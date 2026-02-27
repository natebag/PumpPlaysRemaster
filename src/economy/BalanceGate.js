const eventBus = require('../core/EventBus');
const db = require('../core/Database');

/**
 * BalanceGate - Token balance checking for Champions DAO access
 *
 * Users holding enough PPP tokens get "Champions" status with perks:
 *   - Free direct command injection (no burn required)
 *   - Higher vote weight
 *   - Special overlay flair
 *
 * Tiers:
 *   Champion:       1,000,000 PPP → 1 free command per hour, 2x vote weight
 *   Elite Champion: 5,000,000 PPP → 3 free commands per hour, 3x vote weight
 *   Legendary:     25,000,000 PPP → unlimited commands, 5x vote weight
 *
 * Balance checks are cached (5 min TTL) and backed by on-chain Solana lookups.
 * Manual balances are persisted in SQLite for testing and offline use.
 */

const CHAMPION_TIERS = {
  champion:      { min: 1000000,  commands_per_hour: 1,  vote_weight: 2, label: 'Champion' },
  elite:         { min: 5000000,  commands_per_hour: 3,  vote_weight: 3, label: 'Elite Champion' },
  legendary:     { min: 25000000, commands_per_hour: -1, vote_weight: 5, label: 'Legendary' }, // -1 = unlimited
};

class BalanceGate {
  constructor() {
    this.connection = null;
    this.tokenMint = process.env.SPL_TOKEN_MINT || null;

    // Cached balances: walletAddress → { balance, tier, lastChecked }
    this.balanceCache = new Map();
    this.cacheTtlMs = 300000; // 5 minute cache

    // Track hourly command usage: userKey → count
    this.hourlyUsage = new Map();
    this.hourlyResetInterval = null;
  }

  init() {
    this._ensureTable();
    this._loadFromDB();
    this._initSolana();

    this.hourlyResetInterval = setInterval(() => {
      this.hourlyUsage.clear();
    }, 3600000);

    console.log(`[BalanceGate] Initialized (mint: ${this.tokenMint ? this.tokenMint.slice(0, 8) + '...' : 'not set'}, ${this.balanceCache.size} cached)`);
  }

  _ensureTable() {
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS champion_balances (
        wallet_address TEXT PRIMARY KEY,
        balance INTEGER DEFAULT 0,
        tier TEXT,
        last_checked INTEGER NOT NULL
      );
    `);
  }

  _loadFromDB() {
    const rows = db.db.prepare('SELECT * FROM champion_balances').all();
    for (const row of rows) {
      this.balanceCache.set(row.wallet_address, {
        balance: row.balance,
        tier: row.tier,
        lastChecked: row.last_checked,
      });
    }
  }

  _persistBalance(walletAddress, balance, tier) {
    db.db.prepare(`
      INSERT INTO champion_balances (wallet_address, balance, tier, last_checked)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(wallet_address) DO UPDATE SET
        balance = excluded.balance,
        tier = excluded.tier,
        last_checked = excluded.last_checked
    `).run(walletAddress, balance, tier, Date.now());
  }

  _initSolana() {
    if (!process.env.SOLANA_RPC_URL || !this.tokenMint) {
      console.log('[BalanceGate] No Solana config - running in manual mode');
      return;
    }

    try {
      const { Connection } = require('@solana/web3.js');
      this.connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
      console.log('[BalanceGate] Solana RPC connected');
    } catch {
      console.log('[BalanceGate] @solana/web3.js not installed - running in manual mode');
    }
  }

  /**
   * Check token balance for a wallet address (on-chain with cache)
   */
  async checkBalance(walletAddress) {
    // Check cache first
    const cached = this.balanceCache.get(walletAddress);
    if (cached && (Date.now() - cached.lastChecked) < this.cacheTtlMs) {
      return cached;
    }

    if (!this.connection || !this.tokenMint) {
      return this.balanceCache.get(walletAddress) || { balance: 0, tier: null, lastChecked: 0 };
    }

    try {
      const { PublicKey } = require('@solana/web3.js');
      const walletPubkey = new PublicKey(walletAddress);
      const mintPubkey = new PublicKey(this.tokenMint);

      const accounts = await this.connection.getParsedTokenAccountsByOwner(
        walletPubkey,
        { mint: mintPubkey }
      );

      let balance = 0;
      if (accounts.value.length > 0) {
        balance = accounts.value[0].account.data.parsed.info.tokenAmount.uiAmount || 0;
      }

      const tier = this._getTier(balance);
      const result = {
        balance,
        tier,
        lastChecked: Date.now(),
      };

      this.balanceCache.set(walletAddress, result);
      this._persistBalance(walletAddress, balance, tier);
      return result;
    } catch (err) {
      console.error(`[BalanceGate] Balance check failed for ${walletAddress}: ${err.message}`);
      return this.balanceCache.get(walletAddress) || { balance: 0, tier: null, lastChecked: 0 };
    }
  }

  /**
   * Manually set a balance (for testing or manual verification)
   */
  setBalance(walletAddress, balance) {
    const tier = this._getTier(balance);
    const result = {
      balance,
      tier,
      lastChecked: Date.now(),
    };
    this.balanceCache.set(walletAddress, result);
    this._persistBalance(walletAddress, balance, tier);
    return result;
  }

  /**
   * Check if a user can inject a champion command
   */
  canInjectCommand(walletAddress, userKey) {
    const cached = this.balanceCache.get(walletAddress);
    if (!cached?.tier) {
      return { allowed: false, reason: 'Not a Champion. Hold PPP tokens for access!' };
    }

    const tier = CHAMPION_TIERS[cached.tier];
    if (tier.commands_per_hour === -1) {
      return { allowed: true, tier: cached.tier, remaining: -1 }; // Unlimited
    }

    const used = this.hourlyUsage.get(userKey) || 0;
    if (used >= tier.commands_per_hour) {
      return {
        allowed: false,
        reason: `Hourly limit reached (${used}/${tier.commands_per_hour})`,
        tier: cached.tier,
      };
    }

    return { allowed: true, tier: cached.tier, remaining: tier.commands_per_hour - used };
  }

  /**
   * Use one of the user's hourly champion command slots
   */
  useCommandSlot(userKey) {
    const used = this.hourlyUsage.get(userKey) || 0;
    this.hourlyUsage.set(userKey, used + 1);
  }

  /**
   * Get the vote weight multiplier for a wallet balance
   */
  getVoteWeight(walletAddress) {
    const cached = this.balanceCache.get(walletAddress);
    if (!cached?.tier) return 1;
    return CHAMPION_TIERS[cached.tier]?.vote_weight || 1;
  }

  _getTier(balance) {
    if (balance >= CHAMPION_TIERS.legendary.min) return 'legendary';
    if (balance >= CHAMPION_TIERS.elite.min) return 'elite';
    if (balance >= CHAMPION_TIERS.champion.min) return 'champion';
    return null;
  }

  getTiers() {
    return CHAMPION_TIERS;
  }

  getStats() {
    const tiers = { champion: 0, elite: 0, legendary: 0 };
    for (const cached of this.balanceCache.values()) {
      if (cached.tier) tiers[cached.tier]++;
    }
    return { cachedWallets: this.balanceCache.size, tiers };
  }

  stop() {
    if (this.hourlyResetInterval) {
      clearInterval(this.hourlyResetInterval);
      this.hourlyResetInterval = null;
    }
  }
}

module.exports = BalanceGate;
