const { app, BrowserWindow, ipcMain, shell, Notification, Tray, Menu, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const fs   = require('fs');
const https = require('https');

// Hard-coded server endpoint.
const SERVER_URL = 'https://www.aprsnet.uk';
const WS_URL     = 'wss://www.aprsnet.uk/ws';

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

const defaultSettings = {
  // Account / connection
  callsign:        '',
  passcode:        '',
  memberUser:      '',          // APRSNET member account username
  memberPass:      '',          // APRSNET member account password
  memberToken:     '',          // APRSNET member API session token
  autoConnect:     true,
  autoMemberLogin: true,        // auto sign-in to the APRSNET member account
  minimizeToTray:  true,
  notifications:   true,
  startMinimized:  false,
  launchOnStartup: false,

  // Position (for plotting "my location" on the map)
  positionMode:    'gps',       // 'gps' | 'manual' | 'off'
  manualLat:       null,
  manualLon:       null,
  beaconToMap:     true,        // show my location marker on the map
  beaconIntervalMin: 10,        // how often to refresh the position marker

  // APRSNET desktop preferences
  prefTheme:       'dark',      // 'dark' | 'light'
  prefMapStyle:    '',          // '' = leave site default, else value for #map-style
  prefFilters:     {},          // { 'show-aprs': true, 'show-cwop': false, ... }
  prefAutoFit:     null,        // null = leave alone, true/false = force
  prefGhost:       null,
  prefPropLines:   null,
  prefWxRadar:     null,
  prefsSynced:     false        // has the user saved APRSNET prefs at least once
};

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath))
      return Object.assign({}, defaultSettings, JSON.parse(fs.readFileSync(settingsPath, 'utf8')));
  } catch (e) {}
  return JSON.parse(JSON.stringify(defaultSettings));
}

function saveSettings(s) {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
  } catch (e) {}
}

let mainWindow = null;
let tray = null;
let settings = loadSettings();
let isOnConnectScreen = true;
let lastKnownPosition = null;   // { lat, lon, accuracy, ts }

function openSafeExternal(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl));
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return shell.openExternal(parsed.toString());
    }
  } catch (e) {}
  return false;
}

// Main window.
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900,
    minWidth: 1024, minHeight: 600,
    title: 'APRS Client',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // geolocation needs this; Electron grants it via the permission handler below
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'connect.html'));

  // Allow geolocation requests for GPS positioning in the local renderer.
  mainWindow.webContents.session.setPermissionRequestHandler((wc, permission, cb) => {
    if (permission === 'geolocation' || permission === 'notifications' || permission === 'bluetooth') return cb(true);
    cb(false);
  });

  mainWindow.once('ready-to-show', () => {
    if (!settings.startMinimized) mainWindow.show();
    mainWindow.webContents.send('settings', settings);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    const url = mainWindow.webContents.getURL();
    const isLocalPage = url.startsWith('file://');
    const isLocalConnect = isLocalPage && url.includes('connect.html');
    isOnConnectScreen = isLocalConnect;
    mainWindow.setTitle((settings.callsign ? settings.callsign + ' - ' : '') + 'APRS Client');
  });

  mainWindow.on('close', (e) => {
    if (settings.minimizeToTray && tray && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // BLE device selection: required for Web Bluetooth in Electron.
  // Auto-selects RT-950 Pro by name prefix; falls back to first device found.
  mainWindow.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault();
    if (!deviceList.length) { callback(''); return; }
    const rt = deviceList.find(d => /RT-?950/i.test(d.deviceName || ''));
    callback((rt || deviceList[0]).deviceId);
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
}

// System tray.
function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
    tray = new Tray(img.resize({ width: 16, height: 16 }));
    tray.setToolTip('APRS Client - ' + (settings.callsign || 'Not connected'));
    tray.on('click', () => { mainWindow && (mainWindow.show(), mainWindow.focus()); });
    updateTrayMenu();
  } catch (e) { console.warn('Tray failed:', e.message); }
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: settings.callsign ? settings.callsign + ' - APRS Client' : 'APRS Client', enabled: false },
    { type: 'separator' },
    { label: 'Open', click: () => { mainWindow && (mainWindow.show(), mainWindow.focus()); } },
    { label: 'Reload', click: () => { mainWindow && mainWindow.webContents.reload(); } },
    { label: 'Disconnect', click: () => goToConnectScreen() },
    { type: 'separator' },
    { label: 'Support Group', click: () => openSafeExternal('https://groups.google.com/g/aprsnetuk') },
    { type: 'separator' },
    { label: 'Quit APRS Client', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
}

