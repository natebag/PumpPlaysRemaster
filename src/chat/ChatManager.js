const eventBus = require('../core/EventBus');
const commandParser = require('./CommandParser');
const PumpFunClient = require('./PumpFunClient');

class ChatManager {
  constructor() {
    this.client = null;
    this.processedCount = 0;
    this.rejectedCount = 0;
  }

  async start() {
    const tokenAddress = process.env.TOKEN_ADDRESS;
    if (!tokenAddress || tokenAddress === 'YOUR_TOKEN_ADDRESS_HERE') {
      console.warn('[Chat] No TOKEN_ADDRESS set - running in demo mode (no chat connection)');
      return;
    }

    this.client = new PumpFunClient(tokenAddress);

    this.client.on('message', (msg) => {
      this._processMessage(msg);
    });

    await this.client.connect();
    console.log('[Chat] ChatManager started');
  }

  _processMessage(msg) {
    // Check for wallet registration command: !wallet <address>
    const walletMatch = msg.text.match(/^[!\/\-.](?:wallet|address)\s+([1-9A-HJ-NP-Za-km-z]{32,44})$/i);
    if (walletMatch) {
      eventBus.emitSafe('chat:wallet', {
        userKey: msg.userKey,
        displayName: msg.displayName,
        walletAddress: walletMatch[1],
        source: msg.source,
      });
      return;
    }

    const parsed = commandParser.parse(msg.text);
    if (!parsed) {
      this.rejectedCount++;
      return;
    }

    this.processedCount++;

    eventBus.emitSafe('chat:message', {
      userKey: msg.userKey,
      displayName: msg.displayName,
      command: parsed,
      rawText: msg.text,
      source: msg.source,
      weight: msg.weight,
      timestamp: msg.timestamp,
    });
  }

  async stop() {
    if (this.client) {
      await this.client.disconnect();
    }
    console.log(`[Chat] Stopped. Processed: ${this.processedCount}, Rejected: ${this.rejectedCount}`);
  }

  getStatus() {
    return {
      client: this.client?.getStatus() || { connected: false },
      processedCount: this.processedCount,
      rejectedCount: this.rejectedCount,
    };
  }
}

module.exports = ChatManager;
