const socket = io({ transports: ['websocket'] });

// DOM elements
const gameName = document.getElementById('game-name');
const gameLabel = document.getElementById('game-label');
const voteBars = document.getElementById('vote-bars');
const voteTimer = document.getElementById('vote-timer');
const votePhase = document.getElementById('vote-phase');
const cmdName = document.getElementById('cmd-name');
const cmdVoter = document.getElementById('cmd-voter');
const statVotes = document.getElementById('stat-votes');
const statUsers = document.getElementById('stat-users');
const statUptime = document.getElementById('stat-uptime');
const chaosFill = document.getElementById('chaos-fill');
const chaosLabel = document.getElementById('chaos-label');
const commandFlash = document.getElementById('command-flash');

let timerInterval = null;
let windowEnd = 0;

// State update from backend
socket.on('state_update', (data) => {
  updateGameInfo(data.game);
  updateVotes(data.vote_state);
  updateStats(data.session_stats);
});

// Command executed flash
socket.on('command_executed', (result) => {
  updateLastCommand(result);
  // Only flash center-screen for Team Rocket / Champions injections
  if (result.source === 'team_rocket' || result.source === 'champions') {
    flashCommand(result);
  }
  updateChaos(result);
});

socket.on('connect', () => {
  console.log('[Overlay] Connected to server');
});

socket.on('disconnect', () => {
  console.log('[Overlay] Disconnected');
  votePhase.textContent = 'DISCONNECTED';
  votePhase.classList.add('pulse');
});

function updateGameInfo(game) {
  if (!game) return;
  gameName.textContent = game.name || 'PUMP PLAYS';
  gameLabel.textContent = game.label || '';
}

function updateVotes(state) {
  if (!state) return;

  // Update timer
  windowEnd = Date.now() + state.time_remaining_ms;
  startTimer(state.window_ms);

  // Update phase indicator
  votePhase.textContent = state.phase.toUpperCase();
  votePhase.classList.toggle('pulse', state.phase === 'collecting');

  // Build vote bars
  const votes = state.votes || {};
  const entries = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const maxVotes = entries.length > 0 ? entries[0][1] : 1;

  voteBars.innerHTML = '';
  for (const [cmd, count] of entries.slice(0, 8)) {
    const pct = (count / maxVotes) * 100;
    const isTop = count === maxVotes && entries.length > 1;

    const row = document.createElement('div');
    row.className = 'vote-row';
    row.innerHTML = `
      <span class="vote-cmd">${escapeHtml(cmd)}</span>
      <div class="vote-bar-bg">
        <div class="vote-bar-fill ${isTop ? 'winner' : ''}" style="width:${pct}%"></div>
      </div>
      <span class="vote-count">${count}</span>
    `;
    voteBars.appendChild(row);
  }

  if (entries.length === 0) {
    voteBars.innerHTML = '<div style="color:#555;font-size:7px;text-align:center;padding:8px">Waiting for votes...</div>';
  }
}

function updateLastCommand(result) {
  if (!result) return;
  cmdName.textContent = result.command;
  const voter = result.firstVoter || 'Unknown';
  cmdVoter.textContent = `by ${voter} (${result.voteCount} vote${result.voteCount !== 1 ? 's' : ''})`;
}

function updateStats(stats) {
  if (!stats) return;
  statVotes.textContent = `Votes: ${stats.total_votes.toLocaleString()}`;
  statUsers.textContent = `Players: ${stats.active_users}`;
  statUptime.textContent = formatUptime(stats.uptime_ms);
}

function updateChaos(result) {
  // Simple chaos calculation based on vote spread
  const totalVoters = result.totalVoters || 1;
  const winnerVotes = result.voteCount || 1;
  const consensus = winnerVotes / totalVoters;
  const chaos = 1 - consensus;

  chaosFill.style.width = `${chaos * 100}%`;

  if (chaos > 0.7) {
    chaosLabel.textContent = 'ANARCHY!';
    chaosLabel.style.color = '#f44336';
  } else if (chaos > 0.4) {
    chaosLabel.textContent = 'CHAOS';
    chaosLabel.style.color = '#ffeb3b';
  } else {
    chaosLabel.textContent = 'DEMOCRACY';
    chaosLabel.style.color = '#4caf50';
  }
}

function flashCommand(result) {
  const cmd = result.command;
  const tier = result.tier || 'Grunt';
  const source = result.source === 'champions' ? 'CHAMPION' : 'TEAM ROCKET';

  commandFlash.innerHTML = `
    <div class="flash-source">${source} (${tier})</div>
    <div class="flash-cmd">${escapeHtml(typeof cmd === 'string' ? cmd : cmd.raw || cmd.type || '???')}</div>
  `;
  commandFlash.classList.remove('hidden');
  commandFlash.classList.add('show');
  setTimeout(() => {
    commandFlash.classList.remove('show');
    setTimeout(() => commandFlash.classList.add('hidden'), 300);
  }, 1200);
}

function startTimer(windowMs) {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const remaining = Math.max(0, windowEnd - Date.now());
    voteTimer.textContent = (remaining / 1000).toFixed(1) + 's';
    if (remaining <= 500) {
      voteTimer.style.color = '#f44336';
    } else {
      voteTimer.style.color = '#ffeb3b';
    }
  }, 50);
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
