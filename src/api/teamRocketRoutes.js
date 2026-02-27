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

  // Get burn status for a user
  app.get('/api/team-rocket/status/:userKey', (req, res) => {
    const status = burnVerifier.getBurnStatus(req.params.userKey);
    const wallet = walletManager.getWallet(req.params.userKey);
    res.json({ ...status, wallet: wallet?.wallet_address || null });
  });

  // Record a burn — with optional on-chain verification via tx signature
  app.post('/api/team-rocket/burn', async (req, res) => {
    const { userKey, amount, txSignature } = req.body;
    if (!userKey) {
      return res.status(400).json({ error: 'userKey required' });
    }

    let burnAmount = amount;

    // If txSignature provided, verify on-chain
    if (txSignature) {
      const wallet = walletManager.getAddress(userKey);
      if (!wallet) {
        return res.status(400).json({ error: 'User has no registered wallet. Register with !wallet first.' });
      }

      const verification = await burnVerifier.verifyBurnTx(txSignature, wallet);
      if (!verification.valid) {
        return res.status(400).json({ error: `Burn verification failed: ${verification.error}` });
      }
      burnAmount = verification.amount;
    } else if (!burnAmount || burnAmount <= 0) {
      return res.status(400).json({ error: 'amount or txSignature required' });
    }

    const result = burnVerifier.recordBurn(userKey, burnAmount);
    res.json({
      success: true,
      total_burned: result.total,
      tier: result.tier,
      verified: !!txSignature,
      message: `Burn recorded: ${burnAmount} PPP${txSignature ? ' (verified on-chain)' : ''}. Total: ${result.total}`,
    });
  });

  // Inject a command (Team Rocket privilege)
  app.post('/api/team-rocket/inject', (req, res) => {
    const { userKey, command } = req.body;
    if (!userKey || !command) {
      return res.status(400).json({ error: 'userKey and command required' });
    }

    // Check if user can inject
    const check = burnVerifier.canInjectCommand(userKey);
    if (!check.allowed) {
      return res.status(403).json({ error: check.reason, tier: check.tier });
    }

    // Parse and validate the command
    const parsed = commandParser.parse(command);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid command', valid: commandParser.getValidCommands() });
    }

    // Use a command slot
    burnVerifier.useCommandSlot(userKey);

    // Inject directly into emulator (bypass vote)
    const commandId = engine.voteManager.nextCommandId++;
    const result = {
      id: commandId,
      command: parsed,
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
