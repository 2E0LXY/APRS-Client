const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aprsClient', {
  getSettings:       ()      => ipcRenderer.invoke('get-settings'),
  saveSettings:      (s)     => ipcRenderer.invoke('save-settings', s),
  connectToServer:   (url)   => ipcRenderer.invoke('connect-to-server', url),
  showNotification:  (t,b)   => ipcRenderer.invoke('show-notification', t, b),
  getVersion:        ()      => ipcRenderer.invoke('get-version'),
  openExternal:      (url)   => ipcRenderer.invoke('open-external', url),
  reloadWindow:      ()      => ipcRenderer.invoke('reload-window'),
  goBack:            ()      => ipcRenderer.invoke('go-back'),
  onSettings:        (cb)    => ipcRenderer.on('settings', (e,s) => cb(s)),
  platform:          process.platform
});
