const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client, utils: sshUtils } = require('ssh2');
const net = require('net');

let mainWindow;
let tray = null;

// Single source of truth for every saved tunnel, keyed by remotePath.
// { localPort, remotePath, routeType, status: 'running'|'reconnecting'|'stopped',
//   conn, privateKey, vpsIp, stopping, reconnectTimer }
// Only { localPort, remotePath, routeType } gets persisted to disk — status/conn/
// privateKey are runtime-only and always reset to 'stopped' when the app starts,
// since there is no live SSH connection to restore across a restart.
const tunnels = new Map();

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

// --- Tunnel state helpers ---

function initTunnelsFromConfig() {
  const cfg = loadConfig();
  tunnels.clear();
  for (const r of cfg.activeRoutes) {
    tunnels.set(r.remotePath, {
      localPort: r.localPort,
      remotePath: r.remotePath,
      routeType: r.routeType,
      status: 'stopped',
      conn: null,
      privateKey: null,
      vpsIp: null,
      stopping: false,
      reconnectTimer: null,
    });
  }
}

function persistTunnels() {
  const cfg = loadConfig();
  cfg.activeRoutes = Array.from(tunnels.values()).map(t => ({
    localPort: t.localPort,
    remotePath: t.remotePath,
    routeType: t.routeType,
  }));
  saveConfig(cfg);
}

function snapshotTunnels() {
  return Array.from(tunnels.values()).map(t => ({
    localPort: t.localPort,
    remotePath: t.remotePath,
    routeType: t.routeType,
    status: t.status,
  }));
}

function broadcastTunnels() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tunnels-changed', snapshotTunnels());
  }
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
  initTunnelsFromConfig();
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

ipcMain.handle('get-server-url', () => SERVER_URL);

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
  // are still running (or reconnecting); the user can log back in and
  // they'll still be there.
  session = null;
  return { success: true };
});

ipcMain.handle('get-session', () => {
  return session ? { email: session.email } : null;
});

// --- SSH connection plumbing (shared by fresh connects and reconnects) ---

function wireConnection(conn, entry, { onReady, onFail }) {
  let settled = false;
  const finishOnce = (fn) => { if (!settled) { settled = true; fn(); } };

  conn.on('ready', () => {
    conn.forwardIn('127.0.0.1', parseInt(entry.localPort), (err) => {
      if (err) {
        conn.end();
        finishOnce(() => onFail(new Error(err.message)));
        return;
      }
      entry.conn = conn;
      entry.status = 'running';
      broadcastTunnels();
      finishOnce(onReady);
    });
  }).on('tcp connection', (info, accept, reject) => {
    const stream = accept();
    const localSocket = net.connect({
      port: parseInt(entry.localPort),
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
  }).on('close', () => {
    handleUnexpectedDrop(entry);
  }).on('error', (err) => {
    finishOnce(() => onFail(new Error('SSH Error: ' + err.message)));
  });

  conn.connect({
    host: entry.vpsIp,
    port: 22,
    username: 'root',
    privateKey: entry.privateKey // Use generated private key! No passwords!
  });
}

function connectSsh(entry) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    wireConnection(conn, entry, { onReady: resolve, onFail: reject });
  });
}

function handleUnexpectedDrop(entry) {
  if (entry.stopping) return; // an intentional Stop already owns this transition
  if (!tunnels.has(entry.remotePath)) return; // deleted out from under us
  if (entry.status === 'reconnecting') return; // already being handled
  entry.conn = null;
  entry.status = 'reconnecting';
  broadcastTunnels();
  scheduleReconnect(entry);
}

// Retries every 5s, per CLIENT_SPEC's original promise, reusing the same private
// key already authorized server-side — a dropped connection doesn't need a new
// HTTP round-trip, just re-establishing the SSH forward.
function scheduleReconnect(entry) {
  if (entry.reconnectTimer) return;
  entry.reconnectTimer = setTimeout(async () => {
    entry.reconnectTimer = null;
    if (!tunnels.has(entry.remotePath) || entry.status !== 'reconnecting') return;
    try {
      await connectSsh(entry);
    } catch (err) {
      console.error(`Reconnect failed for ${entry.remotePath}:`, err.message);
      if (tunnels.has(entry.remotePath) && entry.status !== 'running') {
        entry.status = 'reconnecting';
        scheduleReconnect(entry);
      }
    }
  }, 5000);
}

