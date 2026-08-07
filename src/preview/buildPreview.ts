import type { Vfs } from '../types';
import { resolveVfsPath } from '../vfs';

function mapUrl(urlMap: Map<string, string>, resolved: string | null): string | undefined {
  if (!resolved) return undefined;
  if (urlMap.has(resolved)) return urlMap.get(resolved);
  const hit = [...urlMap.keys()].find((k) => k.toLowerCase() === resolved.toLowerCase());
  return hit ? urlMap.get(hit) : undefined;
}

function mimeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html;charset=utf-8';
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'text/javascript;charset=utf-8';
  if (lower.endsWith('.css')) return 'text/css;charset=utf-8';
  if (lower.endsWith('.json')) return 'application/json;charset=utf-8';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.woff2')) return 'font/woff2';
  if (lower.endsWith('.woff')) return 'font/woff';
  if (lower.endsWith('.ttf')) return 'font/ttf';
  if (lower.endsWith('.otf')) return 'font/otf';
  if (lower.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}

function rewriteCss(css: string, fromPath: string, urlMap: Map<string, string>): string {
  return css.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi, (full, raw) => {
    if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) {
      return full;
    }
    const resolved = resolveVfsPath(fromPath, raw);
    const mapped = mapUrl(urlMap, resolved);
    if (!mapped) return full;
    return `url("${mapped}")`;
  });
}

function escapeForInlineScript(code: string): string {
  return code.replace(/<\/script>/gi, '<\\/script>');
}

/** Inline local script/link stylesheet tags so engines don't depend on blob-relative loads. */
function inlineLocalScriptsAndStyles(
  html: string,
  fromPath: string,
  vfs: Vfs,
  urlMap: Map<string, string>,
): string {
  // <link rel="stylesheet" href="...">
  html = html.replace(/<link\b([^>]*?)>/gi, (full, attrs: string) => {
    const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || '';
    if (!/\bstylesheet\b/i.test(rel)) {
      // still rewrite other link hrefs (preload etc.) to blob if possible
      return full.replace(/(href\s*=\s*["'])([^"']+)(["'])/i, (m, pre, raw, post) => {
        if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return m;
        const resolved = resolveVfsPath(fromPath, raw);
        const mapped = mapUrl(urlMap, resolved);
        return mapped ? `${pre}${mapped}${post}` : m;
      });
    }
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!href || /^(https?:)?\/\//i.test(href) || href.startsWith('data:')) return full;
    const resolved = resolveVfsPath(fromPath, href);
    if (!resolved || !vfs.has(resolved)) return full;
    let css = vfs.readText(resolved) || '';
    css = rewriteCss(css, resolved, urlMap);
    return `<style data-pv-inline="${resolved}">${css}</style>`;
  });

  // <script src="..."></script> or self-closing-ish
  html = html.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (full, attrs: string, body: string) => {
      const src = /src\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
      if (!src) return full; // already inline
      if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('blob:')) {
        return full;
      }
      const resolved = resolveVfsPath(fromPath, src);
      if (!resolved || !vfs.has(resolved)) {
        // leave tag but point to blob if we have it
        const mapped = mapUrl(urlMap, resolved);
        if (mapped) {
          const newAttrs = attrs.replace(/(src\s*=\s*["'])([^"']+)(["'])/i, `$1${mapped}$3`);
          return `<script${newAttrs}>${body}</script>`;
        }
        return full;
      }
      const code = vfs.readText(resolved) || '';
      const stripped = attrs
        .replace(/\ssrc\s*=\s*["'][^"']+["']/i, '')
        .replace(/\scrossorigin\s*=\s*["'][^"']*["']/i, '');
      return `<script${stripped} data-pv-inline="${resolved}">${escapeForInlineScript(code)}</script>`;
    },
  );

  // media tags → blob urls
  html = html.replace(
    /(<(?:img|source|video|audio)\b[^>]*?\s(?:src|href)\s*=\s*["'])([^"']+)(["'])/gi,
    (full, pre, raw, post) => {
      if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) {
        return full;
      }
      const resolved = resolveVfsPath(fromPath, raw);
      const mapped = mapUrl(urlMap, resolved);
      return mapped ? `${pre}${mapped}${post}` : full;
    },
  );

  return html;
}

/**
 * Runtime shim: blob HTML has no directory, so relative fetch/XHR/src must be remapped to VFS blobs.
 */
