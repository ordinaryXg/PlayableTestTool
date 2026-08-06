import type { Finding, Probe, ProbeEvent, RuleContext } from '../../../types';
import { isAllowedExternalUrl } from '../limits';

/** Shared probe bootstrap: defines __pvPost and hooks. Concatenated into wrapper. */
export const PROBE_BOOTSTRAP = `
(function(){
  function __pvPost(type, detail){
    try {
      parent.postMessage({ source: 'playable-validator-probe', type: type, detail: detail || {}, at: Date.now() }, '*');
    } catch (e) {}
  }
  window.__pvPost = __pvPost;
})();
`;

export const networkProbe: Probe = {
  id: 'network',
  script: `
(function(){
  var post = window.__pvPost;
  function report(url, via){
    if (!url) return;
    try { post('network', { url: String(url), via: via }); } catch(e) {}
  }
  var ofetch = window.fetch;
  if (ofetch) {
    window.fetch = function(input, init){
      var url = typeof input === 'string' ? input : (input && input.url);
      report(url, 'fetch');
      return ofetch.apply(this, arguments);
    };
  }
  var XO = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url){
    report(url, 'xhr');
    return XO.apply(this, arguments);
  };
  var NativeImage = window.Image;
  window.Image = function(){
    var img = new NativeImage();
    var desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src') ||
               Object.getOwnPropertyDescriptor(Image.prototype, 'src');
    if (desc && desc.set) {
      Object.defineProperty(img, 'src', {
        set: function(v){ report(v, 'image'); desc.set.call(this, v); },
        get: function(){ return desc.get ? desc.get.call(this) : ''; }
      });
    }
    return img;
  };
  window.Image.prototype = NativeImage.prototype;

  var Obs = window.MutationObserver;
  if (Obs) {
    new Obs(function(muts){
      muts.forEach(function(m){
        m.addedNodes && m.addedNodes.forEach(function(n){
          if (!n || n.nodeType !== 1) return;
          var tag = n.tagName;
          if (tag === 'SCRIPT' || tag === 'IMG' || tag === 'IFRAME' || tag === 'LINK') {
            report(n.src || n.href, tag.toLowerCase());
          }
        });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (window.WebSocket) {
    var WS = window.WebSocket;
    window.WebSocket = function(url, protocols){
      report(url, 'websocket');
      return protocols !== undefined ? new WS(url, protocols) : new WS(url);
    };
    window.WebSocket.prototype = WS.prototype;
  }
})();
`,
  toFindings: (events, ctx) => {
    const findings: Finding[] = [];
    const seen = new Set<string>();
    for (const ev of events) {
      if (ev.type !== 'network') continue;
      const url = String(ev.detail.url || '');
      if (!url || url.startsWith('blob:') || url.startsWith('data:')) continue;
      const isExternal = /^(https?:)?\/\//i.test(url) || /^[a-z][a-z0-9+.-]*:/i.test(url);
      if (!isExternal) continue;
      if (isAllowedExternalUrl(url, ctx.market.limits.externalUrlAllowlist)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      findings.push({
        ruleId: 'third-party-calls',
        category: 'policy',
        severity: 'error',
        messageZh: `运行时检测到第三方请求：${url}`,
        keywordEn: 'Invalid fourth party call',
        evidence: { snippet: `${ev.detail.via}: ${url}`, runtime: true },
      });
    }
    return findings;
  },
};

export const exitProbe: Probe = {
  id: 'exit',
  script: `
(function(){
  var post = window.__pvPost;
  var count = 0;
  function onExit(via){
    count += 1;
    post('exit', { via: via, count: count });
  }
  function wrapExitApi(){
    var E = window.ExitApi || window.ExitAPI;
    if (!E) return false;
    var orig = E.exit;
    if (typeof orig === 'function' && !orig.__pvWrapped) {
      E.exit = function(){
        onExit('ExitApi.exit');
        return orig.apply(this, arguments);
      };
      E.exit.__pvWrapped = true;
    }
    return true;
  }
  wrapExitApi();
  var tries = 0;
  var t = setInterval(function(){
    if (wrapExitApi() || ++tries > 40) clearInterval(t);
  }, 100);

  document.addEventListener('click', function(e){
    var el = e.target;
    var hops = 0;
    while (el && hops < 5) {
      if (el.tagName === 'A' && el.href && !String(el.getAttribute('href')||'').startsWith('#')) {
        post('navigation', { href: el.href });
      }
      el = el.parentElement; hops++;
    }
  }, true);
})();
`,
  toFindings: (events, _ctx) => {
    const exits = events.filter((e) => e.type === 'exit');
    const findings: Finding[] = [];
    if (exits.length > 1) {
      findings.push({
        ruleId: 'multiple-exits',
        category: 'policy',
        severity: 'warning',
        messageZh: `运行时在采集窗口内触发了 ${exits.length} 次退出调用。`,
        keywordEn: 'multiple exits',
        evidence: {
          runtime: true,
          snippet: exits.map((e) => String(e.detail.via)).join(', '),
        },
      });
    }
    return findings;
  },
};

export const storageProbe: Probe = {
  id: 'storage',
  script: `
(function(){
  var post = window.__pvPost;
  ['localStorage','sessionStorage'].forEach(function(name){
    try {
      var s = window[name];
      if (!s) return;
      ['setItem','getItem','removeItem','clear'].forEach(function(method){
        var orig = s[method].bind(s);
        s[method] = function(){
          post('storage', { api: name, method: method });
          return orig.apply(null, arguments);
        };
      });
    } catch (e) {}
  });
})();
`,
  toFindings: (events: ProbeEvent[], _ctx: RuleContext) => {
    const hits = events.filter((e) => e.type === 'storage');
    if (hits.length === 0) return [];
    return [
      {
        ruleId: 'disallowed-html5',
        category: 'policy',
        severity: 'error',
        messageZh: '运行时检测到 localStorage/sessionStorage 调用。',
        keywordEn: 'Unsupported HTML5 feature',
        evidence: {
          runtime: true,
          snippet: hits
            .slice(0, 5)
            .map((h) => `${h.detail.api}.${h.detail.method}`)
            .join(', '),
        },
      } satisfies Finding,
    ];
  },
};

export const googleProbes: Probe[] = [networkProbe, exitProbe, storageProbe];

export function buildProbeScript(probes: Probe[]): string {
  return [PROBE_BOOTSTRAP, ...probes.map((p) => p.script)].join('\n');
}
