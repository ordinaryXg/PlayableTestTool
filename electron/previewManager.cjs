const { WebContentsView } = require('electron');
const { getPreset } = require('./presets.cjs');
const { entryUrl } = require('./protocol.cjs');

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
/** @type {import('electron').WebContentsView | null} */
let previewView = null;
let currentPresetId = 'mid';
let visible = false;
/** @type {{ x: number, y: number, width: number, height: number }} */
let bounds = { x: 0, y: 0, width: 0, height: 0 };
/** @type {ReturnType<typeof setInterval> | null} */
let fpsPollTimer = null;
/** @type {{ width: number, height: number, dpr: number, pageScale?: number } | null} */
let lastMetrics = null;
/** @type {{ channel: string, language: string, locale: string }} */
let previewEnv = { channel: '', language: '', locale: 'en-US' };
/** True after a successful load while view size was valid (>=2px). */
let loadedWithValidBounds = false;

function setMainWindow(win) {
  mainWindow = win;
}

function setPreviewEnv(env) {
  previewEnv = {
    channel: typeof env?.channel === 'string' ? env.channel : '',
    language: typeof env?.language === 'string' ? env.language : '',
    locale: typeof env?.locale === 'string' && env.locale ? env.locale : 'en-US',
  };
}

function currentPageScale() {
  const z = lastMetrics && lastMetrics.pageScale;
  return typeof z === 'number' && z > 0 ? z : 1;
}

function attachDebugger(webContents) {
  const dbg = webContents.debugger;
  try {
    if (!dbg.isAttached()) dbg.attach('1.3');
  } catch {
    try {
      dbg.attach('1.3');
    } catch (err) {
      console.warn('[cdp] attach failed', err);
      return null;
    }
  }
  return dbg;
}

/**
 * Visual zoom for WebContentsView.
 * - Layout CSS size ≈ bounds / zoomFactor; renderer sets bounds = logical × pageScale.
 * - Do NOT re-apply setDeviceMetricsOverride on zoom-only updates — it resets zoomFactor
 *   and makes the slider appear to need a full refresh.
 */
