const BaseAdapter = require('./BaseAdapter');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

/**
 * Project64Adapter - Sends inputs to N64 games via ViGEm virtual controller
 *
 * Auto-launches:
 *   1. Python ViGEm server (creates virtual Xbox controllers)
 *   2. Project64 with the game ROM
 *
 * Project64 sees virtual controllers as real Xbox gamepads.
 * Supports up to 4 controllers for Pokemon Stadium 2 multiplayer.
 */
class Project64Adapter extends BaseAdapter {
  constructor() {
    super('Project64');
    this.serverUrl = process.env.VIGEM_SERVER_URL || 'http://localhost:7777';
    this.gameConfig = null;
    this.vigemMapping = null;
    this.analogPositions = null;
    this.maxPlayers = 1;
    this.vigemProcess = null;
    this.emulatorProcess = null;
  }

  async connect(gameConfig) {
    this.gameConfig = gameConfig;

    const systemConfig = gameConfig.systemConfig;
    this.vigemMapping = systemConfig?.vigem_mapping || {};
    this.analogPositions = systemConfig?.analog_positions || {};
    this.maxPlayers = gameConfig.multiplayer?.max_players || 1;

    // Launch ViGEm server if not already running
    await this._ensureVigemServer();

    // Launch Project64 with ROM
    this._launchEmulator(gameConfig);

    this.connected = true;
    const mappedButtons = Object.keys(this.vigemMapping);
    console.log(`[PJ64] Adapter ready for ${gameConfig.name} (${this.maxPlayers}-player)`);
    console.log(`[PJ64] Mapped buttons: ${mappedButtons.join(', ') || 'NONE — check n64.json systemConfig'}`);
    return true;
  }

  async _ensureVigemServer() {
    // Check if ViGEm server is already running
    try {
      await this._httpGet('/status');
      console.log('[PJ64] ViGEm server already running');
      return;
    } catch {
      // Not running, need to start it
    }

    const vigemScript = path.join(process.cwd(), 'scripts', 'vigem', 'input_server.py');
    if (!fs.existsSync(vigemScript)) {
      console.log(`[PJ64] ViGEm server script not found: ${vigemScript}`);
      return;
    }

    const pythonCmd = process.env.PYTHON_CMD || 'python';
    const port = new URL(this.serverUrl).port || '7777';

    console.log(`[PJ64] Starting ViGEm server on port ${port}...`);
    this.vigemProcess = spawn(pythonCmd, [vigemScript], {
      env: { ...process.env, VIGEM_PORT: port, NUM_CONTROLLERS: String(this.maxPlayers) },
      detached: true,
      stdio: 'ignore',
      cwd: path.join(process.cwd(), 'scripts', 'vigem'),
    });

    this.vigemProcess.on('error', (err) => {
      console.error(`[PJ64] ViGEm server failed to start: ${err.message}`);
      console.log('[PJ64] Install Python deps: cd scripts/vigem && pip install -r requirements.txt');
      this.vigemProcess = null;
    });

    this.vigemProcess.on('exit', (code) => {
      console.log(`[PJ64] ViGEm server exited (code ${code})`);
      this.vigemProcess = null;
    });

    // Wait for server to be ready
    await this._waitForServer(5000);
  }

  async _waitForServer(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await this._httpGet('/status');
        console.log('[PJ64] ViGEm server is ready');
        return true;
      } catch {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    console.warn('[PJ64] ViGEm server did not respond in time — inputs may fail until it starts');
    return false;
  }

  _launchEmulator(gameConfig) {
    const rawExe = process.env.PROJECT64_EXE;
    if (!rawExe) {
      console.log('[PJ64] No PROJECT64_EXE set — skipping auto-launch');
      console.log('[PJ64] Set PROJECT64_EXE in .env to enable auto-launch');
      return;
    }

    const exePath = path.resolve(process.cwd(), rawExe);
    if (!fs.existsSync(exePath)) {
      console.log(`[PJ64] Project64 not found at ${exePath}`);
      return;
    }

    const romDir = path.resolve(process.cwd(), process.env.ROM_DIR || 'roms');
    const romPath = path.join(romDir, gameConfig.rom);

    if (!fs.existsSync(romPath)) {
      console.log(`[PJ64] ROM not found: ${romPath}`);
      return;
    }

    this._killEmulator();

    console.log(`[PJ64] Launching Project64: ${gameConfig.rom}`);
    this.emulatorProcess = spawn(exePath, [romPath], {
      detached: true,
      stdio: 'ignore',
    });

    this.emulatorProcess.on('error', (err) => {
      console.error(`[PJ64] Launch failed: ${err.message}`);
    });

    this.emulatorProcess.on('exit', (code) => {
      console.log(`[PJ64] Process exited (code ${code})`);
      this.emulatorProcess = null;
    });

    console.log(`[PJ64] Launched PID ${this.emulatorProcess.pid}`);
  }

