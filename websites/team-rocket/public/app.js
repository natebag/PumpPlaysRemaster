const API_BASE = window.PUMP_API || localStorage.getItem('pump_api') || '';
let walletAddress = null;
let walletPublicKey = null;

// PPP Token Config
const PPP_MINT = 'DxKwgDV2NZapgrpdvCHNdWcAByWuXvohKsdUAxcrpump';
const TOKEN_DECIMALS = 6;
const TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

// ─── API Helpers ───
async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(API_BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    return await res.json();
  } catch (err) {
    console.warn('API error:', err.message);
    return null;
  }
}

function apiPost(path, body) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
}

// ─── Logging ───
function addLog(text, type = '') {
  const log = document.getElementById('command-log');
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  const line = document.createElement('div');
  line.className = 'log-line ' + type;
  line.textContent = `[${time}] ${text}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function showResult(elementId, text, success) {
  const el = document.getElementById(elementId);
  el.className = 'result-msg ' + (success ? 'success' : 'error');
  el.textContent = text;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 8000);
}

// ─── Phantom Connection + Signature Verification ───
document.getElementById('btn-connect-phantom').addEventListener('click', async () => {
  if (!window.solana || !window.solana.isPhantom) {
    showResult('burn-result', 'Phantom wallet not found. Install it from phantom.app', false);
    addLog('ERROR: Phantom wallet not detected', 'err');
    return;
  }

  try {
    addLog('Connecting Phantom wallet...', 'sys');
    const resp = await window.solana.connect();
    walletPublicKey = resp.publicKey;
    walletAddress = resp.publicKey.toString();
    addLog('Wallet connected: ' + walletAddress.slice(0, 8) + '...' + walletAddress.slice(-4), 'sys');

    // Sign message to verify ownership
    addLog('Requesting signature to verify ownership...', 'sys');
    const message = new TextEncoder().encode('PUMP PLAYS: Verify wallet ownership for Team Rocket');
    const signResult = await window.solana.signMessage(message, 'utf8');

    // Send verification to backend
    const verifyResult = await apiPost('/api/wallet/verify', {
      walletAddress,
      message: Array.from(message),
      signature: Array.from(signResult.signature),
    });

    if (!verifyResult || !verifyResult.verified) {
      addLog('VERIFICATION FAILED: ' + (verifyResult?.error || 'Unknown error'), 'err');
      showResult('burn-result', 'Wallet verification failed. Try again.', false);
      walletAddress = null;
      return;
    }

    // Register wallet with backend
    await apiPost('/api/wallet/register', {
      userKey: walletAddress,
      displayName: walletAddress.slice(0, 8) + '...',
      walletAddress,
    });

    addLog('VERIFIED! Wallet ownership confirmed.', 'sys');
    onConnected();
  } catch (err) {
    addLog('Connection rejected: ' + (err.message || 'User cancelled'), 'err');
    walletAddress = null;
  }
});

function onConnected() {
  document.getElementById('connect-panel').classList.add('hidden');
  document.getElementById('terminal-panel').classList.remove('hidden');
  document.getElementById('agent-name').textContent =
    walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4);
  refreshStatus();
  loadTiers();
}

// ─── Status ───
async function refreshStatus() {
  if (!walletAddress) return;
  const data = await apiFetch('/api/team-rocket/status/' + encodeURIComponent(walletAddress));
  if (!data) return;

  document.getElementById('agent-tier').textContent = data.tier_label || data.tier || 'UNRANKED';
  document.getElementById('total-burned').textContent = (data.burned || 0).toLocaleString() + ' PPP';
  document.getElementById('commands-remaining').textContent =
    (data.commands_remaining !== undefined ? data.commands_remaining : 0) + ' / hr';

  // Highlight active tier
  document.querySelectorAll('.tier-card').forEach(card => {
    card.classList.remove('active');
    if (data.tier && card.dataset.tier === data.tier.toLowerCase()) {
      card.classList.add('active');
    }
  });
}

async function loadTiers() {
  const data = await apiFetch('/api/team-rocket/tiers');
  if (!data) return;
}

// ─── Solana Token Burn ───

/**
 * Derive the Associated Token Account for a wallet + mint
 */
async function findAssociatedTokenAddress(wallet, mint) {
  const [ata] = await solanaWeb3.PublicKey.findProgramAddress(
    [wallet.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

/**
 * Create an SPL Token burn instruction.
 * Instruction index 8 = Burn, followed by u64 amount (little-endian).
 */
function createBurnInstruction(tokenAccount, mint, owner, amount) {
  const data = new Uint8Array(9);
  data[0] = 8; // Burn instruction
  const view = new DataView(data.buffer);
  // Write amount as u64 little-endian (split into two u32s for JS compat)
  const lo = Number(BigInt(amount) & BigInt(0xFFFFFFFF));
  const hi = Number((BigInt(amount) >> BigInt(32)) & BigInt(0xFFFFFFFF));
  view.setUint32(1, lo, true);
  view.setUint32(5, hi, true);

  return new solanaWeb3.TransactionInstruction({
    keys: [
      { pubkey: tokenAccount, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: TOKEN_PROGRAM_ID,
    data,
  });
}

// ─── Burn Flow ───
document.getElementById('btn-burn').addEventListener('click', () => doBurn());

document.querySelectorAll('.burn-presets .btn-small').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('burn-amount').value = btn.dataset.amount;
    doBurn();
  });
});

async function doBurn() {
  const amount = parseInt(document.getElementById('burn-amount').value);
  if (!amount || amount <= 0) {
    showResult('burn-result', 'Enter a valid burn amount', false);
    return;
  }

  if (!walletPublicKey) {
    showResult('burn-result', 'Wallet not connected', false);
    return;
  }

  addLog(`Initiating on-chain burn of ${amount.toLocaleString()} PPP...`, 'burn');

  try {
    const connection = new solanaWeb3.Connection(SOLANA_RPC, 'confirmed');
    const mintPubkey = new solanaWeb3.PublicKey(PPP_MINT);

    // Find the user's token account for PPP
    const tokenAccount = await findAssociatedTokenAddress(walletPublicKey, mintPubkey);
    addLog('Token account: ' + tokenAccount.toString().slice(0, 8) + '...', 'sys');

    // Verify the token account exists and has sufficient balance
    try {
      const accountInfo = await connection.getTokenAccountBalance(tokenAccount);
      const balance = accountInfo.value.uiAmount || 0;
      if (balance < amount) {
        showResult('burn-result', `Insufficient balance: ${balance.toLocaleString()} PPP (need ${amount.toLocaleString()})`, false);
        addLog(`BURN FAILED: Insufficient balance (${balance.toLocaleString()} PPP)`, 'err');
        return;
      }
      addLog(`Token balance: ${balance.toLocaleString()} PPP`, 'sys');
    } catch {
      showResult('burn-result', 'No PPP token account found for this wallet', false);
      addLog('BURN FAILED: No PPP token account found', 'err');
      return;
    }

    // Create burn instruction (amount in smallest units)
    const rawAmount = amount * Math.pow(10, TOKEN_DECIMALS);
    const burnIx = createBurnInstruction(tokenAccount, mintPubkey, walletPublicKey, rawAmount);

    // Build transaction
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const transaction = new solanaWeb3.Transaction({
      recentBlockhash: blockhash,
      feePayer: walletPublicKey,
    }).add(burnIx);

    addLog('Requesting Phantom signature for burn transaction...', 'burn');

    // Sign and send via Phantom
    const { signature } = await window.solana.signAndSendTransaction(transaction);
    addLog(`Transaction sent! Signature: ${signature.slice(0, 16)}...`, 'burn');

    // Wait for confirmation
    addLog('Waiting for on-chain confirmation...', 'sys');
    await connection.confirmTransaction(signature, 'confirmed');
    addLog('Transaction CONFIRMED on-chain!', 'burn');

    // Report to backend with the tx signature for verification
    const result = await apiPost('/api/team-rocket/burn', {
      walletAddress,
      txSignature: signature,
      amount, // Backend will verify against on-chain data
    });

    if (!result || result.error) {
      // Burn happened on-chain but backend didn't record it
      showResult('burn-result', 'Tokens burned on-chain but backend sync failed. Contact support with tx: ' + signature, false);
      addLog('WARNING: On-chain burn succeeded but backend failed: ' + (result?.error || 'unreachable'), 'err');
      return;
    }

    showResult('burn-result', `Burned ${amount.toLocaleString()} PPP on-chain! Total: ${result.total_burned?.toLocaleString()}. Tier: ${result.tier}`, true);
    addLog(`BURN VERIFIED: ${amount.toLocaleString()} PPP | Tx: ${signature.slice(0, 16)}... | Tier: ${result.tier}`, 'burn');

    document.getElementById('burn-amount').value = '';
    refreshStatus();

  } catch (err) {
    if (err.message?.includes('User rejected')) {
      addLog('Burn cancelled by user', 'sys');
      showResult('burn-result', 'Transaction cancelled', false);
    } else {
      addLog('BURN ERROR: ' + err.message, 'err');
      showResult('burn-result', 'Burn failed: ' + err.message, false);
    }
  }
}

// ─── Command Injection ───
document.getElementById('btn-inject').addEventListener('click', () => {
  const cmd = document.getElementById('inject-command').value.trim();
  if (cmd) doInject(cmd);
});

document.getElementById('inject-command').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const cmd = e.target.value.trim();
    if (cmd) doInject(cmd);
  }
});

document.querySelectorAll('.cmd-btn').forEach(btn => {
  btn.addEventListener('click', () => doInject(btn.dataset.cmd));
});

async function doInject(command) {
  addLog(`Injecting command: ${command}`, 'cmd');

  const result = await apiPost('/api/team-rocket/inject', { walletAddress, command });
  if (!result) {
    showResult('inject-result', 'Inject failed - API unreachable', false);
    addLog('INJECT FAILED: API unreachable', 'err');
    return;
  }

  if (result.error) {
    showResult('inject-result', result.error, false);
    addLog('INJECT DENIED: ' + result.error, 'err');
    return;
  }

  const btn = result.command?.button || command;
  showResult('inject-result', `Command "${btn}" injected! (${result.remaining} remaining)`, true);
  addLog(`INJECTED: ${btn} | Remaining: ${result.remaining}`, 'cmd');

  document.getElementById('inject-command').value = '';
  refreshStatus();
}

// ─── Refresh ───
setInterval(refreshStatus, 15000);
