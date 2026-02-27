const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const eventBus = require('../core/EventBus');

class GameScheduler {
  constructor(engine) {
    this.engine = engine;
    this.schedule = null;
    this.cronJob = null;
    this.currentDay = null;
  }

  init() {
    this._loadSchedule();

    if (!this.schedule) {
      console.log('[Scheduler] No schedule.json found - manual game switching only');
      return;
    }

    // Check schedule at midnight and on startup
    this._applySchedule();

    // Run at midnight every day
    this.cronJob = cron.schedule('0 0 * * *', () => {
      console.log('[Scheduler] Midnight rotation check...');
      this._applySchedule();
    });

    console.log('[Scheduler] Game rotation initialized');
  }

  _loadSchedule() {
    const schedulePath = path.join(__dirname, '../../config/schedule.json');
    if (!fs.existsSync(schedulePath)) return;
    try {
      this.schedule = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
    } catch (err) {
      console.error('[Scheduler] Failed to parse schedule.json:', err.message);
    }
  }

  _applySchedule() {
    if (!this.schedule) return;

    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = days[new Date().getDay()];

    if (today === this.currentDay) return; // Already checked today
    this.currentDay = today;

    const entry = this.schedule[today];
    if (!entry) {
      console.log(`[Scheduler] No game scheduled for ${today}`);
      return;
    }

    // Skip if the correct game is already loaded (prevents double-load on startup)
    const config = require('../core/ConfigManager');
    const activeGame = config.getActiveGame();
    if (activeGame && activeGame.id === entry.game) {
      console.log(`[Scheduler] ${today.toUpperCase()}: ${entry.label || entry.game} (already loaded)`);
      this.engine.currentLabel = entry.label || activeGame.name;
      eventBus.emitSafe('schedule:changed', { day: today, ...entry });
      return;
    }

    console.log(`[Scheduler] ${today.toUpperCase()}: Switching to ${entry.label || entry.game}`);

    try {
      this.engine.loadGame(entry.game, entry.label);
      eventBus.emitSafe('schedule:changed', { day: today, ...entry });
    } catch (err) {
      console.error(`[Scheduler] Failed to load game "${entry.game}":`, err.message);
    }
  }

  // Manual override for special events
  forceGame(gameId, label) {
    this.currentDay = null; // Reset so schedule can resume later
    this.engine.loadGame(gameId, label);
    if (label) {
      eventBus.emitSafe('schedule:changed', { day: 'override', game: gameId, label });
    }
  }

  getSchedule() {
    return this.schedule;
  }

  getCurrentScheduleEntry() {
    if (!this.schedule) return null;
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = days[new Date().getDay()];
    return { day: today, ...this.schedule[today] };
  }

  stop() {
    if (this.cronJob) this.cronJob.stop();
  }
}

module.exports = GameScheduler;
