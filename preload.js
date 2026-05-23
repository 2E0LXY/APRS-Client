const { contextBridge, ipcRenderer } = require('electron');

// Bridge between the sandboxed web page and the Electron main process.
// Everything the website's injected overlay can do is listed here.
contextBridge.exposeInMainWorld('aprsClient', {
  // Settings (includes website appearance preferences)
  getSettings:      ()        => ipcRenderer.invoke('get-settings'),
  saveSettings:     (s)       => ipcRenderer.invoke('save-settings', s),

  // Fixed server endpoints (always aprsnet.uk)
  getServer:        ()        => ipcRenderer.invoke('get-server'),
  connectToServer:  ()        => ipcRenderer.invoke('connect-to-server'),
  probeServer:      ()        => ipcRenderer.invoke('probe-server'),
  goBack:           ()        => ipcRenderer.invoke('go-back'),

  // Desktop integration
  showNotification: (t, b)    => ipcRenderer.invoke('show-notification', t, b),
  getVersion:       ()        => ipcRenderer.invoke('get-version'),
  openExternal:     (url)     => ipcRenderer.invoke('open-external', url),
  reloadWindow:     ()        => ipcRenderer.invoke('reload-window'),

  // Position / GPS
  getPosition:      ()        => ipcRenderer.invoke('get-position'),
  reportPosition:   (pos)     => ipcRenderer.invoke('report-position', pos),

  // Events
  onSettings:       (cb)      => ipcRenderer.on('settings', (e, s) => cb(s)),

  platform:         process.platform
});
