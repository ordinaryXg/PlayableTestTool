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

function setMainWindow(win) {
  mainWindow = win;
}

function setPresetId(id) {
  currentPresetId = id;
}

function destroyPreview() {
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
  const dbg = webContents.debugger;
  try {
    if (!dbg.isAttached()) dbg.attach('1.3');
  } catch {
    try {
      dbg.attach('1.3');
    } catch (err) {
      console.warn('[cdp] attach failed', err);
      return;
    }
  }

  const metrics = metricsOverride || preset.metrics;
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

  try {
    await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: metrics.width,
      height: metrics.height,
      deviceScaleFactor: metrics.dpr,
      mobile: true,
    });
  } catch (err) {
    console.warn('[cdp] metrics', err);
  }
}

function wireConsoleForward(webContents) {
  webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Electron 35+: details live on the event object; older args still accepted.
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
  mainWindow.contentView.addChildView(previewView);
  return previewView;
}

function updateBounds(next) {
  if (!next) return;
  bounds = {
    x: Math.round(next.x || 0),
    y: Math.round(next.y || 0),
    width: Math.max(0, Math.round(next.width || 0)),
    height: Math.max(0, Math.round(next.height || 0)),
  };
  if (!previewView || !visible) return;
  if (bounds.width < 2 || bounds.height < 2) {
    previewView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    return;
  }
  previewView.setBounds(bounds);
}

async function showPreview(metricsOverride) {
  if (!mainWindow) return { ok: false, error: 'no-window' };
  const view = ensurePreviewView();
  if (!view) return { ok: false, error: 'no-view' };

  const preset = getPreset(currentPresetId);
  visible = true;
  updateBounds(bounds);

  const url = entryUrl();
  await view.webContents.loadURL(url);
  await applyCdp(view.webContents, preset, metricsOverride);
  try {
    await view.webContents.executeJavaScript(`
      (function(){
        if (window.__pvFpsHooked) return;
        window.__pvFpsHooked = true;
        var last = performance.now(), frames = 0;
        function tick(now){
          frames++;
          if (now - last >= 500) {
            var fps = Math.round((frames * 1000) / (now - last));
            frames = 0; last = now;
            var heapUsedMB, heapLimitMB;
            try {
              if (performance.memory) {
                heapUsedMB = Math.round((performance.memory.usedJSHeapSize / 1048576) * 10) / 10;
                heapLimitMB = Math.round((performance.memory.jsHeapSizeLimit / 1048576) * 10) / 10;
              }
            } catch (e) {}
            try {
              if (window.pvFpsBridge) window.pvFpsBridge(fps, heapUsedMB, heapLimitMB);
            } catch (e) {}
          }
          requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      })();
    `, true);
  } catch (err) {
    console.warn('[fps inject]', err);
  }
  return { ok: true, url };
}

function hidePreview() {
  visible = false;
  if (previewView) {
    previewView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
}

/** Re-show without reloading (used when switching back from Console tab). */
function revealPreview() {
  if (!previewView) return { ok: false, error: 'no-view' };
  visible = true;
  updateBounds(bounds);
  return { ok: true };
}

async function reloadPreview(metricsOverride) {
  if (!previewView || !visible) return { ok: false };
  const preset = getPreset(currentPresetId);
  await previewView.webContents.reload();
  await applyCdp(previewView.webContents, preset, metricsOverride);
  return { ok: true };
}

async function applyMetrics(metrics) {
  if (!previewView || !visible) return;
  const preset = getPreset(currentPresetId);
  await applyCdp(previewView.webContents, preset, metrics);
}

module.exports = {
  setMainWindow,
  setPresetId,
  destroyPreview,
  updateBounds,
  showPreview,
  hidePreview,
  revealPreview,
  reloadPreview,
  applyMetrics,
  getPreviewWebContents: () => previewView?.webContents || null,
};
