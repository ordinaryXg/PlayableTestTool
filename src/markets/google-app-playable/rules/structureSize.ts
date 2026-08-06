import type { Finding, Rule, RuleContext } from '../../../types';

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.slice(i).toLowerCase() : '';
}

export const structureRules: Rule[] = [
  {
    id: 'zip-format',
    category: 'structure',
    mode: 'static',
    runStatic: () => [], // produced during loadBundle; placeholder so id exists in pack
  },
  {
    id: 'path-charset',
    category: 'structure',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const re = /^[A-Za-z0-9._\-/]+$/;
      for (const p of ctx.vfs.paths()) {
        if (!re.test(p)) {
          findings.push({
            ruleId: 'path-charset',
            category: 'structure',
            severity: 'error',
            messageZh: `路径包含不支持的字符（仅允许字母、数字、.、-、_）：${p}`,
            keywordEn: 'unsupported characters in path',
            evidence: { path: p },
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'filename-length',
    category: 'structure',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const base = ctx.bundle.fileName.replace(/\.zip$/i, '');
      if (ctx.bundle.sourceKind === 'zip' && base.length > ctx.market.limits.maxZipNameLength) {
        findings.push({
          ruleId: 'filename-length',
          category: 'structure',
          severity: 'error',
          messageZh: `ZIP 文件名（不含扩展名）长度为 ${base.length}，超过 ${ctx.market.limits.maxZipNameLength} 字符限制。`,
          keywordEn: 'Filename >50 characters',
          evidence: { snippet: ctx.bundle.fileName },
        });
      }
      for (const p of ctx.vfs.paths()) {
        if (p.length > ctx.market.limits.maxPathLength) {
          findings.push({
            ruleId: 'filename-length',
            category: 'structure',
            severity: 'warning',
            messageZh: `包内路径过长（${p.length} 字符）：${p}`,
            keywordEn: 'Filename >50 characters',
            evidence: { path: p },
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'primary-html',
    category: 'structure',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      if (!ctx.entryHtmlPath) {
        findings.push({
          ruleId: 'primary-html',
          category: 'structure',
          severity: 'error',
          messageZh:
            '缺少主 HTML 文件。主 HTML 应包含 ad.size 或 ad.orientation 等广告元数据。',
          keywordEn: 'missing a primary .HTML file',
        });
        return findings;
      }
      const html = ctx.vfs.readText(ctx.entryHtmlPath) || '';
      if (!/<!doctype\s+html/i.test(html)) {
        findings.push({
          ruleId: 'primary-html',
          category: 'structure',
          severity: 'error',
          messageZh: '主 HTML 缺少 <!DOCTYPE html> 声明。',
          keywordEn: 'missing a primary .HTML file',
          evidence: { path: ctx.entryHtmlPath },
        });
      }
      if (!/<html[\s>]/i.test(html)) {
        findings.push({
          ruleId: 'primary-html',
          category: 'structure',
          severity: 'error',
          messageZh: '主 HTML 缺少 <html> 标签。',
          keywordEn: 'missing a primary .HTML file',
          evidence: { path: ctx.entryHtmlPath },
        });
      }
      if (!/<head[\s>]/i.test(html)) {
        findings.push({
          ruleId: 'primary-html',
          category: 'structure',
          severity: 'error',
          messageZh: '主 HTML 缺少 <head> 标签。',
          keywordEn: 'missing a primary .HTML file',
          evidence: { path: ctx.entryHtmlPath },
        });
      }
      if (!ctx.adMeta.size && !ctx.adMeta.orientation) {
        findings.push({
          ruleId: 'primary-html',
          category: 'structure',
          severity: 'error',
          messageZh:
            '主 HTML 缺少 ad.size 或 ad.orientation meta。例如 <meta name="ad.size" content="width=320,height=480">。',
          keywordEn: 'missing a primary .HTML file',
          evidence: { path: ctx.entryHtmlPath },
        });
      }
      return findings;
    },
  },
  {
    id: 'primary-creative',
    category: 'structure',
    mode: 'static',
    runStatic: (ctx) => {
      if (!ctx.entryHtmlPath) return [];
      const html = ctx.vfs.readText(ctx.entryHtmlPath) || '';
      if (html.trim().length < 20) {
        return [
          {
            ruleId: 'primary-creative',
            category: 'structure',
            severity: 'warning',
            messageZh: '主创意 HTML 内容过少，可能不是有效的主要创意资产。',
            keywordEn: 'primary creative asset',
            evidence: { path: ctx.entryHtmlPath },
          },
        ];
      }
      return [];
    },
  },
];

export const sizeRules: Rule[] = [
  {
    id: 'ad-dimensions',
    category: 'size',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const { size, orientation } = ctx.adMeta;
      if (orientation) {
        const ok = ['portrait', 'landscape', 'portrait,landscape', 'landscape,portrait'].includes(
          orientation.replace(/\s/g, ''),
        );
        if (!ok) {
          findings.push({
            ruleId: 'ad-dimensions',
            category: 'size',
            severity: 'error',
            messageZh: `ad.orientation 值无效：「${orientation}」。允许 portrait / landscape / portrait,landscape。`,
            keywordEn: 'ad.orientation',
            evidence: { path: ctx.entryHtmlPath ?? undefined, snippet: orientation },
          });
        }
        return findings;
      }
      if (size) {
        const allowed = ctx.market.limits.allowedAdSizes.some(
          (s) => s.w === size.w && s.h === size.h,
        );
        if (!allowed) {
          findings.push({
            ruleId: 'ad-dimensions',
            category: 'size',
            severity: 'error',
            messageZh: `广告尺寸 ${size.w}×${size.h} 不被支持。App Playable 仅支持 320×480 或 480×320（或改用 ad.orientation）。`,
            keywordEn: 'Dimensions are not allowed',
            evidence: {
              path: ctx.entryHtmlPath ?? undefined,
              snippet: `${size.w}x${size.h}`,
            },
          });
        }
      }
      return findings;
    },
  },
  {
    id: 'bundle-size',
    category: 'size',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      const { byteLength } = ctx.bundle;
      const { maxZipBytes, warnZipBytes } = ctx.market.limits;
      if (byteLength > maxZipBytes) {
        findings.push({
          ruleId: 'bundle-size',
          category: 'size',
          severity: 'error',
          messageZh: `捆绑包大小 ${(byteLength / 1024 / 1024).toFixed(2)} MB，超过 ${ (maxZipBytes / 1024 / 1024).toFixed(1) } MB 上限。`,
          keywordEn: 'File size is too large',
        });
      } else if (byteLength > warnZipBytes) {
        findings.push({
          ruleId: 'bundle-size',
          category: 'size',
          severity: 'warning',
          messageZh: `捆绑包大小 ${(byteLength / 1024 / 1024).toFixed(2)} MB，接近上限，上传时可能不稳定。`,
          keywordEn: 'File size is too large',
        });
      }
      return findings;
    },
  },
  {
    id: 'file-type-and-count',
    category: 'size',
    mode: 'static',
    runStatic: (ctx) => {
      const findings: Finding[] = [];
      if (ctx.bundle.fileCount > ctx.market.limits.maxFiles) {
        findings.push({
          ruleId: 'file-type-and-count',
          category: 'size',
          severity: 'error',
          messageZh: `媒体包文件数为 ${ctx.bundle.fileCount}，超过 ${ctx.market.limits.maxFiles} 上限。`,
          keywordEn: 'too many files',
        });
      }
      for (const p of ctx.vfs.paths()) {
        const ext = extOf(p);
        if (!ext || !ctx.market.limits.allowedExtensions.includes(ext)) {
          findings.push({
            ruleId: 'file-type-and-count',
            category: 'size',
            severity: 'error',
            messageZh: `不支持的文件类型：${p}`,
            keywordEn: 'unsupported type',
            evidence: { path: p, snippet: ext || '(no extension)' },
          });
        }
      }
      return findings;
    },
  },
];

export function allStructureAndSizeRules(): Rule[] {
  return [...structureRules, ...sizeRules];
}

/** Helper for tests */
export function runRule(ruleId: string, ctx: RuleContext): Finding[] {
  const rule = allStructureAndSizeRules().find((r) => r.id === ruleId);
  return rule?.runStatic?.(ctx) ?? [];
}