// --- IPC Handlers: tunnel lifecycle ---

async function establishTunnel(entry) {
  if (!session) {
    throw new Error('Not logged in.');
  }

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
      path: entry.remotePath,
      target: `http://127.0.0.1:${entry.localPort}`,
      type: entry.routeType,
      publicKey: pubKeyOpenSSH
    })
  });

  if (!routeRes.ok) {
    let detail = '';
    try { detail = await routeRes.text(); } catch {}
    throw new Error(`Failed to add route to dashboard (HTTP ${routeRes.status}): ${detail}`);
  }

  entry.privateKey = privateKey;
  entry.vpsIp = session.vpsIp;
  entry.stopping = false;

  await connectSsh(entry);
}

async function stopTunnelInternal(entry) {
  entry.stopping = true;
  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
  }
  if (entry.conn) {
    try { entry.conn.end(); } catch (e) {}
    entry.conn = null;
  }

  // Remove the route server-side too (also revokes the SSH key), using the
  // current session — works even for a tunnel that has no live SSH connection
  // here (e.g. one still showing "stopped" from a previous app run).
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
        body: JSON.stringify({ path: entry.remotePath })
      });
    } catch (err) {}
  }

  entry.status = 'stopped';
  entry.privateKey = null;
  entry.vpsIp = null;
  entry.stopping = false;
}

ipcMain.handle('get-tunnels', () => snapshotTunnels());

// "Bind Tunnel" — create (or replace) a saved tunnel and start it immediately.
ipcMain.handle('connect-tunnel', async (event, config) => {
  const entry = tunnels.get(config.remotePath) || {
    localPort: config.localPort,
    remotePath: config.remotePath,
    routeType: config.routeType,
    status: 'stopped',
    conn: null,
    privateKey: null,
    vpsIp: null,
    stopping: false,
    reconnectTimer: null,
  };

  // Re-submitting a path that's already running/reconnecting: tear down the old
  // SSH connection first so we don't leak it while opening a new one.
  if (entry.status !== 'stopped') {
    await stopTunnelInternal(entry);
  }

  entry.localPort = config.localPort;
  entry.routeType = config.routeType;

  try {
    await establishTunnel(entry);
    tunnels.set(entry.remotePath, entry);
    persistTunnels();
    broadcastTunnels();
    return { success: true, message: 'Connected!' };
  } catch (error) {
    return { success: false, message: error.message || error.toString() };
  }
});

// Re-starts a previously saved (now stopped) tunnel using its saved settings.
ipcMain.handle('start-tunnel', async (event, { remotePath }) => {
  const entry = tunnels.get(remotePath);
  if (!entry) return { success: false, message: 'Unknown tunnel.' };

  try {
    await establishTunnel(entry);
    broadcastTunnels();
    return { success: true, message: 'Connected!' };
  } catch (error) {
    entry.status = 'stopped';
    broadcastTunnels();
    return { success: false, message: error.message || error.toString() };
  }
});

// Reversible: tears down the SSH connection and the server-side route/key, but
// keeps the tunnel's settings saved locally so Start is one click.
ipcMain.handle('stop-tunnel', async (event, { remotePath }) => {
  const entry = tunnels.get(remotePath);
  if (!entry) return { success: false, message: 'Unknown tunnel.' };

  await stopTunnelInternal(entry);
  broadcastTunnels();
  return { success: true };
});

// Permanent: stops (best-effort) and forgets the tunnel entirely.
ipcMain.handle('delete-tunnel', async (event, { remotePath }) => {
  const entry = tunnels.get(remotePath);
  if (entry) {
    await stopTunnelInternal(entry);
    tunnels.delete(remotePath);
    persistTunnels();
  }
  broadcastTunnels();
  return { success: true };
});

// IPC Handler to exit app completely
ipcMain.handle('quit-app', () => {
  app.isQuiting = true;
  app.quit();
});
