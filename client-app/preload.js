const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: (creds) => ipcRenderer.invoke('login', creds),
  logout: () => ipcRenderer.invoke('logout'),
  getSession: () => ipcRenderer.invoke('get-session'),

  getTunnels: () => ipcRenderer.invoke('get-tunnels'),
  connectTunnel: (config) => ipcRenderer.invoke('connect-tunnel', config),
  startTunnel: (remotePath) => ipcRenderer.invoke('start-tunnel', { remotePath }),
  stopTunnel: (remotePath) => ipcRenderer.invoke('stop-tunnel', { remotePath }),
  deleteTunnel: (remotePath) => ipcRenderer.invoke('delete-tunnel', { remotePath }),
  onTunnelsChanged: (callback) => {
    const handler = (event, tunnels) => callback(tunnels);
    ipcRenderer.on('tunnels-changed', handler);
    return () => ipcRenderer.removeListener('tunnels-changed', handler);
  },

  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  quitApp: () => ipcRenderer.invoke('quit-app')
});
