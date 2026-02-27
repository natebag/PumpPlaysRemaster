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

  // Check champion status for a user
  app.get('/api/champions/status/:userKey', async (req, res) => {
    const wallet = walletManager.getWallet(req.params.userKey);
    if (!wallet) {
      return res.json({ tier: null, message: 'No wallet registered. Use !wallet <address>' });
    }

    const balance = await balanceGate.checkBalance(wallet.wallet_address);
    const canInject = balanceGate.canInjectCommand(wallet.wallet_address, req.params.userKey);

    res.json({
      wallet: wallet.wallet_address,
      balance: balance.balance,
      tier: balance.tier,
      can_inject: canInject.allowed,
      commands_remaining: canInject.remaining,
    });
  });

  // Inject a command (Champions privilege)
  app.post('/api/champions/inject', async (req, res) => {
    const { userKey, command } = req.body;
    if (!userKey || !command) {
      return res.status(400).json({ error: 'userKey and command required' });
    }

    // Get wallet
    const wallet = walletManager.getWallet(userKey);
    if (!wallet) {
      return res.status(403).json({ error: 'No wallet registered' });
    }

    // Check balance and access
    const check = balanceGate.canInjectCommand(wallet.wallet_address, userKey);
    if (!check.allowed) {
      return res.status(403).json({ error: check.reason, tier: check.tier });
    }

    // Parse command
    const parsed = commandParser.parse(command);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid command', valid: commandParser.getValidCommands() });
    }

    // Use a command slot
    balanceGate.useCommandSlot(userKey);

    // Inject directly
    const commandId = engine.voteManager.nextCommandId++;
    const result = {
      id: commandId,
      command: parsed,
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

  // Manually set balance for testing
  app.post('/api/champions/set-balance', (req, res) => {
    const { walletAddress, balance } = req.body;
    if (!walletAddress || balance === undefined) {
      return res.status(400).json({ error: 'walletAddress and balance required' });
    }
    const result = balanceGate.setBalance(walletAddress, balance);
    res.json({ success: true, ...result });
  });
}

module.exports = { setupChampionsRoutes };
