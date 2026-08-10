import type { Finding, Probe, ProbeEvent, Rule, RuleContext } from '../../types';
import { isAllowedExternalUrl, isSafeFileToken, zipBaseName } from './limits';

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

function pathParts(path: string): string[] {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').split('/').filter(Boolean);
}

export const mintegralRules: Rule[] = [
  {
    id: 'mtg-format',
    category: 'structure',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const paths = ctx.vfs.paths();
      const htmlFiles = paths.filter((p) => /\.html?$/i.test(p));

      if (htmlFiles.length === 0) {
        findings.push({
          ruleId: 'mtg-format',
          category: 'structure',
          severity: 'error',
          messageZh:
            '未找到 HTML。Mintegral 支持单个 HTML，或含资源的 ZIP（Mindworks Playable Testing）。',
          keywordEn: 'single HTML or Zip with resources',
        });
        return findings;
      }

      if (htmlFiles.length > 1) {
        findings.push({
          ruleId: 'mtg-format',
          category: 'structure',
          severity: 'warning',
          messageZh: `检测到 ${htmlFiles.length} 个 HTML 入口，请确认主入口唯一且可本地直接打开。`,
          keywordEn: 'HTML file inside the ZIP needs to be openable locally',
          evidence: { snippet: htmlFiles.slice(0, 8).join(', ') },
        });
      }

      if (ctx.entryHtmlPath) {
        const html = entryText(ctx);
        if (!/<!doctype\s+html/i.test(html) || !/<html[\s>]/i.test(html)) {
          findings.push({
            ruleId: 'mtg-format',
            category: 'structure',
            severity: 'warning',
            messageZh: '主 HTML 建议包含完整文档结构（<!DOCTYPE html> / <html>），以便本地可打开。',
            keywordEn: 'HTML openable locally',
            evidence: { path: ctx.entryHtmlPath },
          });
        }
      }

      return findings;
    },
  },
  {
    id: 'mtg-bundle-size',
    category: 'size',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const { byteLength } = ctx.bundle;
      const { maxZipBytes, warnZipBytes } = ctx.market.limits;
      if (byteLength > maxZipBytes) {
        findings.push({
          ruleId: 'mtg-bundle-size',
          category: 'size',
          severity: 'error',
          messageZh: `包大小 ${(byteLength / 1024 / 1024).toFixed(2)} MB，超过 Mintegral / Mindworks 5 MB 上限。`,
          keywordEn: 'Zip / playable ≤ 5M',
        });
      } else if (byteLength > warnZipBytes) {
        findings.push({
          ruleId: 'mtg-bundle-size',
          category: 'size',
          severity: 'warning',
          messageZh: `包大小 ${(byteLength / 1024 / 1024).toFixed(2)} MB，接近 5 MB 上限。`,
          keywordEn: 'Zip / playable ≤ 5M',
        });
      }
      return findings;
    },
  },
  {
    id: 'mtg-naming',
    category: 'structure',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const zipBase = zipBaseName(ctx.bundle.fileName);

      if (!isSafeFileToken(zipBase)) {
        findings.push({
          ruleId: 'mtg-naming',
          category: 'structure',
          severity: 'error',
          messageZh: `包名「${zipBase}」含非法字符。Mindworks 要求文件名仅含字母、数字、下划线。`,
          keywordEn: 'file names only letters, numbers, and underscores',
          evidence: { snippet: ctx.bundle.fileName },
        });
      }

      for (const p of ctx.vfs.paths()) {
        for (const part of pathParts(p)) {
          const token = part.replace(/\.[^.]+$/, '');
          if (token && !isSafeFileToken(token)) {
            findings.push({
              ruleId: 'mtg-naming',
              category: 'structure',
              severity: 'error',
              messageZh: `路径「${p}」含非法字符。仅允许字母、数字、下划线。`,
              keywordEn: 'file names only letters, numbers, and underscores',
              evidence: { path: p },
            });
            break;
          }
        }
      }

      if (ctx.bundle.sourceKind === 'zip' && ctx.entryHtmlPath) {
        const parts = pathParts(ctx.entryHtmlPath);
        const htmlBase = (parts[parts.length - 1] || '').replace(/\.[^.]+$/i, '');
        const folder = parts.length >= 2 ? parts[0] : null;

        // Expected: name.zip > name/ > name.html (identical names)
        if (htmlBase !== zipBase) {
          findings.push({
            ruleId: 'mtg-naming',
            category: 'structure',
            severity: 'error',
            messageZh: `ZIP 名「${zipBase}」与 HTML 名「${htmlBase}」不一致。须 Zip / 资源文件夹 / HTML 同名（如 demo.zip → demo/demo.html）。`,
            keywordEn: 'Zip File, Assets Folder, HTML must be the same name',
            evidence: { path: ctx.entryHtmlPath, snippet: ctx.bundle.fileName },
          });
        } else if (folder && folder !== zipBase) {
          findings.push({
            ruleId: 'mtg-naming',
            category: 'structure',
            severity: 'error',
            messageZh: `资源文件夹「${folder}」与 ZIP 名「${zipBase}」不一致。须三者同名。`,
            keywordEn: 'Zip File, Assets Folder, HTML must be the same name',
            evidence: { path: ctx.entryHtmlPath },
          });
        } else if (!folder && ctx.vfs.paths().length > 1) {
          findings.push({
            ruleId: 'mtg-naming',
            category: 'structure',
            severity: 'warning',
            messageZh:
              '多文件 ZIP 建议使用「包名/包名.html」目录结构（Zip、文件夹、HTML 同名），以符合 Mindworks 规范。',
            keywordEn: 'Zip File, Assets Folder, HTML must be the same name',
            evidence: { path: ctx.entryHtmlPath },
          });
        }
      }

      return findings;
    },
  },
  {
    id: 'mtg-api',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const all = allTextFiles(ctx)
        .map((f) => f.text)
        .join('\n');

      const hasInstall =
        /window\.install\s*&&\s*window\.install\s*\(/i.test(all) ||
        /window\.install\s*\(/i.test(all);
      const hasGameEnd =
        /window\.gameEnd\s*&&\s*window\.gameEnd\s*\(/i.test(all) ||
        /window\.gameEnd\s*\(/i.test(all);
      const hasGameReady =
        /window\.gameReady\s*&&\s*window\.gameReady\s*\(/i.test(all) ||
        /window\.gameReady\s*\(/i.test(all);
      const hasGameStart =
        /function\s+gameStart\s*\(/i.test(all) ||
        /window\.gameStart\s*=/i.test(all) ||
        /(?:const|let|var)\s+gameStart\s*=/i.test(all);

      if (!hasInstall) {
        findings.push({
          ruleId: 'mtg-api',
          category: 'policy',
          severity: 'error',
          messageZh:
            '未检测到 window.install()。跳转商店须调用 window.install && window.install()。',
          keywordEn: 'window.install && window.install()',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      }
      if (!hasGameEnd) {
        findings.push({
          ruleId: 'mtg-api',
          category: 'policy',
          severity: 'error',
          messageZh:
            '未检测到 window.gameEnd()。试玩结束（通关/失败/进结束页）时应调用 window.gameEnd && window.gameEnd()。',
          keywordEn: 'window.gameEnd && window.gameEnd()',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      }
      if (!hasGameReady) {
        findings.push({
          ruleId: 'mtg-api',
          category: 'policy',
          severity: 'error',
          messageZh:
            '未检测到 window.gameReady()。加载完成可交互时应调用 window.gameReady && window.gameReady()。',
          keywordEn: 'window.gameReady && window.gameReady()',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      }
      if (!hasGameStart) {
        findings.push({
          ruleId: 'mtg-api',
          category: 'policy',
          severity: 'warning',
          messageZh:
            '未检测到全局 gameStart()。Mindworks 会在开始时调用该函数（倒计时/BGM 等逻辑可放此处）。',
          keywordEn: 'function gameStart()',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      }

      return findings;
    },
  },
  {
    id: 'mtg-no-external',
    category: 'policy',
    mode: 'hybrid',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      for (const ref of ctx.refs) {
        if (!ref.isExternal) continue;
        if (/^(data:|blob:)/i.test(ref.raw)) continue;
        if (isAllowedExternalUrl(ref.raw, ctx.market.limits.externalUrlAllowlist)) continue;
        findings.push({
          ruleId: 'mtg-no-external',
          category: 'policy',
          severity: 'error',
          messageZh: `检测到外部/动态资源引用：${ref.raw}。除 JS/HTML 外资源应 base64 内联，且勿动态外网请求。`,
          keywordEn: 'assets base64; no dynamical external request',
          evidence: { path: ref.fromPath, snippet: ref.raw },
        });
      }
      return findings;
    },
  },
  {
    id: 'mtg-no-auto-redirect',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const all = allTextFiles(ctx)
        .map((f) => f.text)
        .join('\n');
      const auto =
        /(?:onload\s*=|DOMContentLoaded|window\.onload)[\s\S]{0,200}(?:window\.install|location\.href|window\.open)\s*\(/i.test(
          all,
        ) ||
        /setTimeout\s*\(\s*(?:function|\([^)]*\)\s*=>)[\s\S]{0,160}(?:window\.install|location\.href|window\.open)\s*\(/i.test(
          all,
        );
      if (!auto) return [];
      return [
        {
          ruleId: 'mtg-no-auto-redirect',
          category: 'policy',
          severity: 'error',
          messageZh: '疑似无用户操作自动跳转/调用 install。Mindworks 要求避免加载后自动跳转。',
          keywordEn: 'avoid auto-redirects without user actions',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        },
      ];
    },
  },
  {
    id: 'mtg-console',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const all = allTextFiles(ctx)
        .map((f) => f.text)
        .join('\n');
      if (!/console\s*=\s*|window\.console\s*=/i.test(all)) return [];
      return [
        {
          ruleId: 'mtg-console',
          category: 'policy',
          severity: 'warning',
          messageZh:
            '检测到覆盖全局 console。Mindworks 提示勿覆盖 console，以免影响跳转与 gameClose 等能力。',
          keywordEn: 'do not override global console',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        },
      ];
    },
  },
  {
    id: 'mtg-pc-support',
    category: 'policy',
    mode: 'static',
    runStatic: () => [
      {
        ruleId: 'mtg-pc-support',
        category: 'policy',
        severity: 'info',
        messageZh:
          'Mindworks 检测在浏览器中运行：请确保滑动/点击等可用鼠标完成（勿仅依赖触控手势）。',
        keywordEn: 'support PC browser / mouse interactions',
      },
    ],
  },
];

export const mintegralNetworkProbe: Probe = {
  id: 'mtg-network',
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
        ruleId: 'mtg-no-external',
        category: 'policy',
        severity: 'error',
        messageZh: `运行时检测到外部网络请求：${url}`,
        keywordEn: 'no dynamical external request',
        evidence: { snippet: `${ev.detail.via}: ${url}`, runtime: true },
      });
    }
    return findings;
  },
};

/** Preview shims for Mindworks APIs. */
export const mintegralApiProbe: Probe = {
  id: 'mtg-api-shim',
  script: `
(function(){
  try {
    function wrap(name){
      var orig = window[name];
      window[name] = function(){
        try {
          if (window.__pvPost) window.__pvPost('exit', { via: 'mtg.' + name });
        } catch (e) {}
        try { console.info('[pv] window.' + name + '()'); } catch (e2) {}
        if (typeof orig === 'function') {
          try { return orig.apply(this, arguments); } catch (e3) {}
        }
      };
    }
    wrap('install');
    wrap('gameEnd');
    wrap('gameReady');
    if (typeof window.gameStart === 'function') {
      try { setTimeout(function(){ try { window.gameStart(); } catch (e) {} }, 0); } catch (e4) {}
    }
  } catch (e) {}
})();
`,
  toFindings: (events: ProbeEvent[]) => {
    const findings: Finding[] = [];
    const count = (via: string) =>
      events.filter((e) => e.type === 'exit' && String(e.detail.via || '') === via).length;
    const installN = count('mtg.install');
    const endN = count('mtg.gameEnd');
    const readyN = count('mtg.gameReady');
    if (installN + endN + readyN === 0) return [];
    if (installN) {
      findings.push({
        ruleId: 'mtg-api',
        category: 'policy',
        severity: 'info',
        messageZh: `预览中已捕获 window.install() ${installN} 次。`,
        keywordEn: 'window.install()',
        evidence: { runtime: true },
      });
    }
    if (endN) {
      findings.push({
        ruleId: 'mtg-api',
        category: 'policy',
        severity: 'info',
        messageZh: `预览中已捕获 window.gameEnd() ${endN} 次。`,
        keywordEn: 'window.gameEnd()',
        evidence: { runtime: true },
      });
    }
    if (readyN) {
      findings.push({
        ruleId: 'mtg-api',
        category: 'policy',
        severity: 'info',
        messageZh: `预览中已捕获 window.gameReady() ${readyN} 次。`,
        keywordEn: 'window.gameReady()',
        evidence: { runtime: true },
      });
    }
    return findings;
  },
};

export const mintegralProbes: Probe[] = [mintegralNetworkProbe, mintegralApiProbe];
