const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  screen,
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
let dragOffset = null;

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

  mainWindow.webContents.on('context-menu', (event) => {
    event.preventDefault();
    showWindowContextMenu();
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

function formatCountdownDuration({ hours, minutes, seconds }) {
  const parts = [];
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分钟`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}秒`);
  return `${parts.join('')}计时结束！`;
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
    const message = formatCountdownDuration(config.countdown);
    showMainWindow();
    mainWindow?.flashFrame(true);
    setTimeout(() => {
      showUpdateToast(message, 'countdown-end', true);
    }, 80);
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
    width: 400,
    height: 320,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
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

function buildAppMenuTemplate() {
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
      label: '正在更新…',
      enabled: false,
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

  return template;
}

function showWindowContextMenu() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  Menu.buildFromTemplate(buildAppMenuTemplate()).popup({ window: mainWindow });
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(buildAppMenuTemplate()));
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
    app.isQuitting = true;
    autoUpdater.quitAndInstall(true, true);
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
        const rect = appEl.getBoundingClientRect();
        return {
          width: Math.ceil(rect.width + 16),
          height: Math.ceil(rect.height + 16),
        };
      })()
    `);
    fitMainWindow(size.width, size.height);
  });

  ipcMain.on('window-drag-start', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [x, y] = mainWindow.getPosition();
    const cursor = screen.getCursorScreenPoint();
    dragOffset = { x: cursor.x - x, y: cursor.y - y };
  });

  ipcMain.on('window-drag-move', (_event, { screenX, screenY }) => {
    if (!mainWindow || mainWindow.isDestroyed() || !dragOffset) return;
    mainWindow.setPosition(
      Math.round(screenX - dragOffset.x),
      Math.round(screenY - dragOffset.y),
    );
  });

  ipcMain.on('window-drag-end', () => {
    dragOffset = null;
    persistWindowBounds();
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
