const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktopClock', {
  platform: process.platform,
});