async function applyDeviceScale(webContents, metrics, opts = {}) {
  if (!webContents || webContents.isDestroyed()) return;
  const zoomOnly = opts.zoomOnly === true;
  const pageScale =
    typeof metrics.pageScale === 'number' && metrics.pageScale > 0 ? metrics.pageScale : 1;
  const width = Math.max(1, Math.round(metrics.width || 320));
  const height = Math.max(1, Math.round(metrics.height || 480));
  const dpr = typeof metrics.dpr === 'number' && metrics.dpr > 0 ? metrics.dpr : 2;

  if (!zoomOnly) {
    const dbg = attachDebugger(webContents);
    if (dbg) {
      try {
        await dbg.sendCommand('Emulation.clearDeviceMetricsOverride');
      } catch {
        /* ignore */
      }
      try {
        await dbg.sendCommand('Emulation.setTouchEmulationEnabled', {
          enabled: true,
          configuration: 'mobile',
        });
      } catch (err) {
        console.warn('[cdp] touch', err);
      }
      try {
        await dbg.sendCommand('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
      } catch {
        /* ignore */
      }
    }
  }

  try {
    webContents.setZoomFactor(pageScale);
    if (!zoomOnly) {
      console.log(
        '[zoom] setZoomFactor',
        pageScale,
        'logical',
        `${width}x${height}`,
        'dpr',
        dpr,
        'bounds',
        `${bounds.width}x${bounds.height}`,
      );
    }
  } catch (err) {
    console.warn('[zoom] setZoomFactor failed', err);
  }
}

function setPresetId(id) {
  currentPresetId = id;
}

function stopFpsPoll() {
  if (fpsPollTimer) {
    clearInterval(fpsPollTimer);
    fpsPollTimer = null;
  }
}

function emitFpsToUi(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('pv:fps', payload);
}

function startFpsPoll(webContents) {
  stopFpsPoll();
  if (!webContents || webContents.isDestroyed()) return;

  const sample = async () => {
    if (!webContents || webContents.isDestroyed() || !visible) return;
    try {
      const result = await webContents.executeJavaScript(
        `
(function(){
  if (!window.__pvFpsState) {
    window.__pvFpsState = { frames: 0, last: performance.now(), fps: 0 };
    (function tick(){
      try { window.__pvFpsState.frames++; } catch (e) {}
      requestAnimationFrame(tick);
    })();
  }
  var s = window.__pvFpsState;
  var now = performance.now();
  var elapsed = Math.max(1, now - s.last);
  if (elapsed >= 400) {
    s.fps = Math.round((s.frames * 1000) / elapsed);
    s.frames = 0;
    s.last = now;
  }
  var heapUsedMB, heapLimitMB;
  try {
    if (performance.memory) {
      heapUsedMB = Math.round((performance.memory.usedJSHeapSize / 1048576) * 10) / 10;
      heapLimitMB = Math.round((performance.memory.jsHeapSizeLimit / 1048576) * 10) / 10;
    }
  } catch (e) {}
  return { fps: s.fps || 0, heapUsedMB: heapUsedMB, heapLimitMB: heapLimitMB };
})();
        `,
        true,
      );
      if (result && typeof result.fps === 'number') {
        emitFpsToUi(result);
      }
    } catch {
      /* page may be navigating */
    }
  };

  const arm = () => {
    void sample();
    stopFpsPoll();
    fpsPollTimer = setInterval(() => {
      void sample();
    }, 500);
  };

  if (typeof webContents.isLoadingMainFrame === 'function') {
    if (!webContents.isLoadingMainFrame()) arm();
  } else if (!webContents.isLoading()) {
    arm();
  }
  webContents.once('did-finish-load', () => {
    arm();
  });
}

function destroyPreview() {
  stopFpsPoll();
  if (!previewView || !mainWindow) {
    previewView = null;
    visible = false;
    return;
  }
  try {
    mainWindow.contentView.removeChildView(previewView);
  } catch {
    /* ignore */
  }
  try {
    previewView.webContents.close();
  } catch {
    /* ignore */
  }
  previewView = null;
  visible = false;
}

async function applyCdp(webContents, preset, metricsOverride) {
  const dbg = attachDebugger(webContents);
  if (!dbg) return;

  const metrics = metricsOverride || lastMetrics || preset.metrics;
  const pageScale =
    typeof metrics.pageScale === 'number' && metrics.pageScale > 0 ? metrics.pageScale : 1;
  lastMetrics = {
    width: metrics.width,
    height: metrics.height,
    dpr: metrics.dpr,
    pageScale,
  };

  try {
    if (preset.cpu > 1) {
      await dbg.sendCommand('Emulation.setCPUThrottlingRate', { rate: preset.cpu });
    } else {
      await dbg.sendCommand('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
  } catch (err) {
    console.warn('[cdp] cpu', err);
  }

  try {
    await dbg.sendCommand('Network.enable');
    await dbg.sendCommand('Network.emulateNetworkConditions', {
      offline: false,
      latency: preset.net.latency,
      downloadThroughput: preset.net.down,
      uploadThroughput: preset.net.up,
    });
  } catch (err) {
    console.warn('[cdp] network', err);
  }

  // Align Chromium locale with preview language (navigator.language).
  try {
    await dbg.sendCommand('Emulation.setLocaleOverride', {
      locale: previewEnv.locale || 'en-US',
    });
  } catch (err) {
    console.warn('[cdp] locale', err);
  }
  try {
    await dbg.sendCommand('Emulation.setUserAgentOverride', {
      userAgent: webContents.getUserAgent(),
      acceptLanguage: previewEnv.locale || 'en-US',
    });
  } catch (err) {
    console.warn('[cdp] acceptLanguage', err);
  }

  await applyDeviceScale(webContents, lastMetrics);
}

function wireConsoleForward(webContents) {
  webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const details = event && typeof event === 'object' ? event : {};
    const msg = details.message != null ? details.message : message;
    const src = details.sourceId != null ? details.sourceId : sourceId;
    const ln = details.lineNumber != null ? details.lineNumber : line;
    let lvl = details.level != null ? details.level : level;
    if (typeof lvl === 'number') {
      lvl = ({ 0: 'debug', 1: 'info', 2: 'warning', 3: 'error' })[lvl] || 'info';
    }
    const levelMap = {
      verbose: 'debug',
      debug: 'debug',
      log: 'log',
      info: 'info',
      warning: 'warn',
      warn: 'warn',
      error: 'error',
    };
    mainWindow.webContents.send('pv:console', {
      level: levelMap[String(lvl)] || 'log',
      message: String(msg ?? ''),
      source: src ? `${src}:${ln || 0}` : undefined,
      at: Date.now(),
    });
  });
}

function ensurePreviewView() {
  if (previewView || !mainWindow) return previewView;
  previewView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      preload: require('node:path').join(__dirname, 'preview-preload.cjs'),
    },
  });
  wireConsoleForward(previewView.webContents);
  previewView.webContents.on('did-finish-load', () => {
    if (lastMetrics) void applyDeviceScale(previewView.webContents, lastMetrics);
  });
  mainWindow.contentView.addChildView(previewView);
  return previewView;
}

