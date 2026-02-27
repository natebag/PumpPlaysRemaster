const path = require('path');
const config = require('../core/ConfigManager');
const db = require('../core/Database');
const commandParser = require('../chat/CommandParser');
const eventBus = require('../core/EventBus');

function setupRoutes(app, engine) {
  // Remote control page
  app.use('/remote', require('express').static(path.join(__dirname, '../remote/public')));

  // System status
  app.get('/', (req, res) => {
    res.json({
      name: 'PUMP PLAYS REMASTER',
      status: 'running',
      game: config.getActiveGame()?.name || 'none',
      uptime_ms: Date.now() - engine.startTime,
    });
  });

  app.get('/api/status', (req, res) => {
    res.json({
      game: config.getActiveGame(),
      chat: engine.chatManager?.getStatus(),
      emulator: engine.emulatorManager?.getStatus(),
      votes: engine.voteManager?.getStats(),
      features: config.features,
    });
  });

  // Vote data
  app.get('/api/votes', (req, res) => {
    res.json(engine.voteManager?.getStats() || {});
  });

  app.get('/api/votes/history', (req, res) => {
    res.json(engine.voteManager?.voteHistory || []);
  });

  // Manual command injection (for testing)
  app.post('/api/command', (req, res) => {
    const { command, username } = req.body;
    if (!command) return res.status(400).json({ error: 'command required' });

    const parsed = commandParser.parse(command);
    if (!parsed) return res.status(400).json({ error: 'invalid command', valid: commandParser.getValidCommands() });

    eventBus.emitSafe('chat:message', {
      userKey: username || 'admin_test',
      displayName: username || 'Admin',
      command: parsed,
      rawText: command,
      source: 'api',
      weight: 1,
      timestamp: Date.now(),
    });

    res.json({ success: true, parsed });
  });

  // Direct command injection (bypasses voting, sends straight to emulator)
  app.post('/api/command/direct', (req, res) => {
    const { command, team } = req.body;
    if (!command) return res.status(400).json({ error: 'command required' });

    const parsed = commandParser.parse(command);
    if (!parsed) return res.status(400).json({ error: 'invalid command', valid: commandParser.getValidCommands() });

    // Override team if specified
    if (team) parsed.team = parseInt(team);

    const voteResult = {
      id: engine.voteManager ? engine.voteManager.nextCommandId++ : Date.now(),
      command: parsed.raw,
      parsedCommand: parsed,
      team: parsed.team || null,
      voteCount: 1,
      firstVoter: 'Remote',
      totalVoters: 1,
      timestamp: Date.now(),
    };

    engine.emulatorManager.sendCommand(voteResult);
    engine.overlayServer?.broadcast('command_executed', voteResult);
    res.json({ success: true, parsed, team: parsed.team });
  });

  // Get current game's full control info (for remote control UI)
  app.get('/api/controls', (req, res) => {
    const game = config.getActiveGame();
    if (!game) return res.json({ error: 'no game active' });
    const sys = game.systemConfig;
    res.json({
      game: { id: game.id, name: game.name, system: game.system },
      buttons: sys?.buttons || {},
      aliases: sys?.aliases || {},
      multiplayer: game.multiplayer || null,
      hold: sys?.hold_commands ? { prefix: sys.hold_prefix || 'hold', min: sys.hold_min_ms, max: sys.hold_max_ms, default: sys.hold_default_ms } : null,
    });
  });

  // BizHawk Lua polling endpoints (Command ID/ACK contract)
  app.get('/api/emulator/pending', (req, res) => {
    const adapter = engine.emulatorManager?.getAdapter();
    if (!adapter || !adapter.getPendingCommands) {
      return res.json([]);
    }
    const afterId = parseInt(req.query.after) || 0;
    res.json(adapter.getPendingCommands(afterId));
  });

  app.post('/api/emulator/ack', (req, res) => {
    const adapter = engine.emulatorManager?.getAdapter();
    if (!adapter || !adapter.acknowledgeCommands) {
      return res.status(404).json({ error: 'no adapter' });
    }
    const { last_id } = req.body;
    if (typeof last_id !== 'number') return res.status(400).json({ error: 'last_id required' });
    res.json(adapter.acknowledgeCommands(last_id));
  });

  // BizHawk save state (Lua polls this to check if save is requested)
  app.get('/api/emulator/savestate', (req, res) => {
    const adapter = engine.emulatorManager?.getAdapter();
    if (!adapter?.getSaveStateRequest) return res.json({ save: false });
    res.json(adapter.getSaveStateRequest());
  });

  // BizHawk confirms save state complete
  app.post('/api/emulator/savestate/done', (req, res) => {
    const adapter = engine.emulatorManager?.getAdapter();
    if (adapter?.confirmSaveState) {
      adapter.confirmSaveState();
      res.json({ ok: true });
    } else {
      res.json({ ok: false });
    }
  });

  // BizHawk game state reporting
  app.post('/api/emulator/state', (req, res) => {
    const adapter = engine.emulatorManager?.getAdapter();
    if (adapter?.receiveGameState) {
      adapter.receiveGameState(req.body);
    }
    res.json({ ok: true });
  });

  // Game switching
  app.post('/api/game/switch', (req, res) => {
    const { gameId } = req.body;
    if (!gameId) return res.status(400).json({ error: 'gameId required' });
    try {
      engine.loadGame(gameId);
      res.json({ success: true, game: config.getActiveGame()?.name });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/games', (req, res) => {
    const games = [];
    for (const [id, game] of config.games) {
      games.push({ id, name: game.name, system: game.system });
    }
    res.json(games);
  });

  // Valid commands for current game
  app.get('/api/commands', (req, res) => {
    res.json({ commands: commandParser.getValidCommands() });
  });

  // === LEADERBOARD ROUTES ===

  app.get('/api/leaderboard', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const orderBy = req.query.order || 'total_points';
    res.json(engine.leaderboardManager?.getAllTime(limit) || []);
  });

  app.get('/api/leaderboard/hourly', (req, res) => {
    res.json(engine.leaderboardManager?.getHourly() || []);
  });

  app.get('/api/leaderboard/overview', (req, res) => {
    res.json(engine.leaderboardManager?.getOverviewStats() || {});
  });

  app.get('/api/leaderboard/commands', (req, res) => {
    const gameId = req.query.game || null;
    res.json(engine.leaderboardManager?.getTopCommands(gameId) || []);
  });

  app.get('/api/user/:userKey', (req, res) => {
    const profile = engine.leaderboardManager?.getUserProfile(req.params.userKey);
    if (!profile) return res.status(404).json({ error: 'user not found' });
    res.json(profile);
  });

  app.get('/api/stats', (req, res) => {
    res.json(db.getTotalStats());
  });

  // === WALLET ROUTES ===

  app.post('/api/wallet/register', (req, res) => {
    const { userKey, displayName, walletAddress } = req.body;
    if (!userKey || !walletAddress) {
      return res.status(400).json({ error: 'userKey and walletAddress required' });
    }
    if (!engine.walletManager) return res.status(400).json({ error: 'Economy not enabled' });
    const result = engine.walletManager.register(userKey, displayName || userKey, walletAddress);
    res.status(result.success ? 200 : 400).json(result);
  });

  // Verify wallet ownership via Phantom signature
  app.post('/api/wallet/verify', (req, res) => {
    const { walletAddress, message, signature } = req.body;
    if (!walletAddress || !message || !signature) {
      return res.status(400).json({ error: 'walletAddress, message, and signature required' });
    }
    if (!engine.walletManager) return res.status(400).json({ error: 'Economy not enabled' });

    const result = engine.walletManager.verifyOwnership(walletAddress, message, signature);
    res.status(result.verified ? 200 : 403).json(result);
  });

  app.get('/api/wallet/stats', (req, res) => {
    if (!engine.walletManager) return res.json({ enabled: false });
    res.json({ enabled: true, ...engine.walletManager.getStats() });
  });

  app.get('/api/wallet/:userKey', (req, res) => {
    if (!engine.walletManager) return res.json({ registered: false });
    const wallet = engine.walletManager.getWallet(req.params.userKey);
    if (!wallet) return res.json({ registered: false });
    res.json({ registered: true, ...wallet });
  });

  app.post('/api/wallet/lock', (req, res) => {
    const { userKey } = req.body;
    if (!userKey) return res.status(400).json({ error: 'userKey required' });
    if (!engine.walletManager) return res.status(400).json({ error: 'Economy not enabled' });
    const result = engine.walletManager.lockWallet(userKey);
    res.status(result.success ? 200 : 400).json(result);
  });

  // === REWARDS ROUTES ===

  app.get('/api/rewards/pending/:userKey', (req, res) => {
    if (!engine.rewardDistributor) return res.json({ enabled: false });
    const pending = engine.rewardDistributor.getPendingRewards(req.params.userKey);
    const total = engine.rewardDistributor.getPendingTotal(req.params.userKey);
    res.json({ total, rewards: pending });
  });

  app.get('/api/rewards/history/:userKey', (req, res) => {
    if (!engine.rewardDistributor) return res.json({ enabled: false });
    const limit = parseInt(req.query.limit) || 20;
    res.json(engine.rewardDistributor.getRewardHistory(req.params.userKey, limit));
  });

  app.get('/api/rewards/stats', (req, res) => {
    if (!engine.rewardDistributor) return res.json({ enabled: false });
    res.json({ enabled: true, ...engine.rewardDistributor.getStats() });
  });

  app.post('/api/rewards/distribute', async (req, res) => {
    if (!engine.rewardDistributor) return res.status(400).json({ error: 'Economy not enabled' });
    const hourly = engine.rewardDistributor.distributeHourly();
    const onchain = await engine.rewardDistributor.distributePending();
    res.json({ hourly, onchain });
  });

  // Trigger only on-chain distribution (skip hourly recalc)
  app.post('/api/rewards/distribute-onchain', async (req, res) => {
    if (!engine.rewardDistributor) return res.status(400).json({ error: 'Economy not enabled' });
    const result = await engine.rewardDistributor.distributePending();
    res.json(result);
  });

  // === GAME STATE ROUTES ===

  app.get('/api/gamestate', (req, res) => {
    const state = engine.gameStateReader?.getState();
    if (!state) return res.json({ enabled: engine.gameStateReader?.enabled || false, state: null });
    res.json({ enabled: true, state });
  });

  // === SCHEDULE ROUTES ===

  app.get('/api/schedule', (req, res) => {
    const scheduler = engine.gameScheduler;
    if (!scheduler) return res.json({ enabled: false });
    res.json({
      enabled: true,
      schedule: scheduler.getSchedule(),
      current: scheduler.getCurrentScheduleEntry(),
    });
  });

  app.post('/api/schedule/force', (req, res) => {
    const { gameId, label } = req.body;
    if (!gameId) return res.status(400).json({ error: 'gameId required' });
    const scheduler = engine.gameScheduler;
    if (!scheduler) return res.status(400).json({ error: 'scheduler not enabled' });
    try {
      scheduler.forceGame(gameId, label || 'MANUAL OVERRIDE');
      res.json({ success: true, game: config.getActiveGame()?.name });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // === FEATURE ROUTES ===

  // Combos
  app.get('/api/combos', (req, res) => {
    if (!engine.comboTracker) return res.json([]);
    res.json(engine.comboTracker.getCombos());
  });

  app.get('/api/combos/stats', (req, res) => {
    res.json(engine.comboTracker?.getStats() || { totalCombos: 0 });
  });

  // Hall of Fame
  app.get('/api/halloffame', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    res.json(engine.hallOfFame?.getEntries(limit) || []);
  });

  app.post('/api/halloffame/record', (req, res) => {
    if (!engine.hallOfFame) return res.status(400).json({ error: 'Not available' });
    const { party, notes } = req.body;
    const entry = engine.hallOfFame.record(party || null, notes || null);
    res.json(entry);
  });

  // Nuzlocke
  app.get('/api/nuzlocke', (req, res) => {
    res.json(engine.nuzlockeMode?.getStatus() || { active: false });
  });

  app.post('/api/nuzlocke/toggle', (req, res) => {
    if (!engine.nuzlockeMode) return res.status(400).json({ error: 'Not available' });
    const { active } = req.body;
    res.json(engine.nuzlockeMode.toggle(active !== false));
  });

  // Highlights
  app.get('/api/highlights', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const minPriority = parseInt(req.query.priority) || 0;
    if (minPriority > 0) {
      res.json(engine.autoHighlights?.getByPriority(minPriority) || []);
    } else {
      res.json(engine.autoHighlights?.getRecent(limit) || []);
    }
  });

  // Predictions
  app.get('/api/predictions', (req, res) => {
    if (!engine.predictionMarket) return res.json({ enabled: false });
    res.json({ enabled: true, predictions: engine.predictionMarket.getActive() });
  });

  app.post('/api/predictions/create', (req, res) => {
    if (!engine.predictionMarket) return res.status(400).json({ error: 'Predictions not enabled' });
    const { title, options, autoResolveEvent } = req.body;
    if (!title || !options) return res.status(400).json({ error: 'title and options required' });
    const pred = engine.predictionMarket.create(title, options, autoResolveEvent || null);
    res.json(pred);
  });

  app.post('/api/predictions/:id/bet', (req, res) => {
    if (!engine.predictionMarket) return res.status(400).json({ error: 'Not enabled' });
    const { userKey, option, amount } = req.body;
    if (!userKey || !option || !amount) return res.status(400).json({ error: 'userKey, option, amount required' });
    const result = engine.predictionMarket.bet(parseInt(req.params.id), userKey, option, amount);
    res.status(result.success ? 200 : 400).json(result);
  });

  app.post('/api/predictions/:id/resolve', (req, res) => {
    if (!engine.predictionMarket) return res.status(400).json({ error: 'Not enabled' });
    const { winningOption } = req.body;
    if (!winningOption) return res.status(400).json({ error: 'winningOption required' });
    const result = engine.predictionMarket.resolve(parseInt(req.params.id), winningOption);
    res.status(result.success ? 200 : 400).json(result);
  });

  // Bounties
  app.get('/api/bounties', (req, res) => {
    if (!engine.bountyBoard) return res.json({ enabled: false });
    res.json({ enabled: true, bounties: engine.bountyBoard.getActive() });
  });

  app.post('/api/bounties/create', (req, res) => {
    if (!engine.bountyBoard) return res.status(400).json({ error: 'Bounties not enabled' });
    const { title, description, type, initialPool, createdBy } = req.body;
    if (!title || !createdBy) return res.status(400).json({ error: 'title and createdBy required' });
    const bounty = engine.bountyBoard.create(title, description, type || 'custom', initialPool || 0, createdBy);
    res.json(bounty);
  });

  app.post('/api/bounties/:id/contribute', (req, res) => {
    if (!engine.bountyBoard) return res.status(400).json({ error: 'Not enabled' });
    const { userKey, amount } = req.body;
    if (!userKey || !amount) return res.status(400).json({ error: 'userKey and amount required' });
    const result = engine.bountyBoard.contribute(parseInt(req.params.id), userKey, amount);
    res.status(result.success ? 200 : 400).json(result);
  });

  app.post('/api/bounties/:id/claim', (req, res) => {
    if (!engine.bountyBoard) return res.status(400).json({ error: 'Not enabled' });
    const { claimedBy } = req.body;
    if (!claimedBy) return res.status(400).json({ error: 'claimedBy required' });
    const result = engine.bountyBoard.claim(parseInt(req.params.id), claimedBy);
    res.status(result.success ? 200 : 400).json(result);
  });
}

module.exports = { setupRoutes };
