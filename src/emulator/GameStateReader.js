const eventBus = require('../core/EventBus');
const config = require('../core/ConfigManager');

/**
 * GameStateReader - Processes RAM data from emulator adapters
 *
 * Receives raw memory state from BizHawk Lua (via POST /api/emulator/state),
 * interprets it based on the active game's memory_map config, and emits
 * game events (party changes, badge earned, etc.)
 *
 * This is OPTIONAL for MVP - overlay works without it. Only enables:
 * - Party display on overlay
 * - Badge tracking
 * - Auto-detection of key game moments
 */
class GameStateReader {
  constructor() {
    this.lastState = null;
    this.stateHistory = [];
    this.maxHistory = 50;
    this.enabled = false;
  }

  init() {
    if (!config.isFeatureEnabled('ramEvents')) {
      console.log('[GameState] RAM events disabled (ENABLE_RAM_EVENTS=false)');
      return;
    }

    this.enabled = true;

    // Listen for raw state from emulator adapter
    eventBus.on('emulator:raw_state', (rawState) => {
      this._processState(rawState);
    });

    // Reset state when game changes
    eventBus.on('game:changed', () => {
      this.lastState = null;
      this.stateHistory = [];
    });

    console.log('[GameState] RAM event reader initialized');
  }

  _processState(rawState) {
    if (!this.enabled) return;

    const game = config.getActiveGame();
    if (!game?.memory_map || Object.keys(game.memory_map).length === 0) return;

    const state = this._interpretState(rawState, game);
    if (!state) return;

    // Detect changes from last state
    const changes = this._detectChanges(state);

    // Update tracking
    this.lastState = state;
    this.stateHistory.push({ ...state, timestamp: Date.now() });
    if (this.stateHistory.length > this.maxHistory) {
      this.stateHistory.shift();
    }

    // Emit processed state for overlay
    eventBus.emitSafe('emulator:state', state);

    // Emit specific game events based on detected changes
    for (const change of changes) {
      eventBus.emitSafe(`game:${change.type}`, change);
      console.log(`[GameState] ${change.type}: ${change.description}`);
    }
  }

  _interpretState(rawState, game) {
    const memMap = game.memory_map;

    const state = {
      game_id: game.id,
      system: game.system,
    };

    // Party data
    if (rawState.party_count !== undefined) {
      state.party_count = rawState.party_count;
    }
    if (rawState.party) {
      state.party = rawState.party.map((mon) => ({
        species: mon.species,
        nickname: mon.nickname || null,
        level: mon.level,
        hp: mon.hp,
        max_hp: mon.max_hp,
        status: mon.status || 0,
        is_fainted: mon.hp === 0,
      }));
    }

    // Badges
    if (rawState.badges !== undefined) {
      state.badges = rawState.badges;
      state.badge_count = this._countBits(rawState.badges);
    }

    // Player name
    if (rawState.player_name) {
      state.player_name = rawState.player_name;
    }

    // Map/location
    if (rawState.map_bank !== undefined && rawState.map_number !== undefined) {
      state.location = {
        bank: rawState.map_bank,
        number: rawState.map_number,
      };
    }

    return state;
  }

  _detectChanges(newState) {
    const changes = [];
    if (!this.lastState) return changes;

    // Badge earned
    if (newState.badge_count !== undefined && this.lastState.badge_count !== undefined) {
      if (newState.badge_count > this.lastState.badge_count) {
        changes.push({
          type: 'badge_earned',
          badge_number: newState.badge_count,
          total_badges: newState.badge_count,
          description: `Badge #${newState.badge_count} earned!`,
        });
      }
    }

    // Party member added
    if (newState.party_count !== undefined && this.lastState.party_count !== undefined) {
      if (newState.party_count > this.lastState.party_count) {
        const newMon = newState.party?.[newState.party_count - 1];
        changes.push({
          type: 'pokemon_caught',
          party_count: newState.party_count,
          pokemon: newMon || null,
          description: `New Pokemon! Party now has ${newState.party_count} members`,
        });
      }
    }

    // Pokemon fainted
    if (newState.party && this.lastState.party) {
      for (let i = 0; i < Math.min(newState.party.length, this.lastState.party.length); i++) {
        const now = newState.party[i];
        const prev = this.lastState.party[i];
        if (now.is_fainted && !prev.is_fainted) {
          changes.push({
            type: 'pokemon_fainted',
            slot: i,
            pokemon: now,
            description: `${now.nickname || `Pokemon #${i + 1}`} fainted!`,
          });
        }
      }
    }

    // Whiteout (all party fainted)
    if (newState.party && newState.party.length > 0) {
      const allFainted = newState.party.every(mon => mon.is_fainted);
      const wasAllFainted = this.lastState.party?.every(mon => mon.is_fainted) || false;
      if (allFainted && !wasAllFainted) {
        changes.push({
          type: 'whiteout',
          description: 'WHITEOUT! All Pokemon fainted!',
        });
      }
    }

    // Location changed
    if (newState.location && this.lastState.location) {
      if (newState.location.bank !== this.lastState.location.bank ||
          newState.location.number !== this.lastState.location.number) {
        changes.push({
          type: 'location_changed',
          from: this.lastState.location,
          to: newState.location,
          description: `Moved to map ${newState.location.bank}:${newState.location.number}`,
        });
      }
    }

    return changes;
  }

  _countBits(value) {
    let count = 0;
    let n = value;
    while (n) {
      count += n & 1;
      n >>= 1;
    }
    return count;
  }

  getState() {
    return this.lastState;
  }

  getHistory() {
    return this.stateHistory;
  }

  stop() {
    this.enabled = false;
  }
}

module.exports = GameStateReader;
