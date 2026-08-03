let currentConfig = {};
let serverUrl = '';
let latestTunnels = [];

// ==================== View switching ====================

function showLoginView() {
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('app-view').classList.add('hidden');
}

async function showAppView(email) {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('app-view').classList.remove('hidden');
  document.getElementById('session-email').textContent = email || '';

  currentConfig = await window.api.getConfig();
  document.getElementById('runAtStartup').checked = !!currentConfig.runAtStartup;
  document.getElementById('minimizeToTray').checked = currentConfig.minimizeToTray !== false;

  latestTunnels = await window.api.getTunnels();
  renderTunnelsList(latestTunnels);
}

function switchPanel(panelId) {
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(panelId).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.panel === panelId);
  });
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
});

// The main process pushes an updated tunnel list whenever anything changes —
// including autonomously, e.g. a background reconnect after a dropped
// connection — so the UI stays truthful without the renderer having to poll.
window.api.onTunnelsChanged((tunnels) => {
  latestTunnels = tunnels;
  renderTunnelsList(tunnels);
});

// ==================== Login ====================

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  errorEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Logging in...';

  try {
    const res = await window.api.login({ email, password });
    if (res.success) {
      await showAppView(email);
    } else {
      errorEl.textContent = res.message || 'Login failed.';
      errorEl.classList.remove('hidden');
    }
  } catch (err) {
    errorEl.textContent = err.message || 'Network error.';
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await window.api.logout();
  document.getElementById('login-password').value = '';
  showLoginView();
});

// ==================== Active Tunnels ====================

const STATUS_LABEL = { running: 'Running', reconnecting: 'Reconnecting', stopped: 'Stopped' };

function statusBadge(status) {
  const badge = document.createElement('span');
  badge.className = `status-badge status-${status}`;
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  badge.appendChild(dot);
  badge.appendChild(document.createTextNode(STATUS_LABEL[status] || status));
  return badge;
}

