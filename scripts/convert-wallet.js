#!/usr/bin/env node
/**
 * Convert Wallet - Convert BIP39 seed phrase to Solana keypair
 *
 * Usage:
 *   node scripts/convert-wallet.js word1 word2 word3 ... word12
 *
 * Uses standard Solana derivation path: m/44'/501'/0'/0'
 * Output: Public key + Private key array (for DISTRIBUTOR_PRIVATE_KEY env var)
 */
const { Keypair } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');

const seedPhrase = process.argv.slice(2).join(' ').trim();

if (!seedPhrase) {
  console.log('');
  console.log('Usage: node scripts/convert-wallet.js <seed phrase words>');
  console.log('');
  console.log('Example:');
  console.log('  node scripts/convert-wallet.js apple banana cherry ...');
  console.log('');
  process.exit(1);
}

// Validate seed phrase
if (!bip39.validateMnemonic(seedPhrase)) {
  console.error('Invalid BIP39 seed phrase. Check your words and try again.');
  process.exit(1);
}

const seed = bip39.mnemonicToSeedSync(seedPhrase);
const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
const keypair = Keypair.fromSeed(derivedSeed);

console.log('');
console.log('=== DERIVED SOLANA KEYPAIR ===');
console.log('');
console.log(`Public Key:  ${keypair.publicKey.toString()}`);
console.log(`Private Key: [${Array.from(keypair.secretKey).join(',')}]`);
console.log('');
console.log('For .env:');
console.log(`DISTRIBUTOR_PRIVATE_KEY=[${Array.from(keypair.secretKey).join(',')}]`);
console.log('');
