const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopClock', {
  platform: process.platform,
  getTimeFormat: () => ipcRenderer.invoke('get-time-format'),
  onTimeFormatChange: (callback) => {
    ipcRenderer.on('time-format-changed', (_event, use24Hour) => {
      callback(use24Hour);
    });
  },
  onUpdateToast: (callback) => {
    ipcRenderer.on('update-toast', (_event, payload) => {
      callback(payload);
    });
  },
  onCountdownStart: (callback) => {
    ipcRenderer.on('countdown-start', (_event, payload) => {
      callback(payload);
    });
  },
  onCountdownStop: (callback) => {
    ipcRenderer.on('countdown-stop', (_event, payload) => {
      callback(payload);
    });
  },
  fitWindow: () => ipcRenderer.invoke('fit-window'),
});
