const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopClock', {
  platform: process.platform,
  getTimeFormat: () => ipcRenderer.invoke('get-time-format'),
  onTimeFormatChange: (callback) => {
    ipcRenderer.on('time-format-changed', (_event, use24Hour) => {
      callback(use24Hour);
    });
  },
});
