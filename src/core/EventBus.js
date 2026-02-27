const EventEmitter = require('events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  emitSafe(event, ...args) {
    try {
      this.emit(event, ...args);
    } catch (err) {
      console.error(`[EventBus] Error in handler for "${event}":`, err.message);
    }
  }
}

module.exports = new EventBus();
