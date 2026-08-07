const { protocol } = require('electron');
const path = require('node:path');

/** @type {Map<string, Buffer>} */
let vfsMap = new Map();
let entryHtmlPath = 'index.html';
/** @type {string | null} */
let injectScript = null;

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
}

function clearVfs() {
  vfsMap = new Map();
  entryHtmlPath = 'index.html';
  injectScript = null;
}

function resolveKey(urlPath) {
  let p = normalize(urlPath);
  if (!p || p === '' || p === '/') p = entryHtmlPath;
  if (vfsMap.has(p)) return p;
  if (vfsMap.has(p.toLowerCase())) return p.toLowerCase();
  const base = path.posix.basename(p);
  if (vfsMap.has(base)) return base;
  return null;
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

function registerPreviewProtocol() {
  protocol.registerBufferProtocol('pv-preview', (request, callback) => {
    try {
      const u = new URL(request.url);
      let reqPath = decodeURIComponent((u.pathname || '/').replace(/^\/+/, ''));
      if (!reqPath) reqPath = entryHtmlPath;
      const key = resolveKey(reqPath);
      if (!key || !vfsMap.has(key)) {
        callback({ statusCode: 404, data: Buffer.from(`Not found: ${reqPath}`) });
        return;
      }
      let data = vfsMap.get(key);
      const mime = mimeFor(key);
      if (
        injectScript &&
        key === entryHtmlPath &&
        (mime.startsWith('text/html') || key.toLowerCase().endsWith('.html'))
      ) {
        let html = data.toString('utf8');
        const tag = `<script>${injectScript.replace(/<\/script/gi, '<\\/script')}</script>`;
        if (/<\/body>/i.test(html)) {
          html = html.replace(/<\/body>/i, `${tag}</body>`);
        } else {
          html += tag;
        }
        data = Buffer.from(html, 'utf8');
      }
      callback({
        mimeType: mime,
        data,
      });
    } catch (err) {
      callback({
        statusCode: 500,
        data: Buffer.from(String(err && err.message ? err.message : err)),
      });
    }
  });
}

function entryUrl() {
  return `pv-preview://local/${entryHtmlPath.split('/').map(encodeURIComponent).join('/')}`;
}

module.exports = {
  setVfs,
  clearVfs,
  registerPreviewProtocol,
  entryUrl,
  getEntryPath: () => entryHtmlPath,
};
