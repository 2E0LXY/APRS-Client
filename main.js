const { app, BrowserWindow, ipcMain, shell, Notification, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

const SERVER_URL = 'https://www.aprsnet.uk';
const WS_URL = 'wss://www.aprsnet.uk/ws';
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

const defaultSettings = {
  callsign: '',
  passcode: '',
  memberUser: '',
  memberPass: '',
  memberToken: '',
  autoMemberLogin: true,
  notifications: true,
  minimizeToTray: true,
  launchOnStartup: false,
  startMinimized: false,
  positionMode: 'manual',
  manualLat: null,
  manualLon: null,
  watchlist: ''
};

let mainWindow;
let tray;
let settings = loadSettings();
let lastKnownPosition = null;

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return Object.assign({}, defaultSettings, JSON.parse(fs.readFileSync(settingsPath, 'utf8')));
    }
  } catch (err) {
    console.warn('Settings load failed:', err.message);
  }
  return Object.assign({}, defaultSettings);
}

function saveSettings(nextSettings) {
  settings = Object.assign({}, settings, nextSettings);
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.warn('Settings save failed:', err.message);
  }
  applyLaunchOnStartup(settings.launchOnStartup);
  updateTray();
  if (mainWindow) mainWindow.webContents.send('settings-changed', settings);
  return settings;
}

function openSafeExternal(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl));
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      shell.openExternal(parsed.toString());
      return true;
    }
  } catch (err) {}
  return false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 700,
    title: 'APRSNET Desktop',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#07110d',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'geolocation' || permission === 'notifications');
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      openSafeExternal(url);
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (!settings.startMinimized) mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (settings.minimizeToTray && tray && !app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.on('click', showMainWindow);
    updateTray();
  } catch (err) {
    console.warn('Tray unavailable:', err.message);
  }
}

function showMainWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

function updateTray() {
  if (!tray) return;
  const label = settings.callsign ? `${settings.callsign} - APRSNET Desktop` : 'APRSNET Desktop';
  tray.setToolTip(label);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label, enabled: false },
    { type: 'separator' },
    { label: 'Open', click: showMainWindow },
    { label: 'Reload', click: () => mainWindow && mainWindow.reload() },
    { label: 'APRSNET Website', click: () => openSafeExternal(SERVER_URL) },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
}

function applyLaunchOnStartup(enabled) {
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled, args: settings.startMinimized ? ['--hidden'] : [] });
  } catch (err) {}
}

function requestAprsnet(req = {}) {
  return new Promise((resolve) => {
    const method = String(req.method || 'GET').toUpperCase();
    const apiPath = String(req.path || '/');
    if (!apiPath.startsWith('/api/')) {
      resolve({ ok: false, status: 400, error: 'Only /api/ paths are allowed' });
      return;
    }

    const body = req.body === undefined || req.body === null ? null : JSON.stringify(req.body);
    const headers = Object.assign({ Accept: 'application/json' }, req.headers || {});
    if (body) headers['Content-Type'] = 'application/json';
    if (settings.memberToken && !headers['X-Member-Token']) headers['X-Member-Token'] = settings.memberToken;

    const request = https.request(SERVER_URL + apiPath, { method, headers, timeout: 12000 }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (err) { data = text; }
        resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, data });
      });
    });

    request.on('error', err => resolve({ ok: false, status: 0, error: err.message }));
    request.on('timeout', () => {
      request.destroy();
      resolve({ ok: false, status: 0, error: 'timeout' });
    });
    if (body) request.write(body);
    request.end();
  });
}

ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:save', (_event, patch) => saveSettings(patch || {}));
ipcMain.handle('server:get', () => ({ url: SERVER_URL, ws: WS_URL }));
ipcMain.handle('api:request', (_event, req) => requestAprsnet(req));
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:open-external', (_event, url) => openSafeExternal(url));
ipcMain.handle('app:reload', () => mainWindow && mainWindow.reload());
ipcMain.handle('notify:show', (_event, title, body) => {
  if (settings.notifications && Notification.isSupported()) {
    new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
  }
});
ipcMain.handle('position:get', () => {
  if (settings.positionMode === 'manual' && Number.isFinite(settings.manualLat) && Number.isFinite(settings.manualLon)) {
    return { source: 'manual', lat: settings.manualLat, lon: settings.manualLon, ts: Date.now() };
  }
  if (settings.positionMode === 'gps') return lastKnownPosition;
  return null;
});
ipcMain.handle('position:report', (_event, pos) => {
  if (pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lon)) {
    lastKnownPosition = { source: 'gps', lat: pos.lat, lon: pos.lon, accuracy: pos.accuracy || null, ts: Date.now() };
  }
  return lastKnownPosition;
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.whenReady().then(() => {
    if (process.argv.includes('--hidden')) settings.startMinimized = true;
    createWindow();
    createTray();
    applyLaunchOnStartup(settings.launchOnStartup);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