function goToConnectScreen() {
  if (!mainWindow) return;
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'connect.html'));
  setTimeout(() => mainWindow.webContents.send('settings', settings), 500);
}

// Launch-on-startup.
function applyLaunchOnStartup(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      args: settings.startMinimized ? ['--hidden'] : []
    });
  } catch (e) {}
}

// IPC.
ipcMain.handle('get-settings', () => settings);

ipcMain.handle('save-settings', (e, s) => {
  settings = Object.assign({}, settings, s);
  saveSettings(settings);
  updateTrayMenu();
  if (tray) tray.setToolTip('APRS Client - ' + (settings.callsign || 'Not connected'));
  applyLaunchOnStartup(settings.launchOnStartup);
  // Push the fresh settings back into whatever page is loaded
  if (mainWindow) mainWindow.webContents.send('settings', settings);
  return settings;
});

// The APRSNET endpoint is fixed - the client always connects to aprsnet.uk.
ipcMain.handle('get-server', () => ({ url: SERVER_URL, ws: WS_URL }));

ipcMain.handle('connect-to-server', () => {
  if (mainWindow) mainWindow.loadFile(path.join(__dirname, 'renderer', 'native.html'));
});

ipcMain.handle('go-back', () => goToConnectScreen());

ipcMain.handle('show-notification', (e, title, body) => {
  if (settings.notifications && Notification.isSupported())
    new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
});

ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('open-external', (e, url) => {
  return openSafeExternal(url);
});
ipcMain.handle('reload-window', () => mainWindow && mainWindow.webContents.reload());

ipcMain.handle('api-request', (e, req = {}) => new Promise((resolve) => {
  const method = String(req.method || 'GET').toUpperCase();
  const apiPath = String(req.path || '/');
  if (!apiPath.startsWith('/api/')) {
    resolve({ ok: false, status: 400, error: 'Only /api/ paths are allowed' });
    return;
  }
  const body = req.body === undefined || req.body === null ? null : JSON.stringify(req.body);
  const headers = Object.assign({ 'Accept': 'application/json' }, req.headers || {});
  if (body) headers['Content-Type'] = 'application/json';
  if (settings.memberToken && !headers['X-Member-Token']) headers['X-Member-Token'] = settings.memberToken;

  const request = https.request(SERVER_URL + apiPath, { method, headers, timeout: 10000 }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', d => text += d);
    res.on('end', () => {
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data });
    });
  });
  request.on('error', err => resolve({ ok: false, status: 0, error: err.message }));
  request.on('timeout', () => { request.destroy(); resolve({ ok: false, status: 0, error: 'timeout' }); });
  if (body) request.write(body);
  request.end();
}));

// Position: the renderer asks the main process for the latest position.
// In GPS mode it returns whatever the renderer last reported; in manual mode
// it returns the configured coordinates.
ipcMain.handle('get-position', () => {
  if (settings.positionMode === 'manual' &&
      typeof settings.manualLat === 'number' &&
      typeof settings.manualLon === 'number') {
    return { lat: settings.manualLat, lon: settings.manualLon, source: 'manual', ts: Date.now() };
  }
  if (settings.positionMode === 'gps' && lastKnownPosition) {
    return Object.assign({ source: 'gps' }, lastKnownPosition);
  }
  return null;
});

// The renderer (which CAN use the geolocation API) reports GPS fixes here
ipcMain.handle('report-position', (e, pos) => {
  if (pos && typeof pos.lat === 'number' && typeof pos.lon === 'number') {
    lastKnownPosition = { lat: pos.lat, lon: pos.lon, accuracy: pos.accuracy || null, ts: Date.now() };
  }
  return lastKnownPosition;
});

// Lightweight server reachability / version probe used by the connect screen
ipcMain.handle('probe-server', () => new Promise((resolve) => {
  const req = https.get(SERVER_URL + '/api/version', { timeout: 5000 }, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      try { resolve({ ok: true, data: JSON.parse(body) }); }
      catch { resolve({ ok: true, data: {} }); }
    });
  });
  req.on('error', () => resolve({ ok: false }));
  req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
}));

// App lifecycle.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });

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

app.on('before-quit', () => { app.isQuitting = true; });
