const express = require('express');
const path = require('path');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

// ─── API Proxy ───
// Forwards /api/* requests to the backend server.
// This lets all websites call /api/status, /api/leaderboard, etc.
// on their own domain — no CORS issues, no separate API domain needed.
//
// Set BACKEND_URL env var on Railway to point to your backend.
// Example: BACKEND_URL=https://your-backend.railway.app

const backendHost = new URL(BACKEND_URL).host;

// Handle CORS preflight FIRST (before proxy catches it)
app.options('/api/*', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

app.use('/api', (req, res) => {
  const targetUrl = BACKEND_URL + req.originalUrl;
  const client = targetUrl.startsWith('https') ? https : http;

  // Only forward safe headers — don't pass browser's accept-encoding
  // (compressed responses break piping when content-encoding isn't forwarded)
  const proxyHeaders = {
    host: backendHost,
    'content-type': req.headers['content-type'] || 'application/json',
    'accept': 'application/json',
  };
  if (req.headers['content-length']) {
    proxyHeaders['content-length'] = req.headers['content-length'];
  }

  const proxyReq = client.request(targetUrl, {
    method: req.method,
    headers: proxyHeaders,
    timeout: 10000,
  }, (proxyRes) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(proxyRes.statusCode);

    const contentType = proxyRes.headers['content-type'];
    if (contentType) res.set('Content-Type', contentType);

    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`[Proxy] ${req.method} ${req.originalUrl} → ${err.message}`);
    res.status(502).json({ error: 'Backend unavailable', offline: true });
  });

  proxyReq.on('timeout', () => {
    console.error(`[Proxy] ${req.method} ${req.originalUrl} → timeout`);
    proxyReq.destroy();
    res.status(504).json({ error: 'Backend timeout', offline: true });
  });

  if (req.method === 'POST' || req.method === 'PUT') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
});

// Backend root status (for uptime) — must be before static handler
app.get('/api/root-status', (req, res) => {
  const targetUrl = BACKEND_URL + '/';
  const client = targetUrl.startsWith('https') ? https : http;

  const proxyReq = client.request(targetUrl, {
    method: 'GET',
    headers: { host: backendHost, accept: 'application/json' },
    timeout: 10000,
  }, (proxyRes) => {
    res.set('Content-Type', 'application/json');
    res.status(proxyRes.statusCode);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    res.status(502).json({ error: 'Backend unavailable' });
  });
  proxyReq.on('timeout', () => { proxyReq.destroy(); res.status(504).json({ error: 'timeout' }); });
  proxyReq.end();
});

// ─── Static Sites ───

// Landing page at root
app.use('/', express.static(path.join(__dirname, 'landing/public')));

// Sub-sites at their paths
app.use('/leaderboard', express.static(path.join(__dirname, 'leaderboard/public')));
app.use('/docs', express.static(path.join(__dirname, 'docs/public')));
app.use('/team-rocket', express.static(path.join(__dirname, 'team-rocket/public')));
app.use('/champions', express.static(path.join(__dirname, 'champions/public')));

// SPA fallbacks - serve each site's index.html for deep links
app.get('/leaderboard/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'leaderboard/public/index.html'));
});

app.get('/docs/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'docs/public/index.html'));
});

app.get('/team-rocket/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'team-rocket/public/index.html'));
});

app.get('/champions/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'champions/public/index.html'));
});

// Landing fallback (catch-all)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'landing/public/index.html'));
});

app.listen(PORT, () => {
  console.log(`[PumpPlays] All sites running on http://localhost:${PORT}`);
  console.log(`[PumpPlays] API proxy → ${BACKEND_URL}`);
  console.log(`  /              -> Landing`);
  console.log(`  /leaderboard   -> Leaderboard`);
  console.log(`  /docs          -> Documentation`);
  console.log(`  /team-rocket   -> Team Rocket`);
  console.log(`  /champions     -> Champions DAO`);
  console.log(`  /api/*         -> Backend proxy`);
});
