const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  alwaysOnTop: false,
  openAtLogin: false,
  use24Hour: true,
  windowBounds: { width: 820, height: 280, x: undefined, y: undefined },
};

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
}

module.exports = { DEFAULTS, loadConfig, saveConfig };
