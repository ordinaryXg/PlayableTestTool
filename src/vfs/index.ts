import JSZip from 'jszip';
import type { BundleMeta, Finding, Vfs } from '../types';

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/^\//, '');
}

/** Strip query/hash and percent-decode a resource reference (HTML 输出转码很常见). */
export function decodeAssetRef(raw: string): string {
  let s = raw.trim().replace(/^['"]|['"]$/g, '');
  const q = s.search(/[?#]/);
  if (q >= 0) s = s.slice(0, q);
  // repeatedly decode in case of double-encoding
  for (let i = 0; i < 3; i++) {
    if (!/%[0-9A-Fa-f]{2}/.test(s)) break;
    try {
      const next = decodeURIComponent(s);
      if (next === s) break;
      s = next;
    } catch {
      break;
    }
  }
  return s;
}

function collapseDots(path: string): string {
  const parts: string[] = [];
  for (const seg of normalizePath(path).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

export function createVfs(entries: Array<{ path: string; bytes: Uint8Array }>): Vfs {
  const files = new Map<string, Uint8Array>();
  /** alias (decoded / lowercase) → canonical path */
  const alias = new Map<string, string>();

  const rememberAlias = (key: string, canonical: string) => {
    if (!key) return;
    if (!alias.has(key)) alias.set(key, canonical);
    const low = key.toLowerCase();
    if (!alias.has(low)) alias.set(low, canonical);
  };

  for (const e of entries) {
    const canonical = collapseDots(normalizePath(e.path));
    if (!canonical || canonical.endsWith('/')) continue;
    if (!files.has(canonical)) files.set(canonical, e.bytes);
    rememberAlias(canonical, canonical);
    const decoded = collapseDots(decodeAssetRef(canonical));
    if (decoded) rememberAlias(decoded, canonical);
  }

  const resolveKey = (path: string): string | null => {
    const candidates = [path, decodeAssetRef(path)].map((p) => collapseDots(p));
    for (const c of candidates) {
      if (!c) continue;
      if (files.has(c)) return c;
      const via = alias.get(c) ?? alias.get(c.toLowerCase());
      if (via && files.has(via)) return via;
    }
    return null;
  };

  return {
    files,
    paths: () => [...files.keys()].sort(),
    has: (path) => resolveKey(path) != null,
    readText: (path) => {
      const key = resolveKey(path);
      if (!key) return null;
      const bytes = files.get(key);
      if (!bytes) return null;
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    },
    readBytes: (path) => {
      const key = resolveKey(path);
      return key ? (files.get(key) ?? null) : null;
    },
    normalize: normalizePath,
  };
}

export interface LoadBundleResult {
  vfs: Vfs;
  bundle: BundleMeta;
  findings: Finding[];
}

function zipFormatError(messageZh: string, snippet?: string): Finding {
  return {
    ruleId: 'zip-format',
    category: 'structure',
    severity: 'error',
    messageZh,
    keywordEn: 'ZIP file cannot be processed',
    evidence: snippet ? { snippet } : undefined,
  };
}

export async function loadBundle(file: File): Promise<LoadBundleResult> {
  const name = file.name;
  const lower = name.toLowerCase();
  const byteLength = file.size;

  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const path = normalizePath(name.split(/[/\\]/).pop() || 'index.html');
    const vfs = createVfs([{ path, bytes: buf }]);
    return {
      vfs,
      bundle: {
        fileName: name,
        byteLength,
        fileCount: 1,
        sourceKind: 'html',
      },
      findings: [],
    };
  }

  if (!lower.endsWith('.zip')) {
    const empty = createVfs([]);
    return {
      vfs: empty,
      bundle: { fileName: name, byteLength, fileCount: 0, sourceKind: 'zip' },
      findings: [
        zipFormatError('仅支持上传 .zip 或 .html 文件。', name),
      ],
    };
  }

  try {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entries: Array<{ path: string; bytes: Uint8Array }> = [];
    const tasks: Promise<void>[] = [];

    zip.forEach((relativePath, entry) => {
      if (entry.dir) return;
      tasks.push(
        entry.async('uint8array').then((bytes) => {
          entries.push({ path: relativePath, bytes });
        }),
      );
    });

    await Promise.all(tasks);
    const vfs = createVfs(entries);
    return {
      vfs,
      bundle: {
        fileName: name,
        byteLength,
        fileCount: vfs.paths().length,
        sourceKind: 'zip',
      },
      findings: [],
    };
  } catch (err) {
    const empty = createVfs([]);
    return {
      vfs: empty,
      bundle: { fileName: name, byteLength, fileCount: 0, sourceKind: 'zip' },
      findings: [
        zipFormatError(
          'ZIP 无法解压：文件损坏或不是有效的 ZIP 归档。请重新压缩后再试。',
          err instanceof Error ? err.message : String(err),
        ),
      ],
    };
  }
}

/** Resolve a relative URL against a file path inside the VFS. */
export function resolveVfsPath(fromPath: string, raw: string): string | null {
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null; // absolute URL
  if (trimmed.startsWith('//')) return null;

  const decoded = decodeAssetRef(trimmed);
  if (!decoded || decoded.startsWith('data:') || decoded.startsWith('blob:')) return null;

  const baseDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : '';
  // Root-absolute within bundle: "/assets/a.png" → "assets/a.png"
  if (decoded.startsWith('/')) {
    return collapseDots(decoded);
  }
  return collapseDots(baseDir + decoded);
}
