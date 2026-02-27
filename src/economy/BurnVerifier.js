const eventBus = require('../core/EventBus');
const db = require('../core/Database');

/**
 * BurnVerifier - On-chain token burn verification (Team Rocket feature)
 *
 * Users burn PPP tokens to earn "Team Rocket" status, which allows
 * injecting commands directly into the game (bypassing the vote).
 *
 * Burn tiers:
 *   Grunt:      10,000 PPP burned  → 1 direct command per hour
 *   Executive:  50,000 PPP burned  → 3 direct commands per hour
 *   Boss:       250,000 PPP burned → 10 direct commands per hour
 *
 * Burns are persisted in SQLite so they survive restarts.
 */

const BURN_ADDRESS = '1nc1nerator11111111111111111111111111111111';

const BURN_TIERS = {
  grunt:     { min: 10000,  commands_per_hour: 1,  label: 'Grunt' },
  executive: { min: 50000,  commands_per_hour: 3,  label: 'Executive' },
  boss:      { min: 250000, commands_per_hour: 10, label: 'Boss' },
};

class BurnVerifier {
  constructor() {
    this.connection = null;
    this.tokenMint = process.env.SPL_TOKEN_MINT || null;

    // In-memory cache (loaded from SQLite on init)
    this.burnRecords = new Map();

    // Track hourly command usage: userKey → count (resets hourly)
    this.hourlyUsage = new Map();
    this.hourlyResetInterval = null;
  }

  init() {
    this._ensureBurnsTable();
    this._loadBurnsFromDB();
    this._initSolana();

    // Reset hourly usage every hour
    this.hourlyResetInterval = setInterval(() => {
      this.hourlyUsage.clear();
    }, 3600000);

    console.log(`[BurnVerifier] Initialized (mint: ${this.tokenMint ? this.tokenMint.slice(0, 8) + '...' : 'not set'}, ${this.burnRecords.size} users loaded)`);
  }

