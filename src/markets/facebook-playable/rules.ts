import type { Finding, Probe, ProbeEvent, Rule, RuleContext } from '../../types';
import {
  FACEBOOK_HTML_MAX_BYTES,
  FACEBOOK_HTML_WARN_BYTES,
  isAllowedExternalUrl,
} from './limits';

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

function isRootIndex(path: string): boolean {
  const n = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return /^index\.html?$/i.test(n);
}

export const facebookRules: Rule[] = [
  {
    id: 'fb-format',
    category: 'structure',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const paths = ctx.vfs.paths();
      const htmlFiles = paths.filter((p) => /\.html?$/i.test(p));

      if (htmlFiles.length === 0) {
        findings.push({
          ruleId: 'fb-format',
          category: 'structure',
          severity: 'error',
          messageZh:
            '未找到 HTML。Facebook Playable 须为单个 .html/.htm，或含根目录 index.html 的 ZIP。',
          keywordEn: 'HTML5 .html / .htm or ZIP with index.html',
        });
        return findings;
      }

      if (ctx.bundle.sourceKind === 'html' && htmlFiles.length > 1) {
        findings.push({
          ruleId: 'fb-format',
          category: 'structure',
          severity: 'error',
          messageZh: `单文件上传检测到 ${htmlFiles.length} 个 HTML；单 HTML 包应只有一个入口文件。`,
          keywordEn: 'single HTML5 file',
          evidence: { snippet: htmlFiles.join(', ') },
        });
      }

      if (ctx.bundle.sourceKind === 'zip') {
        const hasRootIndex = paths.some(isRootIndex);
        if (!hasRootIndex) {
          findings.push({
            ruleId: 'fb-format',
            category: 'structure',
            severity: 'error',
            messageZh:
              'ZIP 须在根目录包含 index.html（例如 ./index.html）。Meta 要求入口位于压缩包根路径。',
            keywordEn: 'index.html at the root of the ZIP',
            evidence: { snippet: paths.filter((p) => /\.html?$/i.test(p)).slice(0, 8).join(', ') },
          });
        }
      }

      if (ctx.entryHtmlPath) {
        const html = entryText(ctx);
        if (!/<!doctype\s+html/i.test(html) || !/<html[\s>]/i.test(html)) {
          findings.push({
            ruleId: 'fb-format',
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
    id: 'fb-bundle-size',
    category: 'size',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const { byteLength, sourceKind, fileCount } = ctx.bundle;
      const { maxZipBytes, warnZipBytes, maxFiles } = ctx.market.limits;

      if (sourceKind === 'html') {
        if (byteLength > FACEBOOK_HTML_MAX_BYTES) {
          findings.push({
            ruleId: 'fb-bundle-size',
            category: 'size',
            severity: 'error',
            messageZh: `单 HTML 大小 ${(byteLength / 1024 / 1024).toFixed(2)} MB，超过 Meta 2 MB 上限。`,
            keywordEn: 'Uploaded File Is Too Large (HTML ≤ 2MB)',
          });
        } else if (byteLength > FACEBOOK_HTML_WARN_BYTES) {
          findings.push({
            ruleId: 'fb-bundle-size',
            category: 'size',
            severity: 'warning',
            messageZh: `单 HTML 大小 ${(byteLength / 1024 / 1024).toFixed(2)} MB，接近 2 MB 上限。`,
            keywordEn: 'HTML ≤ 2MB',
          });
        }
        return findings;
      }

      // ZIP
      if (byteLength > maxZipBytes) {
        findings.push({
          ruleId: 'fb-bundle-size',
          category: 'size',
          severity: 'error',
          messageZh: `ZIP 大小 ${(byteLength / 1024 / 1024).toFixed(2)} MB，超过 Meta 5 MB 上限。`,
          keywordEn: 'Upload Too Large (ZIP ≤ 5MB)',
        });
      } else if (byteLength > warnZipBytes) {
        findings.push({
          ruleId: 'fb-bundle-size',
          category: 'size',
          severity: 'warning',
          messageZh: `ZIP 大小 ${(byteLength / 1024 / 1024).toFixed(2)} MB，接近 5 MB 上限。`,
          keywordEn: 'ZIP ≤ 5MB',
        });
      }

      if (fileCount > maxFiles) {
        findings.push({
          ruleId: 'fb-bundle-size',
          category: 'size',
          severity: 'error',
          messageZh: `ZIP 内文件数 ${fileCount}，超过 Meta 100 个文件上限。`,
          keywordEn: 'Uploaded Bundle Too Many SubAssets (≤ 100)',
        });
      }

      const indexPath = ctx.vfs.paths().find(isRootIndex) || ctx.entryHtmlPath;
      if (indexPath) {
        const idxBytes = ctx.vfs.readBytes(indexPath)?.byteLength ?? 0;
        if (idxBytes > FACEBOOK_HTML_MAX_BYTES) {
          findings.push({
            ruleId: 'fb-bundle-size',
            category: 'size',
            severity: 'error',
            messageZh: `ZIP 内 ${indexPath} 为 ${(idxBytes / 1024 / 1024).toFixed(2)} MB，超过 2 MB 上限。`,
            keywordEn: 'index.html ≤ 2MB',
            evidence: { path: indexPath },
          });
        }
      }

      return findings;
    },
  },
  {
    id: 'fb-no-external',
    category: 'policy',
    mode: 'hybrid',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      for (const ref of ctx.refs) {
        if (!ref.isExternal) continue;
        if (/^(data:|blob:)/i.test(ref.raw)) continue;
        if (isAllowedExternalUrl(ref.raw, ctx.market.limits.externalUrlAllowlist)) continue;
        findings.push({
          ruleId: 'fb-no-external',
          category: 'policy',
          severity: 'error',
          messageZh: `禁止外部资源/网络引用：${ref.raw}。单 HTML 须 data-URI 内联；ZIP 仅可引用包内相对路径。`,
          keywordEn: 'No external network calls / No dynamic asset loading',
          evidence: { path: ref.fromPath, snippet: ref.raw },
        });
      }
      return findings;
    },
  },
  {
    id: 'fb-cta',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const all = allTextFiles(ctx)
        .map((f) => f.text)
        .join('\n');
      const hasCta =
        /FbPlayableAd\s*\.\s*onCTAClick\s*\(/i.test(all) ||
        /FbPlayableAd\s*\[\s*['"]onCTAClick['"]\s*\]\s*\(/i.test(all);

      if (!hasCta) {
        return [
          {
            ruleId: 'fb-cta',
            category: 'policy',
            severity: 'error',
            messageZh:
              '未检测到 FbPlayableAd.onCTAClick()。Meta 要求在用户点击 CTA 时调用该函数以打开正确应用商店页（Missing CTA Click Function Call）。',
            keywordEn: 'FbPlayableAd.onCTAClick()',
            evidence: { path: ctx.entryHtmlPath ?? undefined },
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'fb-no-redirect',
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
      const hasCta = /FbPlayableAd\s*\.\s*onCTAClick\s*\(/i.test(all);

      if (hardRedirect || metaRefresh) {
        findings.push({
          ruleId: 'fb-no-redirect',
          category: 'policy',
          severity: 'error',
          messageZh: hasCta
            ? '检测到 JavaScript / meta 外链跳转。Meta 禁止 redirect to external link；请仅通过 FbPlayableAd.onCTAClick() 处理 CTA。'
            : '检测到 JavaScript / meta 外链跳转，且未使用 FbPlayableAd.onCTAClick()。请移除 redirect 并改用官方 CTA API。',
          keywordEn: 'Uploaded File Contains Redirect to External Link',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      }
      return findings;
    },
  },
  {
    id: 'fb-no-mraid',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const all = allTextFiles(ctx)
        .map((f) => f.text)
        .join('\n');
      const usesMraid =
        /\bmraid\b/i.test(all) || /mraid\.js/i.test(all) || /mraid\.open\s*\(/i.test(all);
      if (!usesMraid) return [];
      return [
        {
          ruleId: 'fb-no-mraid',
          category: 'policy',
          severity: 'warning',
          messageZh:
            '检测到 MRAID 相关用法。Meta Playable 须在无 mraid.js 环境下可运行；点击跳转请使用 FbPlayableAd.onCTAClick()，勿依赖 MRAID。',
          keywordEn: 'Must work without mraid.js',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        },
      ];
    },
  },
  {
    id: 'fb-orientation',
    category: 'size',
    mode: 'static',
    runStatic: () => [
      {
        ruleId: 'fb-orientation',
        category: 'size',
        severity: 'info',
        messageZh:
          'Meta 要求竖屏构建，并在多种分辨率下自适应。请用预览区竖屏分辨率（如 360×640 / 1080×1920）验证布局。',
        keywordEn: 'Portrait orientation and responsive across resolutions',
      },
    ],
  },
  {
    id: 'fb-file-types',
    category: 'structure',
    mode: 'static',
    runStatic: (ctx) => {
      if (ctx.bundle.sourceKind !== 'zip') return [];
      const findings: Finding[] = [];
      const allowed = new Set(ctx.market.limits.allowedExtensions.map((e) => e.toLowerCase()));
      for (const p of ctx.vfs.paths()) {
        const m = /\.[a-z0-9]+$/i.exec(p);
        const ext = m ? m[0].toLowerCase() : '';
        if (!ext || !allowed.has(ext)) {
          findings.push({
            ruleId: 'fb-file-types',
            category: 'structure',
            severity: 'warning',
            messageZh: `ZIP 中含非常见扩展名文件：${p}。请确认平台可解析该资源。`,
            keywordEn: 'playable ZIP assets',
            evidence: { path: p },
          });
        }
      }
      return findings;
    },
  },
];

/** Runtime: any external network is an error for Facebook playables. */
export const facebookNetworkProbe: Probe = {
  id: 'fb-network',
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
        ruleId: 'fb-no-external',
        category: 'policy',
        severity: 'error',
        messageZh: `运行时检测到外部网络请求：${url}（XMLHttpRequest / fetch 等均不允许）。`,
        keywordEn: 'No external network calls',
        evidence: { snippet: `${ev.detail.via}: ${url}`, runtime: true },
      });
    }
    return findings;
  },
};

/** Preview shim so FbPlayableAd.onCTAClick works outside Meta runtime. */
export const facebookCtaProbe: Probe = {
  id: 'fb-cta-shim',
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
        ruleId: 'fb-cta',
        category: 'policy',
        severity: 'info',
        messageZh: `预览中已捕获 FbPlayableAd.onCTAClick() ${clicks.length} 次。`,
        keywordEn: 'FbPlayableAd.onCTAClick()',
        evidence: { runtime: true },
      },
    ];
  },
};

export const facebookProbes: Probe[] = [facebookNetworkProbe, facebookCtaProbe];
