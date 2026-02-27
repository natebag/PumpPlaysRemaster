const eventBus = require('./EventBus');
const config = require('./ConfigManager');
const db = require('./Database');
const ChatManager = require('../chat/ChatManager');
const VoteManager = require('../voting/VoteManager');
const EmulatorManager = require('../emulator/EmulatorManager');
const OverlayServer = require('../overlay/OverlayServer');
const StatsTracker = require('../leaderboard/StatsTracker');
const LeaderboardManager = require('../leaderboard/LeaderboardManager');
const GameScheduler = require('../schedule/GameScheduler');
const GameStateReader = require('../emulator/GameStateReader');
const WalletManager = require('../economy/WalletManager');
const RewardDistributor = require('../economy/RewardDistributor');
const BurnVerifier = require('../economy/BurnVerifier');
const BalanceGate = require('../economy/BalanceGate');
const PredictionMarket = require('../features/PredictionMarket');
const BountyBoard = require('../features/BountyBoard');
const ComboTracker = require('../features/ComboTracker');
const HallOfFame = require('../features/HallOfFame');
const NuzlockeMode = require('../features/NuzlockeMode');
const AutoHighlights = require('../features/AutoHighlights');
const { setupRoutes } = require('../api/routes');
const { setupTeamRocketRoutes } = require('../api/teamRocketRoutes');
const { setupChampionsRoutes } = require('../api/championsRoutes');
const express = require('express');
const cors = require('cors');

class GameEngine {
  constructor() {
    this.chatManager = null;
    this.voteManager = null;
    this.emulatorManager = null;
    this.overlayServer = null;
    this.statsTracker = null;
    this.leaderboardManager = null;
    this.gameScheduler = null;
    this.gameStateReader = null;
    this.walletManager = null;
    this.rewardDistributor = null;
    this.currentLabel = '';
    this.burnVerifier = null;
    this.balanceGate = null;
    this.predictionMarket = null;
    this.bountyBoard = null;
    this.comboTracker = null;
    this.hallOfFame = null;
    this.nuzlockeMode = null;
    this.autoHighlights = null;
    this.app = null;
    this.server = null;
    this.startTime = Date.now();
  }

  async start() {
    console.log('===========================================');
    console.log('    PUMP PLAYS REMASTER');
    console.log('    Pokemon 30th Anniversary Edition');
    console.log('===========================================');

    // Load configs
    config.load();

    const gameId = process.env.ACTIVE_GAME || 'pokemon-firered';
    const gameConfig = config.setActiveGame(gameId);
    this.currentLabel = gameConfig.name;

    // Set up Express API server
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());

    // Initialize database
    db.init();

    // Initialize components
    this.emulatorManager = new EmulatorManager();
    this.voteManager = new VoteManager(gameConfig);
    this.chatManager = new ChatManager();
    this.overlayServer = new OverlayServer();
    this.statsTracker = new StatsTracker();
    this.leaderboardManager = new LeaderboardManager();

    // Wire up the event pipeline
    this._setupEventPipeline();

    // Initialize economy if enabled
    if (config.isFeatureEnabled('economy')) {
      this.walletManager = new WalletManager();
      this.walletManager.init();
      this.burnVerifier = new BurnVerifier();
      this.burnVerifier.init();
      this.balanceGate = new BalanceGate();
      this.balanceGate.init();
      this.rewardDistributor = new RewardDistributor(this.walletManager);
      this.rewardDistributor.init();
    } else {
      console.log('[Engine] Economy disabled (ENABLE_ECONOMY=false)');
    }

    // Set up API routes
    setupRoutes(this.app, this);
    if (this.burnVerifier) setupTeamRocketRoutes(this.app, this);
    if (this.balanceGate) setupChampionsRoutes(this.app, this);

    // Start servers
    const port = parseInt(process.env.PORT) || 4000;
    this.server = this.app.listen(port, () => {
      console.log(`[Engine] API server on http://localhost:${port}`);
    });

    await this.overlayServer.start();
    await this.emulatorManager.connect(gameConfig);
    this.statsTracker.init();
    this.leaderboardManager.init();
    this.voteManager.start();
    await this.chatManager.start();

    // Initialize game state reader if enabled
    this.gameStateReader = new GameStateReader();
    this.gameStateReader.init();

    // Initialize scheduler if enabled
    if (config.isFeatureEnabled('scheduler')) {
      this.gameScheduler = new GameScheduler(this);
      this.gameScheduler.init();
    } else {
      console.log('[Engine] Scheduler disabled (ENABLE_SCHEDULER=false)');
    }

    // Initialize advanced features (always loaded, event-driven)
    this.comboTracker = new ComboTracker();
    this.comboTracker.init();
    this.hallOfFame = new HallOfFame();
    this.hallOfFame.init();
    this.nuzlockeMode = new NuzlockeMode();
    this.nuzlockeMode.init();
    this.autoHighlights = new AutoHighlights();
    this.autoHighlights.init();

