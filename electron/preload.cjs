const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pvDesktop', {
  isDesktop: true,
  getPreset: () => ipcRenderer.invoke('pv:getPreset'),
  listPresets: () => ipcRenderer.invoke('pv:listPresets'),
  setPreset: (presetId) => ipcRenderer.invoke('pv:setPreset', presetId),
  setPreviewVfs: (payload) => ipcRenderer.invoke('pv:setPreviewVfs', payload),
  showPreview: (metrics) => ipcRenderer.invoke('pv:showPreview', metrics),
  hidePreview: () => ipcRenderer.invoke('pv:hidePreview'),
  reloadPreview: (metrics) => ipcRenderer.invoke('pv:reloadPreview', metrics),
  updatePreviewBounds: (bounds) => ipcRenderer.invoke('pv:updatePreviewBounds', bounds),
  applyPreviewMetrics: (metrics) => ipcRenderer.invoke('pv:applyPreviewMetrics', metrics),
  saveBundleForRestore: (payload) => ipcRenderer.invoke('pv:saveBundleForRestore', payload),
  loadRestoredBundle: () => ipcRenderer.invoke('pv:loadRestoredBundle'),
  clearRestoredBundle: () => ipcRenderer.invoke('pv:clearRestoredBundle'),
  onConsole: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('pv:console', listener);
    return () => ipcRenderer.removeListener('pv:console', listener);
  },
  onProbe: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('pv:probe', listener);
    return () => ipcRenderer.removeListener('pv:probe', listener);
  },
  onMemoryWarning: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('pv:memory-warning', listener);
    return () => ipcRenderer.removeListener('pv:memory-warning', listener);
  },
  onFps: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('pv:fps', listener);
    return () => ipcRenderer.removeListener('pv:fps', listener);
  },
});
