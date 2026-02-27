const fs = require('fs');
const path = require('path');

class ConfigManager {
  constructor() {
    this.games = new Map();
    this.systems = new Map();
    this.activeGame = null;
    this.features = {};
  }

  load() {
    this._loadSystems();
    this._loadGames();
    this._loadFeatureFlags();
    console.log(`[Config] Loaded ${this.systems.size} systems, ${this.games.size} games`);
  }

  _loadSystems() {
    const dir = path.join(__dirname, '../../config/systems');
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      this.systems.set(data.id, data);
    }
  }

  _loadGames() {
    const dir = path.join(__dirname, '../../config/games');
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      this.games.set(data.id, data);
    }
  }

  _loadFeatureFlags() {
    this.features = {
      economy: process.env.ENABLE_ECONOMY === 'true',
      scheduler: process.env.ENABLE_SCHEDULER === 'true',
      ramEvents: process.env.ENABLE_RAM_EVENTS === 'true',
      predictions: process.env.ENABLE_PREDICTIONS === 'true',
      bounties: process.env.ENABLE_BOUNTIES === 'true',
    };
  }

  setActiveGame(gameId) {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Game config not found: ${gameId}`);
    const system = this.systems.get(game.system);
    if (!system) throw new Error(`System config not found: ${game.system}`);
    this.activeGame = { ...game, systemConfig: system };
    console.log(`[Config] Active game: ${game.name} (${game.system})`);
    return this.activeGame;
  }

  getActiveGame() {
    return this.activeGame;
  }

  getSystem(systemId) {
    return this.systems.get(systemId);
  }

  isFeatureEnabled(feature) {
    return this.features[feature] === true;
  }
}

module.exports = new ConfigManager();
