const BaseAdapter = require('./BaseAdapter');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

/**
 * DolphinAdapter - Sends inputs to GameCube/Wii games via ViGEm virtual controller
 *
 * Auto-launches:
 *   1. Python ViGEm server on port 7778 (separate from Project64's 7777)
 *   2. Dolphin Emulator with the game ROM/ISO
 *
 * Supports main analog stick + C-stick (Xbox left/right sticks).
 * Supports up to 4 controllers for multiplayer GCN/Wii games.
 */
class DolphinAdapter extends BaseAdapter {
  constructor() {
    super('Dolphin');
    this.serverUrl = process.env.DOLPHIN_VIGEM_URL || 'http://localhost:7778';
    this.gameConfig = null;
    this.vigemMapping = null;
    this.analogPositions = null;
    this.cstickPositions = null;
    this.maxPlayers = 1;
    this.vigemProcess = null;
    this.emulatorProcess = null;
  }

  async connect(gameConfig) {
    this.gameConfig = gameConfig;

    const systemConfig = gameConfig.systemConfig;
    this.vigemMapping = systemConfig?.vigem_mapping || {};
    this.analogPositions = systemConfig?.analog_positions || {};
    this.cstickPositions = systemConfig?.cstick_positions || {};
    this.maxPlayers = gameConfig.multiplayer?.max_players || 1;

    // Launch ViGEm server if not already running
    await this._ensureVigemServer();

    // Launch Dolphin with ROM
    this._launchEmulator(gameConfig);

    this.connected = true;
    console.log(`[Dolphin] Adapter ready for ${gameConfig.name} (${this.maxPlayers}-player)`);
    return true;
  }

  async _ensureVigemServer() {
    try {
      await this._httpGet('/status');
      console.log('[Dolphin] ViGEm server already running');
      return;
    } catch {
      // Not running
    }

    const vigemScript = path.join(process.cwd(), 'scripts', 'vigem', 'input_server.py');
    if (!fs.existsSync(vigemScript)) {
      console.log(`[Dolphin] ViGEm server script not found: ${vigemScript}`);
      return;
    }

    const pythonCmd = process.env.PYTHON_CMD || 'python';
    const port = new URL(this.serverUrl).port || '7778';

    console.log(`[Dolphin] Starting ViGEm server on port ${port}...`);
    this.vigemProcess = spawn(pythonCmd, [vigemScript], {
      env: { ...process.env, VIGEM_PORT: port, NUM_CONTROLLERS: String(this.maxPlayers) },
      detached: true,
      stdio: 'ignore',
      cwd: path.join(process.cwd(), 'scripts', 'vigem'),
    });

    this.vigemProcess.on('error', (err) => {
      console.error(`[Dolphin] ViGEm server failed to start: ${err.message}`);
      console.log('[Dolphin] Install Python deps: cd scripts/vigem && pip install -r requirements.txt');
      this.vigemProcess = null;
    });

    this.vigemProcess.on('exit', (code) => {
      console.log(`[Dolphin] ViGEm server exited (code ${code})`);
      this.vigemProcess = null;
    });

    await this._waitForServer(5000);
  }

  async _waitForServer(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await this._httpGet('/status');
        console.log('[Dolphin] ViGEm server is ready');
        return true;
      } catch {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    console.warn('[Dolphin] ViGEm server did not respond in time — inputs may fail until it starts');
    return false;
  }

  _launchEmulator(gameConfig) {
    const rawExe = process.env.DOLPHIN_EXE;
    if (!rawExe) {
      console.log('[Dolphin] No DOLPHIN_EXE set — skipping auto-launch');
      console.log('[Dolphin] Set DOLPHIN_EXE in .env to enable auto-launch');
      return;
    }

    const exePath = path.resolve(process.cwd(), rawExe);
    if (!fs.existsSync(exePath)) {
      console.log(`[Dolphin] Dolphin not found at ${exePath}`);
      return;
    }

    const romDir = path.resolve(process.cwd(), process.env.ROM_DIR || 'roms');
    const romPath = path.join(romDir, gameConfig.rom);

    if (!fs.existsSync(romPath)) {
      console.log(`[Dolphin] ROM/ISO not found: ${romPath}`);
      return;
    }

    this._killEmulator();

    console.log(`[Dolphin] Launching Dolphin: ${gameConfig.rom}`);
    this.emulatorProcess = spawn(exePath, ['-e', romPath], {
      detached: true,
      stdio: 'ignore',
    });

    this.emulatorProcess.on('error', (err) => {
      console.error(`[Dolphin] Launch failed: ${err.message}`);
    });

    this.emulatorProcess.on('exit', (code) => {
      console.log(`[Dolphin] Process exited (code ${code})`);
      this.emulatorProcess = null;
    });

    console.log(`[Dolphin] Launched PID ${this.emulatorProcess.pid}`);
  }

  async disconnect() {
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
        console.log(`[Dolphin] Killed emulator process ${this.emulatorProcess.pid}`);
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
        console.log(`[Dolphin] Killed ViGEm server ${this.vigemProcess.pid}`);
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

    if (this.cstickPositions[button]) {
      return this._sendCStick(button, controller, type, duration);
    }

    if (this.analogPositions[button]) {
      return this._sendAnalog(button, controller, type, duration);
    }

    const xboxButton = this.vigemMapping[button];
    if (!xboxButton) {
      console.warn(`[Dolphin] No ViGEm mapping for button: ${button}`);
      return false;
    }

    const payload = {
      controller,
      button: xboxButton,
      action: type === 'hold' ? 'hold' : 'press',
      duration_ms: type === 'hold' ? duration : 150,
    };

    try {
      await this._httpPost('/input', payload);
      return true;
    } catch (err) {
      console.error(`[Dolphin] Input failed: ${err.message}`);
      return false;
    }
  }

  async _sendAnalog(stickDir, controller, type, duration) {
    const [x, y] = this.analogPositions[stickDir];
    try {
      await this._httpPost('/analog', {
        controller, stick: 'left', x, y,
        duration_ms: type === 'hold' ? duration : 200,
      });
      return true;
    } catch (err) {
      console.error(`[Dolphin] Analog input failed: ${err.message}`);
      return false;
    }
  }

  async _sendCStick(stickDir, controller, type, duration) {
    const [x, y] = this.cstickPositions[stickDir];
    try {
      await this._httpPost('/analog', {
        controller, stick: 'right', x, y,
        duration_ms: type === 'hold' ? duration : 200,
      });
      return true;
    } catch (err) {
      console.error(`[Dolphin] C-stick input failed: ${err.message}`);
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

module.exports = DolphinAdapter;
