const path = require('node:path');
const { WebContentsView, BrowserWindow, screen } = require('electron');
const { getPreset } = require('./presets.cjs');
const { entryUrl } = require('./protocol.cjs');

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
/** @type {import('electron').BrowserWindow | null} */
let popupWindow = null;
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
/** Embedded preview was visible when popup opened (restore only if still true on close). */
let embeddedVisibleBeforePopup = false;
/** @type {{ windowWidth: number, windowHeight: number, pageScale: number } | null} */
let popupLayoutCache = null;
/** Resolution key last used to compute popup layout (skip resize when unchanged). */
let popupMetricsKey = null;

function isPopupOpen() {
  return popupWindow != null && !popupWindow.isDestroyed();
}

function metricsResolutionKey(metrics) {
  const w = metrics?.width ?? 0;
  const h = metrics?.height ?? 0;
  const dpr = metrics?.dpr ?? 0;
  return `${w}x${h}@${dpr}`;
}

function restorePopupSizeIfNeeded() {
  if (!isPopupOpen() || !popupLayoutCache) return;
  const [cw, ch] = popupWindow.getContentSize();
  if (cw === popupLayoutCache.windowWidth && ch === popupLayoutCache.windowHeight) return;
  popupWindow.setContentSize(popupLayoutCache.windowWidth, popupLayoutCache.windowHeight, false);
}

function wirePopupWindow(popup) {
  popup.on('closed', () => {
    popupWindow = null;
    popupActive = false;
    popupLayoutCache = null;
    popupMetricsKey = null;
    stopFpsPoll();
    if (embeddedVisibleBeforePopup && previewView) {
      void resumeEmbeddedPreview();
    }
    embeddedVisibleBeforePopup = false;
  });
  popup.on('resize', () => {
    if (popup.isDestroyed()) return;
    const [w, h] = popup.getContentSize();
    if (!popupLayoutCache) {
      popupLayoutCache = { windowWidth: w, windowHeight: h, pageScale: 1 };
      return;
    }
    popupLayoutCache.windowWidth = w;
    popupLayoutCache.windowHeight = h;
  });
}

let popupActive = false;

function getActivePreviewWebContents() {
  if (popupActive && isPopupOpen()) {
    return popupWindow.webContents;
  }
  if (visible && previewView && !previewView.webContents.isDestroyed()) {
    return previewView.webContents;
  }
  return null;
}

function shouldForwardPreviewIpc(sender) {
  const active = getActivePreviewWebContents();
  return active != null && !active.isDestroyed() && sender === active;
}

function suspendEmbeddedPreview() {
  stopFpsPoll();
  visible = false;
  if (!previewView) return;
  previewView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  try {
    previewView.webContents.setBackgroundThrottling(true);
    void previewView.webContents.loadURL('about:blank');
  } catch {
    /* ignore */
  }
}

async function resumeEmbeddedPreview() {
  if (!previewView || previewView.webContents.isDestroyed()) return;
  try {
    previewView.webContents.setBackgroundThrottling(false);
  } catch {
    /* ignore */
  }
  visible = true;
  updateBounds(bounds);
  const preset = getPreset(currentPresetId);
  try {
    await previewView.webContents.loadURL(entryUrl());
    if (bounds.width >= 2 && bounds.height >= 2) {
      await applyCdp(previewView.webContents, preset, lastMetrics || undefined);
    }
  } catch (err) {
    console.warn('[preview] resume embedded', err);
  }
  startFpsPoll(previewView.webContents);
}

function setMainWindow(win) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeListener('show', restorePopupSizeIfNeeded);
    mainWindow.removeListener('restore', restorePopupSizeIfNeeded);
  }
  mainWindow = win;
  if (mainWindow) {
    mainWindow.on('show', restorePopupSizeIfNeeded);
    mainWindow.on('restore', restorePopupSizeIfNeeded);
  }
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

