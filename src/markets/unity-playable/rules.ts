import type { Finding, Probe, ProbeEvent, Rule, RuleContext } from '../../types';
import { isAllowedExternalUrl } from './limits';

function allTextFiles(ctx: RuleContext): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  for (const p of ctx.vfs.paths()) {
    if (!/\.(html?|js|css|svg)$/i.test(p)) continue;
    const text = ctx.vfs.readText(p);
    if (text != null) out.push({ path: p, text });
  }
  return out;
}

function entryText(ctx: RuleContext): string {
  if (!ctx.entryHtmlPath) return '';
  return ctx.vfs.readText(ctx.entryHtmlPath) || '';
}

function isIndexHtml(path: string): boolean {
  const n = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return /(^|\/)index\.html?$/i.test(n);
}

const STORE_URL_RE =
  /play\.google\.com|apps\.apple\.com|itunes\.apple\.com|app\.adjust\.com|app\.appsflyer\.com|market:\/\/|itms-apps:\/\//i;

export const unityRules: Rule[] = [
  {
    id: 'un-single-html',
    category: 'structure',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const paths = ctx.vfs.paths();
      const htmlFiles = paths.filter((p) => /\.html?$/i.test(p));

      if (ctx.bundle.sourceKind === 'zip' && paths.length > 1) {
        findings.push({
          ruleId: 'un-single-html',
          category: 'structure',
          severity: 'error',
          messageZh: `Unity 要求单个自包含 index.html，当前包内有 ${paths.length} 个文件。请将全部资源内联，且不得引用其它文件/文件夹。`,
          keywordEn: 'single HTML index file (index.html), no links to other files',
          evidence: { snippet: paths.slice(0, 8).join(', ') },
        });
      }

      if (htmlFiles.length === 0) {
        findings.push({
          ruleId: 'un-single-html',
          category: 'structure',
          severity: 'error',
          messageZh: '未找到 HTML。Unity Playable 须为单个 index.html。',
          keywordEn: 'single HTML index file (index.html)',
        });
      } else if (htmlFiles.length > 1) {
        findings.push({
          ruleId: 'un-single-html',
          category: 'structure',
          severity: 'error',
          messageZh: `检测到 ${htmlFiles.length} 个 HTML，Unity 仅允许单个 index.html。`,
          keywordEn: 'single HTML index file (index.html)',
          evidence: { snippet: htmlFiles.join(', ') },
        });
      }

      if (ctx.entryHtmlPath && !isIndexHtml(ctx.entryHtmlPath)) {
        findings.push({
          ruleId: 'un-single-html',
          category: 'structure',
          severity: 'warning',
          messageZh: `入口文件名为 ${ctx.entryHtmlPath}，Unity 规范要求命名为 index.html。`,
          keywordEn: 'index.html',
          evidence: { path: ctx.entryHtmlPath },
        });
      }

      if (ctx.entryHtmlPath) {
        const html = entryText(ctx);
        if (!/<!doctype\s+html/i.test(html) || !/<html[\s>]/i.test(html)) {
          findings.push({
            ruleId: 'un-single-html',
            category: 'structure',
            severity: 'error',
            messageZh: '主 HTML 缺少完整文档结构（<!DOCTYPE html> / <html>）。',
            keywordEn: 'HTML5 document',
            evidence: { path: ctx.entryHtmlPath },
          });
        }
      }

      return findings;
    },
  },
  {
    id: 'un-bundle-size',
    category: 'size',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const { byteLength } = ctx.bundle;
      const { maxZipBytes, warnZipBytes } = ctx.market.limits;
      if (byteLength > maxZipBytes) {
        findings.push({
          ruleId: 'un-bundle-size',
          category: 'size',
          severity: 'error',
          messageZh: `文件大小 ${(byteLength / 1024 / 1024).toFixed(2)} MB，超过 Unity 5 MB 上限。`,
          keywordEn: 'less than 5 MB',
        });
      } else if (byteLength > warnZipBytes) {
        findings.push({
          ruleId: 'un-bundle-size',
          category: 'size',
          severity: 'warning',
          messageZh: `文件大小 ${(byteLength / 1024 / 1024).toFixed(2)} MB，接近 5 MB 上限。`,
          keywordEn: 'less than 5 MB',
        });
      }
      return findings;
    },
  },
  {
    id: 'un-minified',
    category: 'structure',
    mode: 'static',
    runStatic: (ctx) => {
      const html = entryText(ctx);
      if (!html || html.length < 8_000) return [];
      const newlines = (html.match(/\n/g) || []).length;
      const ratio = newlines / html.length;
      // Minified playables are typically dense; high newline density suggests unminified source
      if (ratio > 0.012 && newlines > 80) {
        return [
          {
            ruleId: 'un-minified',
            category: 'structure',
            severity: 'warning',
            messageZh:
              '素材看起来未充分 minify。Unity 要求内嵌式缩小文件（移除多余空白以利于机器读取）。',
            keywordEn: 'inlined and minified file',
            evidence: { path: ctx.entryHtmlPath ?? undefined },
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'un-no-external',
    category: 'policy',
    mode: 'hybrid',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      for (const ref of ctx.refs) {
        if (!ref.isExternal) continue;
        if (/^(data:|blob:)/i.test(ref.raw)) continue;
        if (isAllowedExternalUrl(ref.raw, ctx.market.limits.externalUrlAllowlist)) continue;
        findings.push({
          ruleId: 'un-no-external',
          category: 'policy',
          severity: 'error',
          messageZh: `禁止外部资源引用：${ref.raw}。Unity 要求全部资源内联到单个 HTML。`,
          keywordEn: 'single HTML with all assets inlined',
          evidence: { path: ref.fromPath, snippet: ref.raw },
        });
      }
      // Relative refs to other files also violate "no links to other files"
      for (const ref of ctx.refs) {
        if (ref.isExternal) continue;
        if (/^(data:|blob:|#|javascript:)/i.test(ref.raw)) continue;
        if (!/\.(js|css|png|jpe?g|gif|webp|svg|mp3|wav|ogg|json|woff2?|ttf|otf)(\?|#|$)/i.test(ref.raw)) {
          continue;
        }
        findings.push({
          ruleId: 'un-no-external',
          category: 'policy',
          severity: 'error',
          messageZh: `检测到对其它文件的引用：${ref.raw}。Unity 要求无指向其它文件/文件夹的链接，资源须内联。`,
          keywordEn: 'no links to other files or folders',
          evidence: { path: ref.fromPath, snippet: ref.raw },
        });
      }
      return findings;
    },
  },
  {
    id: 'un-mraid',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const all = allTextFiles(ctx)
        .map((f) => f.text)
        .join('\n');

      const usesMraidOpen = /mraid\.open\s*\(/i.test(all);
      const usesViewableChange =
        /viewableChange/i.test(all) ||
        /mraid\.addEventListener\s*\(\s*['"]viewableChange['"]/i.test(all);
      const usesMraidReady =
        /mraid\.addEventListener\s*\(\s*['"]ready['"]/i.test(all) ||
        /mraid\.getState\s*\(/i.test(all);
      const hardRedirect =
        /window\.open\s*\(|top\.location\s*=|location\.href\s*=|location\.replace\s*\(/i.test(all);

      if (!usesMraidOpen && hardRedirect) {
        findings.push({
          ruleId: 'un-mraid',
          category: 'policy',
          severity: 'error',
          messageZh:
            '检测到 window.open / location 跳转，但未使用 mraid.open()。Unity 要求 CTA 使用 mraid.open 直连应用商店。',
          keywordEn: 'mraid.open to app store',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      } else if (!usesMraidOpen) {
        findings.push({
          ruleId: 'un-mraid',
          category: 'policy',
          severity: 'error',
          messageZh:
            '未检测到 mraid.open()。Unity Playable 须符合 MRAID 3.0，且号召性用语应使用 mraid.open 链接到应用商店。',
          keywordEn: 'MRAID 3.0 / mraid.open',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      }

      if (!usesViewableChange) {
        findings.push({
          ruleId: 'un-mraid',
          category: 'policy',
          severity: 'error',
          messageZh:
            '未检测到 mraid viewableChange 监听。Unity 要求在启动试玩内容前等待 MRAID viewableChange 事件。',
          keywordEn: 'wait for MRAID viewableChange before starting',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      }

      if (usesMraidOpen && !usesMraidReady && !usesViewableChange) {
        findings.push({
          ruleId: 'un-mraid',
          category: 'policy',
          severity: 'warning',
          messageZh: '使用了 mraid.open()，但未见 ready / viewableChange 等待逻辑。',
          keywordEn: 'mraid ready / viewableChange',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      }

      return findings;
    },
  },
  {
    id: 'un-no-auto-store',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const all = allTextFiles(ctx)
        .map((f) => f.text)
        .join('\n');

      const autoStore =
        /(?:onload\s*=|DOMContentLoaded|window\.onload)[\s\S]{0,200}(?:mraid\.open|location\.href|window\.open)\s*\([^)]*(?:play\.google|apps\.apple|itunes\.apple|market:)/i.test(
          all,
        ) ||
        /setTimeout\s*\(\s*(?:function\s*\([^)]*\)\s*\{[^}]{0,120}|(?:\(\)\s*=>\s*\{?)[^}]{0,120})?(?:mraid\.open|location\.href|window\.open)\s*\([^)]*(?:play\.google|apps\.apple|itunes\.apple)/i.test(
          all,
        );

      const metaRefreshStore =
        /<meta[^>]+http-equiv\s*=\s*['"]?refresh[^>]+url\s*=\s*[^'"]*(?:play\.google|apps\.apple)/i.test(
          entryText(ctx),
        );

      if (autoStore || metaRefreshStore) {
        findings.push({
          ruleId: 'un-no-auto-store',
          category: 'policy',
          severity: 'error',
          messageZh:
            '疑似在无明确用户操作时自动跳转应用商店。Unity 禁止自动重定向到应用商店。',
          keywordEn: 'must not automatically redirect to the app store',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      }

      // Hard store open without mraid.open is already covered; still flag bare store URLs via location
      if (STORE_URL_RE.test(all) && /location\.(href|replace)\s*=/.test(all) && !/mraid\.open\s*\(/i.test(all)) {
        findings.push({
          ruleId: 'un-no-auto-store',
          category: 'policy',
          severity: 'warning',
          messageZh: '检测到通过 location 打开应用商店链接。请改为在用户点击 CTA 时调用 mraid.open()。',
          keywordEn: 'CTA should use mraid.open',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      }

      return findings;
    },
  },
  {
    id: 'un-orientation',
    category: 'size',
    mode: 'static',
    runStatic: () => [
      {
        ruleId: 'un-orientation',
        category: 'size',
        severity: 'info',
        messageZh:
          'Unity 要求支持纵向与横向。请在预览区分别用竖屏/横屏分辨率验证布局与可玩性。',
        keywordEn: 'support both portrait and landscape orientations',
      },
    ],
  },
  {
    id: 'un-close-ui',
    category: 'policy',
    mode: 'static',
    runStatic: () => [
      {
        ruleId: 'un-close-ui',
        category: 'policy',
        severity: 'info',
        messageZh:
          '广告不得遮挡关闭按钮或其它容器 UI，导致用户无法关闭广告。请避免全屏固定遮罩盖住顶部安全区。',
        keywordEn: 'must not block the close button or container UI',
      },
    ],
  },
  {
    id: 'un-os-versions',
    category: 'policy',
    mode: 'static',
    runStatic: () => [
      {
        ruleId: 'un-os-versions',
        category: 'policy',
        severity: 'info',
        messageZh: 'Unity 要求目标环境：Android 4.4+、iOS 9.0+。请避免仅新浏览器可用的 API。',
        keywordEn: 'Android 4.4+ / iOS 9.0+',
      },
    ],
  },
];

/** Runtime: external network is warned (analytics may be allowed); still surfaces for review. */
export const unityNetworkProbe: Probe = {
  id: 'un-network',
  script: `
(function(){
  try {
  var post = window.__pvPost;
  function report(url, via){
    if (!url) return;
    try { post('network', { url: String(url), via: via }); } catch(e) {}
  }
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
  } catch (e) {}
})();
`,
  toFindings: (events: ProbeEvent[]) => {
    const findings: Finding[] = [];
    const seen = new Set<string>();
    for (const ev of events) {
      if (ev.type !== 'network') continue;
      const url = String(ev.detail.url || '');
      if (!url || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('pv-preview:')) {
        continue;
      }
      const isExternal = /^(https?:)?\/\//i.test(url) || /^[a-z][a-z0-9+.-]*:/i.test(url);
      if (!isExternal) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      const looksLikeAsset =
        /\.(js|css|png|jpe?g|gif|webp|svg|mp3|wav|ogg|mp4|woff2?|ttf|json)(\?|#|$)/i.test(url);
      findings.push({
        ruleId: 'un-no-external',
        category: 'policy',
        severity: looksLikeAsset ? 'error' : 'warning',
        messageZh: looksLikeAsset
          ? `运行时检测到外部资源加载：${url}。Unity 要求资源全部内联。`
          : `运行时检测到网络请求：${url}。Unity 原则上不需要 XHR；若仅为不含个人数据的分析回调，请自行确认合规。`,
        keywordEn: looksLikeAsset
          ? 'all assets inlined'
          : 'no network requests required; analytics may be allowed',
        evidence: { snippet: `${ev.detail.via}: ${url}`, runtime: true },
      });
    }
    return findings;
  },
};

/** Preview MRAID 3.0-ish shim: ready + viewableChange + open. */
export const unityMraidProbe: Probe = {
  id: 'un-mraid-shim',
  script: `
(function(){
  try {
    if (window.mraid) return;
    var listeners = {};
    function emit(name, arg){
      var list = listeners[name] || [];
      for (var i = 0; i < list.length; i++) {
        try { list[i](arg); } catch (e) {}
      }
    }
    var state = 'loading';
    window.mraid = {
      getState: function(){ return state; },
      getVersion: function(){ return '3.0'; },
      isViewable: function(){ return true; },
      open: function(url){
        try {
          if (window.__pvPost) window.__pvPost('exit', { via: 'mraid.open', url: String(url || '') });
        } catch (e) {}
        try { console.info('[pv] mraid.open', url); } catch (e2) {}
      },
      addEventListener: function(name, fn){
        if (!listeners[name]) listeners[name] = [];
        listeners[name].push(fn);
        if (name === 'ready' && state === 'default') {
          try { fn(); } catch (e) {}
        }
        if (name === 'viewableChange' && state === 'default') {
          try { fn(true); } catch (e) {}
        }
      },
      removeEventListener: function(name, fn){
        var list = listeners[name] || [];
        listeners[name] = list.filter(function(f){ return f !== fn; });
      }
    };
    setTimeout(function(){
      state = 'default';
      emit('ready');
      emit('viewableChange', true);
    }, 0);
  } catch (e) {}
})();
`,
  toFindings: (events: ProbeEvent[]) => {
    const opens = events.filter(
      (e) => e.type === 'exit' && String(e.detail.via || '').includes('mraid.open'),
    );
    if (opens.length === 0) return [];
    return [
      {
        ruleId: 'un-mraid',
        category: 'policy',
        severity: 'info',
        messageZh: `预览中已捕获 mraid.open() ${opens.length} 次。`,
        keywordEn: 'mraid.open',
        evidence: { runtime: true },
      },
    ];
  },
};

export const unityProbes: Probe[] = [unityNetworkProbe, unityMraidProbe];
