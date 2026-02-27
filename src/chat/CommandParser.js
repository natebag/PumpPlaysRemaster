const config = require('../core/ConfigManager');

class CommandParser {
  parse(rawMessage) {
    const text = rawMessage.trim().toLowerCase();
    const gameConfig = config.getActiveGame();
    const systemConfig = gameConfig?.systemConfig;
    if (!systemConfig) return null;

    // Strip command prefix if present
    let command = text;
    const prefixes = systemConfig.command_prefixes || ['-', '/', '!', '.'];
    for (const prefix of prefixes) {
      if (command.startsWith(prefix)) {
        command = command.slice(prefix.length).trim();
        break;
      }
    }

    if (!command) return null;

    // Check for team prefix (multiplayer games like Stadium)
    // e.g., "1a" = team 1 press A, "2up" = team 2 press up
    let team = null;
    const teamPrefixes = gameConfig?.multiplayer?.team_prefixes;
    if (teamPrefixes && gameConfig?.multiplayer?.enabled) {
      for (const tp of teamPrefixes) {
        if (command.startsWith(tp) && command.length > tp.length) {
          team = parseInt(tp);
          command = command.slice(tp.length);
          break;
        }
      }
    }

    // Resolve aliases
    const aliases = systemConfig.aliases || {};
    if (aliases[command]) {
      command = aliases[command];
    }

    // Check for hold command (e.g. "holda", "holdup 500")
    if (systemConfig.hold_commands) {
      const holdPrefix = systemConfig.hold_prefix || 'hold';
      const holdMatch = command.match(new RegExp(`^${holdPrefix}(\\w+)(?:\\s+(\\d+))?$`));
      if (holdMatch) {
        const button = holdMatch[1];
        const resolvedButton = aliases[button] || button;
        if (systemConfig.buttons[resolvedButton]) {
          let duration = holdMatch[2] ? parseInt(holdMatch[2]) : systemConfig.hold_default_ms;
          duration = Math.max(systemConfig.hold_min_ms, Math.min(systemConfig.hold_max_ms, duration));
          return { type: 'hold', button: resolvedButton, duration, raw: command, team };
        }
      }
    }

    // Check for standard button press
    if (systemConfig.buttons[command]) {
      return { type: 'press', button: command, raw: command, team };
    }

    return null;
  }

  isValid(rawMessage) {
    return this.parse(rawMessage) !== null;
  }

  getValidCommands() {
    const systemConfig = config.getActiveGame()?.systemConfig;
    if (!systemConfig) return [];
    const commands = Object.keys(systemConfig.buttons);
    if (systemConfig.hold_commands) {
      const holdPrefix = systemConfig.hold_prefix || 'hold';
      commands.push(...Object.keys(systemConfig.buttons).map(b => `${holdPrefix}${b}`));
    }
    return commands;
  }
}

module.exports = new CommandParser();
