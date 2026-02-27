#!/usr/bin/env node
/**
 * Setup Live Wallet - Generate or validate distributor wallet configuration
 *
 * Usage:
 *   node scripts/setup-live-wallet.js --generate   Generate a new wallet keypair
 *   node scripts/setup-live-wallet.js              Check current config status
 */
require('dotenv').config();
const { Keypair } = require('@solana/web3.js');

const args = process.argv.slice(2);

if (args.includes('--generate')) {
  const wallet = Keypair.generate();
  const privateKeyArray = Array.from(wallet.secretKey);

  console.log('');
  console.log('=== NEW DISTRIBUTOR WALLET ===');
  console.log('');
  console.log(`Public Key:  ${wallet.publicKey.toString()}`);
  console.log(`Private Key: [${privateKeyArray.join(',')}]`);
  console.log('');
  console.log('Add these to your .env file:');
  console.log('');
  console.log(`DISTRIBUTOR_PRIVATE_KEY=[${privateKeyArray.join(',')}]`);
  console.log('');
  console.log('IMPORTANT: Fund this wallet with:');
  console.log('  1. SOL for transaction fees (~0.1 SOL recommended)');
  console.log('  2. PPP tokens to distribute');
  console.log('  3. Extra SOL for ATA creation (~0.003 SOL per unique recipient)');
  console.log('');
} else {
  console.log('');
  console.log('=== PUMP PLAYS REMASTER - Wallet Config ===');
  console.log('');

  const checks = [
    { name: 'SOLANA_RPC_URL', value: process.env.SOLANA_RPC_URL, sensitive: false },
    { name: 'SPL_TOKEN_MINT', value: process.env.SPL_TOKEN_MINT, sensitive: false },
    { name: 'DISTRIBUTOR_PRIVATE_KEY', value: process.env.DISTRIBUTOR_PRIVATE_KEY, sensitive: true },
    { name: 'ENABLE_ECONOMY', value: process.env.ENABLE_ECONOMY, sensitive: false },
    { name: 'TEST_TOKEN_POOL', value: process.env.TEST_TOKEN_POOL || '2000000 (default)', sensitive: false },
    { name: 'DISTRIBUTION_DAYS', value: process.env.DISTRIBUTION_DAYS || '14 (default)', sensitive: false },
  ];

  for (const c of checks) {
    const display = c.sensitive && c.value ? '[SET]' : (c.value || 'NOT SET');
    const icon = c.value ? '[OK]' : '[--]';
    console.log(`  ${icon} ${c.name}: ${display}`);
  }

  // If private key is set, show the public key
  if (process.env.DISTRIBUTOR_PRIVATE_KEY) {
    try {
      const keyArray = JSON.parse(process.env.DISTRIBUTOR_PRIVATE_KEY);
      const wallet = Keypair.fromSecretKey(new Uint8Array(keyArray));
      console.log('');
      console.log(`  Distributor Public Key: ${wallet.publicKey.toString()}`);
    } catch (err) {
      console.log('');
      console.log(`  [ERROR] Invalid DISTRIBUTOR_PRIVATE_KEY: ${err.message}`);
    }
  }

  const pool = parseInt(process.env.TEST_TOKEN_POOL) || 2000000;
  const days = parseInt(process.env.DISTRIBUTION_DAYS) || 14;
  const perHour = Math.floor(pool / (days * 24));
  console.log('');
  console.log(`  Distribution: ${pool.toLocaleString()} tokens over ${days} days = ${perHour.toLocaleString()} PPP/hour`);
  console.log('');

  if (!process.env.DISTRIBUTOR_PRIVATE_KEY) {
    console.log('  Run with --generate to create a new wallet.');
    console.log('');
  }
}
