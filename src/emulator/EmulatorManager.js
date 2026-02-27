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

    // Disconnect existing adapter if switching
    if (this.adapter) {
      await this.adapter.disconnect();
    }

    this.adapter = factory();
    await this.adapter.connect(gameConfig);
    console.log(`[Emulator] Connected via ${emulatorType} adapter`);
    return true;
  }

  async disconnect() {
    if (this.adapter) {
      await this.adapter.disconnect();
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
