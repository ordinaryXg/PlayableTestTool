import { describe, expect, it } from 'vitest';
import { createVfs, resolveVfsPath } from '../vfs';
import { findEntryHtml, parseAdMeta, collectReferences } from '../parser';
import { mergeFindings } from '../engine';
import { googleAppPlayableMarket } from '../markets/google-app-playable';
import type { Finding, RuleContext } from '../types';

function ctxFromFiles(
  files: Record<string, string>,
  bundleName = 'ad.zip',
): RuleContext {
  const entries = Object.entries(files).map(([path, text]) => ({
    path,
    bytes: new TextEncoder().encode(text),
  }));
  const vfs = createVfs(entries);
  const entryHtmlPath = findEntryHtml(vfs);
  const html = entryHtmlPath ? vfs.readText(entryHtmlPath) || '' : '';
  return {
    vfs,
    entryHtmlPath,
    bundle: {
      fileName: bundleName,
      byteLength: entries.reduce((n, e) => n + e.bytes.byteLength, 0),
      fileCount: entries.length,
      sourceKind: 'zip',
    },
    market: googleAppPlayableMarket,
    refs: collectReferences(vfs, entryHtmlPath),
    adMeta: parseAdMeta(html),
  };
}

const VALID_HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="ad.size" content="width=320,height=480">
<script src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script>
</head>
<body>
<button onclick="ExitApi.exit()">Install</button>
</body>
</html>`;

describe('vfs resolve', () => {
  it('resolves relative paths', () => {
    expect(resolveVfsPath('assets/app.js', '../img/a.png')).toBe('img/a.png');
    expect(resolveVfsPath('index.html', './main.js')).toBe('main.js');
  });
});

describe('parser', () => {
  it('finds entry and ad meta', () => {
    const vfs = createVfs([
      { path: 'index.html', bytes: new TextEncoder().encode(VALID_HTML) },
    ]);
    expect(findEntryHtml(vfs)).toBe('index.html');
    const meta = parseAdMeta(VALID_HTML);
    expect(meta.size).toEqual({ w: 320, h: 480 });
  });
});

describe('structure and size rules', () => {
  it('flags bad path charset', () => {
    const ctx = ctxFromFiles({
      'index.html': VALID_HTML,
      'my file.png': 'x',
    });
    const findings = googleAppPlayableMarket.rules
      .find((r) => r.id === 'path-charset')!
      .runStatic!(ctx);
    expect(findings.some((f) => f.evidence?.path === 'my file.png')).toBe(true);
  });

  it('flags wrong dimensions', () => {
    const html = VALID_HTML.replace('320,height=480', '300,height=250');
    const ctx = ctxFromFiles({ 'index.html': html });
    const findings = googleAppPlayableMarket.rules
      .find((r) => r.id === 'ad-dimensions')!
      .runStatic!(ctx);
    expect(findings[0]?.severity).toBe('error');
  });

  it('accepts orientation meta', () => {
    const html = `<!DOCTYPE html><html><head>
<meta name="ad.orientation" content="portrait">
</head><body></body></html>`;
    const ctx = ctxFromFiles({ 'index.html': html });
    const findings = googleAppPlayableMarket.rules
      .find((r) => r.id === 'ad-dimensions')!
      .runStatic!(ctx);
    expect(findings).toHaveLength(0);
  });

  it('flags unsupported extension', () => {
    const ctx = ctxFromFiles({
      'index.html': VALID_HTML,
      'clip.mp4': 'xx',
    });
    const findings = googleAppPlayableMarket.rules
      .find((r) => r.id === 'file-type-and-count')!
      .runStatic!(ctx);
    expect(findings.some((f) => f.evidence?.path === 'clip.mp4')).toBe(true);
  });
});

describe('policy and tooling', () => {
  it('flags external third party', () => {
    const html = VALID_HTML.replace(
      '</head>',
      '<script src="https://evil.example/a.js"></script></head>',
    );
    const ctx = ctxFromFiles({ 'index.html': html });
    const findings = googleAppPlayableMarket.rules
      .find((r) => r.id === 'third-party-calls')!
      .runStatic!(ctx);
    expect(findings.some((f) => /evil\.example/.test(f.messageZh))).toBe(true);
  });

  it('flags missing assets', () => {
    const html = VALID_HTML.replace(
      '</body>',
      '<img src="missing.png"></body>',
    );
    const ctx = ctxFromFiles({ 'index.html': html });
    const findings = googleAppPlayableMarket.rules
      .find((r) => r.id === 'missing-assets')!
      .runStatic!(ctx);
    expect(findings[0]?.ruleId).toBe('missing-assets');
  });

  it('flags Studio Enabler on non-GWD', () => {
    const html = VALID_HTML.replace(
      '</head>',
      '<script src="Enabler.js"></script></head>',
    );
    const ctx = ctxFromFiles({ 'index.html': html, 'Enabler.js': 'var Enabler={};' });
    const findings = googleAppPlayableMarket.rules
      .find((r) => r.id === 'doubleclick-studio')!
      .runStatic!(ctx);
    expect(findings[0]?.severity).toBe('error');
  });

  it('flags Swiffy', () => {
    const ctx = ctxFromFiles({
      'index.html': VALID_HTML.replace('</body>', '<script>swiffyobject</script></body>'),
    });
    const findings = googleAppPlayableMarket.rules
      .find((r) => r.id === 'no-swiffy')!
      .runStatic!(ctx);
    expect(findings[0]?.ruleId).toBe('no-swiffy');
  });

  it('flags http urls', () => {
    const html = VALID_HTML.replace(
      '</head>',
      '<script src="http://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js"></script></head>',
    );
    const ctx = ctxFromFiles({ 'index.html': html });
    const findings = googleAppPlayableMarket.rules
      .find((r) => r.id === 'secure-url')!
      .runStatic!(ctx);
    expect(findings.some((f) => f.ruleId === 'secure-url')).toBe(true);
  });
});

describe('mergeFindings', () => {
  it('upgrades severity from runtime', () => {
    const staticF: Finding[] = [
      {
        ruleId: 'multiple-exits',
        category: 'policy',
        severity: 'info',
        messageZh: 'static',
        keywordEn: 'multiple exits',
      },
    ];
    const runtimeF: Finding[] = [
      {
        ruleId: 'multiple-exits',
        category: 'policy',
        severity: 'warning',
        messageZh: 'runtime',
        keywordEn: 'multiple exits',
        evidence: { runtime: true },
      },
    ];
    const merged = mergeFindings(staticF, runtimeF);
    expect(merged.some((f) => f.severity === 'warning')).toBe(true);
  });
});
