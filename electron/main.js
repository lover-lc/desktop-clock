const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  shell,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { loadConfig, saveConfig } = require('./config');

const isDev = !app.isPackaged;
let mainWindow = null;
let tray = null;
let config = loadConfig();
let updateDownloaded = false;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function getTrayIcon() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
}

function createWindow() {
  const { windowBounds } = config;

  mainWindow = new BrowserWindow({
    width: windowBounds.width,
    height: windowBounds.height,
    x: windowBounds.x,
    y: windowBounds.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    notifyTimeFormat();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('moved', persistWindowBounds);
  mainWindow.on('resized', persistWindowBounds);
}

function persistWindowBounds() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  config.windowBounds = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
  };
  saveConfig(config);
}

function applyLoginItemSettings() {
  app.setLoginItemSettings({
    openAtLogin: config.openAtLogin,
    openAsHidden: false,
  });
}

function setAlwaysOnTop(enabled) {
  config.alwaysOnTop = enabled;
  saveConfig(config);
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(enabled);
  }
  rebuildTrayMenu();
}

function setOpenAtLogin(enabled) {
  config.openAtLogin = enabled;
  saveConfig(config);
  applyLoginItemSettings();
  rebuildTrayMenu();
}

function notifyTimeFormat() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('time-format-changed', config.use24Hour);
}

function setUse24Hour(enabled) {
  config.use24Hour = enabled;
  saveConfig(config);
  notifyTimeFormat();
  rebuildTrayMenu();
}

function showMainWindow() {
  if (!mainWindow) return;
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
}

function rebuildTrayMenu() {
  if (!tray) return;

  const template = [
    {
      label: '显示时钟',
      click: showMainWindow,
    },
    { type: 'separator' },
    {
      label: '窗口置顶',
      type: 'checkbox',
      checked: config.alwaysOnTop,
      click: (item) => setAlwaysOnTop(item.checked),
    },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: config.openAtLogin,
      click: (item) => setOpenAtLogin(item.checked),
    },
    {
      label: '24 小时制',
      type: 'checkbox',
      checked: config.use24Hour,
      click: (item) => setUse24Hour(item.checked),
    },
    { type: 'separator' },
    {
      label: '检查更新',
      click: () => {
        autoUpdater.checkForUpdates().catch(() => {
          tray?.displayBalloon({
            title: 'Desktop Clock',
            content: '检查更新失败，请确认已联网。',
          });
        });
      },
    },
  ];

  if (updateDownloaded) {
    template.push({
      label: '立即重启并更新',
      click: () => {
        app.isQuitting = true;
        autoUpdater.quitAndInstall();
      },
    });
  }

  template.push(
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  );

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  tray = new Tray(getTrayIcon());
  tray.setToolTip('Desktop Clock');
  rebuildTrayMenu();

  tray.on('double-click', showMainWindow);
}

function setupAutoUpdater() {
  if (isDev) return;

  autoUpdater.on('checking-for-update', () => {
    tray?.displayBalloon({
      title: 'Desktop Clock',
      content: '正在检查更新…',
    });
  });

  autoUpdater.on('update-available', () => {
    tray?.displayBalloon({
      title: 'Desktop Clock',
      content: '发现新版本，正在后台下载…',
    });
  });

  autoUpdater.on('update-not-available', () => {
    // Silent when no update during background check.
  });

  autoUpdater.on('update-downloaded', () => {
    updateDownloaded = true;
    rebuildTrayMenu();
    tray?.displayBalloon({
      title: 'Desktop Clock',
      content: '更新已下载，可在托盘菜单选择「立即重启并更新」。',
    });
  });

  autoUpdater.on('error', (error) => {
    console.error('Auto update error:', error);
  });

  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    console.error('Initial update check failed:', error);
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);

  ipcMain.handle('get-time-format', () => config.use24Hour);

  app.whenReady().then(() => {
    applyLoginItemSettings();
    createWindow();
    createTray();
    setupAutoUpdater();
  });

  app.on('window-all-closed', (event) => {
    event.preventDefault();
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    persistWindowBounds();
  });

  app.on('activate', showMainWindow);
}

// Prevent navigation away from the clock page.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});
