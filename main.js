const { app, BrowserWindow, ipcMain, shell, Notification, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs   = require('fs');

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

const defaultSettings = {
  serverUrl:      'https://www.aprsnet.uk',
  wsUrl:          'wss://www.aprsnet.uk/ws',
  callsign:       '',
  passcode:       '',
  autoConnect:    true,
  minimizeToTray: true,
  notifications:  true
};

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath))
      return Object.assign({}, defaultSettings, JSON.parse(fs.readFileSync(settingsPath,'utf8')));
  } catch(e) {}
  return { ...defaultSettings };
}

function saveSettings(s) {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
  } catch(e) {}
}

let mainWindow = null;
let tray = null;
let settings = loadSettings();
let isOnConnectScreen = true;

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
      webSecurity: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'connect.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.webContents.send('settings', settings);
  });

  // Inject overlay script whenever a non-connect-screen page finishes loading
  mainWindow.webContents.on('did-finish-load', () => {
    const url = mainWindow.webContents.getURL();
    const isLocalConnect = url.startsWith('file://') && url.includes('connect.html');
    isOnConnectScreen = isLocalConnect;

    if (!isLocalConnect) {
      // Inject client overlay into server page
      const overlayPath = path.join(__dirname, 'renderer', 'client-overlay.js');
      if (fs.existsSync(overlayPath)) {
        const code = fs.readFileSync(overlayPath, 'utf8');
        mainWindow.webContents.executeJavaScript(code).catch(e => {
          console.warn('Overlay inject failed:', e.message);
        });
      }
      // Update window title
      mainWindow.webContents.executeJavaScript(
        'document.title'
      ).then(t => {
        mainWindow.setTitle((settings.callsign ? settings.callsign + ' — ' : '') + 'APRS Client');
      }).catch(() => {});
    }
  });

  mainWindow.on('close', (e) => {
    if (settings.minimizeToTray && tray && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
    tray = new Tray(img.resize({ width: 16, height: 16 }));
    tray.setToolTip('APRS Client — ' + (settings.callsign || 'Not connected'));
    tray.on('click', () => { mainWindow && (mainWindow.show(), mainWindow.focus()); });
    updateTrayMenu();
  } catch(e) { console.warn('Tray failed:', e.message); }
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: settings.callsign ? settings.callsign + ' — APRS Client' : 'APRS Client', enabled: false },
    { type: 'separator' },
    { label: 'Open', click: () => { mainWindow && (mainWindow.show(), mainWindow.focus()); } },
    { label: 'Disconnect', click: () => {
      if (mainWindow && !isOnConnectScreen) {
        mainWindow.loadFile(path.join(__dirname, 'renderer', 'connect.html'));
        setTimeout(() => mainWindow.webContents.send('settings', settings), 500);
      }
    }},
    { type: 'separator' },
    { label: 'Quit APRS Client', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle('get-settings', () => settings);

ipcMain.handle('save-settings', (e, s) => {
  settings = Object.assign({}, settings, s);
  saveSettings(settings);
  updateTrayMenu();
  if (tray) tray.setToolTip('APRS Client — ' + (settings.callsign || 'Not connected'));
  return settings;
});

ipcMain.handle('connect-to-server', (e, url) => {
  if (mainWindow) mainWindow.loadURL(url);
});

ipcMain.handle('show-notification', (e, title, body) => {
  if (settings.notifications && Notification.isSupported())
    new Notification({ title, body, icon: path.join(__dirname,'assets','icon.png') }).show();
});

ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('open-external', (e, url) => shell.openExternal(url));
ipcMain.handle('reload-window', () => mainWindow && mainWindow.webContents.reload());

ipcMain.handle('go-back', () => {
  if (!mainWindow) return;
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'connect.html'));
  setTimeout(() => mainWindow.webContents.send('settings', settings), 500);
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { app.isQuitting = true; });
