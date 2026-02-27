const eventBus = require('../core/EventBus');

/**
 * NuzlockeMode - Permadeath event mode with modified rules/payouts
 *
 * When Nuzlocke mode is active:
 *   - Fainted Pokemon are "dead" (tracked, announced dramatically)
 *   - First encounter per area is the only catch allowed
 *   - All Pokemon must be nicknamed
 *   - Whiteout = run over, reset
 *   - Higher PPP payouts for participants (danger = rewards)
 *   - Death counter displayed on overlay
 *
 * This is a special event mode, not always-on. Admins toggle it
 * for special streams ("NUZLOCKE FRIDAY" etc.)
 */
class NuzlockeMode {
  constructor() {
    this.active = false;
    this.deathCount = 0;
    this.graveyard = [];    // { species, nickname, level, cause, timestamp }
    this.encounterAreas = new Set(); // areas where we've already caught
    this.payoutMultiplier = 2.0; // 2x PPP during Nuzlocke
  }

  init() {
    eventBus.on('game:pokemon_fainted', (data) => {
      if (!this.active) return;
      this._recordDeath(data);
    });

    eventBus.on('game:whiteout', () => {
      if (!this.active) return;
      this._handleWhiteout();
    });

    eventBus.on('game:location_changed', (data) => {
      if (!this.active) return;
      // Track areas visited for first-encounter rule
      const areaKey = `${data.to.bank}:${data.to.number}`;
      this.encounterAreas.add(areaKey);
    });

    console.log('[Nuzlocke] Mode initialized (inactive)');
  }

  /**
   * Toggle Nuzlocke mode on/off
   */
  toggle(active) {
    this.active = active;
    if (active) {
      this.deathCount = 0;
      this.graveyard = [];
      this.encounterAreas.clear();
      console.log('[Nuzlocke] MODE ACTIVATED! Permadeath rules in effect.');
      eventBus.emitSafe('nuzlocke:activated', { multiplier: this.payoutMultiplier });
    } else {
      console.log(`[Nuzlocke] Mode deactivated. Deaths: ${this.deathCount}`);
      eventBus.emitSafe('nuzlocke:deactivated', { totalDeaths: this.deathCount, graveyard: this.graveyard });
    }
    return { active: this.active, deathCount: this.deathCount };
  }

  _recordDeath(data) {
    this.deathCount++;
    const death = {
      species: data.pokemon?.species_name || `Pokemon #${data.slot + 1}`,
      nickname: data.pokemon?.nickname || null,
      level: data.pokemon?.level || 0,
      cause: 'battle',
      timestamp: Date.now(),
      deathNumber: this.deathCount,
    };

    this.graveyard.push(death);

    eventBus.emitSafe('nuzlocke:death', death);
    console.log(`[Nuzlocke] REST IN PEACE: ${death.nickname || death.species} (Lv${death.level}) - Death #${this.deathCount}`);
  }

  _handleWhiteout() {
    eventBus.emitSafe('nuzlocke:whiteout', {
      deathCount: this.deathCount,
      graveyard: this.graveyard,
      message: 'NUZLOCKE RUN OVER! Total party wipe.',
    });
    console.log(`[Nuzlocke] RUN OVER! Whiteout after ${this.deathCount} deaths.`);
  }

  getStatus() {
    return {
      active: this.active,
      deathCount: this.deathCount,
      graveyard: this.graveyard,
      areasVisited: this.encounterAreas.size,
      payoutMultiplier: this.payoutMultiplier,
    };
  }

  stop() {}
}

module.exports = NuzlockeMode;
