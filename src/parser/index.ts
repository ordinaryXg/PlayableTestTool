import type { AdMeta, ResourceRef, Vfs } from '../types';
import { resolveVfsPath } from '../vfs';

const HTML_EXT = /\.(html?|HTML?)$/;

export function findEntryHtml(vfs: Vfs): string | null {
  const paths = vfs.paths().filter((p) => HTML_EXT.test(p));
  if (paths.length === 0) return null;

  const preferred = ['index.html', 'index.htm', 'main.html'];
  for (const name of preferred) {
    const hit = paths.find((p) => p.toLowerCase() === name || p.toLowerCase().endsWith('/' + name));
    if (hit) return hit;
  }

  // Prefer file that contains ad.size or ad.orientation
  for (const p of paths) {
    const html = vfs.readText(p) || '';
    if (/name\s*=\s*["']ad\.(size|orientation)["']/i.test(html)) return p;
  }

  return paths[0];
}

export function parseAdMeta(html: string): AdMeta {
  const isGwd =
    /gwd-/i.test(html) ||
    /google.?web.?designer/i.test(html) ||
    /name\s*=\s*["']environment["']/i.test(html);

  let size: AdMeta['size'];
  const sizeMatch = html.match(
    /<meta[^>]*name\s*=\s*["']ad\.size["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i,
  ) || html.match(
    /<meta[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']ad\.size["'][^>]*>/i,
  );
  if (sizeMatch) {
    const w = Number(/width\s*=\s*(\d+)/i.exec(sizeMatch[1])?.[1]);
    const h = Number(/height\s*=\s*(\d+)/i.exec(sizeMatch[1])?.[1]);
    if (Number.isFinite(w) && Number.isFinite(h)) size = { w, h };
  }

  let orientation: string | undefined;
  const oriMatch = html.match(
    /<meta[^>]*name\s*=\s*["']ad\.orientation["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i,
  ) || html.match(
    /<meta[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']ad\.orientation["'][^>]*>/i,
  );
  if (oriMatch) orientation = oriMatch[1].trim().toLowerCase();

  let environment: string | undefined;
  const envMatch = html.match(
    /<meta[^>]*name\s*=\s*["']environment["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i,
  ) || html.match(
    /<meta[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']environment["'][^>]*>/i,
  );
  if (envMatch) environment = envMatch[1].trim().toLowerCase();

  return { size, orientation, environment, isGwd };
}

function pushRef(
  list: ResourceRef[],
  fromPath: string,
  raw: string,
  kind: ResourceRef['kind'],
): void {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('#')) {
    return;
  }
  // Skip javascript: / mailto: etc.
  if (/^(javascript|mailto|tel):/i.test(trimmed)) return;
  const isExternal =
    /^(https?:)?\/\//i.test(trimmed) ||
    (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !trimmed.toLowerCase().startsWith('javascript:'));

  if (!isExternal && !isPlausibleAssetRef(trimmed)) return;

  list.push({
    fromPath,
    raw: trimmed,
    resolved: isExternal ? null : resolveVfsPath(fromPath, trimmed),
    kind,
    isExternal,
  });
}

/** Reject mime fragments / extension-only / garbage often found inside inlined playable code. */
function isPlausibleAssetRef(raw: string): boolean {
  const decoded = raw.split(/[?#]/)[0].trim();
  if (!decoded) return false;
  // ".png" / ".js" — not a real file path
  if (/^\.\w{1,10}$/i.test(decoded)) return false;
  // "image/png" mime type mistaken as path
  if (/^(image|audio|video|application|text|font)\/[\w.+-]+$/i.test(decoded)) return false;
  // must have a non-empty basename stem (foo.png, not .png)
  const base = decoded.replace(/\\/g, '/').split('/').pop() || '';
  if (!base || base === '.' || base === '..') return false;
  if (/^\.\w+$/i.test(base)) return false;
  return true;
}

/**
 * Remove script/style/noscript bodies so we don't treat string literals inside
 * inlined playable bundles as real <img src> / <link href> tags.
 * External <script src> / <link href> opening tags are preserved.
 */
function scrubInlineBodies(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, (_, attrs: string) => {
      // keep opening tag if it may declare src; drop body always
      return `<script${attrs}></script>`;
    })
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
}

function collectFromHtml(html: string, fromPath: string, list: ResourceRef[]): void {
  // Real <style> blocks (before scrub) — skip data: urls inside via pushRef
  const styleTagRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = styleTagRe.exec(html))) {
    collectCssUrls(sm[1], fromPath, list);
  }

  const markup = scrubInlineBodies(html);
  const tagRe =
    /<(script|link|img|iframe|source|video|audio|embed|object)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(markup))) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const src = /(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!src) continue;
    const kind: ResourceRef['kind'] =
      tag === 'script'
        ? 'script'
        : tag === 'link'
          ? 'link'
          : tag === 'img'
            ? 'img'
            : tag === 'iframe'
              ? 'iframe'
              : 'other';
    pushRef(list, fromPath, src, kind);
  }

  // element inline style="..." on real markup only
  const styleBlocks = markup.matchAll(/style\s*=\s*["']([^"']+)["']/gi);
  for (const s of styleBlocks) collectCssUrls(s[1], fromPath, list);
}

function collectCssUrls(css: string, fromPath: string, list: ResourceRef[]): void {
  const re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    pushRef(list, fromPath, m[1], 'css-url');
  }
  const importRe = /@import\s+(?:url\()?['"]?([^'")\s]+)['"]?\)?/gi;
  while ((m = importRe.exec(css))) {
    pushRef(list, fromPath, m[1], 'css-url');
  }
}

