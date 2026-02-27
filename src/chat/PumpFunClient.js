const EventEmitter = require('events');

class PumpFunClient extends EventEmitter {
  constructor(tokenAddress) {
    super();
    this.tokenAddress = tokenAddress;
    this.client = null;
    this.connected = false;
    this.messageCount = 0;
    this.rateLimitWindow = [];
    this.MAX_MESSAGES_PER_SEC = 50;
  }

  async connect() {
    try {
      // Dynamic import for ESM module
      const { PumpChatClient } = await import('pump-chat-client');
      this.client = new PumpChatClient({ roomId: this.tokenAddress });

      this.client.on('message', (msg) => {
        this._handleMessage(msg);
      });

      this.client.on('connect', () => {
        this.connected = true;
        console.log('[PumpFun] Connected to chat WebSocket');
      });

      this.client.on('disconnect', () => {
        this.connected = false;
        console.log('[PumpFun] Disconnected from chat, will auto-reconnect...');
      });

      this.client.on('error', (err) => {
        console.error('[PumpFun] WebSocket error:', err.message);
      });

      await this.client.connect();
      this.connected = true;
      console.log(`[PumpFun] Joined chat room for token: ${this.tokenAddress}`);
    } catch (err) {
      console.error('[PumpFun] Failed to connect:', err.message);
      console.log('[PumpFun] Will retry connection in 10 seconds...');
      setTimeout(() => this.connect(), 10000);
    }
  }

  _handleMessage(msg) {
    // Global rate limiting
    const now = Date.now();
    this.rateLimitWindow = this.rateLimitWindow.filter(t => now - t < 1000);
    if (this.rateLimitWindow.length >= this.MAX_MESSAGES_PER_SEC) return;
    this.rateLimitWindow.push(now);

    this.messageCount++;

    const userKey = msg.userAddress || msg.username || `anon_${this.messageCount}`;
    const displayName = msg.username || 'Anonymous';

    this.emit('message', {
      userKey,
      displayName,
      text: msg.message || '',
      source: 'pumpfun_ws',
      timestamp: msg.timestamp || Date.now(),
      weight: 1,
    });
  }

  async disconnect() {
    if (this.client) {
      try {
        this.client.disconnect();
      } catch (e) { /* ignore */ }
      this.connected = false;
    }
  }

  getStatus() {
    return {
      connected: this.connected,
      messageCount: this.messageCount,
      source: 'pumpfun_ws',
    };
  }
}

module.exports = PumpFunClient;
