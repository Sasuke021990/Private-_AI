const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client, utils: sshUtils } = require('ssh2');
const net = require('net');

let mainWindow;
let tray = null;
const activeTunnels = new Map(); // remotePath -> { conn } (live ssh2 Client connections)

// In-memory only — never persisted to disk. Cleared on logout or app restart.
let session = null; // { email, cookie, csrfToken, vpsIp }

const SERVER_URL = 'http://203.57.85.144:4000';

// --- Config Management ---
const configPath = path.join(app.getPath('userData'), 'tunnel-config.json');

function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    // Migration: earlier versions of this app stored the dashboard/VPS password in
    // plaintext here. Purge it if an old config file still has it.
    if ('dashboardPassword' in cfg || 'vpsRootPassword' in cfg) {
      delete cfg.dashboardPassword;
      delete cfg.vpsRootPassword;
      saveConfig(cfg);
    }
    return { email: '', runAtStartup: false, minimizeToTray: true, activeRoutes: [], ...cfg };
  } catch (e) {
    return { email: '', runAtStartup: false, minimizeToTray: true, activeRoutes: [] };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

// --- App Initialization ---
function createWindow(startHidden = false) {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 580,
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

  // Intercept close to minimize to tray, unless the user turned that setting off
  mainWindow.on('close', (event) => {
    const cfg = loadConfig();
    if (!app.isQuiting && cfg.minimizeToTray !== false) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // No icon asset shipped yet — fall back to an empty image so Tray() doesn't throw.
  const { nativeImage } = require('electron');
  let image;
  try {
    image = nativeImage.createFromPath(path.join(__dirname, 'src/icon.png'));
  } catch (e) {
    image = null;
  }
  if (!image || image.isEmpty()) {
    image = nativeImage.createEmpty();
  }
  tray = new Tray(image);
  tray.setToolTip('Auth Proxy Tunnel');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show App', click: () => mainWindow.show() },
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

// --- IPC Handlers: config ---

ipcMain.handle('get-config', () => {
  return loadConfig();
});

ipcMain.handle('save-config', (event, newCfg) => {
  const current = loadConfig();
  const updated = { ...current, ...newCfg };
  saveConfig(updated);

  app.setLoginItemSettings({
    openAtLogin: updated.runAtStartup,
    args: ['--hidden']
  });

  return true;
});

// --- Cookie helpers ---
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

// --- IPC Handlers: session ---

ipcMain.handle('login', async (event, { email, password }) => {
  try {
    const authRes = await fetch(`${SERVER_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!authRes.ok) {
      let message = 'Login failed. Check your credentials.';
      try { message = (await authRes.json()).error || message; } catch {}
      return { success: false, message };
    }

    const cookieJar = parseSetCookies(authRes);
    const cookie = cookieHeader(cookieJar);
    const csrfToken = cookieJar['csrf_token'] || '';
    const authData = await authRes.json();

    session = { email, cookie, csrfToken, vpsIp: authData.vpsIp };

    // Remember the email only (never the password) for convenience next time.
    const cfg = loadConfig();
    cfg.email = email;
    saveConfig(cfg);

    return { success: true, email };
  } catch (error) {
    return { success: false, message: error.message || error.toString() };
  }
});

ipcMain.handle('logout', () => {
  // Local-only: forgets the session so the app returns to the login screen.
  // Deliberately does NOT call the server's real /logout or touch active
  // tunnels/SSH keys — closing this app session shouldn't kill tunnels that
  // are still running; the user can log back in and they'll still be there.
  session = null;
  return { success: true };
});

ipcMain.handle('get-session', () => {
  return session ? { email: session.email } : null;
});

// --- IPC Handlers: tunnels ---

ipcMain.handle('connect-tunnel', async (event, config) => {
  if (!session) {
    return { success: false, message: 'Not logged in.' };
  }

  try {
    // Generate SSH Keypair using ssh2 utils instead of Node's crypto module —
    // avoids an 'openssh' format error in Electron's bundled Node version.
    const { private: privateKey, public: pubKeyOpenSSH } = sshUtils.generateKeyPairSync('rsa', { bits: 2048 });

    // Add Route to Dashboard, registering the SSH public key for this route's port
    const routeRes = await fetch(`${SERVER_URL}/admin/api/routes`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': session.cookie,
        'X-CSRF-Token': session.csrfToken
      },
      body: JSON.stringify({
        path: config.remotePath,
        target: `http://127.0.0.1:${config.localPort}`,
        type: config.routeType,
        publicKey: pubKeyOpenSSH
      })
    });

    if (!routeRes.ok) {
      let detail = '';
      try { detail = await routeRes.text(); } catch {}
      throw new Error(`Failed to add route to dashboard (HTTP ${routeRes.status}): ${detail}`);
    }

    // Establish SSH Tunnel using the freshly generated private key
    return new Promise((resolve, reject) => {
      const conn = new Client();

      conn.on('ready', () => {
        conn.forwardIn('127.0.0.1', parseInt(config.localPort), (err, port) => {
          if (err) {
            conn.end();
            return reject(err.message);
          }

          activeTunnels.set(config.remotePath, { conn });

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
        host: session.vpsIp,
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
      activeTunnels.delete(config.remotePath);
    }

    // Delete the route server-side too, using the current session (works even for
    // a tunnel listed from a previous app run that has no live SSH connection here).
    if (session) {
      try {
        await fetch(`${SERVER_URL}/admin/api/routes`, {
          method: 'DELETE',
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': session.cookie,
            'X-CSRF-Token': session.csrfToken
          },
          body: JSON.stringify({ path: config.remotePath })
        });
      } catch (err) {}
    }

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
