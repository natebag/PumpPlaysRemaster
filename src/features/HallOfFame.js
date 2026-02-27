const eventBus = require('../core/EventBus');
const db = require('../core/Database');
const config = require('../core/ConfigManager');

/**
 * HallOfFame - Records when the community beats the Elite Four
 *
 * Tracks hall of fame entries per game with:
 *   - Final party composition
 *   - Total commands executed
 *   - Total participants
 *   - Duration
 *   - Top contributors
 *
 * Could be written on-chain in the future for permanent records.
 */
class HallOfFame {
  constructor() {
    this.entries = [];
  }

  init() {
    this._ensureTable();
    this._loadEntries();

    // Auto-detect Elite Four completion via badge count
    // Gen 1/3: 8 badges + E4 = special event
    eventBus.on('game:badge_earned', (data) => {
      if (data.total_badges === 8) {
        console.log('[HallOfFame] All 8 badges earned! Elite Four challenge begins...');
      }
    });

    console.log(`[HallOfFame] Initialized (${this.entries.length} entries)`);
  }

  _ensureTable() {
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS hall_of_fame (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT NOT NULL,
        game_name TEXT NOT NULL,
        completed_at INTEGER NOT NULL,
        duration_ms INTEGER,
        total_commands INTEGER DEFAULT 0,
        total_participants INTEGER DEFAULT 0,
        party TEXT,
        top_contributors TEXT,
        notes TEXT
      );
    `);
  }

  _loadEntries() {
    this.entries = db.db.prepare(
      'SELECT * FROM hall_of_fame ORDER BY completed_at DESC'
    ).all();
    for (const entry of this.entries) {
      if (entry.party) entry.party = JSON.parse(entry.party);
      if (entry.top_contributors) entry.top_contributors = JSON.parse(entry.top_contributors);
    }
  }

  /**
   * Record a Hall of Fame entry (Elite Four defeated!)
   */
  record(party = null, notes = null) {
    const game = config.getActiveGame();
    const stats = db.getTotalStats();
    const topUsers = db.getLeaderboard(5, 'total_points');

    const now = Date.now();
    const entry = {
      game_id: game?.id || 'unknown',
      game_name: game?.name || 'Unknown',
      completed_at: now,
      duration_ms: null,
      total_commands: stats?.total_commands || 0,
      total_participants: stats?.total_users || 0,
      party: party,
      top_contributors: topUsers.map(u => ({
        user: u.display_name,
        commands: u.total_commands,
        points: u.total_points,
      })),
      notes,
    };

    const result = db.db.prepare(`
      INSERT INTO hall_of_fame (game_id, game_name, completed_at, duration_ms, total_commands, total_participants, party, top_contributors, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.game_id, entry.game_name, entry.completed_at, entry.duration_ms,
      entry.total_commands, entry.total_participants,
      JSON.stringify(entry.party), JSON.stringify(entry.top_contributors),
      entry.notes
    );

    entry.id = result.lastInsertRowid;
    this.entries.unshift(entry);

    eventBus.emitSafe('halloffame:entry', entry);
    console.log(`[HallOfFame] NEW ENTRY: ${entry.game_name} completed! ${entry.total_participants} participants, ${entry.total_commands} commands`);

    return entry;
  }

  getEntries(limit = 20) {
    return this.entries.slice(0, limit);
  }

  getEntry(id) {
    return this.entries.find(e => e.id === id) || null;
  }

  getStats() {
    return {
      totalEntries: this.entries.length,
      gamesCompleted: [...new Set(this.entries.map(e => e.game_id))].length,
      latestEntry: this.entries[0] || null,
    };
  }

  stop() {}
}

module.exports = HallOfFame;
