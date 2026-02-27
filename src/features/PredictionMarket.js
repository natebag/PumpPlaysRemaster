const eventBus = require('../core/EventBus');
const db = require('../core/Database');

/**
 * PredictionMarket - Bet PPP on game outcomes
 *
 * Auto-resolves predictions via game state events from RAM reading:
 *   - "Will we beat the gym leader?" → resolved on badge_earned event
 *   - "Will a Pokemon faint this hour?" → resolved on pokemon_fainted event
 *   - "Total whiteouts today?" → over/under on whiteout count
 *
 * Custom predictions can be created and resolved manually by admins.
 */

const PREDICTION_STATUS = {
  OPEN: 'open',         // Accepting bets
  LOCKED: 'locked',     // No more bets, awaiting outcome
  RESOLVED: 'resolved', // Outcome determined, payouts calculated
  CANCELLED: 'cancelled',
};

class PredictionMarket {
  constructor() {
    this.activePredictions = new Map(); // id → prediction
  }

  init() {
    this._ensureTables();
    this._loadActive();
    this._setupAutoResolvers();
    console.log(`[Predictions] Market initialized (${this.activePredictions.size} active)`);
  }

  _ensureTables() {
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        options TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        winning_option TEXT,
        auto_resolve_event TEXT,
        created_by TEXT DEFAULT 'system',
        created_at INTEGER NOT NULL,
        locked_at INTEGER,
        resolved_at INTEGER,
        total_pool INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS prediction_bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prediction_id INTEGER NOT NULL,
        user_key TEXT NOT NULL,
        option_key TEXT NOT NULL,
        amount INTEGER NOT NULL,
        payout INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE(prediction_id, user_key),
        FOREIGN KEY (prediction_id) REFERENCES predictions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_bets_prediction ON prediction_bets(prediction_id);
      CREATE INDEX IF NOT EXISTS idx_bets_user ON prediction_bets(user_key);
    `);
  }

  _loadActive() {
    const rows = db.db.prepare(
      "SELECT * FROM predictions WHERE status IN ('open', 'locked')"
    ).all();
    for (const row of rows) {
      row.options = JSON.parse(row.options);
      this.activePredictions.set(row.id, row);
    }
  }

  _setupAutoResolvers() {
    // Auto-resolve badge predictions
    eventBus.on('game:badge_earned', (data) => {
      for (const [id, pred] of this.activePredictions) {
        if (pred.auto_resolve_event === 'badge_earned' && pred.status === 'locked') {
          this.resolve(id, 'yes');
        }
      }
    });

    // Auto-resolve faint predictions
    eventBus.on('game:pokemon_fainted', () => {
      for (const [id, pred] of this.activePredictions) {
        if (pred.auto_resolve_event === 'pokemon_fainted' && pred.status === 'locked') {
          this.resolve(id, 'yes');
        }
      }
    });

    // Auto-resolve whiteout predictions
    eventBus.on('game:whiteout', () => {
      for (const [id, pred] of this.activePredictions) {
        if (pred.auto_resolve_event === 'whiteout' && pred.status === 'locked') {
          this.resolve(id, 'yes');
        }
      }
    });
  }

  /**
   * Create a new prediction
   */
  create(title, options, autoResolveEvent = null, createdBy = 'system') {
    // options = { yes: "Badge earned", no: "No badge" }
    const now = Date.now();
    const result = db.db.prepare(`
      INSERT INTO predictions (title, options, auto_resolve_event, created_by, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(title, JSON.stringify(options), autoResolveEvent, createdBy, now);

    const prediction = {
      id: result.lastInsertRowid,
      title,
      options,
      status: PREDICTION_STATUS.OPEN,
      auto_resolve_event: autoResolveEvent,
      created_by: createdBy,
      created_at: now,
      total_pool: 0,
    };

    this.activePredictions.set(prediction.id, prediction);
    eventBus.emitSafe('prediction:created', prediction);
    return prediction;
  }

  /**
   * Place a bet on a prediction
   */
  bet(predictionId, userKey, optionKey, amount) {
    const prediction = this.activePredictions.get(predictionId);
    if (!prediction) return { success: false, message: 'Prediction not found' };
    if (prediction.status !== PREDICTION_STATUS.OPEN) {
      return { success: false, message: 'Prediction is no longer accepting bets' };
    }
    if (!prediction.options[optionKey]) {
      return { success: false, message: `Invalid option. Choose: ${Object.keys(prediction.options).join(', ')}` };
    }
    if (amount <= 0) return { success: false, message: 'Amount must be positive' };

    try {
      db.db.prepare(`
        INSERT INTO prediction_bets (prediction_id, user_key, option_key, amount, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(predictionId, userKey, optionKey, amount, Date.now());

      db.db.prepare('UPDATE predictions SET total_pool = total_pool + ? WHERE id = ?')
        .run(amount, predictionId);

      prediction.total_pool += amount;

      eventBus.emitSafe('prediction:bet', { predictionId, userKey, optionKey, amount });
      return { success: true, message: `Bet ${amount} PPP on "${prediction.options[optionKey]}"` };
    } catch {
      return { success: false, message: 'Already placed a bet on this prediction' };
    }
  }

  /**
   * Lock a prediction (no more bets)
   */
  lock(predictionId) {
    const prediction = this.activePredictions.get(predictionId);
    if (!prediction) return false;

    prediction.status = PREDICTION_STATUS.LOCKED;
    db.db.prepare("UPDATE predictions SET status = 'locked', locked_at = ? WHERE id = ?")
      .run(Date.now(), predictionId);

    eventBus.emitSafe('prediction:locked', { id: predictionId, title: prediction.title });
    return true;
  }

  /**
   * Resolve a prediction and calculate payouts
   */
  resolve(predictionId, winningOption) {
    const prediction = this.activePredictions.get(predictionId);
    if (!prediction) return { success: false, message: 'Not found' };

    prediction.status = PREDICTION_STATUS.RESOLVED;
    prediction.winning_option = winningOption;

    // Get all bets
    const bets = db.db.prepare(
      'SELECT * FROM prediction_bets WHERE prediction_id = ?'
    ).all(predictionId);

    // Calculate winning pool and losing pool
    let winningPool = 0;
    let losingPool = 0;
    for (const bet of bets) {
      if (bet.option_key === winningOption) {
        winningPool += bet.amount;
      } else {
        losingPool += bet.amount;
      }
    }

    // Distribute payouts proportionally
    const payouts = [];
    const updatePayout = db.db.prepare(
      'UPDATE prediction_bets SET payout = ? WHERE id = ?'
    );

    const updateAll = db.db.transaction(() => {
      for (const bet of bets) {
        if (bet.option_key === winningOption && winningPool > 0) {
          // Winner gets their bet back + proportional share of losing pool
          const share = bet.amount / winningPool;
          const payout = bet.amount + Math.floor(losingPool * share);
          updatePayout.run(payout, bet.id);
          payouts.push({ userKey: bet.user_key, amount: bet.amount, payout });
        } else {
          updatePayout.run(0, bet.id);
        }
      }

      db.db.prepare(
        "UPDATE predictions SET status = 'resolved', winning_option = ?, resolved_at = ? WHERE id = ?"
      ).run(winningOption, Date.now(), predictionId);
    });

    updateAll();
    this.activePredictions.delete(predictionId);

    eventBus.emitSafe('prediction:resolved', {
      id: predictionId,
      title: prediction.title,
      winningOption,
      payouts,
    });

    return { success: true, payouts, totalPool: prediction.total_pool };
  }

  getActive() {
    return Array.from(this.activePredictions.values());
  }

  getPrediction(id) {
    const pred = this.activePredictions.get(id);
    if (!pred) {
      const row = db.db.prepare('SELECT * FROM predictions WHERE id = ?').get(id);
      if (row) row.options = JSON.parse(row.options);
      return row;
    }
    const bets = db.db.prepare(
      'SELECT option_key, COUNT(*) as count, SUM(amount) as total FROM prediction_bets WHERE prediction_id = ? GROUP BY option_key'
    ).all(id);
    return { ...pred, bets };
  }

  stop() {}
}

module.exports = PredictionMarket;
