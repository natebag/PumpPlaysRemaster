const eventBus = require('../core/EventBus');

// States: IDLE → COLLECTING → PROCESSING → IDLE
const PHASE = { IDLE: 'idle', COLLECTING: 'collecting', PROCESSING: 'processing' };

class VoteManager {
  constructor(gameConfig) {
    this.windowMs = gameConfig?.vote_window_ms || parseInt(process.env.VOTE_WINDOW_MS) || 3000;
    this.phase = PHASE.IDLE;
    this.timer = null;

    // Multiplayer config
    this.multiplayer = gameConfig?.multiplayer?.enabled || false;
    this.maxPlayers = gameConfig?.multiplayer?.max_players || 1;

    // Current window state (single-player / non-team votes)
    this.votes = new Map();         // command_raw → count
    this.userVotes = new Map();     // userKey → command_raw
    this.firstVoters = new Map();   // command_raw → { userKey, displayName }
    this.commandData = new Map();   // command_raw → parsed command object

    // Team voting state (for multiplayer games like Stadium)
    // Each team gets its own independent vote pool
    this.teamVotes = new Map();       // teamNum → Map<cmd, count>
    this.teamUserVotes = new Map();   // teamNum → Map<userKey, cmd>
    this.teamFirstVoters = new Map(); // teamNum → Map<cmd, {userKey, displayName}>
    this.teamCommandData = new Map(); // teamNum → Map<cmd, parsed command>

    // Persistent stats
    this.totalVotes = 0;
    this.lastCommand = null;
    this.windowCount = 0;
    this.activeUsers = new Set();   // users who voted in current window
    this.sessionUsers = new Set();  // all users this session
    this.voteHistory = [];          // last 50 executed commands

    // Command ID tracking for ACK contract
    this.nextCommandId = 1;
  }

  start() {
    if (this.phase !== PHASE.IDLE) return;
    const mode = this.multiplayer ? `${this.maxPlayers}-player team` : 'standard';
    console.log(`[Vote] Starting vote cycles (${this.windowMs}ms windows, ${mode} mode)`);
    this._startWindow();
  }

  stop() {
    this.phase = PHASE.IDLE;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[Vote] Stopped');
  }

  reconfigure(gameConfig) {
    this.windowMs = gameConfig?.vote_window_ms || parseInt(process.env.VOTE_WINDOW_MS) || 3000;
    this.multiplayer = gameConfig?.multiplayer?.enabled || false;
    this.maxPlayers = gameConfig?.multiplayer?.max_players || 1;
  }

  addVote(userKey, command, displayName, weight = 1) {
    // Only accept votes during COLLECTING phase
    if (this.phase !== PHASE.COLLECTING) return false;

    this.totalVotes++;
    this.activeUsers.add(userKey);
    this.sessionUsers.add(userKey);

    // Route to team voting if multiplayer and command has a team
    if (this.multiplayer && command.team) {
      return this._addTeamVote(command.team, userKey, command, displayName, weight);
    }

    // Standard single-pool voting
    const cmdKey = command.raw;

    // If user already voted this window, remove their previous vote
    if (this.userVotes.has(userKey)) {
      const prevCmd = this.userVotes.get(userKey);
      const prevCount = this.votes.get(prevCmd) || 0;
      if (prevCount > weight) {
        this.votes.set(prevCmd, prevCount - weight);
      } else {
        this.votes.delete(prevCmd);
      }
    }

    // Record new vote
    this.userVotes.set(userKey, cmdKey);
    this.votes.set(cmdKey, (this.votes.get(cmdKey) || 0) + weight);

    // Store parsed command data (type, button, duration, etc.)
    if (!this.commandData.has(cmdKey)) {
      this.commandData.set(cmdKey, command);
    }

    // Track first voter for this command
    if (!this.firstVoters.has(cmdKey)) {
      this.firstVoters.set(cmdKey, { userKey, displayName });
    }

    // Broadcast update
    eventBus.emitSafe('vote:update', this._getVoteState());
    return true;
  }

  _addTeamVote(team, userKey, command, displayName, weight) {
    if (team < 1 || team > this.maxPlayers) return false;

    const cmdKey = command.raw;

    // Initialize team maps if needed
    if (!this.teamVotes.has(team)) {
      this.teamVotes.set(team, new Map());
      this.teamUserVotes.set(team, new Map());
      this.teamFirstVoters.set(team, new Map());
      this.teamCommandData.set(team, new Map());
    }

    const votes = this.teamVotes.get(team);
    const userVotes = this.teamUserVotes.get(team);
    const firstVoters = this.teamFirstVoters.get(team);
    const cmdData = this.teamCommandData.get(team);

    // Remove previous vote for this user on this team
    if (userVotes.has(userKey)) {
      const prevCmd = userVotes.get(userKey);
      const prevCount = votes.get(prevCmd) || 0;
      if (prevCount > weight) {
        votes.set(prevCmd, prevCount - weight);
      } else {
        votes.delete(prevCmd);
      }
    }

    // Record new vote
    userVotes.set(userKey, cmdKey);
    votes.set(cmdKey, (votes.get(cmdKey) || 0) + weight);

    if (!cmdData.has(cmdKey)) {
      cmdData.set(cmdKey, command);
    }

    if (!firstVoters.has(cmdKey)) {
      firstVoters.set(cmdKey, { userKey, displayName });
    }

    eventBus.emitSafe('vote:update', this._getVoteState());
    return true;
  }

