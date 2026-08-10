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

  it('decodes percent-encoding and strips query', () => {
    expect(resolveVfsPath('index.html', 'assets/%E5%9B%BE.png?v=2')).toBe(
      'assets/图.png',
    );
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

  it('accepts percent-encoded asset paths that exist in the zip', () => {
    const fileName = '图标.png';
    const encoded = encodeURIComponent(fileName);
    const html = VALID_HTML.replace(
      '</body>',
      `<img src="assets/${encoded}?v=1"></body>`,
    );
    const ctx = ctxFromFiles({
      'index.html': html,
      [`assets/${fileName}`]: 'png',
    });
    const findings = googleAppPlayableMarket.rules
      .find((r) => r.id === 'missing-assets')!
      .runStatic!(ctx);
    expect(findings).toHaveLength(0);
  });

  it('ignores inlined JS virtual paths that are not real zip files', () => {
    const html = VALID_HTML.replace(
      '</body>',
      `<script>
        var bundle = { "assets/hero.png": "data:image/png;base64,aaa" };
        var path = "assets/hero.png";
      </script></body>`,
    );
    const ctx = ctxFromFiles({ 'index.html': html });
    const findings = googleAppPlayableMarket.rules
      .find((r) => r.id === 'missing-assets')!
      .runStatic!(ctx);
    expect(findings).toHaveLength(0);
  });

  it('ignores fake img tags and .png fragments inside inline script', () => {
    const html = VALID_HTML.replace(
      '</body>',
      `<script>
        var mime = "image/png";
        var htmlSnippet = '<img src=".png">';
        var also = '<img src="virtual/hero.png">';
      </script></body>`,
    );
    const ctx = ctxFromFiles({ 'index.html': html });
    const findings = googleAppPlayableMarket.rules
      .find((r) => r.id === 'missing-assets')!
      .runStatic!(ctx);
    expect(findings).toHaveLength(0);
  });

  it('accepts nested folder refs with ./ and query string', () => {
    const html = VALID_HTML.replace(
      '</head>',
      '<script src="./js/main.js?hash=abc"></script></head>',
    );
    const ctx = ctxFromFiles({
      'index.html': html,
      'js/main.js': 'ExitApi.exit();',
    });
    const findings = googleAppPlayableMarket.rules
      .find((r) => r.id === 'missing-assets')!
      .runStatic!(ctx);
    expect(findings).toHaveLength(0);
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

describe('AppLovin playable rules', () => {
  it('requires single self-contained HTML and flags external refs', async () => {
    const { applovinPlayableMarket } = await import('../markets/applovin-playable');
    const files = {
      'index.html': `<!DOCTYPE html><html><head></head><body>
        <script src="https://cdn.example.com/game.js"></script>
        <img src="https://cdn.example.com/a.png">
      </body></html>`,
      'extra.js': 'console.log(1)',
    };
    const entries = Object.entries(files).map(([path, text]) => ({
      path,
      bytes: new TextEncoder().encode(text),
    }));
    const vfs = createVfs(entries);
    const entryHtmlPath = findEntryHtml(vfs);
    const ctx: RuleContext = {
      vfs,
      entryHtmlPath,
      bundle: {
        fileName: 'game.zip',
        byteLength: 100,
        fileCount: 2,
        sourceKind: 'zip',
      },
      market: applovinPlayableMarket,
      refs: collectReferences(vfs, entryHtmlPath),
      adMeta: parseAdMeta(vfs.readText(entryHtmlPath!) || ''),
    };
    const single = applovinPlayableMarket.rules.find((r) => r.id === 'al-single-html')!.runStatic!(ctx);
    expect(single.some((f) => f.severity === 'error')).toBe(true);
    const external = applovinPlayableMarket.rules.find((r) => r.id === 'al-no-external')!.runStatic!(ctx);
    expect(external.length).toBeGreaterThan(0);
  });

  it('flags hard redirect without mraid.open', async () => {
    const { applovinPlayableMarket } = await import('../markets/applovin-playable');
    const html = `<!DOCTYPE html><html><body>
      <button onclick="window.open('https://apps.apple.com/app/1')">Go</button>
    </body></html>`;
    const vfs = createVfs([{ path: 'index.html', bytes: new TextEncoder().encode(html) }]);
    const ctx: RuleContext = {
      vfs,
      entryHtmlPath: 'index.html',
      bundle: { fileName: 'a.html', byteLength: html.length, fileCount: 1, sourceKind: 'html' },
      market: applovinPlayableMarket,
      refs: collectReferences(vfs, 'index.html'),
      adMeta: parseAdMeta(html),
    };
    const mraid = applovinPlayableMarket.rules.find((r) => r.id === 'al-mraid')!.runStatic!(ctx);
    expect(mraid.some((f) => f.severity === 'error' && f.keywordEn.includes('mraid.open'))).toBe(
      true,
    );
  });
});

describe('Unity playable rules', () => {
  it('requires single HTML, mraid.open, viewableChange, and flags external refs', async () => {
    const { unityPlayableMarket } = await import('../markets/unity-playable');
    const files = {
      'index.html': `<!DOCTYPE html><html><head></head><body>
        <script src="https://cdn.example.com/game.js"></script>
        <button onclick="window.open('https://apps.apple.com/app/1')">Go</button>
      </body></html>`,
      'extra.js': 'console.log(1)',
    };
    const entries = Object.entries(files).map(([path, text]) => ({
      path,
      bytes: new TextEncoder().encode(text),
    }));
    const vfs = createVfs(entries);
    const entryHtmlPath = findEntryHtml(vfs);
    const ctx: RuleContext = {
      vfs,
      entryHtmlPath,
      bundle: {
        fileName: 'game.zip',
        byteLength: 100,
        fileCount: 2,
        sourceKind: 'zip',
      },
      market: unityPlayableMarket,
      refs: collectReferences(vfs, entryHtmlPath),
      adMeta: parseAdMeta(vfs.readText(entryHtmlPath!) || ''),
    };
    const single = unityPlayableMarket.rules.find((r) => r.id === 'un-single-html')!.runStatic!(ctx);
    expect(single.some((f) => f.severity === 'error')).toBe(true);
    const external = unityPlayableMarket.rules.find((r) => r.id === 'un-no-external')!.runStatic!(ctx);
    expect(external.length).toBeGreaterThan(0);
    const mraid = unityPlayableMarket.rules.find((r) => r.id === 'un-mraid')!.runStatic!(ctx);
    expect(mraid.some((f) => f.messageZh.includes('mraid.open'))).toBe(true);
    expect(mraid.some((f) => f.messageZh.includes('viewableChange'))).toBe(true);
  });

  it('accepts valid Unity playable with mraid.open and viewableChange', async () => {
    const { unityPlayableMarket } = await import('../markets/unity-playable');
    const html = `<!DOCTYPE html><html><body>
      <script>
        mraid.addEventListener('viewableChange', function(v){ if(v) start(); });
        function start(){}
        function cta(){ mraid.open('https://apps.apple.com/app/1'); }
      </script>
      <button onclick="cta()">Install</button>
    </body></html>`;
    const vfs = createVfs([{ path: 'index.html', bytes: new TextEncoder().encode(html) }]);
    const ctx: RuleContext = {
      vfs,
      entryHtmlPath: 'index.html',
      bundle: { fileName: 'index.html', byteLength: html.length, fileCount: 1, sourceKind: 'html' },
      market: unityPlayableMarket,
      refs: collectReferences(vfs, 'index.html'),
      adMeta: parseAdMeta(html),
    };
    const mraid = unityPlayableMarket.rules.find((r) => r.id === 'un-mraid')!.runStatic!(ctx);
    expect(mraid.filter((f) => f.severity === 'error')).toHaveLength(0);
    const external = unityPlayableMarket.rules.find((r) => r.id === 'un-no-external')!.runStatic!(ctx);
    expect(external).toHaveLength(0);
  });
});

describe('Facebook playable rules', () => {
  it('requires FbPlayableAd.onCTAClick and flags external refs', async () => {
    const { facebookPlayableMarket } = await import('../markets/facebook-playable');
    const html = `<!DOCTYPE html><html><body>
      <script src="https://cdn.example.com/x.js"></script>
      <button onclick="window.open('https://apps.apple.com/app/1')">Go</button>
    </body></html>`;
    const vfs = createVfs([{ path: 'index.html', bytes: new TextEncoder().encode(html) }]);
    const ctx: RuleContext = {
      vfs,
      entryHtmlPath: 'index.html',
      bundle: { fileName: 'a.html', byteLength: html.length, fileCount: 1, sourceKind: 'html' },
      market: facebookPlayableMarket,
      refs: collectReferences(vfs, 'index.html'),
      adMeta: parseAdMeta(html),
    };
    const cta = facebookPlayableMarket.rules.find((r) => r.id === 'fb-cta')!.runStatic!(ctx);
    expect(cta.some((f) => f.severity === 'error')).toBe(true);
    const external = facebookPlayableMarket.rules.find((r) => r.id === 'fb-no-external')!.runStatic!(
      ctx,
    );
    expect(external.length).toBeGreaterThan(0);
    const redirect = facebookPlayableMarket.rules.find((r) => r.id === 'fb-no-redirect')!.runStatic!(
      ctx,
    );
    expect(redirect.some((f) => f.severity === 'error')).toBe(true);
  });

  it('accepts valid HTML with FbPlayableAd.onCTAClick', async () => {
    const { facebookPlayableMarket } = await import('../markets/facebook-playable');
    const html = `<!DOCTYPE html><html><body>
      <button onclick="FbPlayableAd.onCTAClick()">Install</button>
    </body></html>`;
    const vfs = createVfs([{ path: 'index.html', bytes: new TextEncoder().encode(html) }]);
    const ctx: RuleContext = {
      vfs,
      entryHtmlPath: 'index.html',
      bundle: { fileName: 'ok.html', byteLength: html.length, fileCount: 1, sourceKind: 'html' },
      market: facebookPlayableMarket,
      refs: collectReferences(vfs, 'index.html'),
      adMeta: parseAdMeta(html),
    };
    const cta = facebookPlayableMarket.rules.find((r) => r.id === 'fb-cta')!.runStatic!(ctx);
    expect(cta).toHaveLength(0);
    const redirect = facebookPlayableMarket.rules.find((r) => r.id === 'fb-no-redirect')!.runStatic!(
      ctx,
    );
    expect(redirect).toHaveLength(0);
  });

  it('requires root index.html in ZIP and enforces file count', async () => {
    const { facebookPlayableMarket } = await import('../markets/facebook-playable');
    const files = {
      'game/index.html': `<!DOCTYPE html><html><body>
        <button onclick="FbPlayableAd.onCTAClick()">Go</button>
      </body></html>`,
    };
    const entries = Object.entries(files).map(([path, text]) => ({
      path,
      bytes: new TextEncoder().encode(text),
    }));
    const vfs = createVfs(entries);
    const entryHtmlPath = findEntryHtml(vfs);
    const ctx: RuleContext = {
      vfs,
      entryHtmlPath,
      bundle: {
        fileName: 'game.zip',
        byteLength: 100,
        fileCount: 1,
        sourceKind: 'zip',
      },
      market: facebookPlayableMarket,
      refs: collectReferences(vfs, entryHtmlPath),
      adMeta: parseAdMeta(vfs.readText(entryHtmlPath!) || ''),
    };
    const format = facebookPlayableMarket.rules.find((r) => r.id === 'fb-format')!.runStatic!(ctx);
    expect(format.some((f) => f.messageZh.includes('根目录'))).toBe(true);
  });
});

describe('Moloco playable rules', () => {
  it('rejects zip upload and requires FbPlayableAd.onCTAClick', async () => {
    const { molocoPlayableMarket } = await import('../markets/moloco-playable');
    const html = `<!DOCTYPE html><html><body>
      <script>new XMLHttpRequest()</script>
      <button onclick="window.open('https://apps.apple.com/app/1')">Go</button>
    </body></html>`;
    const vfs = createVfs([{ path: 'index.html', bytes: new TextEncoder().encode(html) }]);
    const ctx: RuleContext = {
      vfs,
      entryHtmlPath: 'index.html',
      bundle: { fileName: 'ad.zip', byteLength: html.length, fileCount: 1, sourceKind: 'zip' },
      market: molocoPlayableMarket,
      refs: collectReferences(vfs, 'index.html'),
      adMeta: parseAdMeta(html),
    };
    const format = molocoPlayableMarket.rules.find((r) => r.id === 'mo-format')!.runStatic!(ctx);
    expect(format.some((f) => f.messageZh.includes('zip'))).toBe(true);
    const cta = molocoPlayableMarket.rules.find((r) => r.id === 'mo-cta')!.runStatic!(ctx);
    expect(cta.some((f) => f.severity === 'error')).toBe(true);
    const xhr = molocoPlayableMarket.rules.find((r) => r.id === 'mo-no-xhr')!.runStatic!(ctx);
    expect(xhr.some((f) => f.severity === 'error')).toBe(true);
    const redirect = molocoPlayableMarket.rules.find((r) => r.id === 'mo-no-redirect')!.runStatic!(ctx);
    expect(redirect.some((f) => f.severity === 'error')).toBe(true);
  });

  it('accepts single HTML with FbPlayableAd.onCTAClick()', async () => {
    const { molocoPlayableMarket } = await import('../markets/moloco-playable');
    const html = `<!DOCTYPE html><html><body>
      <button onclick="FbPlayableAd.onCTAClick()">Install</button>
    </body></html>`;
    const vfs = createVfs([{ path: 'index.html', bytes: new TextEncoder().encode(html) }]);
    const ctx: RuleContext = {
      vfs,
      entryHtmlPath: 'index.html',
      bundle: { fileName: 'index.html', byteLength: html.length, fileCount: 1, sourceKind: 'html' },
      market: molocoPlayableMarket,
      refs: collectReferences(vfs, 'index.html'),
      adMeta: parseAdMeta(html),
    };
    const format = molocoPlayableMarket.rules.find((r) => r.id === 'mo-format')!.runStatic!(ctx);
    expect(format.filter((f) => f.severity === 'error')).toHaveLength(0);
    const cta = molocoPlayableMarket.rules.find((r) => r.id === 'mo-cta')!.runStatic!(ctx);
    expect(cta).toHaveLength(0);
  });
});

describe('Mintegral playable rules', () => {
  it('requires Mindworks APIs and matching zip/html names', async () => {
    const { mintegralPlayableMarket } = await import('../markets/mintegral-playable');
    const files = {
      'wrong/index.html': `<!DOCTYPE html><html><body>
        <script src="https://cdn.example.com/x.js"></script>
        <button>Go</button>
      </body></html>`,
    };
    const entries = Object.entries(files).map(([path, text]) => ({
      path,
      bytes: new TextEncoder().encode(text),
    }));
    const vfs = createVfs(entries);
    const entryHtmlPath = findEntryHtml(vfs);
    const ctx: RuleContext = {
      vfs,
      entryHtmlPath,
      bundle: {
        fileName: 'demo.zip',
        byteLength: 100,
        fileCount: 1,
        sourceKind: 'zip',
      },
      market: mintegralPlayableMarket,
      refs: collectReferences(vfs, entryHtmlPath),
      adMeta: parseAdMeta(vfs.readText(entryHtmlPath!) || ''),
    };
    const naming = mintegralPlayableMarket.rules.find((r) => r.id === 'mtg-naming')!.runStatic!(ctx);
    expect(naming.some((f) => f.severity === 'error')).toBe(true);
    const api = mintegralPlayableMarket.rules.find((r) => r.id === 'mtg-api')!.runStatic!(ctx);
    expect(api.some((f) => f.messageZh.includes('install'))).toBe(true);
    expect(api.some((f) => f.messageZh.includes('gameEnd'))).toBe(true);
    expect(api.some((f) => f.messageZh.includes('gameReady'))).toBe(true);
    const external = mintegralPlayableMarket.rules.find((r) => r.id === 'mtg-no-external')!.runStatic!(
      ctx,
    );
    expect(external.length).toBeGreaterThan(0);
  });

  it('accepts valid Mindworks package', async () => {
    const { mintegralPlayableMarket } = await import('../markets/mintegral-playable');
    const html = `<!DOCTYPE html><html><body>
      <script>
        function gameStart(){}
        window.gameReady && window.gameReady();
        function end(){ window.gameEnd && window.gameEnd(); }
        function cta(){ window.install && window.install(); }
      </script>
      <button onclick="cta()">Install</button>
    </body></html>`;
    const vfs = createVfs([{ path: 'demo/demo.html', bytes: new TextEncoder().encode(html) }]);
    const ctx: RuleContext = {
      vfs,
      entryHtmlPath: 'demo/demo.html',
      bundle: { fileName: 'demo.zip', byteLength: html.length, fileCount: 1, sourceKind: 'zip' },
      market: mintegralPlayableMarket,
      refs: collectReferences(vfs, 'demo/demo.html'),
      adMeta: parseAdMeta(html),
    };
    const naming = mintegralPlayableMarket.rules.find((r) => r.id === 'mtg-naming')!.runStatic!(ctx);
    expect(naming.filter((f) => f.severity === 'error')).toHaveLength(0);
    const api = mintegralPlayableMarket.rules.find((r) => r.id === 'mtg-api')!.runStatic!(ctx);
    expect(api.filter((f) => f.severity === 'error')).toHaveLength(0);
  });
});