  async disconnect() {
    // Reset controllers before shutting down
    try {
      await this._httpPost('/reset', {});
    } catch {
      // Server might already be gone
    }

    this._killEmulator();
    this._killVigemServer();
    this.connected = false;
  }

  _killEmulator() {
    if (this.emulatorProcess && this.emulatorProcess.pid) {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /PID ${this.emulatorProcess.pid} /T /F`, { stdio: 'ignore' });
        } else {
          process.kill(-this.emulatorProcess.pid, 'SIGTERM');
        }
        console.log(`[PJ64] Killed emulator process ${this.emulatorProcess.pid}`);
      } catch {
        // Already dead
      }
      this.emulatorProcess = null;
    }
  }

  _killVigemServer() {
    if (this.vigemProcess && this.vigemProcess.pid) {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /PID ${this.vigemProcess.pid} /T /F`, { stdio: 'ignore' });
        } else {
          process.kill(-this.vigemProcess.pid, 'SIGTERM');
        }
        console.log(`[PJ64] Killed ViGEm server ${this.vigemProcess.pid}`);
      } catch {
        // Already dead
      }
      this.vigemProcess = null;
    }
  }

  async sendInput(voteResult) {
    const parsed = voteResult.parsedCommand || null;
    const command = voteResult.command;
    if (!command && !parsed) return false;

    const controller = (voteResult.team || 1) - 1;
    const button = parsed ? parsed.button : (typeof command === 'string' ? command : command.button);
    const type = parsed ? parsed.type : (typeof command === 'string' ? 'press' : (command.type || 'press'));
    const duration = parsed ? (parsed.duration || 150) : (typeof command === 'string' ? 150 : (command.duration || 150));

    console.log(`[PJ64] Input: button="${button}" type="${type}" controller=${controller}`);

    if (this.analogPositions[button]) {
      return this._sendAnalog(button, controller, type, duration);
    }

    const xboxButton = this.vigemMapping[button];
    if (!xboxButton) {
      console.warn(`[PJ64] No ViGEm mapping for button: ${button}`);
      return false;
    }

    const payload = {
      controller,
      button: xboxButton,
      action: type === 'hold' ? 'hold' : 'press',
      duration_ms: type === 'hold' ? duration : 150,
    };

    try {
      const resp = await this._httpPost('/input', payload);
      console.log(`[PJ64] Sent ${xboxButton} → ViGEm response:`, resp);
      return true;
    } catch (err) {
      console.error(`[PJ64] Input failed: ${err.message}`);
      return false;
    }
  }

  async _sendAnalog(stickDir, controller, type, duration) {
    const [x, y] = this.analogPositions[stickDir];

    const payload = {
      controller,
      stick: 'left',
      x,
      y,
      duration_ms: type === 'hold' ? duration : 200,
    };

    try {
      await this._httpPost('/analog', payload);
      return true;
    } catch (err) {
      console.error(`[PJ64] Analog input failed: ${err.message}`);
      return false;
    }
  }

  _httpGet(path) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.serverUrl);
      const req = http.get(url.toString(), (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(2000, () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  _httpPost(path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.serverUrl);
      const postData = JSON.stringify(body);
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  getStatus() {
    return {
      name: this.name,
      connected: this.connected,
      serverUrl: this.serverUrl,
      maxPlayers: this.maxPlayers,
      game: this.gameConfig?.name || 'none',
      emulatorPid: this.emulatorProcess?.pid || null,
      vigemPid: this.vigemProcess?.pid || null,
    };
  }
}

module.exports = Project64Adapter;
