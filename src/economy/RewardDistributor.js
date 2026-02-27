const eventBus = require('../core/EventBus');
const db = require('../core/Database');

/**
 * RewardDistributor - Hourly PPP token payouts based on leaderboard rank
 *
 * Distribution tiers (percentage of hourly token pool):
 *   Rank 1:    40%
 *   Rank 2:    25%
 *   Rank 3:    15%
 *   Rank 4-10: 15% (split evenly)
 *   Rank 11+:  5%  (split evenly among active participants)
 *
 * Rewards accumulate as "pending" and are distributed on-chain
 * when Solana RPC + distributor wallet are configured.
 * Without SPL_TOKEN_MINT, runs in simulation mode (fake tx signatures).
 */
class RewardDistributor {
  constructor(walletManager) {
    this.walletManager = walletManager;
    this.hourlyInterval = null;

    // Token pool config
    this.totalPool = parseInt(process.env.TEST_TOKEN_POOL) || 2000000;
    this.distributionDays = parseInt(process.env.DISTRIBUTION_DAYS) || 14;
    this.hoursTotal = this.distributionDays * 24;
    this.tokensPerHour = Math.floor(this.totalPool / this.hoursTotal);

    // Distribution tiers
    this.tiers = {
      rank1: 0.40,
      rank2: 0.25,
      rank3: 0.15,
      ranks4to10: 0.15,
      participation: 0.05,
    };

    // Pending rewards (accumulated until on-chain distribution)
    this.totalDistributed = 0;

    // Solana on-chain distribution
    this.connection = null;
    this.wallet = null;
    this.tokenMint = process.env.SPL_TOKEN_MINT || null;
    this.isDistributing = false;
  }

  init() {
    this._ensureRewardsTable();
    this._initSolana();

    // Run distribution every hour
    this.hourlyInterval = setInterval(() => {
      this.distributeHourly();
    }, 3600000); // 1 hour

    console.log(`[Rewards] Distributor initialized (${this.tokensPerHour} PPP/hour)`);
  }

  /**
   * Initialize Solana connection and distributor wallet.
   * Gracefully degrades if dependencies or env vars are missing.
   */
  _initSolana() {
    if (!process.env.SOLANA_RPC_URL) {
      console.log('[Rewards] No SOLANA_RPC_URL - on-chain distribution disabled');
      return;
    }

    try {
      const { Connection, Keypair } = require('@solana/web3.js');
      this.connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');

      if (process.env.DISTRIBUTOR_PRIVATE_KEY) {
        try {
          const privateKeyArray = JSON.parse(process.env.DISTRIBUTOR_PRIVATE_KEY);
          this.wallet = Keypair.fromSecretKey(new Uint8Array(privateKeyArray));
          console.log(`[Rewards] Distributor wallet: ${this.wallet.publicKey.toString()}`);
        } catch (err) {
          console.error('[Rewards] Invalid DISTRIBUTOR_PRIVATE_KEY:', err.message);
        }
      } else {
        console.log('[Rewards] No DISTRIBUTOR_PRIVATE_KEY - simulation mode');
      }

      if (this.tokenMint) {
        console.log(`[Rewards] Token mint: ${this.tokenMint}`);
      } else {
        console.log('[Rewards] No SPL_TOKEN_MINT - will simulate transfers');
      }
    } catch (err) {
      console.log('[Rewards] @solana/web3.js not available - on-chain distribution disabled');
    }
  }

