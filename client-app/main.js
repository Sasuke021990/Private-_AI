const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');
const net = require('net');

let mainWindow;
let tray = null;
const activeTunnels = new Map(); // Store active SSH connections

// --- Config Management ---
const configPath = path.join(app.getPath('userData'), 'tunnel-config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    return { vpsIp: '', vpsRootPassword: '', dashboardPassword: '', runAtStartup: false, activeRoutes: [] };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

// --- App Initialization ---
function createWindow(startHidden = false) {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    resizable: false,
    autoHideMenuBar: true
  });

  mainWindow.loadFile('src/index.html');

  if (startHidden) {
    mainWindow.hide();
  }

  // Intercept close to minimize to tray
  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Use a generic icon if no specific one exists
  // In a real app you'd load a small PNG or ICO here
  tray = new Tray(path.join(__dirname, 'src/icon.png')); // We will gracefully fail or show empty if missing, but electron expects a file. 
  // Wait, Electron tray requires an image. Let's just create an empty nativeImage.
  const { nativeImage } = require('electron');
  const emptyImage = nativeImage.createEmpty();
  tray.setImage(emptyImage);
  tray.setToolTip('Auth Proxy Tunnel');
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Dashboard', click: () => mainWindow.show() },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow.show());
}

const isHiddenStart = process.argv.includes('--hidden');

app.whenReady().then(() => {
  createWindow(isHiddenStart);
  createTray();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  app.isQuiting = true;
});

// --- IPC Handlers ---

ipcMain.handle('get-config', () => {
  return loadConfig();
});

ipcMain.handle('save-config', (event, newCfg) => {
  const current = loadConfig();
  const updated = { ...current, ...newCfg };
  saveConfig(updated);
  
  // Update startup settings
  app.setLoginItemSettings({
    openAtLogin: updated.runAtStartup,
    args: ['--hidden']
  });
  
  return true;
});

ipcMain.handle('connect-tunnel', async (event, config) => {
  try {
    // 1. Authenticate with Dashboard
    const authRes = await fetch(`http://${config.vpsIp}:4000/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: config.dashboardPassword
      })
    });

    if (!authRes.ok) throw new Error('Dashboard login failed. Check credentials.');
    
    const setCookie = authRes.headers.get('set-cookie');

    // 2. Add Route to Dashboard
    const routeRes = await fetch(`http://${config.vpsIp}:4000/admin/api/routes`, {
      method: 'POST',
      redirect: 'error',
      headers: { 
        'Content-Type': 'application/json',
        'Cookie': setCookie
      },
      body: JSON.stringify({
        path: config.remotePath,
        target: `http://127.0.0.1:${config.localPort}`,
        type: config.routeType
      })
    });

    if (!routeRes.ok) throw new Error('Failed to add route to dashboard.');

    // 3. Establish SSH Tunnel
    return new Promise((resolve, reject) => {
      const conn = new Client();
      
      conn.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
        finish([config.vpsRootPassword]);
      });

      conn.on('ready', () => {
        conn.forwardIn('127.0.0.1', parseInt(config.localPort), (err, port) => {
          if (err) {
            conn.end();
            return reject(err.message);
          }
          
          // Save active connection
          activeTunnels.set(config.remotePath, conn);

          // Update config to persist this route
          const cfg = loadConfig();
          const routeExists = cfg.activeRoutes.find(r => r.remotePath === config.remotePath);
          if (!routeExists) {
            cfg.activeRoutes.push({ localPort: config.localPort, remotePath: config.remotePath, routeType: config.routeType });
            saveConfig(cfg);
          }

          resolve({ success: true, message: 'Connected!' });
        });
      }).on('tcp connection', (info, accept, reject) => {
        const stream = accept();
        const localSocket = net.connect(parseInt(config.localPort), '127.0.0.1', () => {
          localSocket.pipe(stream);
          stream.pipe(localSocket);
        });
        localSocket.on('error', () => stream.end());
      }).on('error', (err) => {
        reject('SSH Error: ' + err.message);
      }).connect({
        host: config.vpsIp,
        port: 22,
        username: 'root',
        password: config.vpsRootPassword,
        tryKeyboard: true
      });
    });

  } catch (error) {
    return { success: false, message: error.message || error.toString() };
  }
});

ipcMain.handle('disconnect-tunnel', async (event, config) => {
  try {
    const conn = activeTunnels.get(config.remotePath);
    if (conn) {
      conn.end();
      activeTunnels.delete(config.remotePath);
    }

    // Authenticate and delete route from dashboard
    const authRes = await fetch(`http://${config.vpsIp}:4000/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: config.dashboardPassword })
    });
    if (!authRes.ok) throw new Error('Auth failed during disconnect');
    
    const setCookie = authRes.headers.get('set-cookie');
    
    await fetch(`http://${config.vpsIp}:4000/admin/api/routes`, {
      method: 'DELETE',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'Cookie': setCookie },
      body: JSON.stringify({ path: config.remotePath })
    });

    // Remove from saved config
    const cfg = loadConfig();
    cfg.activeRoutes = cfg.activeRoutes.filter(r => r.remotePath !== config.remotePath);
    saveConfig(cfg);

    return { success: true };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

// IPC Handler to exit app completely
ipcMain.handle('quit-app', () => {
  app.isQuiting = true;
  app.quit();
});
