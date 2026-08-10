import type { Finding, Probe, ProbeEvent, Rule, RuleContext } from '../../types';
import { isAllowedExternalUrl } from './limits';

function allTextFiles(ctx: RuleContext): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  for (const p of ctx.vfs.paths()) {
    if (!/\.(html?|js|css|svg|json)$/i.test(p)) continue;
    const text = ctx.vfs.readText(p);
    if (text != null) out.push({ path: p, text });
  }
  return out;
}

function entryText(ctx: RuleContext): string {
  if (!ctx.entryHtmlPath) return '';
  return ctx.vfs.readText(ctx.entryHtmlPath) || '';
}

export const molocoRules: Rule[] = [
  {
    id: 'mo-format',
    category: 'structure',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const paths = ctx.vfs.paths();
      const htmlFiles = paths.filter((p) => /\.html?$/i.test(p));

      if (ctx.bundle.sourceKind === 'zip') {
        findings.push({
          ruleId: 'mo-format',
          category: 'structure',
          severity: 'error',
          messageZh:
            'Moloco 禁止以 .zip 上传。须提交单个自包含 HTML5 文件（.html / .htm），资源以 data-URI 内联。',
          keywordEn: 'must not upload as .zip; HTML5 .html / .htm only',
          evidence: { snippet: paths.slice(0, 8).join(', ') },
        });
      }

      if (paths.length > 1) {
        findings.push({
          ruleId: 'mo-format',
          category: 'structure',
          severity: 'error',
          messageZh: `检测到 ${paths.length} 个文件。Moloco 要求单个广告文件内联全部资源。`,
          keywordEn: 'single ad file with all assets data-URI compressed',
          evidence: { snippet: paths.slice(0, 8).join(', ') },
        });
      }

      if (htmlFiles.length === 0) {
        findings.push({
          ruleId: 'mo-format',
          category: 'structure',
          severity: 'error',
          messageZh: '未找到 HTML。Moloco Playable / IEC 须为 .html 或 .htm。',
          keywordEn: 'HTML5 (.html, .htm)',
        });
      } else if (htmlFiles.length > 1) {
        findings.push({
          ruleId: 'mo-format',
          category: 'structure',
          severity: 'error',
          messageZh: `检测到 ${htmlFiles.length} 个 HTML，Moloco 仅允许单个 HTML5 文件。`,
          keywordEn: 'single HTML5 file',
          evidence: { snippet: htmlFiles.join(', ') },
        });
      }

      if (ctx.entryHtmlPath) {
        const html = entryText(ctx);
        if (!/<!doctype\s+html/i.test(html) || !/<html[\s>]/i.test(html)) {
          findings.push({
            ruleId: 'mo-format',
            category: 'structure',
            severity: 'warning',
            messageZh: '主 HTML 建议包含完整文档结构（<!DOCTYPE html> / <html>）。',
            keywordEn: 'HTML5 document',
            evidence: { path: ctx.entryHtmlPath },
          });
        }
      }

      return findings;
    },
  },
  {
    id: 'mo-bundle-size',
    category: 'size',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const { byteLength } = ctx.bundle;
      const { maxZipBytes, warnZipBytes } = ctx.market.limits;
      if (byteLength > maxZipBytes) {
        findings.push({
          ruleId: 'mo-bundle-size',
          category: 'size',
          severity: 'error',
          messageZh: `文件大小 ${(byteLength / 1024 / 1024).toFixed(2)} MB，超过 Moloco 5 MB 上限。`,
          keywordEn: 'less than 5MB',
        });
      } else if (byteLength > warnZipBytes) {
        findings.push({
          ruleId: 'mo-bundle-size',
          category: 'size',
          severity: 'warning',
          messageZh: `文件大小 ${(byteLength / 1024 / 1024).toFixed(2)} MB，接近 5 MB 上限。`,
          keywordEn: 'less than 5MB',
        });
      }
      return findings;
    },
  },
  {
    id: 'mo-no-external',
    category: 'policy',
    mode: 'hybrid',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      for (const ref of ctx.refs) {
        if (!ref.isExternal) continue;
        if (/^(data:|blob:)/i.test(ref.raw)) continue;
        if (isAllowedExternalUrl(ref.raw, ctx.market.limits.externalUrlAllowlist)) continue;
        findings.push({
          ruleId: 'mo-no-external',
          category: 'policy',
          severity: 'error',
          messageZh: `禁止外部引用/网络请求：${ref.raw}。资源须 data-URI 内联，不得动态外网加载。`,
          keywordEn: 'no external references / HTTP requests / dynamic asset loading',
          evidence: { path: ref.fromPath, snippet: ref.raw },
        });
      }
      return findings;
    },
  },
  {
    id: 'mo-no-xhr',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const all = allTextFiles(ctx)
        .map((f) => f.text)
        .join('\n');
      if (!/XMLHttpRequest/i.test(all)) return [];
      return [
        {
          ruleId: 'mo-no-xhr',
          category: 'policy',
          severity: 'error',
          messageZh: '检测到 XMLHttpRequest。Moloco 禁止素材包含该 JavaScript 对象。',
          keywordEn: 'must not include XMLHttpRequest',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        },
      ];
    },
  },
  {
    id: 'mo-cta',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const all = allTextFiles(ctx)
        .map((f) => f.text)
        .join('\n');
      const hasCta =
        /FbPlayableAd\s*\.\s*onCTAClick\s*\(\s*\)/i.test(all) ||
        /FbPlayableAd\s*\[\s*['"]onCTAClick['"]\s*\]\s*\(\s*\)/i.test(all);
      const hasCtaWithArgs = /FbPlayableAd\s*\.\s*onCTAClick\s*\(\s*[^)\s]/i.test(all);

      if (!hasCta && !hasCtaWithArgs) {
        return [
          {
            ruleId: 'mo-cta',
            category: 'policy',
            severity: 'error',
            messageZh:
              '未检测到 FbPlayableAd.onCTAClick()。Moloco 要求不带参数调用该函数以跳转应用商店。',
            keywordEn: 'FbPlayableAd.onCTAClick() without parameters',
            evidence: { path: ctx.entryHtmlPath ?? undefined },
          },
        ];
      }
      if (hasCtaWithArgs && !hasCta) {
        return [
          {
            ruleId: 'mo-cta',
            category: 'policy',
            severity: 'warning',
            messageZh:
              '检测到 FbPlayableAd.onCTAClick 带参数调用。Moloco 要求不带任何参数调用 onCTAClick()。',
            keywordEn: 'FbPlayableAd.onCTAClick() without parameters',
            evidence: { path: ctx.entryHtmlPath ?? undefined },
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'mo-no-redirect',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const all = allTextFiles(ctx)
        .map((f) => f.text)
        .join('\n');
      const hardRedirect =
        /window\.open\s*\(|top\.location\s*=|location\.href\s*=|location\.replace\s*\(|document\.location\s*=/i.test(
          all,
        );
      const metaRefresh = /<meta[^>]+http-equiv\s*=\s*['"]?refresh/i.test(entryText(ctx));
      if (hardRedirect || metaRefresh) {
        findings.push({
          ruleId: 'mo-no-redirect',
          category: 'policy',
          severity: 'error',
          messageZh:
            '检测到 JavaScript / meta 重定向。Moloco 禁止 JS redirect；请仅通过 FbPlayableAd.onCTAClick() 处理跳转。',
          keywordEn: 'must not include JavaScript redirects',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      }
      return findings;
    },
  },
  {
    id: 'mo-no-mraid',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const all = allTextFiles(ctx)
        .map((f) => f.text)
        .join('\n');
      const usesMraid =
        /mraid\.js/i.test(all) || /\bmraid\b/i.test(all) || /mraid\.open\s*\(/i.test(all);
      if (!usesMraid) return [];
      return [
        {
          ruleId: 'mo-no-mraid',
          category: 'policy',
          severity: 'error',
          messageZh: '检测到 mraid / mraid.js。Moloco 要求素材不得包含 mraid.js。',
          keywordEn: 'must not include mraid.js',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        },
      ];
    },
  },
  {
    id: 'mo-orientation',
    category: 'size',
    mode: 'static',
    runStatic: () => [
      {
        ruleId: 'mo-orientation',
        category: 'size',
        severity: 'info',
        messageZh:
          'Moloco 要求横竖屏均可，并兼容手机/平板/桌面等分辨率。请在预览区分别验证横竖屏布局。',
        keywordEn: 'portrait and landscape; compatible across devices',
      },
    ],
  },
];

export const molocoNetworkProbe: Probe = {
  id: 'mo-network',
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
      findings.push({
        ruleId: 'mo-no-external',
        category: 'policy',
        severity: 'error',
        messageZh: `运行时检测到外部网络请求：${url}`,
        keywordEn: 'no external HTTP requests',
        evidence: { snippet: `${ev.detail.via}: ${url}`, runtime: true },
      });
    }
    return findings;
  },
};

export const molocoCtaProbe: Probe = {
  id: 'mo-cta-shim',
  script: `
(function(){
  try {
    if (!window.FbPlayableAd) {
      window.FbPlayableAd = {};
    }
    var orig = window.FbPlayableAd.onCTAClick;
    window.FbPlayableAd.onCTAClick = function(){
      try {
        if (window.__pvPost) window.__pvPost('exit', { via: 'FbPlayableAd.onCTAClick' });
      } catch (e) {}
      try { console.info('[pv] FbPlayableAd.onCTAClick()'); } catch (e2) {}
      if (typeof orig === 'function') {
        try { return orig.apply(this, arguments); } catch (e3) {}
      }
    };
  } catch (e) {}
})();
`,
  toFindings: (events: ProbeEvent[]) => {
    const clicks = events.filter(
      (e) => e.type === 'exit' && String(e.detail.via || '').includes('FbPlayableAd'),
    );
    if (clicks.length === 0) return [];
    return [
      {
        ruleId: 'mo-cta',
        category: 'policy',
        severity: 'info',
        messageZh: `预览中已捕获 FbPlayableAd.onCTAClick() ${clicks.length} 次。`,
        keywordEn: 'FbPlayableAd.onCTAClick()',
        evidence: { runtime: true },
      },
    ];
  },
};

export const molocoProbes: Probe[] = [molocoNetworkProbe, molocoCtaProbe];
