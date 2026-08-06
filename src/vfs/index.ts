import JSZip from 'jszip';
import type { BundleMeta, Finding, Vfs } from '../types';

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/^\//, '');
}

export function createVfs(entries: Array<{ path: string; bytes: Uint8Array }>): Vfs {
  const files = new Map<string, Uint8Array>();
  for (const e of entries) {
    const p = normalizePath(e.path);
    if (!p || p.endsWith('/')) continue;
    files.set(p, e.bytes);
  }

  return {
    files,
    paths: () => [...files.keys()].sort(),
    has: (path) => files.has(normalizePath(path)),
    readText: (path) => {
      const bytes = files.get(normalizePath(path));
      if (!bytes) return null;
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    },
    readBytes: (path) => files.get(normalizePath(path)) ?? null,
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

  const baseDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : '';
  const joined = normalizePath(baseDir + trimmed);
  // collapse .. segments
  const parts: string[] = [];
  for (const seg of joined.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}