function looksLikeFilePath(s: string): boolean {
  if (!s || s.length > 512) return false;
  if (/^(https?:)?\/\//i.test(s) || s.startsWith('data:') || s.startsWith('blob:')) return true;
  const n = s.replace(/\\/g, '/');
  // relative/absolute path or simple filename with a normal extension
  return /^(?:\.\.?\/|\/)?[^?\s#]+?\.\w{1,8}$/i.test(n);
}

function collectFromJs(js: string, fromPath: string, list: ResourceRef[]): void {
  // JS 内路径仅用于第三方/安全 URL 等启发式，不参与 missing-assets。
  // 忽略 base64，避免噪声。
  const scrubbed = js.replace(/data:[^;]+;base64,[A-Za-z0-9+/=\s]+/gi, 'data:stripped');

  const re =
    /(?:fetch\(\s*|open\(\s*['"](?:GET|POST)['"]\s*,\s*|new\s+WebSocket\(\s*)['"]([^'"]+)['"]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scrubbed))) {
    if (looksLikeFilePath(m[1]) || /^(https?:)?\/\//i.test(m[1])) {
      pushRef(list, fromPath, m[1], 'js-url');
    }
  }
}

export function collectReferences(vfs: Vfs, entryHtmlPath: string | null): ResourceRef[] {
  const list: ResourceRef[] = [];
  if (!entryHtmlPath) return list;

  const queue = [entryHtmlPath];
  const seen = new Set<string>();

  while (queue.length) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const text = vfs.readText(path);
    if (text == null) continue;

    if (/\.html?$/i.test(path)) {
      collectFromHtml(text, path, list);
    } else if (/\.css$/i.test(path)) {
      collectCssUrls(text, path, list);
    } else if (/\.js$/i.test(path)) {
      collectFromJs(text, path, list);
    }

    for (const ref of list) {
      if (ref.fromPath !== path) continue;
      if (ref.isExternal || !ref.resolved) continue;
      if (vfs.has(ref.resolved) && /\.(html?|css|js)$/i.test(ref.resolved) && !seen.has(ref.resolved)) {
        queue.push(ref.resolved);
      }
    }
  }

  return list;
}

export function buildRuleExtras(vfs: Vfs, entryHtmlPath: string | null) {
  const html = entryHtmlPath ? vfs.readText(entryHtmlPath) || '' : '';
  return {
    adMeta: parseAdMeta(html),
    refs: collectReferences(vfs, entryHtmlPath),
  };
}
