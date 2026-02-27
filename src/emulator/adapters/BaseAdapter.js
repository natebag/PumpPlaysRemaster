const EventEmitter = require('events');

class BaseAdapter extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.connected = false;
  }

  async connect(gameConfig) {
    throw new Error(`${this.name}: connect() not implemented`);
  }

  async disconnect() {
    this.connected = false;
  }

  async sendInput(command) {
    throw new Error(`${this.name}: sendInput() not implemented`);
  }

  async readMemory(address, size) {
    return null; // Optional - not all adapters support this
  }

  getStatus() {
    return { name: this.name, connected: this.connected };
  }
}

module.exports = BaseAdapter;
