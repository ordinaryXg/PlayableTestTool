const { protocol } = require('electron');
const path = require('node:path');

/** @type {Map<string, Buffer>} */
let vfsMap = new Map();
let entryHtmlPath = 'index.html';
/** @type {string | null} */
let injectScript = null;
/** Bumped on every setVfs so preview loadURL bypasses Chromium same-URL cache. */
let vfsGeneration = 0;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

function normalize(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .split('?')[0]
    .split('#')[0];
}

function setVfs(files, entry, script) {
  vfsMap = new Map();
  for (const [rawPath, data] of Object.entries(files || {})) {
    const key = normalize(rawPath);
    if (!key) continue;
    const buf = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
    vfsMap.set(key, buf);
    vfsMap.set(key.toLowerCase(), buf);
  }
  entryHtmlPath = normalize(entry || 'index.html');
  injectScript = typeof script === 'string' && script.length > 0 ? script : null;
  vfsGeneration += 1;
}

function clearVfs() {
  vfsMap = new Map();
  entryHtmlPath = 'index.html';
  injectScript = null;
  vfsGeneration += 1;
}

function resolveKey(urlPath) {
  let p = normalize(urlPath);
  if (!p || p === '' || p === '/') p = entryHtmlPath;
  if (vfsMap.has(p)) return p;
  if (vfsMap.has(p.toLowerCase())) return p.toLowerCase();
  const base = path.posix.basename(p);
  if (vfsMap.has(base)) return base;
  if (vfsMap.has(base.toLowerCase())) return base.toLowerCase();
  return null;
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

function isEntryHtml(key) {
  const a = normalize(key);
  const b = normalize(entryHtmlPath);
  return a === b || a.toLowerCase() === b.toLowerCase();
}

function injectIntoHtml(buf) {
  if (!injectScript) return buf;
  let html = buf.toString('utf8');
  // Inject at start of <head> (not between doctype and <html> — that can break parsing).
  const tag = `<script data-pv-inject>${injectScript.replace(/<\/script/gi, '<\\/script')}</script>`;
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => `${m}${tag}`);
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(/<html[^>]*>/i, (m) => `${m}<head>${tag}</head>`);
  } else if (/<body[^>]*>/i.test(html)) {
    html = html.replace(/<body[^>]*>/i, (m) => `${m}${tag}`);
  } else {
    html = `${tag}\n${html}`;
  }
  return Buffer.from(html, 'utf8');
}

function respond(status, data, contentType) {
  const body = Buffer.isBuffer(data) ? new Uint8Array(data) : new Uint8Array(Buffer.from(String(data)));
  return new Response(body, {
    status,
    headers: {
      'content-type': contentType,
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      'access-control-allow-origin': '*',
    },
  });
}

function registerPreviewProtocol() {
  // Prefer protocol.handle so Content-Type is applied reliably (buffer protocol
  // often renders HTML as plain text in recent Electron builds).
  protocol.handle('pv-preview', (request) => {
    try {
      const u = new URL(request.url);
      let reqPath = decodeURIComponent((u.pathname || '/').replace(/^\/+/, ''));
      // Host-only URLs like pv-preview://bundle/ → serve entry HTML
      if (!reqPath) reqPath = entryHtmlPath;

      const key = resolveKey(reqPath);
      if (!key || !vfsMap.has(key)) {
        return respond(404, `Not found: ${reqPath}`, 'text/plain; charset=utf-8');
      }

      let data = vfsMap.get(key);
      let mime = mimeFor(key);

      // Entry without extension: still treat as HTML
      if (isEntryHtml(key) && mime === 'application/octet-stream') {
        mime = 'text/html; charset=utf-8';
      }

      if (isEntryHtml(key) && mime.startsWith('text/html')) {
        data = injectIntoHtml(data);
      }

      return respond(200, data, mime);
    } catch (err) {
      return respond(
        500,
        String(err && err.message ? err.message : err),
        'text/plain; charset=utf-8',
      );
    }
  });
}

function entryUrl() {
  const parts = entryHtmlPath.split('/').filter(Boolean).map(encodeURIComponent);
  const pathPart = parts.join('/') || encodeURIComponent(entryHtmlPath);
  // Query busts Chromium cache so language/channel reinject always reloads HTML.
  return `pv-preview://bundle/${pathPart}?v=${vfsGeneration}&t=${Date.now()}`;
}

module.exports = {
  setVfs,
  clearVfs,
  registerPreviewProtocol,
  entryUrl,
  getEntryPath: () => entryHtmlPath,
  getVfsGeneration: () => vfsGeneration,
};
