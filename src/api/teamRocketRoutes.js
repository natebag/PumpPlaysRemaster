const eventBus = require('../core/EventBus');
const commandParser = require('../chat/CommandParser');

/**
 * Team Rocket Routes - Burn verification + direct command injection
 *
 * Users who burn PPP tokens can inject commands directly into the game,
 * bypassing the democratic vote. Higher burn tiers = more commands per hour.
 */
function setupTeamRocketRoutes(app, engine) {
  const { burnVerifier, walletManager } = engine;

  // Get burn tiers info
  app.get('/api/team-rocket/tiers', (req, res) => {
    res.json(burnVerifier.getTiers());
  });

  // Get burn status for a wallet
  app.get('/api/team-rocket/status/:walletAddress', (req, res) => {
    const walletAddress = req.params.walletAddress;
    const status = burnVerifier.getBurnStatus(walletAddress);
    const verified = walletManager.isSessionVerified(walletAddress);
    res.json({ ...status, wallet: walletAddress, verified });
  });

  // Record a burn — requires verified wallet + on-chain tx signature
  app.post('/api/team-rocket/burn', async (req, res) => {
    const { walletAddress, amount, txSignature } = req.body;
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress required (connect Phantom)' });
    }

    // Require verified wallet session (Phantom signature)
    if (!walletManager.isSessionVerified(walletAddress)) {
      return res.status(403).json({ error: 'Wallet not verified. Connect and sign with Phantom first.' });
    }

    let burnAmount = amount;

    // If txSignature provided, verify on-chain
    if (txSignature) {
      const verification = await burnVerifier.verifyBurnTx(txSignature, walletAddress);
      if (!verification.valid) {
        return res.status(400).json({ error: `Burn verification failed: ${verification.error}` });
      }
      burnAmount = verification.amount;
    } else if (!burnAmount || burnAmount <= 0) {
      return res.status(400).json({ error: 'amount or txSignature required' });
    }

    const result = burnVerifier.recordBurn(walletAddress, burnAmount, txSignature);
    res.json({
      success: true,
      total_burned: result.total,
      tier: result.tier,
      verified_onchain: !!txSignature,
      message: `Burn recorded: ${burnAmount} PPP${txSignature ? ' (verified on-chain)' : ''}. Total: ${result.total}`,
    });
  });

  // Inject a command (Team Rocket privilege - requires verified wallet)
  app.post('/api/team-rocket/inject', (req, res) => {
    const { walletAddress, command } = req.body;
    if (!walletAddress || !command) {
      return res.status(400).json({ error: 'walletAddress and command required' });
    }

    // Require verified wallet session
    if (!walletManager.isSessionVerified(walletAddress)) {
      return res.status(403).json({ error: 'Wallet not verified. Connect and sign with Phantom first.' });
    }

    // Check if user can inject
    const check = burnVerifier.canInjectCommand(walletAddress);
    if (!check.allowed) {
      return res.status(403).json({ error: check.reason, tier: check.tier });
    }

    // Parse and validate the command
    const parsed = commandParser.parse(command);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid command', valid: commandParser.getValidCommands() });
    }

    // Use a command slot
    burnVerifier.useCommandSlot(walletAddress);

    // Inject directly into emulator (bypass vote)
    const commandId = engine.voteManager.nextCommandId++;
    const result = {
      id: commandId,
      command: parsed.raw || command,
      parsedCommand: parsed,
      voteCount: 0,
      firstVoter: `Team Rocket (${check.tier})`,
      totalVoters: 0,
      windowNumber: -1,
      timestamp: Date.now(),
      source: 'team_rocket',
      team: parsed.team,
    };

    engine.emulatorManager.sendCommand(result);
    engine.overlayServer.broadcast('command_executed', result);

    res.json({
      success: true,
      command: parsed,
      remaining: check.remaining - 1,
      tier: check.tier,
    });
  });
}

module.exports = { setupTeamRocketRoutes };
