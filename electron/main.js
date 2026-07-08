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
let countdownDialog = null;
let tray = null;
let config = loadConfig();
let updateDownloaded = false;
let manualUpdateCheck = false;
let countdownRunning = false;
let countdownTimer = null;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function showUpdateToast(message, type = 'info', persistent = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('update-toast', { message, type, persistent });
}

function checkForUpdatesManual() {
  if (isDev) {
    showMainWindow();
    showUpdateToast('开发模式下无法检查更新', 'info');
    return;
  }

  showMainWindow();
  manualUpdateCheck = true;
  showUpdateToast('正在检查更新…', 'info');
  autoUpdater.checkForUpdates().catch(() => {
    if (manualUpdateCheck) {
      manualUpdateCheck = false;
    }
  });
}

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
    resizable: false,
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

function fitMainWindow(width, height) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const bounds = mainWindow.getBounds();
  mainWindow.setContentSize(Math.ceil(width), Math.ceil(height));

  const nextBounds = mainWindow.getBounds();
  config.windowBounds = {
    width: nextBounds.width,
    height: nextBounds.height,
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

function getCountdownTotalSeconds({ hours, minutes, seconds }) {
  return hours * 3600 + minutes * 60 + seconds;
}

function clearCountdownTimer() {
  if (countdownTimer) {
    clearTimeout(countdownTimer);
    countdownTimer = null;
  }
}

function stopCountdown({ notifyRenderer = true } = {}) {
  clearCountdownTimer();
  countdownRunning = false;
  if (notifyRenderer && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('countdown-stop', { ended: false });
  }
  rebuildTrayMenu();
}

function onCountdownEnd() {
  if (!countdownRunning) return;

  const shouldRemind = config.countdown?.remind === true;
  countdownRunning = false;
  clearCountdownTimer();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('countdown-stop', {
      ended: true,
      remind: shouldRemind,
    });
  }

  if (shouldRemind) {
    showMainWindow();
    mainWindow?.flashFrame(true);
    showUpdateToast('倒计时结束！', 'success', true);
  }

  rebuildTrayMenu();
}

function startCountdown(values) {
  const totalSeconds = getCountdownTotalSeconds(values);
  if (totalSeconds <= 0) return;

  config.countdown = {
    hours: values.hours,
    minutes: values.minutes,
    seconds: values.seconds,
    remind: values.remind,
  };
  saveConfig(config);

  stopCountdown({ notifyRenderer: false });
  countdownRunning = true;
  showMainWindow();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('countdown-start', config.countdown);
  }

  countdownTimer = setTimeout(onCountdownEnd, totalSeconds * 1000);
  rebuildTrayMenu();
}

function openCountdownDialog() {
  if (countdownDialog) {
    countdownDialog.focus();
    return;
  }

  countdownDialog = new BrowserWindow({
    width: 340,
    height: 280,
    resizable: false,
    minimizable: false,
    maximizable: false,
    modal: true,
    parent: mainWindow,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'countdown-dialog-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  countdownDialog.loadFile(
    path.join(__dirname, '..', 'renderer', 'countdown-dialog.html'),
  );

  countdownDialog.once('ready-to-show', () => {
    countdownDialog.show();
  });

  countdownDialog.on('closed', () => {
    countdownDialog = null;
  });
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
      label: '设置倒计时…',
      click: openCountdownDialog,
    },
  ];

  if (countdownRunning) {
    template.push({
      label: '停止倒计时',
      click: () => stopCountdown(),
    });
  }

  template.push({ type: 'separator' });

  template.push({
    label: '检查更新',
    click: checkForUpdatesManual,
  });

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

function registerAutoUpdaterEvents() {
  autoUpdater.on('update-available', () => {
    showUpdateToast('发现新版本，正在后台下载…', 'info');
  });

  autoUpdater.on('update-not-available', () => {
    if (manualUpdateCheck) {
      showUpdateToast('当前已是最新版本', 'success');
      manualUpdateCheck = false;
    }
  });

  autoUpdater.on('update-downloaded', () => {
    updateDownloaded = true;
    rebuildTrayMenu();
    showUpdateToast('更新已下载，请从托盘选择「立即重启并更新」', 'success');
  });

  autoUpdater.on('error', (error) => {
    console.error('Auto update error:', error);
    if (manualUpdateCheck) {
      showUpdateToast('检查更新失败，请确认已联网。', 'error');
      manualUpdateCheck = false;
    }
  });
}

function setupAutoUpdater() {
  registerAutoUpdaterEvents();

  if (isDev) return;

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

  ipcMain.handle('fit-window', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const size = await mainWindow.webContents.executeJavaScript(`
      (() => {
        const appEl = document.getElementById('app');
        const toast = document.getElementById('toast');
        const appRect = appEl.getBoundingClientRect();
        let width = appRect.width + 16;
        let height = appRect.height + 16;

        if (toast.classList.contains('visible')) {
          const toastRect = toast.getBoundingClientRect();
          width = Math.max(width, toastRect.width + 32);
          height = Math.max(height, toastRect.bottom - appRect.top + 16);
        }

        return {
          width: Math.ceil(width),
          height: Math.ceil(height),
        };
      })()
    `);
    fitMainWindow(size.width, size.height);
  });

  ipcMain.handle('get-countdown-defaults', () => config.countdown);

  ipcMain.on('countdown-dialog-submit', (_event, values) => {
    if (countdownDialog) {
      countdownDialog.close();
    }
    startCountdown(values);
  });

  ipcMain.on('countdown-dialog-cancel', () => {
    if (countdownDialog) {
      countdownDialog.close();
    }
  });

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
    clearCountdownTimer();
    persistWindowBounds();
  });

  app.on('activate', showMainWindow);
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});
