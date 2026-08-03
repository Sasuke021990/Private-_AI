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

const crypto = require('crypto');
const SERVER_URL = 'http://203.57.85.144:4000';

// Fetch's Headers.get('set-cookie') collapses multiple Set-Cookie headers into one
// comma-joined string on older runtimes; getSetCookie() (Node 18.14+) returns them
// as a proper array. We need both the auth cookie and the CSRF cookie issued at login.
function parseSetCookies(res) {
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  const jar = {};
  for (const line of raw) {
    if (!line) continue;
    const first = line.split(';')[0];
    const eq = first.indexOf('=');
    if (eq === -1) continue;
    jar[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
  }
  return jar;
}

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

ipcMain.handle('connect-tunnel', async (event, config) => {
  try {
    // 1. Generate SSH Keypair using ssh2 utils instead of crypto
    // This avoids the 'openssh' format error in Electron's older Node version
    const { utils } = require('ssh2');
    const { private: privateKey, public: pubKeyOpenSSH } = utils.generateKeyPairSync('rsa', { bits: 2048 });

    // 2. Authenticate (SSH key is registered in step 3, tied to the route/port)
    const authRes = await fetch(`${SERVER_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: config.email,
        password: config.dashboardPassword
      })
    });

    if (!authRes.ok) throw new Error('Login failed. Check credentials.');

    const cookieJar = parseSetCookies(authRes);
    const setCookie = cookieHeader(cookieJar);
    const csrfToken = cookieJar['csrf_token'] || '';
    const authData = await authRes.json();
    const vpsIp = authData.vpsIp;

    // 3. Add Route to Dashboard, registering the SSH public key for this route's port
    const routeRes = await fetch(`${SERVER_URL}/admin/api/routes`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': setCookie,
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({
        path: config.remotePath,
        target: `http://127.0.0.1:${config.localPort}`,
        type: config.routeType,
        publicKey: pubKeyOpenSSH
      })
    });

    if (!routeRes.ok) throw new Error('Failed to add route to dashboard.');

    // 4. Establish SSH Tunnel using Private Key
    return new Promise((resolve, reject) => {
      const conn = new Client();

      conn.on('ready', () => {
        conn.forwardIn('127.0.0.1', parseInt(config.localPort), (err, port) => {
          if (err) {
            conn.end();
            return reject(err.message);
          }

          activeTunnels.set(config.remotePath, { conn, setCookie, csrfToken });

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
        const localSocket = net.connect({
          port: parseInt(config.localPort), 
          host: '127.0.0.1',
          allowHalfOpen: true // Keep socket open for response if request body finishes
        }, () => {
          localSocket.pipe(stream);
          stream.pipe(localSocket);
        });

        // Only handle errors to prevent crashes. .pipe() handles end/close natively.
        localSocket.on('error', (err) => {
          console.error('Local socket error:', err);
          stream.end();
        });
        
        stream.on('error', (err) => {
          console.error('SSH stream error:', err);
          localSocket.destroy();
        });
      }).on('error', (err) => {
        reject('SSH Error: ' + err.message);
      }).connect({
        host: vpsIp,
        port: 22,
        username: 'root',
        privateKey: privateKey // Use generated private key! No passwords!
      });
    });

  } catch (error) {
    return { success: false, message: error.message || error.toString() };
  }
});

ipcMain.handle('disconnect-tunnel', async (event, config) => {
  try {
    const tunnelData = activeTunnels.get(config.remotePath);
    if (tunnelData) {
      tunnelData.conn.end();
      
      // Use stored cookie/CSRF token to delete route
      try {
        await fetch(`${SERVER_URL}/admin/api/routes`, {
          method: 'DELETE',
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': tunnelData.setCookie,
            'X-CSRF-Token': tunnelData.csrfToken || ''
          },
          body: JSON.stringify({ path: config.remotePath })
        });
      } catch (err) {}

      activeTunnels.delete(config.remotePath);
    }

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
