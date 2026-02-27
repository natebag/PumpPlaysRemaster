const BizHawkAdapter = require('./adapters/BizHawkAdapter');
const Project64Adapter = require('./adapters/Project64Adapter');
const DolphinAdapter = require('./adapters/DolphinAdapter');

class EmulatorManager {
  constructor() {
    this.adapter = null;
    this.adapters = {
      bizhawk: () => new BizHawkAdapter(),
      project64: () => new Project64Adapter(),
      dolphin: () => new DolphinAdapter(),
    };
  }

  async connect(gameConfig) {
    const emulatorType = gameConfig.emulator;
    const factory = this.adapters[emulatorType];
    if (!factory) {
      console.error(`[Emulator] Unknown emulator type: ${emulatorType}`);
      console.log(`[Emulator] Available: ${Object.keys(this.adapters).join(', ')}`);
      return false;
    }

    // Save state and disconnect existing adapter if switching
    if (this.adapter) {
      await this.saveAndDisconnect();
    }

    this.adapter = factory();
    await this.adapter.connect(gameConfig);
    console.log(`[Emulator] Connected via ${emulatorType} adapter`);
    return true;
  }

  async saveAndDisconnect() {
    if (!this.adapter) return;
    try {
      console.log('[Emulator] Saving state before disconnect...');
      await this.adapter.saveState();
    } catch (err) {
      console.warn(`[Emulator] Save state failed: ${err.message}`);
    }
    await this.adapter.disconnect();
  }

  async disconnect() {
    if (this.adapter) {
      await this.saveAndDisconnect();
      this.adapter = null;
    }
  }

  sendCommand(voteResult) {
    if (!this.adapter?.connected) {
      console.warn('[Emulator] No adapter connected, dropping command');
      return false;
    }
    return this.adapter.sendInput(voteResult);
  }

  getAdapter() {
    return this.adapter;
  }

  getStatus() {
    return this.adapter?.getStatus() || { connected: false };
  }
}

module.exports = EmulatorManager;