    // Feature-flagged advanced features
    if (config.isFeatureEnabled('predictions')) {
      this.predictionMarket = new PredictionMarket();
      this.predictionMarket.init();
    }
    if (config.isFeatureEnabled('bounties')) {
      this.bountyBoard = new BountyBoard();
      this.bountyBoard.init();
    }

    console.log('[Engine] All systems GO! PUMP PLAYS REMASTER is live.');
    console.log(`[Engine] Game: ${gameConfig.name}`);
    console.log(`[Engine] Overlay: http://localhost:${process.env.OVERLAY_PORT || 4001}`);
  }

  _setupEventPipeline() {
    // Chat message → parse → vote
    eventBus.on('chat:message', (msg) => {
      this.voteManager.addVote(msg.userKey, msg.command, msg.displayName, msg.weight);
    });

    // Vote winner → execute on emulator
    eventBus.on('vote:winner', (result) => {
      this.emulatorManager.sendCommand(result);
      this.overlayServer.broadcast('command_executed', result);
    });

    // Vote state updates → overlay
    eventBus.on('vote:update', (state) => {
      this.overlayServer.broadcast('state_update', this._buildOverlayState(state));
    });

    // Emulator state → overlay
    eventBus.on('emulator:state', (state) => {
      this.overlayServer.broadcast('game_state', state);
    });

    // Achievement earned → overlay
    eventBus.on('achievement:earned', (data) => {
      this.overlayServer.broadcast('achievement', data);
      console.log(`[Achievement] ${data.displayName} earned "${data.achievement}"!`);
    });

    // Leaderboard updates → overlay
    eventBus.on('leaderboard:update', (data) => {
      this.overlayServer.broadcast('leaderboard_update', data);
    });

    // Wallet registration from chat
    eventBus.on('chat:wallet', (data) => {
      if (!this.walletManager) return;
      const result = this.walletManager.register(data.userKey, data.displayName, data.walletAddress);
      console.log(`[Wallet] ${data.displayName}: ${result.message}`);
    });

    // Combo landed → bonus points + overlay notification
    eventBus.on('combo:landed', (data) => {
      const bonusPoints = data.bonus * 10; // multiplier × base points
      if (data.lastVoterKey) {
        try {
          db.db.prepare('UPDATE users SET total_points = total_points + ? WHERE user_key = ?')
            .run(bonusPoints, data.lastVoterKey);
        } catch (err) {
          console.warn('[Combo] Failed to award bonus:', err.message);
        }
      }
      this.overlayServer.broadcast('combo_landed', {
        name: data.combo.name,
        description: data.combo.description,
        bonus: data.bonus,
        bonusPoints,
        finisher: data.lastVoter,
      });
      console.log(`[Combo] ${data.combo.name} by ${data.lastVoter} → +${bonusPoints} bonus pts`);
    });
  }

  _buildOverlayState(voteState) {
    const game = config.getActiveGame();
    return {
      type: 'state_update',
      vote_state: voteState,
      last_command: this.voteManager.getLastCommand(),
      system: game?.system || 'gba',
      game: {
        id: game?.id || '',
        name: game?.name || '',
        label: this.currentLabel || '',
      },
      leaderboard_preview: this.leaderboardManager?.getOverviewStats()?.top5 || [],
      session_stats: {
        total_votes: this.voteManager.totalVotes,
        active_users: this.voteManager.getActiveUserCount(),
        uptime_ms: Date.now() - this.startTime,
      },
    };
  }

  async loadGame(gameId, label) {
    console.log(`[Engine] Switching to game: ${gameId}`);
    this.voteManager.stop();
    const gameConfig = config.setActiveGame(gameId);
    this.currentLabel = label || gameConfig.name;
    await this.emulatorManager.connect(gameConfig);
    this.voteManager.reconfigure(gameConfig);
    this.voteManager.start();
    eventBus.emitSafe('game:changed', gameConfig);
    console.log(`[Engine] Now playing: ${gameConfig.name} (${this.currentLabel})`);
  }

  async shutdown() {
    console.log('[Engine] Shutting down...');
    this.voteManager.stop();
    this.statsTracker?.stop();
    this.gameScheduler?.stop();
    this.gameStateReader?.stop();
    this.rewardDistributor?.stop();
    this.burnVerifier?.stop();
    this.balanceGate?.stop();
    await this.chatManager.stop();
    await this.emulatorManager.disconnect();
    this.overlayServer.stop();
    db.close();
    if (this.server) this.server.close();
    console.log('[Engine] Shutdown complete.');
  }
}

module.exports = GameEngine;
