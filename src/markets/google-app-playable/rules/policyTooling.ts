import type { Finding, Rule, RuleContext } from '../../../types';
import { isAllowedExternalUrl } from '../limits';

function allTextFiles(ctx: RuleContext): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  for (const p of ctx.vfs.paths()) {
    if (!/\.(html?|js|css|svg)$/i.test(p)) continue;
    const text = ctx.vfs.readText(p);
    if (text != null) out.push({ path: p, text });
  }
  return out;
}

export const policyRules: Rule[] = [
  {
    id: 'third-party-calls',
    category: 'policy',
    mode: 'hybrid',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      for (const ref of ctx.refs) {
        if (!ref.isExternal) continue;
        if (isAllowedExternalUrl(ref.raw, ctx.market.limits.externalUrlAllowlist)) continue;
        findings.push({
          ruleId: 'third-party-calls',
          category: 'policy',
          severity: 'error',
          messageZh: `检测到不允许的第三方/外部引用：${ref.raw}`,
          keywordEn: 'Invalid fourth party call / external reference',
          evidence: { path: ref.fromPath, snippet: ref.raw },
        });
      }
      return findings;
    },
  },
  {
    id: 'resource-preload',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      for (const { path, text } of allTextFiles(ctx)) {
        const re =
          /<link[^>]+rel\s*=\s*["'](?:preload|prefetch|preconnect|dns-prefetch)["'][^>]*>/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          const tag = m[0];
          const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
          if (href && (/^(https?:)?\/\//i.test(href) || /^[a-z][a-z0-9+.-]*:/i.test(href))) {
            if (!isAllowedExternalUrl(href, ctx.market.limits.externalUrlAllowlist)) {
              findings.push({
                ruleId: 'resource-preload',
                category: 'policy',
                severity: 'warning',
                messageZh: `检测到指向包外资源的预加载：${href}`,
                keywordEn: 'preload / prefetch',
                evidence: { path, snippet: tag.slice(0, 120) },
              });
            }
          }
        }
      }
      return findings;
    },
  },
  {
    id: 'custom-exit-disallowed',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      // GWD + ExitAPI is improperly configured
      if (ctx.adMeta.isGwd) {
        for (const { path, text } of allTextFiles(ctx)) {
          if (/ExitApi\.exit|ExitAPI\.exit|exitapi\.js/i.test(text)) {
            findings.push({
              ruleId: 'custom-exit-disallowed',
              category: 'policy',
              severity: 'error',
              messageZh:
                'GWD 创意中不应使用 ExitAPI；请使用 Tap Area，并在 Google Ads 中配置最终到达网址。',
              keywordEn: 'Custom exit / Exit found',
              evidence: { path },
            });
          }
        }
      }
      // window.open / top.location hard exits
      for (const { path, text } of allTextFiles(ctx)) {
        if (/window\.open\s*\(|top\.location\s*=|location\.replace\s*\(/i.test(text)) {
          findings.push({
            ruleId: 'custom-exit-disallowed',
            category: 'policy',
            severity: 'warning',
            messageZh: '检测到可能的自定义跳转（window.open / top.location 等），App 投放中可能不符合退出规范。',
            keywordEn: 'Custom exit',
            evidence: { path },
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'exit-api-script',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      if (ctx.adMeta.isGwd) return [];
      const findings: Finding[] = [];
      const entry = ctx.entryHtmlPath ? ctx.vfs.readText(ctx.entryHtmlPath) || '' : '';
      const hasLiteral =
        /<script[^>]+src\s*=\s*["'][^"']*exitapi[^"']*["'][^>]*>\s*<\/script>/i.test(entry) ||
        /<script[^>]+src\s*=\s*["'][^"']*exitapi[^"']*["'][^>]*\/?>/i.test(entry);
      const usesExit = /ExitApi\.exit\s*\(|ExitAPI\.exit\s*\(/i.test(entry);
      const dynamicInject = /createElement\s*\(\s*['"]script['"]\s*\)[\s\S]{0,200}exitapi/i.test(
        entry,
      );

      if (usesExit && !hasLiteral) {
        findings.push({
          ruleId: 'exit-api-script',
          category: 'policy',
          severity: 'error',
          messageZh:
            '调用了 ExitApi.exit()，但未以字面量 <script src="...exitapi.js"> 引入。动态注入会导致整页可点等问题。',
          keywordEn: 'ExitApi.exit / exitapi.js',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      }
      if (dynamicInject) {
        findings.push({
          ruleId: 'exit-api-script',
          category: 'policy',
          severity: 'warning',
          messageZh: '检测到通过 JS 动态注入 exitapi，应以字面量 script 标签引入。',
          keywordEn: 'exitapi.js',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      }
      if (!usesExit && !hasLiteral) {
        findings.push({
          ruleId: 'exit-api-script',
          category: 'policy',
          severity: 'info',
          messageZh:
            '未检测到 ExitApi。若不自行处理点击退出，Google Ads 可能自动添加 Install CTA。',
          keywordEn: 'ExitApi.exit / exitapi.js',
          evidence: { path: ctx.entryHtmlPath ?? undefined },
        });
      }
      return findings;
    },
  },
  {
    id: 'disallowed-html5',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      for (const { path, text } of allTextFiles(ctx)) {
        if (/<(iframe|frame|frameset|object|embed)\b/i.test(text)) {
          findings.push({
            ruleId: 'disallowed-html5',
            category: 'policy',
            severity: 'error',
            messageZh: '不允许使用 iframe / frame / object / embed 嵌入内容。',
            keywordEn: 'Unacceptable HTML5 ad',
            evidence: { path },
          });
        }
        if (/<amp-|\bcdm\.ampproject\.org\b/i.test(text)) {
          findings.push({
            ruleId: 'disallowed-html5',
            category: 'policy',
            severity: 'error',
            messageZh: 'App Campaigns 不支持 AMPHTML。',
            keywordEn: 'Unsupported HTML5 feature',
            evidence: { path },
          });
        }
        if (/localStorage|sessionStorage/i.test(text)) {
          findings.push({
            ruleId: 'disallowed-html5',
            category: 'policy',
            severity: 'warning',
            messageZh:
              '源码中出现 localStorage/sessionStorage。Google HTML5 广告文档写明不支持本地存储；官方校验器未必报错，但投放侧仍可能出问题。',
            keywordEn: 'Unsupported HTML5 feature',
            evidence: { path },
          });
        }
        if (/rdf:description/i.test(text)) {
          findings.push({
            ruleId: 'disallowed-html5',
            category: 'policy',
            severity: 'error',
            messageZh: '检测到不支持的 SVG/HTML5 特征（如 rdf:description）。',
            keywordEn: 'UNSUPPORTED_HTML5_FEATURE',
            evidence: { path, snippet: 'rdf:description' },
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'missing-assets',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const seen = new Set<string>();
      // 只检查 HTML/CSS 声明式引用。Playable 常把资源内联进 JS（base64 / 虚拟 FS），
      // JS 字符串里的路径不等于 ZIP 内真实文件，不能当缺失资源报错。
      const declarative = new Set(['script', 'link', 'img', 'css-url', 'iframe', 'other']);
      for (const ref of ctx.refs) {
        if (ref.isExternal) continue;
        if (!ref.resolved) continue;
        if (!declarative.has(ref.kind)) continue;
        // 扩展名片段（如 .png）不是有效资源路径
        if (/^\.\w{1,10}$/i.test(ref.resolved)) continue;
        if (ctx.vfs.has(ref.resolved)) continue;
        const key = `${ref.fromPath}|${ref.resolved}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({
          ruleId: 'missing-assets',
          category: 'policy',
          severity: 'error',
          messageZh: `引用的资源在 ZIP 中不存在：${ref.resolved}`,
          keywordEn: "asset that couldn't be found",
          evidence: { path: ref.fromPath, snippet: ref.raw },
        });
      }
      return findings;
    },
  },
  {
    id: 'multiple-exits',
    category: 'policy',
    mode: 'hybrid',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      let count = 0;
      const locations: string[] = [];
      for (const { path, text } of allTextFiles(ctx)) {
        const matches = text.match(/ExitApi\.exit\s*\(|ExitAPI\.exit\s*\(/gi);
        if (matches) {
          count += matches.length;
          locations.push(`${path}×${matches.length}`);
        }
      }
      if (count > 1) {
        findings.push({
          ruleId: 'multiple-exits',
          category: 'policy',
          severity: 'warning',
          messageZh: `检测到多处 ExitApi.exit 调用（${count} 次），可能触发 multiple exits 问题。`,
          keywordEn: 'multiple exits',
          evidence: { snippet: locations.join(', ') },
        });
      }
      return findings;
    },
  },
  {
    id: 'secure-url',
    category: 'policy',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      for (const ref of ctx.refs) {
        if (/^http:\/\//i.test(ref.raw)) {
          findings.push({
            ruleId: 'secure-url',
            category: 'policy',
            severity: 'error',
            messageZh: `检测到非 HTTPS URL：${ref.raw}`,
            keywordEn: 'Invalid URL / secure URL',
            evidence: { path: ref.fromPath, snippet: ref.raw },
          });
        }
        // malformed
        if (ref.isExternal) {
          try {
            // eslint-disable-next-line no-new
            new URL(ref.raw.startsWith('//') ? `https:${ref.raw}` : ref.raw);
          } catch {
            findings.push({
              ruleId: 'secure-url',
              category: 'policy',
              severity: 'error',
              messageZh: `URL 格式无效：${ref.raw}`,
              keywordEn: 'Invalid URL',
              evidence: { path: ref.fromPath, snippet: ref.raw },
            });
          }
        }
      }
      return findings;
    },
  },
];

export const toolingRules: Rule[] = [
  {
    id: 'doubleclick-studio',
    category: 'tooling',
    mode: 'static',
    runStatic: (ctx) => {
      if (ctx.adMeta.isGwd) return [];
      const findings: Finding[] = [];
      for (const { path, text } of allTextFiles(ctx)) {
        if (/\bEnabler\b/.test(text) || /studio\/Enabler\.js/i.test(text)) {
          findings.push({
            ruleId: 'doubleclick-studio',
            category: 'tooling',
            severity: 'error',
            messageZh:
              '检测到 DoubleClick Studio Enabler。自定义 HTML5 包不支持 Studio 构建；请移除 Enabler 引用。',
            keywordEn: 'DoubleClick Studio / Enabler',
            evidence: { path },
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'gwd-environment',
    category: 'tooling',
    mode: 'static',
    runStatic: (ctx) => {
      if (!ctx.adMeta.isGwd && !ctx.adMeta.environment) return [];
      const findings: Finding[] = [];
      const env = ctx.adMeta.environment;
      if (env === 'gwd-genericad' || env === 'gwd-dv360') {
        findings.push({
          ruleId: 'gwd-environment',
          category: 'tooling',
          severity: 'error',
          messageZh: `GWD 广告环境为「${env}」，须改为 gwd-googleads 或 gwd-admob。`,
          keywordEn: 'gwd-googleads / Google Web Designer',
          evidence: { path: ctx.entryHtmlPath ?? undefined, snippet: env },
        });
      }
      // unpublished source markers
      for (const { path, text } of allTextFiles(ctx)) {
        if (/gwd-motion-path|data-gwd-source|source\.html/i.test(text) && /gwd-preview/i.test(text)) {
          findings.push({
            ruleId: 'gwd-environment',
            category: 'tooling',
            severity: 'warning',
            messageZh: '疑似未 Publish 的 GWD 源工程特征，请使用「Publish locally」后再上传。',
            keywordEn: 'not published',
            evidence: { path },
          });
        }
      }
      if (ctx.adMeta.isGwd && env && env !== 'gwd-googleads' && env !== 'gwd-admob') {
        if (env !== 'gwd-genericad' && env !== 'gwd-dv360') {
          findings.push({
            ruleId: 'gwd-environment',
            category: 'tooling',
            severity: 'warning',
            messageZh: `GWD environment 为「${env}」，建议确认为 gwd-googleads 或 gwd-admob。`,
            keywordEn: 'gwd-googleads',
            evidence: { path: ctx.entryHtmlPath ?? undefined, snippet: env },
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'no-swiffy',
    category: 'tooling',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      for (const { path, text } of allTextFiles(ctx)) {
        if (/swiffy/i.test(text) || /swiffyobject/i.test(text)) {
          findings.push({
            ruleId: 'no-swiffy',
            category: 'tooling',
            severity: 'error',
            messageZh: '禁止使用 Swiffy 构建的素材。',
            keywordEn: 'Swiffy',
            evidence: { path },
          });
        }
      }
      return findings;
    },
  },
];

export function allPolicyAndToolingRules(): Rule[] {
  return [...policyRules, ...toolingRules];
}