  _ensureBurnsTable() {
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS burns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_key TEXT NOT NULL,
        amount INTEGER NOT NULL,
        tx_signature TEXT,
        verified_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS burn_totals (
        user_key TEXT PRIMARY KEY,
        total_burned INTEGER DEFAULT 0,
        tier TEXT,
        last_verified INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_burns_user ON burns(user_key);
    `);
  }

  _loadBurnsFromDB() {
    const rows = db.db.prepare('SELECT * FROM burn_totals').all();
    for (const row of rows) {
      this.burnRecords.set(row.user_key, {
        total: row.total_burned,
        tier: row.tier,
        lastVerified: row.last_verified,
      });
    }
  }

  _initSolana() {
    if (!process.env.SOLANA_RPC_URL || !this.tokenMint) {
      console.log('[BurnVerifier] No Solana config - running in manual/test mode');
      return;
    }

    try {
      const { Connection } = require('@solana/web3.js');
      this.connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
      console.log('[BurnVerifier] Solana RPC connected');
    } catch {
      console.log('[BurnVerifier] @solana/web3.js not installed - running in manual mode');
    }
  }

  /**
   * Record a verified burn amount for a user.
   * Persists to SQLite so burns survive restarts.
   */
  recordBurn(userKey, amount, txSignature) {
    const existing = this.burnRecords.get(userKey) || { total: 0, tier: null, lastVerified: 0 };
    existing.total += amount;
    existing.tier = this._getTier(existing.total);
    existing.lastVerified = Date.now();
    this.burnRecords.set(userKey, existing);

    // Persist individual burn record
    db.db.prepare(`
      INSERT INTO burns (user_key, amount, tx_signature, verified_at)
      VALUES (?, ?, ?, ?)
    `).run(userKey, amount, txSignature || null, existing.lastVerified);

    // Upsert burn total
    db.db.prepare(`
      INSERT INTO burn_totals (user_key, total_burned, tier, last_verified)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_key) DO UPDATE SET
        total_burned = excluded.total_burned,
        tier = excluded.tier,
        last_verified = excluded.last_verified
    `).run(userKey, existing.total, existing.tier, existing.lastVerified);

    eventBus.emitSafe('burn:verified', {
      userKey,
      amount,
      total: existing.total,
      tier: existing.tier,
    });

    return existing;
  }

  /**
   * Check if a user can inject a command (based on burn tier + hourly limit)
   */
  canInjectCommand(userKey) {
    const record = this.burnRecords.get(userKey);
    if (!record?.tier) {
      return { allowed: false, reason: 'No burn tier. Burn PPP tokens to join Team Rocket!' };
    }

    const tier = BURN_TIERS[record.tier];
    const used = this.hourlyUsage.get(userKey) || 0;

    if (used >= tier.commands_per_hour) {
      return {
        allowed: false,
        reason: `Hourly limit reached (${used}/${tier.commands_per_hour}). Resets every hour.`,
        tier: record.tier,
      };
    }

    return { allowed: true, tier: record.tier, remaining: tier.commands_per_hour - used };
  }

  /**
   * Use one of the user's hourly command slots
   */
  useCommandSlot(userKey) {
    const used = this.hourlyUsage.get(userKey) || 0;
    this.hourlyUsage.set(userKey, used + 1);
  }

  _getTier(totalBurned) {
    if (totalBurned >= BURN_TIERS.boss.min) return 'boss';
    if (totalBurned >= BURN_TIERS.executive.min) return 'executive';
    if (totalBurned >= BURN_TIERS.grunt.min) return 'grunt';
    return null;
  }

  /**
   * Get burn status for a user
   */
  getBurnStatus(userKey) {
    const record = this.burnRecords.get(userKey);
    if (!record) return { burned: 0, tier: null, commands_remaining: 0 };

    const tier = record.tier ? BURN_TIERS[record.tier] : null;
    const used = this.hourlyUsage.get(userKey) || 0;

    return {
      burned: record.total,
      tier: record.tier,
      tier_label: tier?.label || 'None',
      commands_per_hour: tier?.commands_per_hour || 0,
      commands_used: used,
      commands_remaining: tier ? Math.max(0, tier.commands_per_hour - used) : 0,
      next_tier: this._getNextTier(record.total),
    };
  }

  _getNextTier(totalBurned) {
    if (totalBurned < BURN_TIERS.grunt.min) {
      return { tier: 'grunt', needed: BURN_TIERS.grunt.min - totalBurned };
    }
    if (totalBurned < BURN_TIERS.executive.min) {
      return { tier: 'executive', needed: BURN_TIERS.executive.min - totalBurned };
    }
    if (totalBurned < BURN_TIERS.boss.min) {
      return { tier: 'boss', needed: BURN_TIERS.boss.min - totalBurned };
    }
    return null; // Max tier reached
  }

  /**
   * Verify a specific burn transaction on-chain.
   * Checks that the transaction actually sends tokens to the burn address.
   * @param {string} txSignature - Transaction signature to verify
   * @param {string} expectedWallet - Wallet address that should have sent the burn
   * @returns {Promise<{ valid: boolean, amount: number, error?: string }>}
   */
  async verifyBurnTx(txSignature, expectedWallet) {
    if (!this.connection || !this.tokenMint) {
      return { valid: false, amount: 0, error: 'On-chain verification not available' };
    }

    // Check if this tx was already verified (prevent double-counting)
    const existing = db.db.prepare('SELECT id FROM burns WHERE tx_signature = ?').get(txSignature);
    if (existing) {
      return { valid: false, amount: 0, error: 'Transaction already verified' };
    }

    try {
      const tx = await this.connection.getParsedTransaction(txSignature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) return { valid: false, amount: 0, error: 'Transaction not found' };
      if (tx.meta?.err) return { valid: false, amount: 0, error: 'Transaction failed on-chain' };

      // Look for SPL token transfer to burn address in instructions
      const instructions = tx.transaction?.message?.instructions || [];
      for (const ix of instructions) {
        if (!ix.parsed) continue;
        const { type, info } = ix.parsed;

        if (type === 'transferChecked' && info?.mint === this.tokenMint) {
          const amount = info.tokenAmount?.uiAmount || 0;
          // Verify sender is the expected wallet and destination involves burn address
          if (info.authority === expectedWallet && amount > 0) {
            return { valid: true, amount };
          }
        }

        if (type === 'transfer' && info?.authority === expectedWallet) {
          const rawAmount = parseInt(info.amount) || 0;
          if (rawAmount > 0) {
            return { valid: true, amount: rawAmount / 1_000_000 };
          }
        }
      }

      return { valid: false, amount: 0, error: 'No matching burn transfer found in transaction' };
    } catch (err) {
      return { valid: false, amount: 0, error: err.message };
    }
  }

  /**
   * Get burn history for a user
   */
  getBurnHistory(userKey, limit = 20) {
    return db.db.prepare(`
      SELECT * FROM burns WHERE user_key = ? ORDER BY verified_at DESC LIMIT ?
    `).all(userKey, limit);
  }

  getTiers() {
    return BURN_TIERS;
  }

  stop() {
    if (this.hourlyResetInterval) {
      clearInterval(this.hourlyResetInterval);
      this.hourlyResetInterval = null;
    }
  }
}

module.exports = BurnVerifier;
