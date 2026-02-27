const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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
  console.log(`  /              -> Landing`);
  console.log(`  /leaderboard   -> Leaderboard`);
  console.log(`  /docs          -> Documentation`);
  console.log(`  /team-rocket   -> Team Rocket`);
  console.log(`  /champions     -> Champions DAO`);
});
