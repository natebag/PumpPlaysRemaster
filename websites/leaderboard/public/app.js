const API_BASE = window.PUMP_API || localStorage.getItem('pump_api') || 'http://localhost:4000';
const SITES = {
  home: localStorage.getItem('pump_landing_url') || '/',
};

let currentSort = 'total_points';
let refreshCountdown = 30;
let isConnected = false;

// Set links
document.getElementById('back-link').href = SITES.home;

// ─── Tab Navigation ───
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ─── Sort Controls ───
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSort = btn.dataset.sort;
    loadLeaderboard();
  });
});

// ─── API ───
async function apiFetch(path) {
  try {
    const res = await fetch(API_BASE + path);
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch {
    return null;
  }
}

function fmt(n) {
  if (n == null) return '--';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function fmtUptime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h + 'h ' + m + 'm';
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ─── Connection Status ───
function setConnected(connected) {
  isConnected = connected;
  const dot = document.querySelector('.conn-dot');
  const text = document.querySelector('.conn-text');
  if (connected) {
    dot.className = 'conn-dot live';
    text.textContent = 'LIVE';
  } else {
    dot.className = 'conn-dot offline';
    text.textContent = 'OFFLINE';
  }
}

// ─── Status Bar ───
async function loadStatus() {
  const data = await apiFetch('/api/status');
  if (data) {
    setConnected(true);
    document.getElementById('game-name').textContent = data.game?.name || 'No game active';
  } else {
    setConnected(false);
    document.getElementById('game-name').textContent = 'OFFLINE';
  }

  const stats = await apiFetch('/api/stats');
  if (stats) {
    document.getElementById('total-players').textContent = fmt(stats.total_users || 0);
    document.getElementById('total-commands').textContent = fmt(stats.total_commands || 0);
  }

  const root = await apiFetch('/');
  if (root && root.uptime_ms) {
    document.getElementById('uptime').textContent = fmtUptime(root.uptime_ms);
  }
}

// ─── Leaderboard ───
async function loadLeaderboard() {
  const data = await apiFetch('/api/leaderboard?limit=50&order=' + currentSort);

  if (!data || !data.length) {
    // Clear podium
    for (let i = 1; i <= 3; i++) {
      const slot = document.getElementById('podium-' + i);
      if (slot) {
        slot.querySelector('.podium-name').textContent = '---';
        slot.querySelector('.podium-score').textContent = '0';
      }
    }
    document.getElementById('rankings-list').innerHTML =
      '<div class="empty-state"><h3>No rankings yet</h3><p>Start playing to see your name here!</p></div>';
    return;
  }

  const label = currentSort === 'total_points' ? 'pts' : 'cmds';
  const field = currentSort;

  // Update podium
  for (let i = 0; i < 3 && i < data.length; i++) {
    const slot = document.getElementById('podium-' + (i + 1));
    if (slot) {
      slot.querySelector('.podium-name').textContent = data[i].display_name || data[i].user_key || '???';
      slot.querySelector('.podium-score').textContent = fmt(data[i][field] || 0) + ' ' + label;
    }
  }

  // Rankings 4+
  if (data.length <= 3) {
    document.getElementById('rankings-list').innerHTML =
      '<div class="empty-state"><p>Only ' + data.length + ' player(s) so far</p></div>';
    return;
  }

  const rows = data.slice(3).map((user, i) => {
    const rank = i + 4;
    const name = escHtml(user.display_name || user.user_key || '???');
    return `
      <div class="rank-row${rank <= 5 ? ' top-rank' : ''}">
        <span class="rank-num">${rank}</span>
        <span class="rank-name">${name}</span>
        <div class="rank-meta">
          <span class="rank-cmds">${fmt(user.total_commands)} cmds</span>
          <span class="rank-pts">${fmt(user.total_points)} pts</span>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('rankings-list').innerHTML = rows;
}

// ─── Hourly ───
async function loadHourly() {
  const data = await apiFetch('/api/leaderboard/hourly');
  if (!data || !data.length) {
    document.getElementById('hourly-list').innerHTML =
      '<div class="empty-state"><p>No hourly data yet&mdash;the hour just started!</p></div>';
    return;
  }

  const rows = data.slice(0, 10).map((user, i) => {
    const name = escHtml(user.display_name || user.user_key || '???');
    const cmds = user.commands || user.total_commands || 0;
    const pts = user.points || user.total_points || 0;
    return `
      <div class="rank-row${i < 3 ? ' top-rank' : ''}">
        <span class="rank-num">${i + 1}</span>
        <span class="rank-name">${name}</span>
        <div class="rank-meta">
          <span class="rank-cmds">${fmt(cmds)} cmds</span>
          <span class="rank-pts">${fmt(pts)} pts</span>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('hourly-list').innerHTML = rows;
}

// ─── Hall of Fame ───
async function loadHallOfFame() {
  const data = await apiFetch('/api/halloffame?limit=20');
  if (!data || !data.length) {
    document.getElementById('hall-entries').innerHTML =
      '<div class="empty-state"><h3>No victories yet</h3><p>The community hasn\'t beaten the Elite Four... yet.</p></div>';
    return;
  }

  const cards = data.map(entry => {
    const contribs = (entry.top_contributors || []).map(c =>
      `<span class="hall-chip">${escHtml(c.user)} (${fmt(c.points)} pts)</span>`
    ).join('');

    return `
      <div class="hall-card">
        <div class="hall-game">${escHtml(entry.game_name || entry.game_id || 'Unknown')}</div>
        <div class="hall-date">${fmtDate(entry.completed_at)}</div>
        <div class="hall-stats">
          <div>
            <span class="hall-stat-val">${fmt(entry.total_commands)}</span>
            <span class="hall-stat-lbl"> Commands</span>
          </div>
          <div>
            <span class="hall-stat-val">${fmt(entry.total_participants)}</span>
            <span class="hall-stat-lbl"> Participants</span>
          </div>
        </div>
        ${contribs ? `
          <div class="hall-contributors">
            <div class="hall-contributors-title">Top Contributors</div>
            ${contribs}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  document.getElementById('hall-entries').innerHTML = cards;
}

// ─── Stats ───
async function loadStats() {
  const stats = await apiFetch('/api/stats');
  if (stats) {
    document.getElementById('stat-users').textContent = fmt(stats.total_users || 0);
    document.getElementById('stat-commands').textContent = fmt(stats.total_commands || 0);
    document.getElementById('stat-points').textContent = fmt(stats.total_points || 0);
  }

  const hall = await apiFetch('/api/halloffame?limit=100');
  if (hall && hall.length) {
    const uniqueGames = new Set(hall.map(e => e.game_id));
    document.getElementById('stat-games').textContent = uniqueGames.size;
  } else {
    document.getElementById('stat-games').textContent = '0';
  }

  // Top commands
  const cmds = await apiFetch('/api/leaderboard/commands');
  if (cmds && cmds.length) {
    const maxCount = cmds[0].count || cmds[0].total || 1;
    const bars = cmds.slice(0, 12).map(cmd => {
      const count = cmd.count || cmd.total || 0;
      const pct = Math.max(2, Math.round((count / maxCount) * 100));
      return `
        <div class="cmd-bar-row">
          <span class="cmd-name">${escHtml(cmd.command || cmd.name || '?')}</span>
          <div class="cmd-bar-track">
            <div class="cmd-bar-fill" style="width:${pct}%"></div>
          </div>
          <span class="cmd-count">${fmt(count)}</span>
        </div>
      `;
    }).join('');
    document.getElementById('command-bars').innerHTML = bars;
  } else {
    document.getElementById('command-bars').innerHTML =
      '<div class="empty-state"><p>No command data yet</p></div>';
  }
}

// ─── User Lookup ───
function initLookup() {
  const input = document.getElementById('lookup-input');
  const btn = document.getElementById('lookup-btn');
  const result = document.getElementById('lookup-result');

  async function doLookup() {
    const query = input.value.trim();
    if (!query) return;

    result.innerHTML = '<div class="placeholder">Searching...</div>';

    const data = await apiFetch('/api/user/' + encodeURIComponent(query));
    if (!data || data.error) {
      result.innerHTML = '<div class="error-text">Player not found. Try their exact username.</div>';
      return;
    }

    result.innerHTML = `
      <div class="lookup-result-card">
        <div class="lr-name">${escHtml(data.display_name || data.user_key || query)}</div>
        <div class="lr-stats">
          <div class="lr-stat">
            <div class="lr-stat-val">${fmt(data.total_points || 0)}</div>
            <div class="lr-stat-lbl">Points</div>
          </div>
          <div class="lr-stat">
            <div class="lr-stat-val">${fmt(data.total_commands || 0)}</div>
            <div class="lr-stat-lbl">Commands</div>
          </div>
          <div class="lr-stat">
            <div class="lr-stat-val">${data.rank || '--'}</div>
            <div class="lr-stat-lbl">Rank</div>
          </div>
        </div>
      </div>
    `;
  }

  btn.addEventListener('click', doLookup);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLookup();
  });
}

// ─── Refresh Timer ───
function initRefreshTimer() {
  setInterval(() => {
    refreshCountdown--;
    if (refreshCountdown <= 0) {
      refreshCountdown = 30;
      refreshAll();
    }
    const el = document.getElementById('refresh-timer');
    if (el) el.textContent = refreshCountdown + 's';
  }, 1000);
}

// ─── Refresh All ───
async function refreshAll() {
  await Promise.all([
    loadStatus(),
    loadLeaderboard(),
    loadHourly(),
    loadHallOfFame(),
    loadStats(),
  ]);
}

// ─── Init ───
refreshAll();
initLookup();
initRefreshTimer();
