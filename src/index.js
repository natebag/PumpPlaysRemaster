require('dotenv').config();

const GameEngine = require('./core/GameEngine');

const engine = new GameEngine();

// Graceful shutdown
process.on('SIGINT', async () => {
  await engine.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await engine.shutdown();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('[FATAL] Unhandled rejection:', err);
});

// Start!
engine.start().catch((err) => {
  console.error('[FATAL] Failed to start:', err);
  process.exit(1);
});
