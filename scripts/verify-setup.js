#!/usr/bin/env node
/**
 * PUMP PLAYS REMASTER - Setup Verification Script
 *
 * Run this BEFORE going live to make sure everything is ready.
 * Usage: node scripts/verify-setup.js
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
let passed = 0;
let warned = 0;
let failed = 0;

function ok(msg) { console.log('  \x1b[32m[OK]\x1b[0m ' + msg); passed++; }
function warn(msg) { console.log('  \x1b[33m[WARN]\x1b[0m ' + msg); warned++; }
function fail(msg) { console.log('  \x1b[31m[FAIL]\x1b[0m ' + msg); failed++; }
function section(title) { console.log('\n\x1b[36m--- ' + title + ' ---\x1b[0m'); }

async function httpGet(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', () => resolve(null));
  });
}

async function main() {
  console.log('\x1b[1m');
  console.log('===========================================');
  console.log('  PUMP PLAYS REMASTER - Setup Verification');
  console.log('===========================================');
  console.log('\x1b[0m');

  // ─── 1. Dependencies ───
  section('Dependencies');

  if (fs.existsSync(path.join(ROOT, 'node_modules'))) {
    ok('node_modules installed');
  } else {
    fail('node_modules missing - run: npm install');
  }

  const requiredPkgs = ['express', 'socket.io', 'better-sqlite3', 'cors', 'dotenv', 'ws', 'axios'];
  for (const pkg of requiredPkgs) {
    try {
      require.resolve(pkg, { paths: [ROOT] });
      ok(pkg + ' found');
    } catch {
      fail(pkg + ' missing - run: npm install');
    }
  }

  // pump-chat-client is optional (chat won't work without it but system boots)
  try {
    require.resolve('pump-chat-client', { paths: [ROOT] });
    ok('pump-chat-client found');
  } catch {
    warn('pump-chat-client not found - chat will use fallback');
  }

  // ─── 2. Environment ───
  section('Environment');

  const envPath = path.join(ROOT, '.env');
  const envExamplePath = path.join(ROOT, '.env.example');

  if (fs.existsSync(envPath)) {
    ok('.env file exists');
    const envContent = fs.readFileSync(envPath, 'utf8');

    if (envContent.includes('TOKEN_ADDRESS=') && !envContent.includes('YOUR_TOKEN_ADDRESS_HERE')) {
      ok('TOKEN_ADDRESS is set');
    } else {
      fail('TOKEN_ADDRESS not configured - set your pump.fun token address in .env');
    }

    const portMatch = envContent.match(/PORT=(\d+)/);
    if (portMatch) {
      ok('PORT=' + portMatch[1]);
    } else {
      warn('PORT not set - will default to 4000');
    }

    const overlayMatch = envContent.match(/OVERLAY_PORT=(\d+)/);
    if (overlayMatch) {
      ok('OVERLAY_PORT=' + overlayMatch[1]);
    } else {
      warn('OVERLAY_PORT not set - will default to 4001');
    }

    if (envContent.includes('ACTIVE_GAME=')) {
      const game = envContent.match(/ACTIVE_GAME=(.+)/)?.[1]?.trim();
      ok('ACTIVE_GAME=' + game);
    } else {
      warn('ACTIVE_GAME not set - will default to pokemon-firered');
    }
  } else {
    fail('.env file missing - copy .env.example to .env and configure it');
    if (fs.existsSync(envExamplePath)) {
      ok('.env.example exists (copy this to .env)');
    }
  }

  // ─── 3. Configs ───
  section('Game & System Configs');

  const systemsDir = path.join(ROOT, 'config', 'systems');
  const gamesDir = path.join(ROOT, 'config', 'games');

  if (fs.existsSync(systemsDir)) {
    const systems = fs.readdirSync(systemsDir).filter(f => f.endsWith('.json'));
    ok(systems.length + ' system configs: ' + systems.map(f => f.replace('.json', '')).join(', '));
  } else {
    fail('config/systems/ directory missing');
  }

  if (fs.existsSync(gamesDir)) {
    const games = fs.readdirSync(gamesDir).filter(f => f.endsWith('.json'));
    ok(games.length + ' game configs: ' + games.map(f => f.replace('.json', '')).join(', '));
  } else {
    fail('config/games/ directory missing');
  }

  // ─── 4. Source Files ───
  section('Core Source Files');

  const criticalFiles = [
    'src/index.js',
    'src/core/GameEngine.js',
    'src/core/EventBus.js',
    'src/core/ConfigManager.js',
    'src/core/Database.js',
    'src/chat/ChatManager.js',
    'src/chat/PumpFunClient.js',
    'src/chat/CommandParser.js',
    'src/voting/VoteManager.js',
    'src/emulator/EmulatorManager.js',
    'src/emulator/adapters/BizHawkAdapter.js',
    'src/overlay/OverlayServer.js',
    'src/overlay/public/index.html',
    'src/overlay/public/styles.css',
    'src/overlay/public/app.js',
    'src/api/routes.js',
  ];

  for (const file of criticalFiles) {
    if (fs.existsSync(path.join(ROOT, file))) {
      ok(file);
    } else {
      fail(file + ' missing!');
    }
  }

  // ─── 5. BizHawk Scripts ───
  section('BizHawk Lua Scripts');

  const luaFiles = [
    'scripts/bizhawk/main.lua',
    'scripts/bizhawk/memory-reader.lua',
  ];

  for (const file of luaFiles) {
    if (fs.existsSync(path.join(ROOT, file))) {
      ok(file);
    } else {
      fail(file + ' missing!');
    }
  }

  // ─── 6. Data Directory ───
  section('Data Directory');

  const dataDir = path.join(ROOT, 'data');
  if (fs.existsSync(dataDir)) {
    ok('data/ directory exists');
  } else {
    warn('data/ directory missing - will be created on first run');
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      ok('data/ directory created');
    } catch {
      fail('Could not create data/ directory');
    }
  }

  // ─── 7. Port Availability ───
  section('Port Checks');

  const apiPort = process.env.PORT || 4000;
  const overlayPort = process.env.OVERLAY_PORT || 4001;

  for (const port of [apiPort, overlayPort]) {
    const res = await httpGet('http://localhost:' + port);
    if (res) {
      warn('Port ' + port + ' is already in use - make sure nothing else is running');
    } else {
      ok('Port ' + port + ' is available');
    }
  }

  // ─── 8. Websites ───
  section('Websites');

  const sites = ['landing', 'leaderboard', 'team-rocket', 'champions'];
  for (const site of sites) {
    const siteDir = path.join(ROOT, 'websites', site);
    if (fs.existsSync(path.join(siteDir, 'public', 'index.html'))) {
      ok('websites/' + site + '/ ready');
    } else {
      warn('websites/' + site + '/ not found');
    }
  }

  // ─── Summary ───
  console.log('\n\x1b[1m===========================================\x1b[0m');
  console.log('\x1b[32m  Passed: ' + passed + '\x1b[0m');
  if (warned > 0) console.log('\x1b[33m  Warnings: ' + warned + '\x1b[0m');
  if (failed > 0) console.log('\x1b[31m  Failed: ' + failed + '\x1b[0m');
  console.log('\x1b[1m===========================================\x1b[0m');

  if (failed > 0) {
    console.log('\n\x1b[31mFix the failures above before going live!\x1b[0m\n');
  } else if (warned > 0) {
    console.log('\n\x1b[33mSome warnings - system will boot but check the items above.\x1b[0m\n');
  } else {
    console.log('\n\x1b[32mAll checks passed! Ready to launch.\x1b[0m\n');
  }

  // ─── Launch Checklist ───
  console.log('\x1b[1m--- LAUNCH CHECKLIST ---\x1b[0m');
  console.log('');
  console.log('  1. Set TOKEN_ADDRESS in .env to your pump.fun token');
  console.log('  2. Start the backend:     npm start');
  console.log('  3. Open BizHawk with your ROM (Pokemon FireRed)');
  console.log('  4. Load Lua script:       scripts/bizhawk/main.lua');
  console.log('  5. Open OBS');
  console.log('  6. Add Browser Source:    http://localhost:4001');
  console.log('  7. Set browser source to 1920x1080, transparent bg');
  console.log('  8. Add Game Capture for BizHawk window');
  console.log('  9. Start streaming!');
  console.log('');
  console.log('  API:      http://localhost:' + apiPort);
  console.log('  Overlay:  http://localhost:' + overlayPort);
  console.log('');
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
