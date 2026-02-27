const db = require('../core/Database');
const eventBus = require('../core/EventBus');

class LeaderboardManager {
  constructor() {
    this.cache = null;
    this.cacheTime = 0;
    this.CACHE_TTL = 5000; // 5 second cache
  }

  init() {
    // Broadcast leaderboard updates periodically
    setInterval(() => {
      this._broadcastUpdate();
    }, 10000);

    console.log('[Leaderboard] Manager initialized');
  }

  getAllTime(limit = 20) {
    return db.getLeaderboard(limit, 'total_points');
  }

  getByCommands(limit = 20) {
    return db.getLeaderboard(limit, 'total_commands');
  }

  getByWins(limit = 20) {
    return db.getLeaderboard(limit, 'total_wins');
  }

  getHourly(limit = 10) {
    return db.getHourlyLeaderboard(limit);
  }

  getTopCommands(gameId) {
    return db.getCommandStats(gameId);
  }

  getUserProfile(userKey) {
    const stats = db.getUserStats(userKey);
    if (!stats) return null;
    const fav = db.getUserFavoriteCommand(userKey);
    const achievements = db.getUserAchievements(userKey);
    return { ...stats, favoriteCommand: fav?.command || null, achievements };
  }

  getOverviewStats() {
    const now = Date.now();
    if (this.cache && now - this.cacheTime < this.CACHE_TTL) {
      return this.cache;
    }

    const totals = db.getTotalStats();
    const top5 = db.getLeaderboard(5, 'total_points');
    const hourly = db.getHourlyLeaderboard(3);
    const topCmds = db.getCommandStats();

    this.cache = {
      totals,
      top5: top5.map(u => ({
        name: u.display_name,
        points: u.total_points,
        commands: u.total_commands,
        wins: u.total_wins,
      })),
      hourlyTop3: hourly,
      topCommands: topCmds,
      updatedAt: now,
    };
    this.cacheTime = now;
    return this.cache;
  }

  _broadcastUpdate() {
    const overview = this.getOverviewStats();
    eventBus.emitSafe('leaderboard:update', overview);
  }
}

module.exports = LeaderboardManager;
