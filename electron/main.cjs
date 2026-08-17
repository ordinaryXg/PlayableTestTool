const path = require('node:path');
const { app, BrowserWindow, ipcMain, protocol, shell } = require('electron');
const { getPreset, listPresets, DEFAULT_PRESET_ID } = require('./presets.cjs');
const {
  readSettings,
  writeSettings,
  saveLastBundle,
  readLastBundle,
  clearLastBundle,
} = require('./settings.cjs');
const {
  registerPreviewProtocol,
  setVfs,
  clearVfs,
} = require('./protocol.cjs');
const previewManager = require('./previewManager.cjs');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'pv-preview',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

function resolvePresetId() {
  const arg = process.argv.find((a) => a.startsWith('--preset='));
  if (arg) return arg.split('=')[1] || DEFAULT_PRESET_ID;
  // settings need app path — before ready we can still use env
  if (process.env.PV_PRESET) return process.env.PV_PRESET;
  return null;
}

let presetId = resolvePresetId() || DEFAULT_PRESET_ID;

function applyBootSwitches(id) {
  const p = getPreset(id);
  if (p.heap > 0) {
    app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${p.heap}`);
  }
  if (p.softGpu) {
    app.commandLine.appendSwitch('enable-unsafe-swiftshader');
    app.commandLine.appendSwitch('use-angle', 'swiftshader');
    app.commandLine.appendSwitch('disable-gpu-compositing');
  }
}

// Prefer CLI/env; otherwise read settings after we can get userData — but switches must be before ready.
// So: if no CLI, try reading settings file from expected userData path early.
function earlyReadPreset() {
  if (resolvePresetId()) return resolvePresetId();
  try {
    const fs = require('node:fs');
    // Approximate userData before ready
    const userData = app.getPath('userData');
    const raw = fs.readFileSync(path.join(userData, 'settings.json'), 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data.presetId === 'string') return data.presetId;
  } catch {
    /* ignore */
  }
  return DEFAULT_PRESET_ID;
}

presetId = earlyReadPreset();
applyBootSwitches(presetId);
previewManager.setPresetId(presetId);
/** Preset id used for process-level switches at boot (heap / SwiftShader). */
const bootPresetId = presetId;

function bootDiffersFrom(id) {
  const boot = getPreset(bootPresetId);
  const next = getPreset(id);
  return boot.heap !== next.heap || boot.softGpu !== next.softGpu;
}

/** @type {BrowserWindow | null} */
let mainWindow = null;
let memoryTimer = null;

function resolveAppIcon() {
  const ico = path.join(__dirname, '..', 'build', 'icon.ico');
  const png = path.join(__dirname, '..', 'build', 'icon.png');
  try {
    if (require('node:fs').existsSync(ico)) return ico;
  } catch {
    /* ignore */
  }
  return png;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 840,
    minHeight: 640,
    title: 'Playable 合规检测器',
    backgroundColor: '#0f1419',
    icon: resolveAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  previewManager.setMainWindow(mainWindow);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    previewManager.destroyPreview();
    mainWindow = null;
  });

  mainWindow.on('resize', () => {
    // renderer drives precise bounds via IPC
  });
}

function startMemoryWatch() {
  if (memoryTimer) clearInterval(memoryTimer);
  memoryTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const preset = getPreset(presetId);
    for (const m of app.getAppMetrics()) {
      const mb = m.memory.workingSetSize / 1024;
      if (mb > preset.oomWarnMb) {
        mainWindow.webContents.send('pv:memory-warning', {
          type: m.type,
          pid: m.pid,
          mb: Math.round(mb),
          limitMb: preset.oomWarnMb,
          at: Date.now(),
        });
      }
    }
  }, 2000);
}

function registerIpc() {
  ipcMain.on('pv:fps', (event, payload) => {
    if (!previewManager.shouldForwardPreviewIpc(event.sender)) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pv:fps', payload);
    }
  });

  ipcMain.on('pv:probe', (event, payload) => {
    if (!previewManager.shouldForwardPreviewIpc(event.sender)) return;
    // FPS/heap is sampled centrally via pv:fps — ignore inject duplicate.
    if (payload && payload.type === 'fps') return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pv:probe', payload);
    }
  });

  ipcMain.handle('pv:getPreset', () => {
    const p = getPreset(presetId);
    const boot = getPreset(bootPresetId);
    return {
      id: p.id,
      label: p.label,
      description: p.description,
      heap: p.heap,
      softGpu: p.softGpu,
      cpu: p.cpu,
      metrics: p.metrics,
      requiresRelaunch: false,
      bootPresetId,
      bootHeap: boot.heap,
      bootSoftGpu: boot.softGpu,
      processLimitsPending: bootDiffersFrom(presetId),
    };
  });

  ipcMain.handle('pv:listPresets', () => listPresets());

  ipcMain.handle('pv:setPreset', async (_e, nextId) => {
    const p = getPreset(nextId);
    writeSettings({ presetId: p.id, pendingRestore: false });
    presetId = p.id;
    previewManager.setPresetId(p.id);
    const applied = await previewManager.reapplyPreset();
    const processLimitsPending = bootDiffersFrom(p.id);
    return {
      ok: true,
      relaunching: false,
      applied: Boolean(applied && applied.applied),
      processLimitsPending,
      bootPresetId,
    };
  });

  ipcMain.handle('pv:relaunchForPreset', (_e, nextId) => {
    const p = getPreset(nextId || presetId);
    writeSettings({ presetId: p.id, pendingRestore: true });
    app.relaunch({
      args: [
        ...process.argv.slice(1).filter((a) => !a.startsWith('--preset=')),
        `--preset=${p.id}`,
      ],
    });
    app.exit(0);
    return { ok: true, relaunching: true };
  });

  ipcMain.handle('pv:setPreviewVfs', (_e, payload) => {
    try {
      const files = {};
      for (const [k, v] of Object.entries(payload.files || {})) {
        if (typeof v === 'string') {
          files[k] = Buffer.from(v, 'base64');
        } else if (v && v.type === 'Buffer' && Array.isArray(v.data)) {
          files[k] = Buffer.from(v.data);
        } else if (v instanceof Uint8Array || Buffer.isBuffer(v)) {
          files[k] = Buffer.from(v);
        }
      }
      setVfs(files, payload.entryHtmlPath, payload.injectScript || null);
      if (payload.previewEnv && typeof payload.previewEnv === 'object') {
        previewManager.setPreviewEnv(payload.previewEnv);
      }
      return { ok: true, entry: payload.entryHtmlPath };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle('pv:showPreview', async (_e, metrics) => previewManager.showPreview(metrics));
  ipcMain.handle('pv:hidePreview', () => {
    previewManager.hidePreview();
    return { ok: true };
  });
  ipcMain.handle('pv:revealPreview', () => previewManager.revealPreview());
  ipcMain.handle('pv:reloadPreview', async (_e, metrics) => previewManager.reloadPreview(metrics));
  ipcMain.handle('pv:updatePreviewBounds', (_e, b) => {
    previewManager.updateBounds(b);
    return { ok: true };
  });
  ipcMain.handle('pv:applyPreviewMetrics', async (_e, metrics) => {
    await previewManager.applyMetrics(metrics);
    return { ok: true };
  });
  ipcMain.handle('pv:openPreviewPopup', async (_e, metrics) =>
    previewManager.openPreviewPopup(metrics),
  );
  ipcMain.handle('pv:closePreviewPopup', () => {
    previewManager.closePreviewPopup();
    return { ok: true };
  });

  ipcMain.handle('pv:saveBundleForRestore', (_e, payload) => {
    try {
      const buf = Buffer.from(payload.base64, 'base64');
      saveLastBundle(payload.fileName || 'bundle.zip', buf);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('pv:loadRestoredBundle', () => {
    const settings = readSettings();
    if (!settings.pendingRestore) return null;
    const last = readLastBundle();
    if (!last) {
      writeSettings({ pendingRestore: false });
      return null;
    }
    writeSettings({ pendingRestore: false });
    return {
      fileName: last.fileName,
      base64: last.buffer.toString('base64'),
    };
  });

  ipcMain.handle('pv:clearRestoredBundle', () => {
    clearLastBundle();
    return { ok: true };
  });
}

app.whenReady().then(() => {
  // Sync settings file with actual boot preset
  writeSettings({ presetId });
  registerPreviewProtocol();
  registerIpc();
  createWindow();
  startMemoryWatch();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (memoryTimer) clearInterval(memoryTimer);
  clearVfs();
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
});
