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
  const isExternal =
    /^(https?:)?\/\//i.test(trimmed) ||
    (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !trimmed.toLowerCase().startsWith('javascript:'));
  list.push({
    fromPath,
    raw: trimmed,
    resolved: isExternal ? null : resolveVfsPath(fromPath, trimmed),
    kind,
    isExternal,
  });
}

function collectFromHtml(html: string, fromPath: string, list: ResourceRef[]): void {
  const tagRe =
    /<(script|link|img|iframe|source|video|audio|embed|object)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
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

  // inline style url()
  const styleBlocks = html.matchAll(/style\s*=\s*["']([^"']+)["']/gi);
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

function collectFromJs(js: string, fromPath: string, list: ResourceRef[]): void {
  const re =
    /(?:src\s*=\s*|href\s*=\s*|load[A-Za-z]*\(\s*|new\s+Image\(\)[\s\S]{0,40}?\.src\s*=\s*|fetch\(\s*|open\(\s*['"](?:GET|POST)['"]\s*,\s*)['"]([^'"]+)['"]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(js))) {
    pushRef(list, fromPath, m[1], 'js-url');
  }
  // simple string paths ending with asset extensions
  const assetRe = /['"]([^'"]+\.(?:png|jpe?g|gif|svg|js|css|json|mp[34]|wav|ogg|woff2?|ttf|otf))['"]/gi;
  while ((m = assetRe.exec(js))) {
    pushRef(list, fromPath, m[1], 'js-url');
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
