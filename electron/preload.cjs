const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  run: (config) => ipcRenderer.invoke('run-job', config),
  stop: () => ipcRenderer.invoke('stop-job'),
  continueLogin: () => ipcRenderer.invoke('continue-login'),
  exportBundle: () => ipcRenderer.invoke('export-support-bundle'),
  onLog: (handler) => ipcRenderer.on('log', (_event, message) => handler(message)),
  onStatus: (handler) => ipcRenderer.on('status', (_event, status) => handler(status)),
  notify: (message) => ipcRenderer.send('renderer-event', message)
});

ipcRenderer.send('renderer-event', 'preload-loaded');
