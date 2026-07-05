const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aprsnet', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  getServer: () => ipcRenderer.invoke('server:get'),
  api: (request) => ipcRenderer.invoke('api:request', request),
  getVersion: () => ipcRenderer.invoke('app:version'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  reload: () => ipcRenderer.invoke('app:reload'),
  notify: (title, body) => ipcRenderer.invoke('notify:show', title, body),
  getPosition: () => ipcRenderer.invoke('position:get'),
  reportPosition: (position) => ipcRenderer.invoke('position:report', position),
  onSettingsChanged: (callback) => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on('settings-changed', listener);
    return () => ipcRenderer.removeListener('settings-changed', listener);
  },
  platform: process.platform
});
