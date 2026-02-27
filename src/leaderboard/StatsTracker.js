const eventBus = require('../core/EventBus');
const db = require('../core/Database');
const config = require('../core/ConfigManager');

const ACHIEVEMENT_THRESHOLDS = [
  { commands: 10, name: 'Rookie Trainer', desc: '10 commands' },
  { commands: 50, name: 'Pokemon Trainer', desc: '50 commands' },
  { commands: 100, name: 'Ace Trainer', desc: '100 commands' },
  { commands: 500, name: 'Gym Leader', desc: '500 commands' },
  { commands: 1000, name: 'Elite Four', desc: '1000 commands' },
  { commands: 5000, name: 'Champion', desc: '5000 commands' },
];

const WIN_THRESHOLDS = [
  { wins: 5, name: 'First Victory', desc: '5 winning votes' },
  { wins: 25, name: 'Strategist', desc: '25 winning votes' },
  { wins: 100, name: 'Tactician', desc: '100 winning votes' },
  { wins: 500, name: 'Commander', desc: '500 winning votes' },
];

const STREAK_THRESHOLDS = [
  { streak: 3, name: 'Hot Streak', desc: '3 wins in a row' },
  { streak: 5, name: 'On Fire', desc: '5 wins in a row' },
  { streak: 10, name: 'Unstoppable', desc: '10 wins in a row' },
];

class StatsTracker {
  constructor() {
    this.sessionVotes = 0;
    this.sessionUsers = new Set();
    this.sessionCommands = 0;
    this.hourlyInterval = null;
  }

  init() {
    // Listen for all votes (not just winners)
    eventBus.on('chat:message', (msg) => {
      this._trackVote(msg);
    });

    // Listen for winning commands
    eventBus.on('vote:winner', (result) => {
      this._trackWin(result);
    });

    // Hourly stats snapshot
    this.hourlyInterval = setInterval(() => this._saveHourlySnapshot(), 3600000);

    console.log('[Stats] StatsTracker initialized');
  }

  _trackVote(msg) {
    const userKey = msg.userKey;
    const displayName = msg.displayName;
    const source = msg.source || 'pumpfun_ws';

    db.upsertUser(userKey, displayName, source);
    this.sessionVotes++;
    this.sessionUsers.add(userKey);
  }

  _trackWin(result) {
    const gameId = config.getActiveGame()?.id || 'unknown';
    const firstVoterKey = result.firstVoter; // This is displayName, we need userKey

    // Record the winning command for all voters in the window
    // For now, just record the command execution
    this.sessionCommands++;

    // We don't have individual voter keys in the result, so we record the execution
    // The per-user tracking happens in _trackVote via chat:message events
    // Here we just need to mark wins

    // Record command stats
    // firstVoter is a display name — use firstVoterKey if available, otherwise skip
    const voterKey = result.firstVoterKey || null;
    if (voterKey) {
      try {
        db.recordCommand(voterKey, result.command, 'press', gameId, result.voteCount, true);
      } catch (err) {
        // FK constraint can fail if user wasn't tracked yet — non-fatal
        console.warn('[Stats] recordCommand failed:', err.message);
      }
    }

    // Check achievements for known users
    this._checkAchievements();
  }

  _checkAchievements() {
    const gameId = config.getActiveGame()?.id;
    const leaderboard = db.getLeaderboard(50);

    for (const user of leaderboard) {
      // Command count achievements
      for (const t of ACHIEVEMENT_THRESHOLDS) {
        if (user.total_commands >= t.commands) {
          const earned = db.addAchievement(user.user_key, t.name, gameId);
          if (earned) {
            eventBus.emitSafe('achievement:earned', {
              userKey: user.user_key,
              displayName: user.display_name,
              achievement: t.name,
              description: t.desc,
            });
          }
        }
      }

      // Win count achievements
      for (const t of WIN_THRESHOLDS) {
        if (user.total_wins >= t.wins) {
          db.addAchievement(user.user_key, t.name, gameId);
        }
      }

      // Streak achievements
      for (const t of STREAK_THRESHOLDS) {
        if (user.best_streak >= t.streak) {
          db.addAchievement(user.user_key, t.name, gameId);
        }
      }
    }
  }

  _saveHourlySnapshot() {
    const gameId = config.getActiveGame()?.id || 'unknown';
    const hourlyBoard = db.getHourlyLeaderboard(1);
    db.recordHourlyStats(gameId, {
      totalVotes: this.sessionVotes,
      uniqueUsers: this.sessionUsers.size,
      commandsExecuted: this.sessionCommands,
      topUser: hourlyBoard[0]?.user_key || null,
      topCommand: null,
    });
  }

  stop() {
    if (this.hourlyInterval) clearInterval(this.hourlyInterval);
    this._saveHourlySnapshot();
  }
}

module.exports = StatsTracker;
