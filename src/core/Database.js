const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DB {
  constructor() {
    this.db = null;
  }

  init() {
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    this.db = new Database(path.join(dataDir, 'leaderboard.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._createTables();
    console.log('[DB] SQLite initialized');
  }

  _createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        user_key TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        source TEXT DEFAULT 'pumpfun_ws',
        wallet_address TEXT,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        total_commands INTEGER DEFAULT 0,
        total_points INTEGER DEFAULT 0,
        total_wins INTEGER DEFAULT 0,
        current_streak INTEGER DEFAULT 0,
        best_streak INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_key TEXT NOT NULL,
        command TEXT NOT NULL,
        command_type TEXT DEFAULT 'press',
        game_id TEXT NOT NULL,
        vote_count INTEGER DEFAULT 1,
        was_winner INTEGER DEFAULT 0,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (user_key) REFERENCES users(user_key)
      );

      CREATE TABLE IF NOT EXISTS hourly_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hour_key TEXT NOT NULL,
        game_id TEXT NOT NULL,
        total_votes INTEGER DEFAULT 0,
        unique_users INTEGER DEFAULT 0,
        total_commands_executed INTEGER DEFAULT 0,
        top_user TEXT,
        top_command TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(hour_key, game_id)
      );

      CREATE TABLE IF NOT EXISTS achievements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_key TEXT NOT NULL,
        achievement TEXT NOT NULL,
        game_id TEXT,
        earned_at INTEGER NOT NULL,
        UNIQUE(user_key, achievement),
        FOREIGN KEY (user_key) REFERENCES users(user_key)
      );

      CREATE INDEX IF NOT EXISTS idx_commands_user ON commands(user_key);
      CREATE INDEX IF NOT EXISTS idx_commands_timestamp ON commands(timestamp);
      CREATE INDEX IF NOT EXISTS idx_commands_game ON commands(game_id);
      CREATE INDEX IF NOT EXISTS idx_commands_winner ON commands(was_winner);
    `);
  }

  // Prepared statements - created lazily
  _prep(key, sql) {
    if (!this['_stmt_' + key]) {
      this['_stmt_' + key] = this.db.prepare(sql);
    }
    return this['_stmt_' + key];
  }

  upsertUser(userKey, displayName, source) {
    const now = Date.now();
    this._prep('upsertUser', `
      INSERT INTO users (user_key, display_name, source, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_key) DO UPDATE SET
        display_name = excluded.display_name,
        last_seen = excluded.last_seen
    `).run(userKey, displayName, source || 'pumpfun_ws', now, now);
  }

  recordCommand(userKey, command, commandType, gameId, voteCount, wasWinner) {
    this._prep('insertCmd', `
      INSERT INTO commands (user_key, command, command_type, game_id, vote_count, was_winner, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userKey, command, commandType, gameId, voteCount, wasWinner ? 1 : 0, Date.now());

    // Update user stats
    const pointsForWin = wasWinner ? 10 : 1;
    this._prep('updateUserStats', `
      UPDATE users SET
        total_commands = total_commands + 1,
        total_points = total_points + ?,
        total_wins = total_wins + ?,
        last_seen = ?
      WHERE user_key = ?
    `).run(pointsForWin, wasWinner ? 1 : 0, Date.now(), userKey);
  }

  updateStreak(userKey, isWinner) {
    if (isWinner) {
      this._prep('incStreak', `
        UPDATE users SET
          current_streak = current_streak + 1,
          best_streak = MAX(best_streak, current_streak + 1)
        WHERE user_key = ?
      `).run(userKey);
    } else {
      this._prep('resetStreak', `
        UPDATE users SET current_streak = 0 WHERE user_key = ?
      `).run(userKey);
    }
  }

  getLeaderboard(limit = 20, orderBy = 'total_points') {
    const validColumns = ['total_points', 'total_commands', 'total_wins', 'best_streak'];
    if (!validColumns.includes(orderBy)) orderBy = 'total_points';
    return this.db.prepare(`
      SELECT user_key, display_name, total_commands, total_points, total_wins,
             current_streak, best_streak, first_seen, last_seen
      FROM users
      ORDER BY ${orderBy} DESC
      LIMIT ?
    `).all(limit);
  }

  getHourlyLeaderboard(limit = 10) {
    const oneHourAgo = Date.now() - 3600000;
    return this.db.prepare(`
      SELECT user_key, COUNT(*) as commands, SUM(was_winner) as wins
      FROM commands
      WHERE timestamp > ?
      GROUP BY user_key
      ORDER BY commands DESC
      LIMIT ?
    `).all(oneHourAgo, limit);
  }

  getUserStats(userKey) {
    return this.db.prepare(`SELECT * FROM users WHERE user_key = ?`).get(userKey);
  }

  getUserFavoriteCommand(userKey) {
    return this.db.prepare(`
      SELECT command, COUNT(*) as count
      FROM commands WHERE user_key = ?
      GROUP BY command ORDER BY count DESC LIMIT 1
    `).get(userKey);
  }

  getCommandStats(gameId) {
    const where = gameId ? 'WHERE game_id = ?' : '';
    const params = gameId ? [gameId] : [];
    return this.db.prepare(`
      SELECT command, COUNT(*) as count
      FROM commands ${where}
      GROUP BY command ORDER BY count DESC LIMIT 10
    `).all(...params);
  }

  getTotalStats() {
    return this.db.prepare(`
      SELECT
        COUNT(DISTINCT user_key) as total_users,
        COUNT(*) as total_commands,
        SUM(was_winner) as total_executions
      FROM commands
    `).get();
  }

  recordHourlyStats(gameId, stats) {
    const hourKey = new Date().toISOString().slice(0, 13);
    this._prep('upsertHourly', `
      INSERT INTO hourly_stats (hour_key, game_id, total_votes, unique_users, total_commands_executed, top_user, top_command, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(hour_key, game_id) DO UPDATE SET
        total_votes = excluded.total_votes,
        unique_users = excluded.unique_users,
        total_commands_executed = excluded.total_commands_executed,
        top_user = excluded.top_user,
        top_command = excluded.top_command
    `).run(hourKey, gameId, stats.totalVotes, stats.uniqueUsers, stats.commandsExecuted, stats.topUser, stats.topCommand, Date.now());
  }

  addAchievement(userKey, achievement, gameId) {
    try {
      this._prep('addAchieve', `
        INSERT INTO achievements (user_key, achievement, game_id, earned_at)
        VALUES (?, ?, ?, ?)
      `).run(userKey, achievement, gameId, Date.now());
      return true;
    } catch (e) {
      return false; // Already earned
    }
  }

  getUserAchievements(userKey) {
    return this.db.prepare(`SELECT * FROM achievements WHERE user_key = ?`).all(userKey);
  }

  close() {
    if (this.db) this.db.close();
  }
}

module.exports = new DB();
