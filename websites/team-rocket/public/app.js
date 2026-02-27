const API_BASE = window.PUMP_API || localStorage.getItem('pump_api') || '';
let userKey = null;
let walletAddress = null;

// ─── API Helpers ───
async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(API_BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    return await res.json();
  } catch (err) {
    console.warn('API error:', err.message);
    return null;
  }
}

function apiPost(path, body) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
}

// ─── Logging ───
function addLog(text, type = '') {
  const log = document.getElementById('command-log');
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  const line = document.createElement('div');
  line.className = 'log-line ' + type;
  line.textContent = `[${time}] ${text}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function showResult(elementId, text, success) {
  const el = document.getElementById(elementId);
  el.className = 'result-msg ' + (success ? 'success' : 'error');
  el.textContent = text;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

// ─── Connection ───
document.getElementById('btn-connect-phantom').addEventListener('click', async () => {
  if (!window.solana || !window.solana.isPhantom) {
    showResult('burn-result', 'Phantom wallet not found. Install it from phantom.app', false);
    addLog('ERROR: Phantom wallet not detected', 'err');
    return;
  }

  try {
    const resp = await window.solana.connect();
    walletAddress = resp.publicKey.toString();
    userKey = walletAddress.slice(0, 8) + '_phantom';

    // Register wallet with backend
    await apiPost('/api/wallet/register', {
      userKey,
      displayName: userKey,
      walletAddress,
    });

    addLog('Phantom connected: ' + walletAddress.slice(0, 8) + '...' + walletAddress.slice(-4), 'sys');
    onConnected();
  } catch (err) {
    addLog('Phantom connection rejected', 'err');
  }
});

document.getElementById('btn-connect-manual').addEventListener('click', async () => {
  const input = document.getElementById('input-userkey');
  const val = input.value.trim();
  if (!val) return;
  userKey = val;
  addLog('Manual login: ' + userKey, 'sys');
  onConnected();
});

function onConnected() {
  document.getElementById('connect-panel').classList.add('hidden');
  document.getElementById('terminal-panel').classList.remove('hidden');
  document.getElementById('agent-name').textContent = userKey;
  refreshStatus();
  loadTiers();
}

// ─── Status ───
async function refreshStatus() {
  if (!userKey) return;
  const data = await apiFetch('/api/team-rocket/status/' + encodeURIComponent(userKey));
  if (!data) return;

  document.getElementById('agent-tier').textContent = data.tier_label || data.tier || 'UNRANKED';
  document.getElementById('total-burned').textContent = (data.burned || 0).toLocaleString() + ' PPP';
  document.getElementById('commands-remaining').textContent =
    (data.commands_remaining !== undefined ? data.commands_remaining : 0) + ' / hr';

  // Highlight active tier
  document.querySelectorAll('.tier-card').forEach(card => {
    card.classList.remove('active');
    if (data.tier && card.dataset.tier === data.tier.toLowerCase()) {
      card.classList.add('active');
    }
  });
}

async function loadTiers() {
  const data = await apiFetch('/api/team-rocket/tiers');
  if (!data) return;
  // Tiers are hardcoded in HTML for simplicity but could be dynamic
}

// ─── Burn ───
document.getElementById('btn-burn').addEventListener('click', () => doBurn());

document.querySelectorAll('.burn-presets .btn-small').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('burn-amount').value = btn.dataset.amount;
    doBurn();
  });
});

async function doBurn() {
  const amount = parseInt(document.getElementById('burn-amount').value);
  if (!amount || amount <= 0) {
    showResult('burn-result', 'Enter a valid burn amount', false);
    return;
  }

  addLog(`Burning ${amount.toLocaleString()} PPP...`, 'burn');

  const result = await apiPost('/api/team-rocket/burn', { userKey, amount });
  if (!result) {
    showResult('burn-result', 'Burn failed - API unreachable', false);
    addLog('BURN FAILED: API unreachable', 'err');
    return;
  }

  if (result.error) {
    showResult('burn-result', result.error, false);
    addLog('BURN FAILED: ' + result.error, 'err');
    return;
  }

  showResult('burn-result', `Burned ${amount.toLocaleString()} PPP. Total: ${result.total_burned?.toLocaleString()}. Tier: ${result.tier}`, true);
  addLog(`BURN SUCCESS: ${amount.toLocaleString()} PPP burned. Tier: ${result.tier}`, 'burn');

  document.getElementById('burn-amount').value = '';
  refreshStatus();
}

// ─── Command Injection ───
document.getElementById('btn-inject').addEventListener('click', () => {
  const cmd = document.getElementById('inject-command').value.trim();
  if (cmd) doInject(cmd);
});

document.getElementById('inject-command').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const cmd = e.target.value.trim();
    if (cmd) doInject(cmd);
  }
});

document.querySelectorAll('.cmd-btn').forEach(btn => {
  btn.addEventListener('click', () => doInject(btn.dataset.cmd));
});

async function doInject(command) {
  addLog(`Injecting command: ${command}`, 'cmd');

  const result = await apiPost('/api/team-rocket/inject', { userKey, command });
  if (!result) {
    showResult('inject-result', 'Inject failed - API unreachable', false);
    addLog('INJECT FAILED: API unreachable', 'err');
    return;
  }

  if (result.error) {
    showResult('inject-result', result.error, false);
    addLog('INJECT DENIED: ' + result.error, 'err');
    return;
  }

  const btn = result.command?.button || command;
  showResult('inject-result', `Command "${btn}" injected! (${result.remaining} remaining)`, true);
  addLog(`INJECTED: ${btn} | Remaining: ${result.remaining}`, 'cmd');

  document.getElementById('inject-command').value = '';
  refreshStatus();
}

// ─── Refresh ───
setInterval(refreshStatus, 15000);