function renderTunnelsList(tunnels) {
  const list = document.getElementById('tunnels-list');
  list.innerHTML = '';

  if (!tunnels || tunnels.length === 0) {
    list.innerHTML = '<div class="empty-state">No tunnels yet. Create one under "Bind Tunnel".</div>';
    return;
  }

  tunnels.forEach(tunnel => {
    const card = document.createElement('div');
    card.className = 'tunnel-card';

    // --- Top row: path + badges, plus the URL line ---
    const top = document.createElement('div');
    top.className = 'tunnel-card-top';

    const info = document.createElement('div');
    info.className = 'tunnel-info';

    const pathRow = document.createElement('div');
    pathRow.className = 'tunnel-path-row';
    const pathEl = document.createElement('span');
    pathEl.className = 'tunnel-path';
    pathEl.textContent = tunnel.remotePath;
    pathRow.appendChild(pathEl);

    const typeBadge = document.createElement('span');
    typeBadge.className = `type-badge ${tunnel.routeType === 'api' ? 'type-api' : ''}`;
    typeBadge.textContent = tunnel.routeType === 'api' ? 'API' : 'APP';
    pathRow.appendChild(typeBadge);
    pathRow.appendChild(statusBadge(tunnel.status));

    const portLine = document.createElement('div');
    portLine.className = 'tunnel-port';
    portLine.textContent = `Local Port: ${tunnel.localPort}`;

    info.appendChild(pathRow);
    info.appendChild(portLine);
    top.appendChild(info);
    card.appendChild(top);

    // --- Public URL + copy ---
    if (serverUrl) {
      const urlRow = document.createElement('div');
      urlRow.className = 'tunnel-url-row';

      const urlEl = document.createElement('code');
      urlEl.className = 'tunnel-url';
      const fullUrl = serverUrl + tunnel.remotePath;
      urlEl.textContent = fullUrl;
      urlRow.appendChild(urlEl);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'copy-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(fullUrl);
          copyBtn.textContent = 'Copied!';
        } catch (e) {
          copyBtn.textContent = 'Failed';
        }
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      });
      urlRow.appendChild(copyBtn);
      card.appendChild(urlRow);
    }

    // --- Actions ---
    const actions = document.createElement('div');
    actions.className = 'tunnel-actions';

    const primaryBtn = document.createElement('button');
    primaryBtn.type = 'button';
    if (tunnel.status === 'stopped') {
      primaryBtn.className = 'start-btn';
      primaryBtn.textContent = 'Start';
      primaryBtn.addEventListener('click', async () => {
        primaryBtn.disabled = true;
        primaryBtn.textContent = 'Starting...';
        const res = await window.api.startTunnel(tunnel.remotePath);
        if (!res.success) {
          showTunnelActionError(res.message);
        }
        // No manual re-render here — the tunnels-changed push event covers it.
      });
    } else {
      primaryBtn.className = 'disconnect-btn';
      primaryBtn.textContent = 'Stop';
      primaryBtn.addEventListener('click', async () => {
        primaryBtn.disabled = true;
        primaryBtn.textContent = 'Stopping...';
        const res = await window.api.stopTunnel(tunnel.remotePath);
        if (!res.success) {
          showTunnelActionError(res.message);
        }
      });
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-icon-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Permanently delete tunnel ${tunnel.remotePath}? This cannot be undone.`)) return;
      deleteBtn.disabled = true;
      const res = await window.api.deleteTunnel(tunnel.remotePath);
      if (!res.success) {
        showTunnelActionError(res.message);
        deleteBtn.disabled = false;
      }
    });

    actions.appendChild(primaryBtn);
    actions.appendChild(deleteBtn);
    card.appendChild(actions);

    list.appendChild(card);
  });
}

function showTunnelActionError(message) {
  // Shared page-level banner (lives outside any single panel) — inline
  // feedback everywhere, no alert() popups.
  const statusEl = document.getElementById('status-message');
  statusEl.textContent = message || 'Something went wrong.';
  statusEl.className = 'error';
}

// ==================== Bind Tunnel ====================

document.getElementById('connect-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const localPort = document.getElementById('localPort').value;
  const rawPath = document.getElementById('remotePath').value;
  const routeType = document.getElementById('routeType').value;

  // The user types just the segment (e.g. "voice"); strip any leading slashes/
  // whitespace they might still type and build the real path ourselves.
  const remotePath = '/' + rawPath.trim().replace(/^\/+/, '');

  const btn = document.getElementById('connect-btn');
  const statusEl = document.getElementById('status-message');

  btn.disabled = true;
  btn.textContent = 'Connecting...';
  statusEl.className = 'hidden';

  try {
    const response = await window.api.connectTunnel({ localPort, remotePath, routeType });

    if (response.success) {
      statusEl.textContent = response.message;
      statusEl.className = 'success';
      btn.textContent = 'Connect Another Tunnel';
      btn.disabled = false;

      document.getElementById('localPort').value = '';
      document.getElementById('remotePath').value = '';
    } else {
      throw new Error(response.message);
    }
  } catch (err) {
    statusEl.textContent = err.message || 'Connection failed.';
    statusEl.className = 'error';
    btn.disabled = false;
    btn.textContent = 'Try Again';
  }
});

// ==================== Settings ====================

document.getElementById('runAtStartup').addEventListener('change', (e) => {
  currentConfig.runAtStartup = e.target.checked;
  window.api.saveConfig({ runAtStartup: e.target.checked });
});

document.getElementById('minimizeToTray').addEventListener('change', (e) => {
  currentConfig.minimizeToTray = e.target.checked;
  window.api.saveConfig({ minimizeToTray: e.target.checked });
});

document.getElementById('quit-btn').addEventListener('click', () => {
  window.api.quitApp();
});

// ==================== Initialize ====================

(async function init() {
  serverUrl = await window.api.getServerUrl();

  currentConfig = await window.api.getConfig();
  if (currentConfig.email) {
    document.getElementById('login-email').value = currentConfig.email;
  }

  const session = await window.api.getSession();
  if (session) {
    await showAppView(session.email);
  } else {
    showLoginView();
  }
})();
