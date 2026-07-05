const { contextBridge, ipcRenderer } = require('electron');

// Bridge between the sandboxed local renderer and the Electron main process.
contextBridge.exposeInMainWorld('aprsClient', {
  // Settings
  getSettings:      ()        => ipcRenderer.invoke('get-settings'),
  saveSettings:     (s)       => ipcRenderer.invoke('save-settings', s),

  // Fixed server endpoints (always aprsnet.uk)
  getServer:        ()        => ipcRenderer.invoke('get-server'),
  connectToServer:  ()        => ipcRenderer.invoke('connect-to-server'),
  probeServer:      ()        => ipcRenderer.invoke('probe-server'),
  goBack:           ()        => ipcRenderer.invoke('go-back'),
  apiRequest:       (req)     => ipcRenderer.invoke('api-request', req),

  // Desktop integration
  showNotification: (t, b)    => ipcRenderer.invoke('show-notification', t, b),
  getVersion:       ()        => ipcRenderer.invoke('get-version'),
  openExternal:     (url)     => ipcRenderer.invoke('open-external', url),
  reloadWindow:     ()        => ipcRenderer.invoke('reload-window'),

  // Position / GPS
  getPosition:      ()        => ipcRenderer.invoke('get-position'),
  reportPosition:   (pos)     => ipcRenderer.invoke('report-position', pos),

  // Events
  onSettings:       (cb)      => {
    const listener = (e, s) => cb(s);
    ipcRenderer.on('settings', listener);
    return () => ipcRenderer.removeListener('settings', listener);
  },

  platform:         process.platform
});
