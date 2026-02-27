const API = window.location.origin;
let controls = null;
let selectedTeam = null;

// Fetch current game controls on load
async function loadControls() {
  try {
    const res = await fetch(API + '/api/controls');
    controls = await res.json();
    renderControls();
  } catch (err) {
    log('Failed to load controls: ' + err.message, true);
  }
}

function renderControls() {
  if (!controls || controls.error) return;

  document.getElementById('game-name').textContent = controls.game.name;
  document.getElementById('game-system').textContent = controls.game.system.toUpperCase();

  // Show team selector for multiplayer
  if (controls.multiplayer?.enabled) {
    const teamSel = document.getElementById('team-selector');
    teamSel.classList.remove('hidden');
    const teamBtns = document.getElementById('team-buttons');
    teamBtns.innerHTML = '';

    // "Any" button (no team, defaults to controller 1)
    const anyBtn = document.createElement('button');
    anyBtn.className = 'team-btn active';
    anyBtn.textContent = 'All';
    anyBtn.onclick = () => selectTeam(null, anyBtn);
    teamBtns.appendChild(anyBtn);

    for (let i = 1; i <= controls.multiplayer.max_players; i++) {
      const btn = document.createElement('button');
      btn.className = 'team-btn';
      btn.textContent = 'P' + i;
      btn.onclick = () => selectTeam(i, btn);
      teamBtns.appendChild(btn);
    }
  }

  // Populate face buttons (non-dpad, non-analog, non-shoulder)
  const faceContainer = document.getElementById('face-buttons');
  const shoulderContainer = document.getElementById('shoulder-buttons');
  faceContainer.innerHTML = '';
  shoulderContainer.innerHTML = '';

  const dpadButtons = ['up', 'down', 'left', 'right'];
  const analogButtons = ['stickup', 'stickdown', 'stickleft', 'stickright'];
  const cButtons = ['cup', 'cdown', 'cleft', 'cright'];
  const shoulderButtons = ['l', 'r', 'z'];
  const skipButtons = [...dpadButtons, ...analogButtons, ...cButtons, ...shoulderButtons];

  const buttons = Object.keys(controls.buttons);

  // Face buttons
  for (const btn of buttons) {
    if (skipButtons.includes(btn)) continue;
    const el = document.createElement('button');
    el.className = 'btn';
    el.dataset.cmd = btn;
    el.textContent = controls.buttons[btn].label || btn.toUpperCase();
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); sendCmd(btn); });
    faceContainer.appendChild(el);
  }

  // Shoulder buttons
  const hasShoulder = shoulderButtons.some(b => controls.buttons[b]);
  if (hasShoulder) {
    for (const btn of shoulderButtons) {
      if (!controls.buttons[btn]) continue;
      const el = document.createElement('button');
      el.className = 'btn';
      el.dataset.cmd = btn;
      el.textContent = controls.buttons[btn].label || btn.toUpperCase();
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); sendCmd(btn); });
      shoulderContainer.appendChild(el);
    }
  } else {
    document.getElementById('shoulder-group').classList.add('hidden');
  }

  // Analog stick
  const hasAnalog = analogButtons.some(b => controls.buttons[b]);
  if (hasAnalog) {
    document.getElementById('analog-group').classList.remove('hidden');
  }

  // C-buttons
  const hasCButtons = cButtons.some(b => controls.buttons[b]);
  if (hasCButtons) {
    document.getElementById('cbutton-group').classList.remove('hidden');
  }

  // Attach click handlers to all pre-built buttons (dpad, analog, c-buttons)
  document.querySelectorAll('.btn[data-cmd]').forEach(btn => {
    // Only add if not already handled
    if (btn.parentElement.id !== 'face-buttons' && btn.parentElement.id !== 'shoulder-buttons') {
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); sendCmd(btn.dataset.cmd); });
    }
  });
}

function selectTeam(team, btn) {
  selectedTeam = team;
  document.querySelectorAll('.team-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  log('Controller: ' + (team ? 'P' + team : 'Default'));
}

async function sendCmd(command) {
  // Visual feedback
  const btn = document.querySelector(`.btn[data-cmd="${command}"]`);
  if (btn) {
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 150);
  }

  const body = { command };
  if (selectedTeam) body.team = selectedTeam;

  try {
    const res = await fetch(API + '/api/command/direct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.success) {
      const teamStr = data.team ? ` (P${data.team})` : '';
      log(command.toUpperCase() + teamStr);
    } else {
      log('Invalid: ' + command, true);
    }
  } catch (err) {
    log('Error: ' + err.message, true);
  }
}

function log(msg, isError) {
  const el = document.getElementById('cmd-log');
  const entry = document.createElement('div');
  entry.className = 'log-entry' + (isError ? ' error' : '');
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  entry.innerHTML = `<span class="time">${time}</span>${msg}`;
  el.prepend(entry);
  // Keep log short
  while (el.children.length > 50) el.lastChild.remove();
}

// Keyboard shortcuts
const KEY_MAP = {
  'w': 'up', 'a': 'left', 's': 'down', 'd': 'right',
  'arrowup': 'up', 'arrowleft': 'left', 'arrowdown': 'down', 'arrowright': 'right',
  'j': 'a', 'k': 'b', 'u': 'x', 'i': 'y',
  'enter': 'start', ' ': 'select',
  'q': 'l', 'e': 'r',
  'z': 'z',
  // Numpad/number for C-buttons
  '8': 'cup', '2': 'cdown', '4': 'cleft', '6': 'cright',
};

// Track team selection via number keys
const TEAM_KEYS = { '1': 1, '2': 2, '3': 3, '4': 4 };

document.addEventListener('keydown', (e) => {
  // Don't intercept when typing in the input
  if (e.target.id === 'custom-cmd') return;

  const key = e.key.toLowerCase();

  // Team selection with Shift+Number
  if (e.shiftKey && TEAM_KEYS[key] && controls?.multiplayer?.enabled) {
    const teamBtn = document.querySelectorAll('.team-btn')[parseInt(key)];
    if (teamBtn) selectTeam(parseInt(key), teamBtn);
    e.preventDefault();
    return;
  }

  const cmd = KEY_MAP[key];
  if (cmd && controls?.buttons?.[cmd]) {
    e.preventDefault();
    sendCmd(cmd);
  }
});

// Custom command input
document.getElementById('send-custom').addEventListener('click', () => {
  const input = document.getElementById('custom-cmd');
  const val = input.value.trim();
  if (!val) return;
  sendCmd(val);
  input.value = '';
});

document.getElementById('custom-cmd').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('send-custom').click();
  }
});

// Init
loadControls();

// Refresh controls when game changes (poll every 10s)
setInterval(async () => {
  try {
    const res = await fetch(API + '/api/controls');
    const newControls = await res.json();
    if (newControls.game?.id !== controls?.game?.id) {
      controls = newControls;
      renderControls();
      log('Game changed to: ' + newControls.game.name);
    }
  } catch { /* ignore */ }
}, 10000);
