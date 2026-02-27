const eventBus = require('../core/EventBus');
const db = require('../core/Database');

/**
 * BountyBoard - Community-funded challenges with PPP pools
 *
 * Users create bounties like "Beat Brock without taking damage"
 * and fund them with PPP. Anyone who completes the challenge
 * claims the pool. Bounties can auto-resolve via game events.
 *
 * Types:
 *   - badge_challenge: "Beat gym X" → auto-resolves on badge_earned
 *   - no_faint: "Clear route without fainting" → fails on pokemon_fainted
 *   - speed_run: "Beat the game in under X commands" → tracked via command count
 *   - custom: Admin-created, manually resolved
 */

const BOUNTY_STATUS = {
  ACTIVE: 'active',
  CLAIMED: 'claimed',
  EXPIRED: 'expired',
  FAILED: 'failed',
};

class BountyBoard {
  constructor() {
    this.activeBounties = new Map();
  }

  init() {
    this._ensureTables();
    this._loadActive();
    this._setupEventListeners();
    console.log(`[Bounties] Board initialized (${this.activeBounties.size} active)`);
  }

  _ensureTables() {
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS bounties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        type TEXT DEFAULT 'custom',
        pool_amount INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        resolve_event TEXT,
        resolve_condition TEXT,
        created_by TEXT NOT NULL,
        claimed_by TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        resolved_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS bounty_contributions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bounty_id INTEGER NOT NULL,
        user_key TEXT NOT NULL,
        amount INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (bounty_id) REFERENCES bounties(id)
      );

      CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);
      CREATE INDEX IF NOT EXISTS idx_bounty_contrib ON bounty_contributions(bounty_id);
    `);
  }

  _loadActive() {
    const rows = db.db.prepare("SELECT * FROM bounties WHERE status = 'active'").all();
    for (const row of rows) {
      this.activeBounties.set(row.id, row);
    }
  }

  _setupEventListeners() {
    eventBus.on('game:badge_earned', (data) => {
      for (const [id, bounty] of this.activeBounties) {
        if (bounty.type === 'badge_challenge' && bounty.resolve_event === 'badge_earned') {
          const condition = bounty.resolve_condition ? JSON.parse(bounty.resolve_condition) : {};
          if (!condition.badge_number || condition.badge_number === data.badge_number) {
            this._autoClaim(id, 'community');
          }
        }
      }
    });

    eventBus.on('game:pokemon_fainted', () => {
      for (const [id, bounty] of this.activeBounties) {
        if (bounty.type === 'no_faint') {
          this.fail(id, 'A Pokemon fainted — bounty failed!');
        }
      }
    });
  }

  /**
   * Create a new bounty
   */
  create(title, description, type, initialPool, createdBy, resolveEvent = null, resolveCondition = null, expiresIn = null) {
    const now = Date.now();
    const expiresAt = expiresIn ? now + expiresIn : null;

    const result = db.db.prepare(`
      INSERT INTO bounties (title, description, type, pool_amount, resolve_event, resolve_condition, created_by, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, description, type, initialPool, resolveEvent, resolveCondition ? JSON.stringify(resolveCondition) : null, createdBy, now, expiresAt);

    const bounty = {
      id: result.lastInsertRowid,
      title, description, type,
      pool_amount: initialPool,
      status: BOUNTY_STATUS.ACTIVE,
      resolve_event: resolveEvent,
      resolve_condition: resolveCondition,
      created_by: createdBy,
      created_at: now,
      expires_at: expiresAt,
    };

    this.activeBounties.set(bounty.id, bounty);

    if (initialPool > 0) {
      db.db.prepare(
        'INSERT INTO bounty_contributions (bounty_id, user_key, amount, created_at) VALUES (?, ?, ?, ?)'
      ).run(bounty.id, createdBy, initialPool, now);
    }

    eventBus.emitSafe('bounty:created', bounty);
    return bounty;
  }

  /**
   * Add PPP to a bounty pool
   */
  contribute(bountyId, userKey, amount) {
    const bounty = this.activeBounties.get(bountyId);
    if (!bounty) return { success: false, message: 'Bounty not found' };
    if (bounty.status !== BOUNTY_STATUS.ACTIVE) return { success: false, message: 'Bounty not active' };
    if (amount <= 0) return { success: false, message: 'Amount must be positive' };

    db.db.prepare(
      'INSERT INTO bounty_contributions (bounty_id, user_key, amount, created_at) VALUES (?, ?, ?, ?)'
    ).run(bountyId, userKey, amount, Date.now());

    db.db.prepare('UPDATE bounties SET pool_amount = pool_amount + ? WHERE id = ?')
      .run(amount, bountyId);

    bounty.pool_amount += amount;
    return { success: true, message: `Added ${amount} PPP. Pool: ${bounty.pool_amount}` };
  }

  /**
   * Claim a bounty (manual claim by admin)
   */
  claim(bountyId, claimedBy) {
    return this._autoClaim(bountyId, claimedBy);
  }

  _autoClaim(bountyId, claimedBy) {
    const bounty = this.activeBounties.get(bountyId);
    if (!bounty) return { success: false, message: 'Not found' };

    bounty.status = BOUNTY_STATUS.CLAIMED;
    bounty.claimed_by = claimedBy;

    db.db.prepare(
      "UPDATE bounties SET status = 'claimed', claimed_by = ?, resolved_at = ? WHERE id = ?"
    ).run(claimedBy, Date.now(), bountyId);

    this.activeBounties.delete(bountyId);

    eventBus.emitSafe('bounty:claimed', {
      id: bountyId,
      title: bounty.title,
      pool: bounty.pool_amount,
      claimedBy,
    });

    return { success: true, pool: bounty.pool_amount, claimedBy };
  }

  fail(bountyId, reason) {
    const bounty = this.activeBounties.get(bountyId);
    if (!bounty) return;

    bounty.status = BOUNTY_STATUS.FAILED;
    db.db.prepare("UPDATE bounties SET status = 'failed', resolved_at = ? WHERE id = ?")
      .run(Date.now(), bountyId);

    this.activeBounties.delete(bountyId);
    eventBus.emitSafe('bounty:failed', { id: bountyId, title: bounty.title, reason });
  }

  getActive() {
    return Array.from(this.activeBounties.values());
  }

  getBounty(id) {
    const bounty = this.activeBounties.get(id) ||
      db.db.prepare('SELECT * FROM bounties WHERE id = ?').get(id);
    if (!bounty) return null;

    const contributions = db.db.prepare(
      'SELECT user_key, SUM(amount) as total FROM bounty_contributions WHERE bounty_id = ? GROUP BY user_key'
    ).all(id);

    return { ...bounty, contributions };
  }

  getHistory(limit = 20) {
    return db.db.prepare(
      'SELECT * FROM bounties ORDER BY created_at DESC LIMIT ?'
    ).all(limit);
  }

  stop() {}
}

module.exports = BountyBoard;