function updateBounds(next) {
  if (!next) return;
  const wasInvalid = bounds.width < 2 || bounds.height < 2;
  bounds = {
    x: Math.round(next.x || 0),
    y: Math.round(next.y || 0),
    width: Math.max(0, Math.round(next.width || 0)),
    height: Math.max(0, Math.round(next.height || 0)),
  };
  if (typeof next.pageScale === 'number' && next.pageScale > 0) {
    if (!lastMetrics) {
      lastMetrics = { width: 320, height: 480, dpr: 2, pageScale: next.pageScale };
    } else {
      lastMetrics = { ...lastMetrics, pageScale: next.pageScale };
    }
  }
  if (!previewView || !visible) return;
  if (bounds.width < 2 || bounds.height < 2) {
    previewView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    return;
  }
  previewView.setBounds(bounds);
  const z = currentPageScale();
  try {
    previewView.webContents.setZoomFactor(z);
  } catch {
    /* ignore */
  }
  // First valid size after a 0×0 boot: reload so canvas/WebGL playables init correctly.
  if (wasInvalid && !loadedWithValidBounds) {
    loadedWithValidBounds = true;
    const preset = getPreset(currentPresetId);
    void (async () => {
      try {
        await previewView.webContents.loadURL(entryUrl());
        await applyCdp(previewView.webContents, preset, lastMetrics || undefined);
        startFpsPoll(previewView.webContents);
      } catch (err) {
        console.warn('[preview] reload after bounds', err);
      }
    })();
  }
}

async function showPreview(metricsOverride) {
  if (!mainWindow) return { ok: false, error: 'no-window' };
  const view = ensurePreviewView();
  if (!view) return { ok: false, error: 'no-view' };

  const preset = getPreset(currentPresetId);
  visible = true;
  loadedWithValidBounds = bounds.width >= 2 && bounds.height >= 2;
  updateBounds(bounds);

  const url = entryUrl();
  console.log('[preview] loadURL', url, previewEnv, 'bounds', bounds);

  // Do NOT attach debugger before the first navigation — it blanks WebContentsView
  // on some Electron builds. Env vars come from HTML inject (cache-busted URL).
  await view.webContents.loadURL(url);

  if (bounds.width >= 2 && bounds.height >= 2) {
    loadedWithValidBounds = true;
    await applyCdp(view.webContents, preset, metricsOverride);
    startFpsPoll(view.webContents);
  }
  return { ok: true, url };
}

function hidePreview() {
  visible = false;
  stopFpsPoll();
  if (previewView) {
    previewView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
}

function revealPreview() {
  if (!previewView) return { ok: false, error: 'no-view' };
  visible = true;
  updateBounds(bounds);
  startFpsPoll(previewView.webContents);
  return { ok: true };
}

async function reloadPreview(metricsOverride) {
  if (!previewView || !visible) return { ok: false };
  const preset = getPreset(currentPresetId);
  stopFpsPoll();
  await previewView.webContents.loadURL(entryUrl());
  await applyCdp(previewView.webContents, preset, metricsOverride);
  startFpsPoll(previewView.webContents);
  return { ok: true };
}

async function applyMetrics(metrics) {
  if (!previewView || !visible) return;
  if (metrics && typeof metrics === 'object') {
    const pageScale =
      typeof metrics.pageScale === 'number' && metrics.pageScale > 0 ? metrics.pageScale : 1;
    const prev = lastMetrics;
    lastMetrics = {
      width: metrics.width,
      height: metrics.height,
      dpr: metrics.dpr,
      pageScale,
    };
    const sizeSame =
      prev &&
      prev.width === lastMetrics.width &&
      prev.height === lastMetrics.height &&
      prev.dpr === lastMetrics.dpr;
    if (sizeSame) {
      // Zoom / fit changes only — never re-enter device metrics (resets zoom).
      await applyDeviceScale(previewView.webContents, lastMetrics, { zoomOnly: true });
      return;
    }
  }
  const preset = getPreset(currentPresetId);
  await applyCdp(previewView.webContents, preset, lastMetrics || metrics);
}

/** Hot-switch device preset: re-apply CDP CPU/network (and last metrics) without relaunch. */
async function reapplyPreset() {
  if (!previewView || !visible) return { ok: true, applied: false };
  const preset = getPreset(currentPresetId);
  await applyCdp(previewView.webContents, preset, lastMetrics || undefined);
  return { ok: true, applied: true };
}

module.exports = {
  setMainWindow,
  setPresetId,
  setPreviewEnv,
  destroyPreview,
  updateBounds,
  showPreview,
  hidePreview,
  revealPreview,
  reloadPreview,
  applyMetrics,
  reapplyPreset,
  getPreviewWebContents: () => previewView?.webContents || null,
};
