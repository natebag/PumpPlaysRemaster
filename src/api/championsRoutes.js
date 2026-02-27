const commandParser = require('../chat/CommandParser');

/**
 * Champions DAO Routes - Token-gated command injection
 *
 * Users holding sufficient PPP tokens can inject commands for free.
 * Balance is checked on-chain (or cached) to determine access tier.
 */
function setupChampionsRoutes(app, engine) {
  const { balanceGate, walletManager } = engine;

  // Get champion tiers info
  app.get('/api/champions/tiers', (req, res) => {
    res.json(balanceGate.getTiers());
  });

  // Check champion status for a wallet address
  app.get('/api/champions/status/:walletAddress', async (req, res) => {
    const walletAddress = req.params.walletAddress;
    const verified = walletManager.isSessionVerified(walletAddress);

    if (!verified) {
      return res.json({ tier: null, verified: false, message: 'Wallet not verified. Connect Phantom and sign to verify.' });
    }

    const balance = await balanceGate.checkBalance(walletAddress);
    const canInject = balanceGate.canInjectCommand(walletAddress, walletAddress);

    res.json({
      wallet: walletAddress,
      verified: true,
      balance: balance.balance,
      tier: balance.tier,
      can_inject: canInject.allowed,
      commands_remaining: canInject.remaining,
    });
  });

  // Inject a command (Champions privilege - requires verified wallet)
  app.post('/api/champions/inject', async (req, res) => {
    const { walletAddress, command } = req.body;
    if (!walletAddress || !command) {
      return res.status(400).json({ error: 'walletAddress and command required' });
    }

    // Require verified wallet session
    if (!walletManager.isSessionVerified(walletAddress)) {
      return res.status(403).json({ error: 'Wallet not verified. Connect and sign with Phantom first.' });
    }

    // Check balance and access
    const check = balanceGate.canInjectCommand(walletAddress, walletAddress);
    if (!check.allowed) {
      return res.status(403).json({ error: check.reason, tier: check.tier });
    }

    // Parse command
    const parsed = commandParser.parse(command);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid command', valid: commandParser.getValidCommands() });
    }

    // Use a command slot
    balanceGate.useCommandSlot(walletAddress);

    // Inject directly
    const commandId = engine.voteManager.nextCommandId++;
    const result = {
      id: commandId,
      command: parsed.raw || command,
      parsedCommand: parsed,
      voteCount: 0,
      firstVoter: `Champion (${check.tier})`,
      totalVoters: 0,
      windowNumber: -1,
      timestamp: Date.now(),
      source: 'champions',
      team: parsed.team,
    };

    engine.emulatorManager.sendCommand(result);
    engine.overlayServer.broadcast('command_executed', result);

    res.json({
      success: true,
      command: parsed,
      remaining: check.remaining === -1 ? 'unlimited' : check.remaining - 1,
      tier: check.tier,
    });
  });
}

module.exports = { setupChampionsRoutes };
