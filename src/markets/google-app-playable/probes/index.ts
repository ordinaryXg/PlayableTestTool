import type { Finding, Probe } from '../../../types';
import { isAllowedExternalUrl } from '../limits';

/** Shared probe bootstrap: defines __pvPost and hooks. Concatenated into wrapper. */
export const PROBE_BOOTSTRAP = `
(function(){
  function __pvPost(type, detail){
    var msg = { source: 'playable-validator-probe', type: type, detail: detail || {}, at: Date.now() };
    try {
      if (window.pvDesktopProbe && typeof window.pvDesktopProbe.post === 'function') {
        window.pvDesktopProbe.post(msg);
      }
    } catch (e) {}
    try {
      parent.postMessage(msg, '*');
    } catch (e) {}
  }
  window.__pvPost = __pvPost;
})();
`;

export const networkProbe: Probe = {
  id: 'network',
  script: `
(function(){
  try {
  var post = window.__pvPost;
  function report(url, via){
    if (!url) return;
    try { post('network', { url: String(url), via: via }); } catch(e) {}
  }
  // 只挂钩 fetch / XHR / DOM 新增节点，避免改写 Image/WebSocket 构造器导致引擎报错
  if (window.fetch) {
    var ofetch = window.fetch.bind(window);
    window.fetch = function(input, init){
      try {
        var url = typeof input === 'string' ? input : (input && input.url);
        report(url, 'fetch');
      } catch (e) {}
      return ofetch(input, init);
    };
  }
  if (window.XMLHttpRequest && XMLHttpRequest.prototype) {
    var XO = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url){
      try { report(url, 'xhr'); } catch (e) {}
      return XO.apply(this, arguments);
    };
  }
  if (window.MutationObserver && document.documentElement) {
    try {
      new MutationObserver(function(muts){
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
    } catch (e) {}
  }
  } catch (e) {}
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
  try {
  var post = window.__pvPost;
  var count = 0;
  function onExit(via){
    count += 1;
    try { post('exit', { via: via, count: count }); } catch (e) {}
  }
  function wrapExitApi(){
    try {
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
    } catch (e) { return false; }
  }
  wrapExitApi();
  var tries = 0;
  var t = setInterval(function(){
    if (wrapExitApi() || ++tries > 40) clearInterval(t);
  }, 100);

  document.addEventListener('click', function(e){
    try {
      var el = e.target;
      var hops = 0;
      while (el && hops < 5) {
        if (el.tagName === 'A' && el.href && !String(el.getAttribute('href')||'').startsWith('#')) {
          post('navigation', { href: el.href });
        }
        el = el.parentElement; hops++;
      }
    } catch (err) {}
  }, true);
  } catch (e) {}
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

export const googleProbes: Probe[] = [networkProbe, exitProbe];

export function buildProbeScript(probes: Probe[]): string {
  return [PROBE_BOOTSTRAP, ...probes.map((p) => p.script)].join('\n');
}

/** Compliance probes + console/FPS devtools hooks. */
export function buildPreviewInjection(probes: Probe[], devtoolsScript: string): string {
  return [PROBE_BOOTSTRAP, ...probes.map((p) => p.script), devtoolsScript].join('\n');
}
