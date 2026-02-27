const BaseAdapter = require('./BaseAdapter');
const eventBus = require('../../core/EventBus');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

class BizHawkAdapter extends BaseAdapter {
  constructor() {
    super('BizHawk');
    this.commandQueue = [];
    this.executedCommands = [];
    this.lastAckId = 0;
    this.gameConfig = null;
    this.process = null;
    this.pendingSaveState = false; // Flag for Lua to check
    this.saveStateComplete = false;
  }

  async connect(gameConfig) {
    this.gameConfig = gameConfig;
    this.connected = true;

    const rawExe = process.env.BIZHAWK_EXE || path.join('BizHawk', 'EmuHawk.exe');
    const exePath = path.resolve(process.cwd(), rawExe);
    const romDir = path.resolve(process.cwd(), process.env.ROM_DIR || 'roms');
    const romPath = path.join(romDir, gameConfig.rom);
    const luaScript = path.join(process.cwd(), 'scripts', 'bizhawk', 'main.lua');
    const serverUrl = `http://localhost:${process.env.PORT || 4000}`;

    if (!fs.existsSync(exePath)) {
      console.log(`[BizHawk] EmuHawk not found at ${exePath} — skipping auto-launch`);
      console.log(`[BizHawk] Set BIZHAWK_EXE in .env or place BizHawk in BizHawk/ folder`);
      return true;
    }

    if (!fs.existsSync(romPath)) {
      console.log(`[BizHawk] ROM not found: ${romPath} — skipping auto-launch`);
      return true;
    }

    this._killProcess();

    // Wait for the old process to fully exit before launching new one
    await new Promise(r => setTimeout(r, 1500));

    console.log(`[BizHawk] Launching: ${gameConfig.name} (${gameConfig.rom})`);
    this.process = spawn(exePath, [
      `--lua=${luaScript}`,
      `--url_get=${serverUrl}`,
      `--url_post=${serverUrl}`,
      romPath,
    ], {
      detached: true,
      stdio: 'ignore',
      cwd: path.dirname(exePath),
    });

    this.process.on('error', (err) => {
      console.error(`[BizHawk] Launch failed: ${err.message}`);
    });

    this.process.on('exit', (code) => {
      console.log(`[BizHawk] Process exited (code ${code})`);
      this.process = null;
    });

    console.log(`[BizHawk] Launched PID ${this.process.pid}`);
    return true;
  }

  async saveState() {
    if (!this.process || !this.connected) return false;

    const gameId = this.gameConfig?.id || 'unknown';
    const savePath = path.resolve(process.cwd(), 'data', 'saves', `${gameId}.state`);

    // Ensure saves directory exists
    const saveDir = path.dirname(savePath);
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

    // Signal Lua to save state
    this.pendingSaveState = savePath;
    this.saveStateComplete = false;

    console.log(`[BizHawk] Requesting save state: ${savePath}`);

    // Wait up to 3 seconds for Lua to complete the save
    const start = Date.now();
    while (!this.saveStateComplete && Date.now() - start < 3000) {
      await new Promise(r => setTimeout(r, 100));
    }

    if (this.saveStateComplete) {
      console.log(`[BizHawk] Save state complete: ${gameId}`);
      return true;
    } else {
      console.warn(`[BizHawk] Save state timed out - Lua may not have responded`);
      return false;
    }
  }

  // Called by API route when Lua polls for save state request
  getSaveStateRequest() {
    if (this.pendingSaveState) {
      const path = this.pendingSaveState;
      return { save: true, path };
    }
    return { save: false };
  }

  // Called by API route when Lua confirms save complete
  confirmSaveState() {
    this.pendingSaveState = false;
    this.saveStateComplete = true;
  }

  async disconnect() {
    this._killProcess();
    this.connected = false;
    this.commandQueue = [];
  }

  _killProcess() {
    if (this.process && this.process.pid) {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /PID ${this.process.pid} /T /F`, { stdio: 'ignore' });
        } else {
          process.kill(-this.process.pid, 'SIGTERM');
        }
        console.log(`[BizHawk] Killed process ${this.process.pid}`);
      } catch {
        // Process already dead
      }
      this.process = null;
    }
  }

  async sendInput(voteResult) {
    // Flatten command for Lua parser (can't handle nested JSON objects)
    const parsed = voteResult.parsedCommand || {};
    const entry = {
      id: voteResult.id,
      button: parsed.button || (typeof voteResult.command === 'string' ? voteResult.command : ''),
      type: parsed.type || 'press',
      duration: parsed.duration || null,
      timestamp: Date.now(),
    };
    this.commandQueue.push(entry);
    return true;
  }

  getPendingCommands(afterId = 0) {
    return this.commandQueue.filter(cmd => cmd.id > afterId);
  }

  acknowledgeCommands(lastId) {
    const acked = this.commandQueue.filter(cmd => cmd.id <= lastId);
    this.commandQueue = this.commandQueue.filter(cmd => cmd.id > lastId);
    this.lastAckId = lastId;
    this.executedCommands.push(...acked);
    if (this.executedCommands.length > 100) {
      this.executedCommands = this.executedCommands.slice(-100);
    }
    return { acknowledged: acked.length, queue_remaining: this.commandQueue.length };
  }

  receiveGameState(state) {
    eventBus.emitSafe('emulator:raw_state', state);
    eventBus.emitSafe('emulator:state', state);
  }

  getStatus() {
    return {
      name: this.name,
      connected: this.connected,
      queueLength: this.commandQueue.length,
      lastAckId: this.lastAckId,
      game: this.gameConfig?.name || 'none',
      pid: this.process?.pid || null,
    };
  }
}

module.exports = BizHawkAdapter;
