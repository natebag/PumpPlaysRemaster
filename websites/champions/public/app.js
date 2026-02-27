const API_BASE = window.PUMP_API || localStorage.getItem('pump_api') || 'http://localhost:4000';
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

function formatBalance(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return String(n);
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

function showResult(text, success) {
  const el = document.getElementById('inject-result');
  el.className = 'result-msg ' + (success ? 'success' : 'error');
  el.textContent = text;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

// ─── Connection ───
document.getElementById('btn-connect-phantom').addEventListener('click', async () => {
  if (!window.solana || !window.solana.isPhantom) {
    addLog('ERROR: Phantom wallet not detected. Install from phantom.app', 'err');
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
  const uk = document.getElementById('input-userkey').value.trim();
  const wa = document.getElementById('input-wallet').value.trim();
  if (!uk) return;

  userKey = uk;
  walletAddress = wa || null;

  if (walletAddress) {
    await apiPost('/api/wallet/register', {
      userKey,
      displayName: userKey,
      walletAddress,
    });
  }

  addLog('Manual login: ' + userKey + (walletAddress ? ' (wallet: ' + walletAddress.slice(0, 8) + '...)' : ''), 'sys');
  onConnected();
});

function onConnected() {
  document.getElementById('connect-panel').classList.add('hidden');
  document.getElementById('terminal-panel').classList.remove('hidden');
  refreshStatus();
}

// ─── Status ───
async function refreshStatus() {
  if (!userKey) return;

  const data = await apiFetch('/api/champions/status/' + encodeURIComponent(userKey));
  if (!data) return;

  // Wallet display
  const walletDisp = data.wallet
    ? data.wallet.slice(0, 6) + '...' + data.wallet.slice(-4)
    : 'No wallet';
  document.getElementById('wallet-display').textContent = walletDisp;

  // Balance
  const balance = data.balance || 0;
  document.getElementById('balance-number').textContent = formatBalance(balance);

  // Tier
  const tier = data.tier || 'NONE';
  document.getElementById('tier-badge').textContent = tier.toUpperCase();

  // Commands remaining
  const remaining = data.commands_remaining;
  document.getElementById('cmds-remaining').textContent =
    remaining === -1 ? 'UNLIMITED' : (remaining !== undefined ? remaining + '/hr' : '--');

  // Perks text
  const perksEl = document.getElementById('balance-perks');
  if (data.tier) {
    perksEl.textContent = data.can_inject ? 'Command injection active' : 'Hourly limit reached - resets on the hour';
  } else {
    perksEl.textContent = 'Hold 1M+ PPP to unlock Champion access';
    perksEl.style.color = '#777';
  }

  // Vote weight
  const weightMap = { champion: '2x', elite: '3x', legendary: '5x' };
  document.getElementById('vote-weight').textContent = weightMap[data.tier] || '1x';

  // Highlight active tier row
  document.querySelectorAll('.tier-row').forEach(row => {
    row.classList.remove('active');
    if (data.tier && row.dataset.tier === data.tier.toLowerCase()) {
      row.classList.add('active');
    }
  });
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
  addLog('Injecting: ' + command, 'cmd');

  const result = await apiPost('/api/champions/inject', {
    userKey,
    command,
  });

  if (!result) {
    showResult('Inject failed - API unreachable', false);
    addLog('FAILED: API unreachable', 'err');
    return;
  }

  if (result.error) {
    showResult(result.error, false);
    addLog('DENIED: ' + result.error, 'err');
    return;
  }

  const btn = result.command?.button || command;
  const rem = result.remaining === 'unlimited' ? 'unlimited' : result.remaining;
  showResult(`"${btn}" injected! (${rem} remaining)`, true);
  addLog(`INJECTED: ${btn} | Remaining: ${rem} | Tier: ${result.tier}`, 'cmd');

  document.getElementById('inject-command').value = '';
  refreshStatus();
}

// ─── Refresh ───
setInterval(refreshStatus, 15000);
