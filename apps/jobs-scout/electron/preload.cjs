const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jobsApi', {
  startRun: (config) => ipcRenderer.send('start-run', config),
  stopRun: () => ipcRenderer.send('stop-run'),
  onLog: (handler) => ipcRenderer.on('log-line', (_event, line) => handler(line)),
  pickResume: () => ipcRenderer.invoke('pick-resume'),
  saveResume: (payload) => ipcRenderer.invoke('save-resume', payload),
  exportLogs: () => ipcRenderer.invoke('export-logs'),
  chatSend: (payload) => ipcRenderer.invoke('chat-send', payload)
});
