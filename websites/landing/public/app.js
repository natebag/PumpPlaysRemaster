const API_BASE = window.PUMP_API || localStorage.getItem('pump_api') || '';

const SITES = {
  leaderboard: localStorage.getItem('pump_leaderboard_url') || '/leaderboard',
  rocket: localStorage.getItem('pump_rocket_url') || '/team-rocket',
  champions: localStorage.getItem('pump_champions_url') || '/champions',
  docs: localStorage.getItem('pump_docs_url') || '/docs',
};

// Set ecosystem links
document.getElementById('link-leaderboard').href = SITES.leaderboard;
document.getElementById('link-rocket').href = SITES.rocket;
document.getElementById('link-champions').href = SITES.champions;
document.getElementById('link-docs').href = SITES.docs;
document.getElementById('link-docs-bottom').href = SITES.docs;
document.getElementById('link-leaderboard-footer').href = SITES.leaderboard;
document.getElementById('link-docs-footer').href = SITES.docs;

// ─── API Fetch ───
async function apiFetch(path) {
  try {
    const res = await fetch(API_BASE + path);
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch {
    return null;
  }
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function formatUptime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h + 'h ' + m + 'm';
}

// ─── Highlight Today ───
function highlightToday() {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const today = days[new Date().getDay()];
  document.querySelectorAll('.sched-card').forEach(card => {
    card.classList.toggle('today', card.dataset.day === today);
  });
}

// ─── Load Status ───
async function loadStatus() {
  const data = await apiFetch('/api/status');
  const dot = document.getElementById('status-dot');
  const statusText = document.getElementById('badge-status');
  const gameEl = document.getElementById('badge-game');

  if (data) {
    dot.className = 'status-dot live';
    statusText.textContent = 'LIVE';
    gameEl.textContent = data.game?.name || 'No game';
  } else {
    dot.className = 'status-dot offline';
    statusText.textContent = 'OFFLINE';
    gameEl.textContent = '---';
  }

  // Stats
  const stats = await apiFetch('/api/stats');
  if (stats) {
    document.getElementById('hero-players').textContent = formatNumber(stats.total_users || 0);
    document.getElementById('hero-commands').textContent = formatNumber(stats.total_commands || 0);
  }

  // Uptime
  const root = await apiFetch('/');
  if (root && root.uptime_ms) {
    document.getElementById('hero-uptime').textContent = formatUptime(root.uptime_ms);
  }

  // Schedule from API
  const schedule = await apiFetch('/api/schedule');
  if (schedule && schedule.schedule) {
    const dayOrder = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    dayOrder.forEach(day => {
      const card = document.querySelector(`.sched-card[data-day="${day}"]`);
      if (card && schedule.schedule[day]) {
        const label = card.querySelector('.sc-label');
        const game = card.querySelector('.sc-game');
        if (label) label.textContent = schedule.schedule[day].label || '';
        if (game) game.textContent = schedule.schedule[day].game || '';
      }
    });
  }
}

// ─── Pixel Rain ───
function initPixelRain() {
  const container = document.getElementById('pixel-rain');
  if (!container) return;

  const colors = ['#EF4444', '#3B82F6', '#F59E0B', '#10B981', '#A855F7'];
  const count = Math.min(30, Math.floor(window.innerWidth / 50));

  for (let i = 0; i < count; i++) {
    const drop = document.createElement('div');
    drop.className = 'pixel-drop';
    drop.style.left = Math.random() * 100 + '%';
    drop.style.height = (Math.random() * 12 + 4) + 'px';
    drop.style.background = colors[Math.floor(Math.random() * colors.length)];
    drop.style.animationDuration = (Math.random() * 6 + 4) + 's';
    drop.style.animationDelay = (Math.random() * 8) + 's';
    drop.style.opacity = '0';
    container.appendChild(drop);
  }
}

// ─── Scroll Reveal ───
function initScrollReveal() {
  const targets = document.querySelectorAll(
    '.step, .featured-game, .sched-card, .pillar, .eco-card, .token-address'
  );
  targets.forEach(el => el.classList.add('reveal'));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

  targets.forEach(el => observer.observe(el));
}

// ─── Copy Token Address ───
function initCopyToken() {
  const btn = document.getElementById('copy-token');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const addr = document.getElementById('token-addr').textContent;
    navigator.clipboard.writeText(addr).then(() => {
      btn.classList.add('copied');
      const copyEl = btn.querySelector('.ta-copy');
      copyEl.textContent = 'COPIED!';
      setTimeout(() => {
        btn.classList.remove('copied');
        copyEl.textContent = 'COPY';
      }, 2000);
    });
  });
}

// ─── Mobile Nav ───
function initMobileNav() {
  const hamburger = document.getElementById('nav-hamburger');
  const links = document.querySelector('.nav-links');
  if (!hamburger || !links) return;

  hamburger.addEventListener('click', () => {
    links.classList.toggle('open');
    hamburger.classList.toggle('active');
  });

  links.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      links.classList.remove('open');
      hamburger.classList.remove('active');
    });
  });
}

// ─── Init ───
highlightToday();
loadStatus();
initPixelRain();
initScrollReveal();
initCopyToken();
initMobileNav();

// Auto-refresh status every 60s
setInterval(loadStatus, 60000);

// Refresh today highlight at midnight
setInterval(highlightToday, 60000);
