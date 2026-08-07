const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { DEFAULT_PRESET_ID } = require('./presets.cjs');

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function sessionPath() {
  return path.join(app.getPath('userData'), 'last-session.json');
}

function lastBundlePath() {
  return path.join(app.getPath('userData'), 'last-bundle.bin');
}

function lastBundleMetaPath() {
  return path.join(app.getPath('userData'), 'last-bundle-meta.json');
}

function readSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const data = JSON.parse(raw);
    return {
      presetId: typeof data.presetId === 'string' ? data.presetId : DEFAULT_PRESET_ID,
      pendingRestore: Boolean(data.pendingRestore),
    };
  } catch {
    return { presetId: DEFAULT_PRESET_ID, pendingRestore: false };
  }
}

function writeSettings(partial) {
  const next = { ...readSettings(), ...partial };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function saveSessionMeta(meta) {
  fs.mkdirSync(path.dirname(sessionPath()), { recursive: true });
  fs.writeFileSync(sessionPath(), JSON.stringify(meta, null, 2), 'utf8');
}

function readSessionMeta() {
  try {
    return JSON.parse(fs.readFileSync(sessionPath(), 'utf8'));
  } catch {
    return null;
  }
}

function saveLastBundle(fileName, buffer) {
  fs.mkdirSync(path.dirname(lastBundlePath()), { recursive: true });
  fs.writeFileSync(lastBundlePath(), buffer);
  fs.writeFileSync(
    lastBundleMetaPath(),
    JSON.stringify({ fileName, savedAt: Date.now(), size: buffer.byteLength }, null, 2),
    'utf8',
  );
}

function readLastBundle() {
  try {
    const meta = JSON.parse(fs.readFileSync(lastBundleMetaPath(), 'utf8'));
    const buffer = fs.readFileSync(lastBundlePath());
    return { fileName: meta.fileName || 'restored.zip', buffer };
  } catch {
    return null;
  }
}

function clearLastBundle() {
  for (const p of [lastBundlePath(), lastBundleMetaPath(), sessionPath()]) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  readSettings,
  writeSettings,
  saveSessionMeta,
  readSessionMeta,
  saveLastBundle,
  readLastBundle,
  clearLastBundle,
};
