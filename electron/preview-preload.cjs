const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pvFpsBridge', (fps, heapUsedMB, heapLimitMB) => {
  ipcRenderer.send('pv:fps', { fps, heapUsedMB, heapLimitMB });
});

contextBridge.exposeInMainWorld('pvDesktopProbe', {
  post: (msg) => {
    ipcRenderer.send('pv:probe', msg);
  },
});
