const db = require('../core/Database');
const eventBus = require('../core/EventBus');

/**
 * WalletManager - Solana wallet registration and validation
 *
 * Users register their Solana wallet address via chat command:
 *   !wallet <address>  or  /wallet <address>
 *
 * Once registered and locked, the wallet cannot be changed.
 * This prevents impersonation and enables PPP token rewards.
 */
class WalletManager {
  constructor() {
    this.walletCache = new Map(); // userKey → wallet info
  }

  init() {
    this._ensureWalletTable();
    this._loadCache();
    console.log(`[Wallet] Manager initialized (${this.walletCache.size} registered wallets)`);
  }

  _ensureWalletTable() {
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS wallets (
        user_key TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        registered_at INTEGER NOT NULL,
        locked INTEGER DEFAULT 0,
        verified INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets(wallet_address);
    `);
  }

  _loadCache() {
    const rows = db.db.prepare('SELECT * FROM wallets').all();
    for (const row of rows) {
      this.walletCache.set(row.user_key, row);
    }
  }

  /**
   * Register a wallet address for a user
   * @returns {{ success: boolean, message: string }}
   */
  register(userKey, displayName, walletAddress) {
    // Validate address format
    if (!this.isValidSolanaAddress(walletAddress)) {
      return { success: false, message: 'Invalid Solana address format' };
    }

    // Check if user already has a locked wallet
    const existing = this.walletCache.get(userKey);
    if (existing?.locked) {
      return { success: false, message: 'Wallet already locked. Cannot change.' };
    }

    // Check if this address is already registered to someone else
    for (const [key, info] of this.walletCache) {
      if (key !== userKey && info.wallet_address === walletAddress) {
        return { success: false, message: 'This address is already registered to another user' };
      }
    }

    const now = Date.now();
    db.db.prepare(`
      INSERT INTO wallets (user_key, display_name, wallet_address, registered_at, locked, verified)
      VALUES (?, ?, ?, ?, 0, 0)
      ON CONFLICT(user_key) DO UPDATE SET
        wallet_address = excluded.wallet_address,
        display_name = excluded.display_name
    `).run(userKey, displayName, walletAddress, now);

    // Also update the users table wallet_address
    db.db.prepare('UPDATE users SET wallet_address = ? WHERE user_key = ?')
      .run(walletAddress, userKey);

    const walletInfo = {
      user_key: userKey,
      display_name: displayName,
      wallet_address: walletAddress,
      registered_at: now,
      locked: 0,
      verified: 0,
    };
    this.walletCache.set(userKey, walletInfo);

    eventBus.emitSafe('wallet:registered', { userKey, displayName, walletAddress });
    return { success: true, message: `Wallet registered: ${walletAddress.slice(0, 8)}...${walletAddress.slice(-4)}` };
  }

  /**
   * Lock a wallet so it can't be changed (one-way operation)
   */
  lockWallet(userKey) {
    const wallet = this.walletCache.get(userKey);
    if (!wallet) return { success: false, message: 'No wallet registered' };
    if (wallet.locked) return { success: false, message: 'Already locked' };

    db.db.prepare('UPDATE wallets SET locked = 1 WHERE user_key = ?').run(userKey);
    wallet.locked = 1;
    return { success: true, message: 'Wallet locked permanently' };
  }

  /**
   * Validate a Solana address format (base58, 32-44 chars)
   */
  isValidSolanaAddress(address) {
    if (!address || typeof address !== 'string') return false;
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  }

  /**
   * Get wallet info for a user
   */
  getWallet(userKey) {
    return this.walletCache.get(userKey) || null;
  }

  /**
   * Get wallet address for a user (or null)
   */
  getAddress(userKey) {
    return this.walletCache.get(userKey)?.wallet_address || null;
  }

  /**
   * Get all registered wallets
   */
  getAllWallets() {
    return Array.from(this.walletCache.values());
  }

  /**
   * Get users with registered wallets for reward distribution
   */
  getRewardableUsers() {
    return Array.from(this.walletCache.values())
      .filter(w => w.wallet_address && w.wallet_address.length > 0);
  }

  getStats() {
    return {
      total: this.walletCache.size,
      locked: Array.from(this.walletCache.values()).filter(w => w.locked).length,
      verified: Array.from(this.walletCache.values()).filter(w => w.verified).length,
    };
  }
}

module.exports = WalletManager;
