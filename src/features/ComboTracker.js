const eventBus = require('../core/EventBus');

/**
 * ComboTracker - Bonus PPP for coordinated move sequences
 *
 * Detects when the community executes specific command sequences
 * and awards bonus points. Encourages coordination over chaos.
 *
 * Examples:
 *   - "Hadouken": down, right, a → 3x bonus
 *   - "Dash": left, left, left (same command 3x) → 2x bonus
 *   - "Menu Master": start, a, a, b → navigate menus efficiently
 */

const COMBOS = [
  {
    id: 'hadouken',
    name: 'Hadouken',
    sequence: ['down', 'right', 'a'],
    bonus: 3,
    description: 'Down → Right → A',
  },
  {
    id: 'shoryuken',
    name: 'Shoryuken',
    sequence: ['right', 'down', 'right', 'a'],
    bonus: 4,
    description: 'Right → Down → Right → A',
  },
  {
    id: 'triple_tap',
    name: 'Triple Tap',
    sequence: ['a', 'a', 'a'],
    bonus: 2,
    description: 'A → A → A',
  },
  {
    id: 'dash_left',
    name: 'Dash Left',
    sequence: ['left', 'left', 'left'],
    bonus: 2,
    description: 'Left → Left → Left',
  },
  {
    id: 'dash_right',
    name: 'Dash Right',
    sequence: ['right', 'right', 'right'],
    bonus: 2,
    description: 'Right → Right → Right',
  },
  {
    id: 'menu_master',
    name: 'Menu Master',
    sequence: ['start', 'a', 'a', 'b'],
    bonus: 3,
    description: 'Start → A → A → B',
  },
  {
    id: 'b_cancel',
    name: 'B Cancel',
    sequence: ['a', 'b', 'a', 'b'],
    bonus: 2,
    description: 'A → B → A → B',
  },
  {
    id: 'konami',
    name: 'Konami Code',
    sequence: ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'b', 'a'],
    bonus: 10,
    description: 'The legendary code',
  },
];

class ComboTracker {
  constructor() {
    // Rolling buffer of recent executed commands
    this.commandHistory = [];
    this.maxHistory = 20;

    // Stats
    this.combosLanded = new Map(); // comboId → count
    this.totalCombos = 0;
  }

  init() {
    // Listen for executed commands
    eventBus.on('vote:winner', (result) => {
      this._trackCommand(result);
    });

    console.log(`[Combos] Tracker initialized (${COMBOS.length} combos registered)`);
  }

  _trackCommand(result) {
    // Extract button from the command
    const button = typeof result.command === 'string'
      ? result.command
      : result.command?.button || result.command?.raw;

    if (!button) return;

    this.commandHistory.push({
      button,
      voter: result.firstVoter,
      voterKey: result.firstVoterKey,
      timestamp: result.timestamp,
    });

    if (this.commandHistory.length > this.maxHistory) {
      this.commandHistory.shift();
    }

    // Check for combo matches
    this._checkCombos(result);
  }

  _checkCombos(lastResult) {
    const buttons = this.commandHistory.map(c => c.button);

    for (const combo of COMBOS) {
      const seq = combo.sequence;
      if (buttons.length < seq.length) continue;

      // Check if the last N commands match the combo sequence
      const recent = buttons.slice(-seq.length);
      const matches = recent.every((btn, i) => btn === seq[i]);

      if (matches) {
        this.totalCombos++;
        this.combosLanded.set(combo.id, (this.combosLanded.get(combo.id) || 0) + 1);

        eventBus.emitSafe('combo:landed', {
          combo: combo,
          bonus: combo.bonus,
          lastVoter: lastResult.firstVoter,
          lastVoterKey: lastResult.firstVoterKey,
          timestamp: Date.now(),
        });

        console.log(`[Combos] ${combo.name} landed! (${combo.bonus}x bonus)`);

        // Clear history to prevent re-triggering the same combo
        this.commandHistory = [];
        break; // Only one combo per command
      }
    }
  }

  getCombos() {
    return COMBOS.map(c => ({
      ...c,
      times_landed: this.combosLanded.get(c.id) || 0,
    }));
  }

  getStats() {
    return {
      totalCombos: this.totalCombos,
      combosLanded: Object.fromEntries(this.combosLanded),
      recentCommands: this.commandHistory.slice(-10).map(c => c.button),
    };
  }

  stop() {}
}

module.exports = ComboTracker;
