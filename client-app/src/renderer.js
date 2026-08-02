let currentConfig = {};

async function loadInitialConfig() {
  currentConfig = await window.api.getConfig();
  
  document.getElementById('email').value = currentConfig.email || '';
  document.getElementById('dashboardPassword').value = currentConfig.dashboardPassword || '';
  if (currentConfig.runAtStartup) document.getElementById('runAtStartup').checked = true;

  renderActiveTunnels();
  
  // Auto-connect saved tunnels if they are in the list!
  // In a robust implementation you would iterate and connect them here in the background.
}

function renderActiveTunnels() {
  const list = document.getElementById('tunnels-list');
  list.innerHTML = '';
  
  if (!currentConfig.activeRoutes || currentConfig.activeRoutes.length === 0) {
    list.innerHTML = '<div style="text-align: center; color: #64748b; font-size: 12px;">No active tunnels</div>';
    return;
  }

  currentConfig.activeRoutes.forEach(route => {
    const card = document.createElement('div');
    card.className = 'tunnel-card';
    card.innerHTML = `
      <div class="tunnel-info">
        <span class="tunnel-path">http://${currentConfig.vpsIp}:4000${route.remotePath} <span class="type-badge ${route.routeType === 'api' ? 'type-api' : ''}">${route.routeType === 'api' ? 'API' : 'APP'}</span></span>
        <span class="tunnel-port">Local Port: ${route.localPort}</span>
      </div>
      <button class="disconnect-btn" data-path="${route.remotePath}">Disconnect</button>
    `;
    list.appendChild(card);
  });

  // Attach disconnect handlers
  document.querySelectorAll('.disconnect-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const path = e.target.getAttribute('data-path');
      e.target.textContent = '...';
      e.target.disabled = true;
      
      const payload = {
        email: document.getElementById('email').value,
        dashboardPassword: document.getElementById('dashboardPassword').value,
        remotePath: path
      };
      
      const res = await window.api.disconnectTunnel(payload);
      if (res.success) {
        currentConfig.activeRoutes = currentConfig.activeRoutes.filter(r => r.remotePath !== path);
        renderActiveTunnels();
      } else {
        alert('Failed to disconnect: ' + res.message);
        e.target.textContent = 'Disconnect';
        e.target.disabled = false;
      }
    });
  });
}

// Save global settings automatically when changed
const globalInputs = ['dashboardPassword', 'email'];
globalInputs.forEach(id => {
  document.getElementById(id).addEventListener('change', (e) => {
    currentConfig[id] = e.target.value;
    window.api.saveConfig({ [id]: e.target.value });
  });
});

document.getElementById('runAtStartup').addEventListener('change', (e) => {
  currentConfig.runAtStartup = e.target.checked;
  window.api.saveConfig({ runAtStartup: e.target.checked });
});

document.getElementById('quit-btn').addEventListener('click', () => {
  window.api.quitApp();
});

document.getElementById('connect-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('email').value;
  const dashboardPassword = document.getElementById('dashboardPassword').value;
  
  const localPort = document.getElementById('localPort').value;
  const remotePath = document.getElementById('remotePath').value;
  const routeType = document.getElementById('routeType').value;

  const btn = document.getElementById('connect-btn');
  const statusEl = document.getElementById('status-message');

  // Update UI
  btn.disabled = true;
  btn.textContent = 'Connecting...';
  statusEl.className = 'hidden';

  try {
    const response = await window.api.connectTunnel({
      email,
      dashboardPassword,
      localPort,
      remotePath,
      routeType
    });

    if (response.success) {
      statusEl.textContent = response.message;
      statusEl.className = 'success';
      btn.textContent = 'Connect Another Tunnel';
      btn.disabled = false;
      
      // Update config manually since main.js modified it
      currentConfig = await window.api.getConfig();
      renderActiveTunnels();
      
      // Clear form
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

// Initialize on load
loadInitialConfig();
