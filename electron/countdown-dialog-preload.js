const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('countdownDialog', {
  getDefaults: () => ipcRenderer.invoke('get-countdown-defaults'),
  submit: (values) => ipcRenderer.send('countdown-dialog-submit', values),
  cancel: () => ipcRenderer.send('countdown-dialog-cancel'),
});