function buildVfsShim(entryHtmlPath: string, urlMap: Map<string, string>): string {
  const files: Record<string, string> = {};
  for (const [path, url] of urlMap) {
    files[path] = url;
    files[path.toLowerCase()] = url;
    const base = path.split('/').pop();
    if (base && !files[base]) files[base] = url;
  }
  const baseDir = entryHtmlPath.includes('/')
    ? entryHtmlPath.slice(0, entryHtmlPath.lastIndexOf('/') + 1)
    : '';

  return `
(function(){
  var FILES = ${JSON.stringify(files)};
  var BASE = ${JSON.stringify(baseDir)};
  function norm(p){
    p = String(p || '').split('#')[0].split('?')[0];
    try { p = decodeURIComponent(p); } catch (e) {}
    p = p.replace(/\\\\/g, '/');
    if (/^(https?:|data:|blob:|javascript:)/i.test(p)) return null;
    if (p.startsWith('/')) p = p.replace(/^\\/+/, '');
    else p = BASE + p;
    var parts = [];
    p.split('/').forEach(function(seg){
      if (!seg || seg === '.') return;
      if (seg === '..') { parts.pop(); return; }
      parts.push(seg);
    });
    return parts.join('/');
  }
  function mapUrl(u){
    if (!u) return u;
    var s = String(u);
    if (/^(https?:|data:|blob:|javascript:)/i.test(s)) return s;
    var n = norm(s);
    if (!n) return s;
    return FILES[n] || FILES[n.toLowerCase()] || FILES[n.split('/').pop()] || s;
  }
  try {
    if (window.fetch) {
      var _fetch = window.fetch.bind(window);
      window.fetch = function(input, init){
        try {
          if (typeof input === 'string') input = mapUrl(input);
          else if (input && typeof input.url === 'string') {
            var mapped = mapUrl(input.url);
            if (mapped !== input.url) input = new Request(mapped, input);
          }
        } catch (e) {}
        return _fetch(input, init);
      };
    }
  } catch (e) {}
  try {
    if (window.XMLHttpRequest) {
      var _open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url){
        try { if (typeof url === 'string') arguments[1] = mapUrl(url); } catch (e) {}
        return _open.apply(this, arguments);
      };
    }
  } catch (e) {}
  function hookSrc(proto, prop){
    try {
      var desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc || !desc.set) return;
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set: function(v){
          try { v = mapUrl(v); } catch (e) {}
          return desc.set.call(this, v);
        }
      });
    } catch (e) {}
  }
  try { hookSrc(HTMLScriptElement.prototype, 'src'); } catch (e) {}
  try { hookSrc(HTMLImageElement.prototype, 'src'); } catch (e) {}
  try { hookSrc(HTMLLinkElement.prototype, 'href'); } catch (e) {}
  try { hookSrc(HTMLSourceElement.prototype, 'src'); } catch (e) {}
})();`;
}

export interface PreviewHandle {
  url: string;
  revoke: () => void;
}

/**
 * Build preview HTML:
 * 1) blob URLs for all VFS assets
 * 2) inline local JS/CSS into entry HTML (reliable boot order)
 * 3) inject VFS shim so runtime relative fetch/XHR/src still resolve
 * 4) inject validator probes
 */
export async function buildPreview(
  vfs: Vfs,
  entryHtmlPath: string,
  probeScript: string,
): Promise<PreviewHandle> {
  const objectUrls: string[] = [];
  const urlMap = new Map<string, string>();

  for (const path of vfs.paths()) {
    if (/\.html?$/i.test(path)) continue;
    const bytes = vfs.readBytes(path);
    if (!bytes) continue;
    let body: BlobPart = bytes;
    if (/\.css$/i.test(path)) {
      body = vfs.readText(path) || '';
    }
    const url = URL.createObjectURL(new Blob([body], { type: mimeFor(path) }));
    objectUrls.push(url);
    urlMap.set(path, url);
  }

  // rewrite css blobs with asset urls
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

  // also register html files as blobs (for rare secondary navigations)
  for (const path of vfs.paths()) {
    if (!/\.html?$/i.test(path)) continue;
    if (path === entryHtmlPath) continue;
    const raw = vfs.readText(path) || '';
    const url = URL.createObjectURL(new Blob([raw], { type: mimeFor(path) }));
    objectUrls.push(url);
    urlMap.set(path, url);
  }

  let html = vfs.readText(entryHtmlPath) || '';
  html = inlineLocalScriptsAndStyles(html, entryHtmlPath, vfs, urlMap);

  const shim = buildVfsShim(entryHtmlPath, urlMap);
  const probe = probeScript || '';
  const inject = `<script data-pv-shim>${escapeForInlineScript(shim)}</script>` +
    (probe ? `<script data-pv-probe>${escapeForInlineScript(probe)}</script>` : '');

  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}${inject}`);
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(/<html[^>]*>/i, (m) => `${m}<head>${inject}</head>`);
  } else {
    html = inject + html;
  }

  const entryUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  objectUrls.push(entryUrl);

  return {
    url: entryUrl,
    revoke: () => objectUrls.forEach((u) => URL.revokeObjectURL(u)),
  };
}
