const eventBus = require('../core/EventBus');

/**
 * AutoHighlights - Detect key moments via game state events
 *
 * Monitors game events and flags "highlight-worthy" moments.
 * Could trigger OBS clip saves, overlay celebrations, or
 * social media posts in the future.
 *
 * Detected highlights:
 *   - Badge earned
 *   - Pokemon caught (new party member)
 *   - Whiteout (dramatic failure)
 *   - Combo landed
 *   - Achievement milestone
 *   - Close battle (Pokemon survives with 1 HP)
 *   - Nuzlocke death
 *   - Hall of Fame entry
 */

const HIGHLIGHT_TYPES = {
  BADGE: { priority: 10, label: 'BADGE EARNED', color: '#FFD700' },
  CATCH: { priority: 5, label: 'NEW POKEMON', color: '#00FF00' },
  WHITEOUT: { priority: 8, label: 'WHITEOUT', color: '#FF0000' },
  COMBO: { priority: 3, label: 'COMBO', color: '#FF6600' },
  ACHIEVEMENT: { priority: 4, label: 'ACHIEVEMENT', color: '#9B59B6' },
  CLOSE_CALL: { priority: 6, label: 'CLOSE CALL', color: '#FF4444' },
  NUZLOCKE_DEATH: { priority: 9, label: 'RIP', color: '#333333' },
  HALL_OF_FAME: { priority: 10, label: 'HALL OF FAME', color: '#FFD700' },
};

class AutoHighlights {
  constructor() {
    this.highlights = [];  // Recent highlights
    this.maxHighlights = 100;
    this.totalHighlights = 0;
  }

  init() {
    // Badge earned
    eventBus.on('game:badge_earned', (data) => {
      this._addHighlight(HIGHLIGHT_TYPES.BADGE, `Badge #${data.badge_number} earned!`, data);
    });

    // Pokemon caught
    eventBus.on('game:pokemon_caught', (data) => {
      const name = data.pokemon?.species_name || 'Unknown Pokemon';
      this._addHighlight(HIGHLIGHT_TYPES.CATCH, `${name} joined the party!`, data);
    });

    // Whiteout
    eventBus.on('game:whiteout', () => {
      this._addHighlight(HIGHLIGHT_TYPES.WHITEOUT, 'All Pokemon fainted! WHITEOUT!', {});
    });

    // Combo
    eventBus.on('combo:landed', (data) => {
      this._addHighlight(HIGHLIGHT_TYPES.COMBO, `${data.combo.name} combo! (${data.bonus}x)`, data);
    });

    // Achievement
    eventBus.on('achievement:earned', (data) => {
      this._addHighlight(HIGHLIGHT_TYPES.ACHIEVEMENT, `${data.displayName} earned "${data.achievement}"`, data);
    });

    // Nuzlocke death
    eventBus.on('nuzlocke:death', (data) => {
      this._addHighlight(HIGHLIGHT_TYPES.NUZLOCKE_DEATH, `RIP ${data.nickname || data.species} (Lv${data.level})`, data);
    });

    // Hall of Fame
    eventBus.on('halloffame:entry', (data) => {
      this._addHighlight(HIGHLIGHT_TYPES.HALL_OF_FAME, `${data.game_name} COMPLETED!`, data);
    });

    // Close call detection (Pokemon survives at very low HP)
    eventBus.on('emulator:state', (state) => {
      if (!state.party) return;
      for (const mon of state.party) {
        if (mon.hp > 0 && mon.hp <= 2 && mon.max_hp > 10) {
          this._addHighlight(HIGHLIGHT_TYPES.CLOSE_CALL,
            `${mon.nickname || mon.species_name || 'Pokemon'} survived with ${mon.hp} HP!`,
            { pokemon: mon }
          );
        }
      }
    });

    console.log('[Highlights] Auto-detection initialized');
  }

  _addHighlight(type, description, data) {
    const highlight = {
      id: ++this.totalHighlights,
      type: type.label,
      priority: type.priority,
      color: type.color,
      description,
      data,
      timestamp: Date.now(),
    };

    this.highlights.push(highlight);
    if (this.highlights.length > this.maxHighlights) {
      this.highlights.shift();
    }

    // Broadcast to overlay
    eventBus.emitSafe('highlight:detected', highlight);
    console.log(`[Highlight] ${type.label}: ${description}`);
  }

  getRecent(limit = 20) {
    return this.highlights.slice(-limit).reverse();
  }

  getByPriority(minPriority = 5) {
    return this.highlights
      .filter(h => h.priority >= minPriority)
      .slice(-20)
      .reverse();
  }

  getStats() {
    return {
      totalHighlights: this.totalHighlights,
      recentCount: this.highlights.length,
    };
  }

  stop() {}
}

module.exports = AutoHighlights;