  _ensureRewardsTable() {
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS pending_rewards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        wallet_address TEXT,
        amount INTEGER NOT NULL,
        rank INTEGER NOT NULL,
        commands_count INTEGER DEFAULT 0,
        hour_key TEXT NOT NULL,
        distributed INTEGER DEFAULT 0,
        distributed_at INTEGER,
        tx_signature TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rewards_user ON pending_rewards(user_key);
      CREATE INDEX IF NOT EXISTS idx_rewards_distributed ON pending_rewards(distributed);
      CREATE INDEX IF NOT EXISTS idx_rewards_hour ON pending_rewards(hour_key);
    `);
  }

  /**
   * Calculate and record hourly rewards based on leaderboard
   */
  distributeHourly() {
    const hourKey = new Date().toISOString().slice(0, 13);

    // Get hourly leaderboard (users active in the last hour)
    const leaderboard = db.getHourlyLeaderboard(50);
    if (leaderboard.length === 0) {
      console.log('[Rewards] No active users this hour, skipping distribution');
      return { distributed: 0, users: 0 };
    }

    const rewards = this._calculateRewards(leaderboard);
    const now = Date.now();

    const insert = db.db.prepare(`
      INSERT INTO pending_rewards (user_key, display_name, wallet_address, amount, rank, commands_count, hour_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.db.transaction((rewards) => {
      for (const reward of rewards) {
        insert.run(
          reward.userKey,
          reward.displayName,
          reward.walletAddress,
          reward.amount,
          reward.rank,
          reward.commands,
          hourKey,
          now
        );
      }
    });

    insertMany(rewards);

    const totalAmount = rewards.reduce((sum, r) => sum + r.amount, 0);
    this.totalDistributed += totalAmount;

    console.log(`[Rewards] Distributed ${totalAmount} PPP to ${rewards.length} users for ${hourKey}`);
    eventBus.emitSafe('rewards:distributed', { hourKey, totalAmount, users: rewards.length });

    // Trigger on-chain distribution if Solana is configured
    if (this.connection) {
      this.distributePending().catch(err => {
        console.error('[Rewards] On-chain distribution error:', err.message);
      });
    }

    return { distributed: totalAmount, users: rewards.length };
  }

  _calculateRewards(leaderboard) {
    const rewards = [];
    const pool = this.tokensPerHour;

    for (let i = 0; i < leaderboard.length; i++) {
      const user = leaderboard[i];
      const rank = i + 1;
      let amount = 0;

      if (rank === 1) {
        amount = Math.floor(pool * this.tiers.rank1);
      } else if (rank === 2) {
        amount = Math.floor(pool * this.tiers.rank2);
      } else if (rank === 3) {
        amount = Math.floor(pool * this.tiers.rank3);
      } else if (rank <= 10) {
        amount = Math.floor(pool * this.tiers.ranks4to10 / 7);
      } else {
        const participantCount = Math.max(1, leaderboard.length - 10);
        amount = Math.floor(pool * this.tiers.participation / participantCount);
      }

      if (amount <= 0) continue;

      const wallet = this.walletManager.getAddress(user.user_key);
      const userStats = db.getUserStats(user.user_key);

      rewards.push({
        userKey: user.user_key,
        displayName: userStats?.display_name || user.user_key,
        walletAddress: wallet,
        amount,
        rank,
        commands: user.commands,
      });
    }

    return rewards;
  }

  // ══════════════════════════════════════════════════════════════
  // ON-CHAIN DISTRIBUTION
  // ══════════════════════════════════════════════════════════════

  /**
   * Send SPL tokens to a wallet address.
   * @param {string} toAddress - Recipient Solana address
   * @param {number} amount - Token amount (human-readable, multiplied by 10^6 internally)
   * @returns {Promise<string>} Transaction signature
   */
  async sendTokens(toAddress, amount) {
    if (!this.wallet) {
      throw new Error('No distributor wallet configured');
    }

    // Simulation mode: no token mint configured
    if (!this.tokenMint) {
      console.log(`[Rewards] [SIM] Would send ${amount} tokens to ${toAddress.slice(0, 8)}...`);
      return `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    const { PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
    const {
      getOrCreateAssociatedTokenAccount,
      createTransferInstruction,
      TOKEN_PROGRAM_ID,
    } = require('@solana/spl-token');

    const toPublicKey = new PublicKey(toAddress);
    const mintPublicKey = new PublicKey(this.tokenMint);

    // Get or create Associated Token Accounts
    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.wallet,
      mintPublicKey,
      this.wallet.publicKey
    );

    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.wallet,       // payer for ATA creation if needed
      mintPublicKey,
      toPublicKey
    );

    // Build transfer instruction (6 decimal token)
    const transferIx = createTransferInstruction(
      fromTokenAccount.address,
      toTokenAccount.address,
      this.wallet.publicKey,
      amount * 1_000_000,
      [],
      TOKEN_PROGRAM_ID
    );

    const tx = new Transaction().add(transferIx);
    const signature = await sendAndConfirmTransaction(
      this.connection,
      tx,
      [this.wallet]
    );

    console.log(`[Rewards] Sent ${amount} tokens to ${toAddress.slice(0, 8)}... (tx: ${signature})`);
    return signature;
  }

  /**
   * Backfill wallet addresses on pending rewards for users who registered after earning.
   */
  _backfillWalletAddresses() {
    const result = db.db.prepare(`
      UPDATE pending_rewards
      SET wallet_address = (SELECT wallet_address FROM wallets WHERE wallets.user_key = pending_rewards.user_key)
      WHERE distributed = 0
        AND (wallet_address IS NULL OR wallet_address = '')
        AND user_key IN (SELECT user_key FROM wallets WHERE wallet_address IS NOT NULL AND wallet_address != '')
    `).run();
    if (result.changes > 0) {
      console.log(`[Rewards] Backfilled wallet addresses on ${result.changes} pending rewards`);
    }
  }

  /**
   * Distribute all pending (undistributed) rewards on-chain.
   * Groups rewards by user to minimize transactions.
   * @returns {Promise<{ sent: number, failed: number, skipped: number }>}
   */
  async distributePending() {
    if (this.isDistributing) {
      console.log('[Rewards] Distribution already in progress, skipping');
      return { sent: 0, failed: 0, skipped: 0 };
    }

    if (!this.connection) {
      console.log('[Rewards] No Solana connection - skipping on-chain distribution');
      return { sent: 0, failed: 0, skipped: 0 };
    }

    this.isDistributing = true;
    let sent = 0, failed = 0, skipped = 0;

    try {
      // Backfill wallet addresses for users who registered after earning
      this._backfillWalletAddresses();

      // Query undistributed rewards grouped by user
      const pendingUsers = db.db.prepare(`
        SELECT user_key, wallet_address, SUM(amount) as total_amount, GROUP_CONCAT(id) as reward_ids
        FROM pending_rewards
        WHERE distributed = 0 AND wallet_address IS NOT NULL AND wallet_address != ''
        GROUP BY user_key
      `).all();

      if (pendingUsers.length === 0) {
        console.log('[Rewards] No pending rewards with wallets to distribute');
        return { sent: 0, failed: 0, skipped: 0 };
      }

      // Count users without wallets
      const noWalletCount = db.db.prepare(`
        SELECT COUNT(DISTINCT user_key) as count
        FROM pending_rewards
        WHERE distributed = 0 AND (wallet_address IS NULL OR wallet_address = '')
      `).get();
      if (noWalletCount.count > 0) {
        skipped = noWalletCount.count;
        console.log(`[Rewards] ${skipped} users have pending rewards but no wallet registered`);
      }

      console.log(`[Rewards] Distributing to ${pendingUsers.length} users...`);

      const updateStmt = db.db.prepare(`
        UPDATE pending_rewards
        SET distributed = 1, distributed_at = ?, tx_signature = ?
        WHERE id = ?
      `);

      for (const user of pendingUsers) {
        try {
          const signature = await this.sendTokens(user.wallet_address, user.total_amount);

          if (signature) {
            // Mark all this user's pending reward rows as distributed
            const now = Date.now();
            const ids = user.reward_ids.split(',').map(Number);
            const markDistributed = db.db.transaction((ids) => {
              for (const id of ids) {
                updateStmt.run(now, signature, id);
              }
            });
            markDistributed(ids);

            sent++;
            console.log(`[Rewards] Distributed ${user.total_amount} PPP to ${user.user_key} (${ids.length} rewards)`);
          }
        } catch (err) {
          failed++;
          console.error(`[Rewards] Failed to distribute to ${user.user_key}: ${err.message}`);
        }
      }

      console.log(`[Rewards] Distribution complete: ${sent} sent, ${failed} failed, ${skipped} skipped (no wallet)`);
      eventBus.emitSafe('rewards:onchain_distributed', { sent, failed, skipped });

    } finally {
      this.isDistributing = false;
    }

    return { sent, failed, skipped };
  }

  // ══════════════════════════════════════════════════════════════
  // QUERIES
  // ══════════════════════════════════════════════════════════════

  /**
   * Get pending (undistributed) rewards for a user
   */
  getPendingRewards(userKey) {
    return db.db.prepare(`
      SELECT * FROM pending_rewards
      WHERE user_key = ? AND distributed = 0
      ORDER BY created_at DESC
    `).all(userKey);
  }

  /**
   * Get total pending reward amount for a user
   */
  getPendingTotal(userKey) {
    const result = db.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM pending_rewards
      WHERE user_key = ? AND distributed = 0
    `).get(userKey);
    return result.total;
  }

  /**
   * Get reward history for a user
   */
  getRewardHistory(userKey, limit = 20) {
    return db.db.prepare(`
      SELECT * FROM pending_rewards
      WHERE user_key = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userKey, limit);
  }

  /**
   * Get overall reward stats
   */
  getStats() {
    const pending = db.db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
      FROM pending_rewards WHERE distributed = 0
    `).get();

    const distributed = db.db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
      FROM pending_rewards WHERE distributed = 1
    `).get();

    return {
      tokensPerHour: this.tokensPerHour,
      totalPool: this.totalPool,
      totalDistributed: this.totalDistributed,
      pending: pending,
      distributed: distributed,
      solana: {
        connected: !!this.connection,
        wallet: this.wallet ? this.wallet.publicKey.toString() : null,
        tokenMint: this.tokenMint,
        simulation: this.connection && !this.tokenMint,
      },
    };
  }

  stop() {
    if (this.hourlyInterval) {
      clearInterval(this.hourlyInterval);
      this.hourlyInterval = null;
    }
  }
}

module.exports = RewardDistributor;
