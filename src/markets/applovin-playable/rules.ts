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

export const applovinRules: Rule[] = [
  {
    id: 'al-single-html',
    category: 'structure',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const paths = ctx.vfs.paths();
      const htmlFiles = paths.filter((p) => /\.html?$/i.test(p));

      if (ctx.bundle.sourceKind === 'zip' && paths.length > 1) {
        findings.push({
          ruleId: 'al-single-html',
          category: 'structure',
          severity: 'error',
          messageZh: `AppLovin 要求单个自包含 HTML 文件，当前包内有 ${paths.length} 个文件。请将资源以 base64/base122 内联后导出单文件。`,
          keywordEn: 'single HTML file',
          evidence: { snippet: paths.slice(0, 8).join(', ') },
        });
      }

      if (htmlFiles.length === 0) {
        findings.push({
          ruleId: 'al-single-html',
          category: 'structure',
          severity: 'error',
          messageZh: '未找到 HTML 文件。AppLovin Playable 须为单个 .html 文件。',
          keywordEn: 'single HTML file',
        });
      } else if (htmlFiles.length > 1) {
        findings.push({
          ruleId: 'al-single-html',
          category: 'structure',
          severity: 'error',
          messageZh: `检测到 ${htmlFiles.length} 个 HTML 文件，AppLovin 仅允许单个 HTML。`,
          keywordEn: 'single HTML file',
          evidence: { snippet: htmlFiles.join(', ') },
        });
      }

      if (ctx.entryHtmlPath) {
        const html = entryText(ctx);
        if (!/<!doctype\s+html/i.test(html) || !/<html[\s>]/i.test(html)) {
          findings.push({
            ruleId: 'al-single-html',
            category: 'structure',
            severity: 'error',
            messageZh: '主 HTML 缺少完整文档结构（<!DOCTYPE html> / <html>）。',
            keywordEn: 'single HTML file',
            evidence: { path: ctx.entryHtmlPath },
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'al-bundle-size',
    category: 'size',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const { byteLength } = ctx.bundle;
      const { maxZipBytes, warnZipBytes } = ctx.market.limits;
      if (byteLength > maxZipBytes) {
        findings.push({
          ruleId: 'al-bundle-size',
          category: 'size',
          severity: 'error',
          messageZh: `文件大小 ${(byteLength / 1024 / 1024).toFixed(2)} MB，超过 AppLovin 5 MB 上限。`,
          keywordEn: 'File size 5 MB or smaller',
        });
      } else if (byteLength > warnZipBytes) {
        findings.push({
          ruleId: 'al-bundle-size',
          category: 'size',
          severity: 'warning',
          messageZh: `文件大小 ${(byteLength / 1024 / 1024).toFixed(2)} MB，接近 5 MB 上限；建议压缩资源（WebP / 降码率）。`,
          keywordEn: 'File size 5 MB or smaller',
        });
      }
      return findings;
    },
  },
  {
    id: 'al-no-external',
    category: 'policy',
    mode: 'hybrid',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      for (const ref of ctx.refs) {
        if (!ref.isExternal) continue;
        if (isAllowedExternalUrl(ref.raw, ctx.market.limits.externalUrlAllowlist)) continue;
        // data: and blob: are fine
        if (/^(data:|blob:)/i.test(ref.raw)) continue;
        findings.push({
          ruleId: 'al-no-external',
          category: 'policy',
          severity: 'error',
          messageZh: `禁止外部资源/网络引用：${ref.raw}。须使用 base64 或 base122 内联。`,
          keywordEn: 'No external resources / No external requests',
          evidence: { path: ref.fromPath, snippet: ref.raw },
        });
      }
      return findings;
    },
  },
  {
    id: 'al-mraid',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const all = allTextFiles(ctx)
        .map((f) => f.text)
        .join('\n');

      const usesMraidOpen = /mraid\.open\s*\(/i.test(all);
      const usesMraidReady =
        /mraid\.addEventListener\s*\(\s*['"]ready['"]/i.test(all) ||
        /mraid\.getState\s*\(/i.test(all);
      const hardRedirect =
        /window\.open\s*\(|top\.location\s*=|location\.href\s*=|location\.replace\s*\(/i.test(all);

      if (!usesMraidOpen && hardRedirect) {
        findings.push({
          ruleId: 'al-mraid',
          category: 'policy',
          severity: 'error',
          messageZh:
            '检测到 window.open / location 跳转，但未使用 mraid.open()。AppLovin 点击归因要求使用 mraid.open(url)。',
          keywordEn: 'mraid.open()',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      } else if (!usesMraidOpen && !usesMraidReady) {
        findings.push({
          ruleId: 'al-mraid',
          category: 'policy',
          severity: 'warning',
          messageZh:
            '未检测到 MRAID 用法。AppLovin 要求支持 MRAID v2.0；点击跳转应使用 mraid.open()，并在 ready 后再调用 API。',
          keywordEn: 'MRAID v2.0 / mraid.open()',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      } else if (usesMraidOpen && !usesMraidReady) {
        findings.push({
          ruleId: 'al-mraid',
          category: 'policy',
          severity: 'warning',
          messageZh:
            '使用了 mraid.open()，但未检测到 ready / getState 等待。请在 mraid 非 loading 后再调用 API。',
          keywordEn: 'mraid ready / getState',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      }

      return findings;
    },
  },
  {
    id: 'al-orientation',
    category: 'size',
    mode: 'static',
    runStatic: () => [
      {
        ruleId: 'al-orientation',
        category: 'size',
        severity: 'info',
        messageZh:
          'AppLovin 要求横竖屏均可正常运行。请在预览区用「横竖屏」按钮分别验证布局与可玩性。',
        keywordEn: 'Orientation compatibility landscape and portrait',
      },
    ],
  },
  {
    id: 'al-audio-autoplay',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      for (const { path, text } of allTextFiles(ctx)) {
        if (/<audio[^>]+autoplay/i.test(text) || /\.autoplay\s*=\s*true/i.test(text)) {
          findings.push({
            ruleId: 'al-audio-autoplay',
            category: 'policy',
            severity: 'error',
            messageZh: '禁止音频自动播放；须保持静音直至首次用户交互。',
            keywordEn: 'Audio muted until first user interaction',
            evidence: { path },
          });
        }
        if (/new\s+Audio\s*\([^)]*\)[\s\S]{0,80}\.play\s*\(/i.test(text)) {
          findings.push({
            ruleId: 'al-audio-autoplay',
            category: 'policy',
            severity: 'warning',
            messageZh: '检测到可能在加载时播放音频的代码，请确认已默认静音并等待用户交互。',
            keywordEn: 'No auto-play audio',
            evidence: { path },
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'al-webgl-fallback',
    category: 'tooling',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const all = allTextFiles(ctx)
        .map((f) => f.text)
        .join('\n');
      const usesWebgl =
        /getContext\s*\(\s*['"]webgl/i.test(all) || /WebGLRenderingContext/i.test(all);
      if (!usesWebgl) return findings;
      const hasFallback =
        /webgl[\s\S]{0,120}(fail|lost|fallback|不支持|失败)/i.test(all) ||
        /contextlost|webglcontextlost/i.test(all) ||
        /getContext\s*\(\s*['"]2d['"]/i.test(all);
      if (!hasFallback) {
        findings.push({
          ruleId: 'al-webgl-fallback',
          category: 'tooling',
          severity: 'warning',
          messageZh: '检测到 WebGL，但未见明确失败/上下文丢失回退 UI。AppLovin 要求提供 fallback。',
          keywordEn: 'WebGL UI fallback',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      }
      return findings;
    },
  },
];

/** Runtime: external network is always an error for AppLovin. */
export const applovinNetworkProbe: Probe = {
  id: 'al-network',
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
  toFindings: (events: ProbeEvent[], _ctx) => {
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
        ruleId: 'al-no-external',
        category: 'policy',
        severity: 'error',
        messageZh: `运行时检测到外部网络请求：${url}`,
        keywordEn: 'No external requests',
        evidence: { snippet: `${ev.detail.via}: ${url}`, runtime: true },
      });
    }
    return findings;
  },
};

export const applovinProbes: Probe[] = [applovinNetworkProbe];
