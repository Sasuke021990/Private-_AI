let currentConfig = {};

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
  renderActiveTunnels();
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

function renderActiveTunnels() {
  const list = document.getElementById('tunnels-list');
  list.innerHTML = '';

  if (!currentConfig.activeRoutes || currentConfig.activeRoutes.length === 0) {
    list.innerHTML = '<div class="empty-state">No active tunnels yet. Create one under "Bind Tunnel".</div>';
    return;
  }

  currentConfig.activeRoutes.forEach(route => {
    const card = document.createElement('div');
    card.className = 'tunnel-card';

    const info = document.createElement('div');
    info.className = 'tunnel-info';

    const pathLine = document.createElement('span');
    pathLine.className = 'tunnel-path';
    pathLine.textContent = route.remotePath;

    const badge = document.createElement('span');
    badge.className = `type-badge ${route.routeType === 'api' ? 'type-api' : ''}`;
    badge.textContent = route.routeType === 'api' ? 'API' : 'APP';
    pathLine.appendChild(badge);

    const portLine = document.createElement('span');
    portLine.className = 'tunnel-port';
    portLine.textContent = `Local Port: ${route.localPort}`;

    info.appendChild(pathLine);
    info.appendChild(portLine);

    const disconnectBtn = document.createElement('button');
    disconnectBtn.className = 'disconnect-btn';
    disconnectBtn.textContent = 'Disconnect';
    disconnectBtn.addEventListener('click', async () => {
      disconnectBtn.textContent = '...';
      disconnectBtn.disabled = true;

      const res = await window.api.disconnectTunnel({ remotePath: route.remotePath });
      if (res.success) {
        currentConfig.activeRoutes = currentConfig.activeRoutes.filter(r => r.remotePath !== route.remotePath);
        renderActiveTunnels();
      } else {
        alert('Failed to disconnect: ' + res.message);
        disconnectBtn.textContent = 'Disconnect';
        disconnectBtn.disabled = false;
      }
    });

    card.appendChild(info);
    card.appendChild(disconnectBtn);
    list.appendChild(card);
  });
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

      currentConfig = await window.api.getConfig();
      renderActiveTunnels();

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
