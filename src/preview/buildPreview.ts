import type { Vfs } from '../types';
import { resolveVfsPath } from '../vfs';

function mimeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html;charset=utf-8';
  if (lower.endsWith('.js')) return 'text/javascript;charset=utf-8';
  if (lower.endsWith('.css')) return 'text/css;charset=utf-8';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.woff2')) return 'font/woff2';
  if (lower.endsWith('.woff')) return 'font/woff';
  if (lower.endsWith('.ttf')) return 'font/ttf';
  if (lower.endsWith('.otf')) return 'font/otf';
  return 'application/octet-stream';
}

function rewriteHtml(html: string, fromPath: string, urlMap: Map<string, string>): string {
  return html.replace(
    /(<(?:script|link|img|source|video|audio)\b[^>]*?\s(?:src|href)\s*=\s*["'])([^"']+)(["'])/gi,
    (full, pre, raw, post) => {
      if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) {
        return full;
      }
      const resolved = resolveVfsPath(fromPath, raw);
      if (!resolved || !urlMap.has(resolved)) return full;
      return `${pre}${urlMap.get(resolved)}${post}`;
    },
  );
}

function rewriteCss(css: string, fromPath: string, urlMap: Map<string, string>): string {
  return css.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi, (full, raw) => {
    if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) {
      return full;
    }
    const resolved = resolveVfsPath(fromPath, raw);
    if (!resolved || !urlMap.has(resolved)) return full;
    return `url("${urlMap.get(resolved)}")`;
  });
}

export interface PreviewHandle {
  url: string;
  revoke: () => void;
}

/**
 * Build a sandboxed preview: each VFS file becomes a blob URL;
 * HTML/CSS relative refs rewritten; probe script injected into entry HTML head.
 */
export async function buildPreview(
  vfs: Vfs,
  entryHtmlPath: string,
  probeScript: string,
): Promise<PreviewHandle> {
  const objectUrls: string[] = [];
  const urlMap = new Map<string, string>();

  // First pass: non-html binary/text assets
  for (const path of vfs.paths()) {
    if (/\.html?$/i.test(path)) continue;
    const bytes = vfs.readBytes(path);
    if (!bytes) continue;
    let body: BlobPart = bytes;
    if (/\.css$/i.test(path)) {
      const text = vfs.readText(path) || '';
      // css rewrite needs urlMap of other assets — do second pass below
      body = text;
    }
    const url = URL.createObjectURL(new Blob([body], { type: mimeFor(path) }));
    objectUrls.push(url);
    urlMap.set(path, url);
  }

  // Rewrite CSS with urlMap
  for (const path of vfs.paths()) {
    if (!/\.css$/i.test(path)) continue;
    const text = vfs.readText(path) || '';
    const rewritten = rewriteCss(text, path, urlMap);
    const old = urlMap.get(path);
    if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(new Blob([rewritten], { type: mimeFor(path) }));
    objectUrls.push(url);
    urlMap.set(path, url);
  }

  // HTML files
  for (const path of vfs.paths()) {
    if (!/\.html?$/i.test(path)) continue;
    let html = vfs.readText(path) || '';
    html = rewriteHtml(html, path, urlMap);
    if (path === entryHtmlPath && probeScript) {
      const inject = `<script>${probeScript.replace(/<\/script>/gi, '<\\/script>')}</script>`;
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, (m) => `${m}${inject}`);
      } else {
        html = inject + html;
      }
    }
    const url = URL.createObjectURL(new Blob([html], { type: mimeFor(path) }));
    objectUrls.push(url);
    urlMap.set(path, url);
  }

  const entryUrl = urlMap.get(entryHtmlPath);
  if (!entryUrl) {
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    throw new Error('无法为入口 HTML 创建预览 URL');
  }

  return {
    url: entryUrl,
    revoke: () => objectUrls.forEach((u) => URL.revokeObjectURL(u)),
  };
}