  _startWindow() {
    this.phase = PHASE.COLLECTING;
    this.votes.clear();
    this.userVotes.clear();
    this.firstVoters.clear();
    this.commandData.clear();
    this.teamVotes.clear();
    this.teamUserVotes.clear();
    this.teamFirstVoters.clear();
    this.teamCommandData.clear();
    this.activeUsers.clear();
    this.windowStart = Date.now();
    this.windowCount++;

    eventBus.emitSafe('vote:update', this._getVoteState());

    this.timer = setTimeout(() => this._endWindow(), this.windowMs);
  }

  _endWindow() {
    this.phase = PHASE.PROCESSING;

    if (this.multiplayer && this.teamVotes.size > 0) {
      // Multiplayer: determine winner per team
      this._endWindowMultiplayer();
    } else {
      // Standard: single winner
      const winner = this._determineWinner();
      if (winner) {
        const commandId = this.nextCommandId++;
        const result = {
          id: commandId,
          command: winner.command,
          parsedCommand: winner.parsedCommand,
          voteCount: winner.voteCount,
          firstVoter: winner.firstVoter,
          firstVoterKey: winner.firstVoterKey,
          totalVoters: this.activeUsers.size,
          windowNumber: this.windowCount,
          timestamp: Date.now(),
        };

        this.lastCommand = result;
        this.voteHistory.push(result);
        if (this.voteHistory.length > 50) this.voteHistory.shift();

        eventBus.emitSafe('vote:winner', result);
      }
    }

    // Start next window
    this.phase = PHASE.IDLE;
    this._startWindow();
  }

  _endWindowMultiplayer() {
    // Emit a winner for each team that has votes
    for (let team = 1; team <= this.maxPlayers; team++) {
      const votes = this.teamVotes.get(team);
      const firstVoters = this.teamFirstVoters.get(team);
      const cmdData = this.teamCommandData.get(team);
      if (!votes || votes.size === 0) continue;

      const winner = this._determineWinnerFromPool(votes, firstVoters, cmdData);
      if (!winner) continue;

      const commandId = this.nextCommandId++;
      const result = {
        id: commandId,
        command: winner.command,
        parsedCommand: winner.parsedCommand,
        team,
        voteCount: winner.voteCount,
        firstVoter: winner.firstVoter,
        firstVoterKey: winner.firstVoterKey,
        totalVoters: this.activeUsers.size,
        windowNumber: this.windowCount,
        timestamp: Date.now(),
      };

      this.lastCommand = result;
      this.voteHistory.push(result);
      if (this.voteHistory.length > 50) this.voteHistory.shift();

      eventBus.emitSafe('vote:winner', result);
    }
  }

  _determineWinner() {
    return this._determineWinnerFromPool(this.votes, this.firstVoters, this.commandData);
  }

  _determineWinnerFromPool(votes, firstVoters, cmdDataMap) {
    if (votes.size === 0) return null;

    let maxVotes = 0;
    const candidates = [];

    for (const [cmd, count] of votes) {
      if (count > maxVotes) {
        maxVotes = count;
        candidates.length = 0;
        candidates.push(cmd);
      } else if (count === maxVotes) {
        candidates.push(cmd);
      }
    }

    // Random tiebreaker
    const winnerCmd = candidates[Math.floor(Math.random() * candidates.length)];
    const firstVoter = firstVoters?.get(winnerCmd) || { displayName: 'Unknown' };
    const parsedCommand = cmdDataMap?.get(winnerCmd) || null;

    return {
      command: winnerCmd,
      parsedCommand,
      voteCount: maxVotes,
      firstVoter: firstVoter.displayName,
      firstVoterKey: firstVoter.userKey || null,
    };
  }

  _getVoteState() {
    const elapsed = Date.now() - (this.windowStart || Date.now());
    const remaining = Math.max(0, this.windowMs - elapsed);

    // Convert votes Map to plain object for serialization
    const votesObj = {};
    for (const [cmd, count] of this.votes) {
      votesObj[cmd] = count;
    }

    const state = {
      votes: votesObj,
      time_remaining_ms: remaining,
      phase: this.phase,
      window_ms: this.windowMs,
      voter_count: this.activeUsers.size,
      multiplayer: this.multiplayer,
    };

    // Include team vote data for multiplayer
    if (this.multiplayer) {
      state.teams = {};
      for (let team = 1; team <= this.maxPlayers; team++) {
        const teamVotes = this.teamVotes.get(team);
        if (teamVotes) {
          state.teams[team] = Object.fromEntries(teamVotes);
        } else {
          state.teams[team] = {};
        }
      }
    }

    return state;
  }

  getLastCommand() {
    return this.lastCommand;
  }

  getActiveUserCount() {
    return this.sessionUsers.size;
  }

  getStats() {
    return {
      phase: this.phase,
      totalVotes: this.totalVotes,
      windowCount: this.windowCount,
      activeUsersThisWindow: this.activeUsers.size,
      sessionUsers: this.sessionUsers.size,
      lastCommand: this.lastCommand,
      currentVotes: Object.fromEntries(this.votes),
      multiplayer: this.multiplayer,
      maxPlayers: this.maxPlayers,
    };
  }

  getChaosLevel() {
    if (this.votes.size <= 1) return 0;
    const total = Array.from(this.votes.values()).reduce((a, b) => a + b, 0);
    if (total === 0) return 0;
    // Shannon entropy normalized to 0-1
    let entropy = 0;
    for (const count of this.votes.values()) {
      const p = count / total;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    const maxEntropy = Math.log2(this.votes.size);
    return maxEntropy > 0 ? entropy / maxEntropy : 0;
  }
}

module.exports = VoteManager;
