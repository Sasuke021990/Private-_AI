const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: (creds) => ipcRenderer.invoke('login', creds),
  logout: () => ipcRenderer.invoke('logout'),
  getSession: () => ipcRenderer.invoke('get-session'),
  connectTunnel: (config) => ipcRenderer.invoke('connect-tunnel', config),
  disconnectTunnel: (config) => ipcRenderer.invoke('disconnect-tunnel', config),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  quitApp: () => ipcRenderer.invoke('quit-app')
});