function startFpsPoll(webContents, opts = {}) {
  stopFpsPoll();
  if (!webContents || webContents.isDestroyed()) return;
  const allowHidden = opts.allowHidden === true;

  const sample = async () => {
    if (!webContents || webContents.isDestroyed()) return;
    if (!allowHidden && !visible) return;
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

function closePreviewPopup() {
  if (isPopupOpen()) {
    popupWindow.close();
  } else {
    popupActive = false;
    popupLayoutCache = null;
    popupMetricsKey = null;
    embeddedVisibleBeforePopup = false;
  }
}

function applyPopupContentSize(layout, force = false) {
  if (!isPopupOpen()) return;
  const key = metricsResolutionKey({
    width: layout.width,
    height: layout.height,
    dpr: layout.dpr,
  });
  if (!force && popupLayoutCache && popupMetricsKey === key) {
    popupWindow.setContentSize(popupLayoutCache.windowWidth, popupLayoutCache.windowHeight, false);
    return popupLayoutCache;
  }
  popupLayoutCache = {
    windowWidth: layout.windowWidth,
    windowHeight: layout.windowHeight,
    pageScale: layout.pageScale,
  };
  popupMetricsKey = key;
  popupWindow.setContentSize(layout.windowWidth, layout.windowHeight, false);
  return popupLayoutCache;
}

function computePopupLayout(metrics) {
  const display = screen.getPrimaryDisplay();
  const maxW = Math.max(320, display.workAreaSize.width - 48);
  const maxH = Math.max(240, display.workAreaSize.height - 48);
  const logicalW = Math.max(1, Math.round(metrics?.width || 320));
  const logicalH = Math.max(1, Math.round(metrics?.height || 480));
  const fitScale = Math.min(1, maxW / logicalW, maxH / logicalH);
  const contentW = Math.max(1, Math.round(logicalW * fitScale));
  const contentH = Math.max(1, Math.round(logicalH * fitScale));
  return {
    windowWidth: contentW,
    windowHeight: contentH,
    pageScale: fitScale,
    width: logicalW,
    height: logicalH,
    dpr: typeof metrics?.dpr === 'number' && metrics.dpr > 0 ? metrics.dpr : 2,
  };
}

function resizePreviewPopup(metrics, force = false) {
  if (!isPopupOpen()) return;
  const layout = computePopupLayout(metrics);
  applyPopupContentSize(
    {
      windowWidth: layout.windowWidth,
      windowHeight: layout.windowHeight,
      pageScale: layout.pageScale,
      width: layout.width,
      height: layout.height,
      dpr: layout.dpr,
    },
    force,
  );
}

async function loadPopupPreview(webContents, metricsOverride, opts = {}) {
  if (!webContents || webContents.isDestroyed()) return;
  const preset = getPreset(currentPresetId);
  const baseMetrics = metricsOverride || lastMetrics || preset.metrics;
  const layout = computePopupLayout(baseMetrics);
  if (opts.resize !== false) {
    applyPopupContentSize(
      {
        windowWidth: layout.windowWidth,
        windowHeight: layout.windowHeight,
        pageScale: layout.pageScale,
        width: layout.width,
        height: layout.height,
        dpr: layout.dpr,
      },
      true,
    );
  }
  const popupMetrics = {
    width: layout.width,
    height: layout.height,
    dpr: layout.dpr,
    pageScale: popupLayoutCache?.pageScale ?? layout.pageScale,
  };
  await webContents.loadURL(entryUrl());
  await applyCdp(webContents, preset, popupMetrics, { persistMetrics: false });
}

async function syncPreviewPopup(metricsOverride, opts = {}) {
  if (!isPopupOpen()) return { ok: true, applied: false };
  const metrics = metricsOverride || lastMetrics;
  if (metrics && opts.resize !== false) resizePreviewPopup(metrics);
  await loadPopupPreview(popupWindow.webContents, metrics, opts);
  startFpsPoll(popupWindow.webContents, { allowHidden: true });
  return { ok: true, applied: true };
}

async function openPreviewPopup(metricsOverride) {
  if (!mainWindow) return { ok: false, error: 'no-window' };

  const metrics = metricsOverride || lastMetrics || getPreset(currentPresetId).metrics;

  if (isPopupOpen()) {
    popupWindow.focus();
    await syncPreviewPopup(metrics, { resize: false });
    return { ok: true, focused: true };
  }

  embeddedVisibleBeforePopup = visible;
  popupActive = true;
  suspendEmbeddedPreview();

  const layout = computePopupLayout(metrics);
  popupLayoutCache = {
    windowWidth: layout.windowWidth,
    windowHeight: layout.windowHeight,
    pageScale: layout.pageScale,
  };
  popupMetricsKey = metricsResolutionKey(metrics);

  popupWindow = new BrowserWindow({
    width: layout.windowWidth,
    height: layout.windowHeight,
    useContentSize: true,
    minWidth: 200,
    minHeight: 160,
    title: 'Playable 预览 — 大屏',
    backgroundColor: '#0f1419',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preview-preload.cjs'),
    },
  });

  wireConsoleForward(popupWindow.webContents);
  wirePopupWindow(popupWindow);

  await loadPopupPreview(popupWindow.webContents, metrics);
  startFpsPoll(popupWindow.webContents, { allowHidden: true });
  return { ok: true };
}

function destroyPreview() {
  embeddedVisibleBeforePopup = false;
  closePreviewPopup();
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

async function applyCdp(webContents, preset, metricsOverride, opts = {}) {
  const dbg = attachDebugger(webContents);
  if (!dbg) return;

  const metrics = metricsOverride || lastMetrics || preset.metrics;
  const pageScale =
    typeof metrics.pageScale === 'number' && metrics.pageScale > 0 ? metrics.pageScale : 1;
  const scaleMetrics = {
    width: metrics.width,
    height: metrics.height,
    dpr: metrics.dpr,
    pageScale,
  };
  if (opts.persistMetrics !== false) {
    lastMetrics = scaleMetrics;
  }

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

  await applyDeviceScale(webContents, scaleMetrics);
}

function wireConsoleForward(webContents) {
  webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (!shouldForwardPreviewIpc(webContents)) return;
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
      preload: path.join(__dirname, 'preview-preload.cjs'),
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
  if (popupActive) return;
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

  if (popupActive && isPopupOpen()) {
    await syncPreviewPopup(metricsOverride, { resize: false });
    return { ok: true, url: entryUrl(), popupOnly: true };
  }

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
  if (!popupActive) stopFpsPoll();
  if (previewView) {
    previewView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
  if (popupActive) {
    embeddedVisibleBeforePopup = false;
  }
}

function revealPreview() {
  if (popupActive && isPopupOpen()) {
    popupWindow.focus();
    return { ok: true, popupOnly: true };
  }
  if (!previewView) return { ok: false, error: 'no-view' };
  visible = true;
  updateBounds(bounds);
  startFpsPoll(previewView.webContents);
  return { ok: true };
}

async function reloadPreview(metricsOverride) {
  if (popupActive && isPopupOpen()) {
    await syncPreviewPopup(metricsOverride, { resize: false });
    return { ok: true, popupOnly: true };
  }
  if (!previewView || !visible) return { ok: false };
  const preset = getPreset(currentPresetId);
  stopFpsPoll();
  await previewView.webContents.loadURL(entryUrl());
  await applyCdp(previewView.webContents, preset, metricsOverride);
  startFpsPoll(previewView.webContents);
  return { ok: true };
}

async function applyMetrics(metrics) {
  if (popupActive && isPopupOpen()) {
    if (!metrics || typeof metrics !== 'object') return;
    const pageScale =
      typeof metrics.pageScale === 'number' && metrics.pageScale > 0 ? metrics.pageScale : 1;
    lastMetrics = {
      width: metrics.width,
      height: metrics.height,
      dpr: metrics.dpr,
      pageScale,
    };
    const preset = getPreset(currentPresetId);
    resizePreviewPopup(lastMetrics, true);
    await applyCdp(
      popupWindow.webContents,
      preset,
      {
        ...lastMetrics,
        pageScale: popupLayoutCache?.pageScale ?? computePopupLayout(lastMetrics).pageScale,
      },
      { persistMetrics: false },
    );
    return;
  }
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
  const preset = getPreset(currentPresetId);
  if (popupActive && isPopupOpen()) {
    await applyCdp(
      popupWindow.webContents,
      preset,
      {
        ...(lastMetrics || preset.metrics),
        pageScale: popupLayoutCache?.pageScale ?? computePopupLayout(lastMetrics || preset.metrics).pageScale,
      },
      { persistMetrics: false },
    );
    return { ok: true, applied: true };
  }
  if (!previewView || !visible) return { ok: true, applied: false };
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
  openPreviewPopup,
  closePreviewPopup,
  shouldForwardPreviewIpc,
  getPreviewWebContents: () => previewView?.webContents || null,
};
