#!/usr/bin/env node
// Fake `baw` (Binance Agentic Wallet CLI) for tests. Canned JSON shaped like the
// x402-payment / wallet docs. Never touches a real wallet.
// Env: FAKE_BAW_MODE  ok | noisy | none_ready | expensive | approve | preview_fail | garbage
//      FAKE_BAW_LOG   file that receives one JSON line of argv per call
//      FAKE_BAW_STATE counter file for tx-history polling
import fs from 'node:fs';

const args = process.argv.slice(2);
if (!args.length) process.exit(0); // harmless if a test runner ever executes this file directly

const mode = process.env.FAKE_BAW_MODE || 'ok';
if (process.env.FAKE_BAW_LOG) fs.appendFileSync(process.env.FAKE_BAW_LOG, JSON.stringify(args) + '\n');

const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = (obj, code = 0) => {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  process.exit(code);
};
const fail = (name, message, code = 1) => out({ success: false, error: { code: 10000001, name, message } }, code);

process.stderr.write('[fake-baw] cli 1.11.0\n');
if (!args.includes('--json')) fail('NO_JSON', 'expected --json');
const [group, cmd] = args;

if (group === 'x402-payment' && cmd === 'preview') {
  if (mode === 'garbage') {
    process.stdout.write('segfault-ish nonsense\n');
    process.exit(3);
  }
  const raw = flag('--paymentRequirements');
  let pr = null;
  try { pr = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch { /* not base64 json */ }
  if (!pr) { try { pr = JSON.parse(raw); } catch { /* not json */ } }
  if (!pr || pr.x402Version !== 2 || !Array.isArray(pr.accepts)) fail('INVALID_PAYMENT_REQUIREMENTS', 'bad paymentRequirements');
  if (mode === 'preview_fail') fail('UNCONNECTED', 'Wallet not connected. Please sign in first.');
  const acc = pr.accepts[0];
  const base = {
    scheme: 'exact', assetTransferMethod: 'permit2', binanceChainId: '56', tokenAddress: acc.asset, tokenSymbol: 'USDT',
    amount: '0.1', amountUsd: mode === 'expensive' ? '5.00' : '0.10', payTo: acc.payTo,
    userWalletAddress: '0x2222222222222222222222222222222222222222', currentBalance: '12', currentBalanceUsd: '12.00',
    needApproveFirst: mode === 'approve', originalAccept: acc,
  };
  const options = mode === 'none_ready'
    ? [
        { ...base, index: 1, status: 'ACTION_REQUIRED', reasons: ['INSUFFICIENT_BALANCE'], currentBalance: '0.01' },
        { index: 2, status: 'NOT_SIGNABLE', reasons: ['UNSUPPORTED_NETWORK'], scheme: 'exact', originalAccept: acc },
      ]
    : [
        { ...base, index: 1, status: 'ACTION_REQUIRED', reasons: ['INSUFFICIENT_BALANCE'] },
        { ...base, index: 2, status: 'READY_TO_SIGN', reasons: [] },
        { ...base, index: 3, status: 'READY_TO_SIGN', reasons: [] },
      ];
  if (mode === 'noisy') process.stdout.write('A new version of baw is available: 1.12.0\n');
  out({ success: true, data: { paymentId: 'pay-123', options } });
}

if (group === 'x402-payment' && cmd === 'sign') {
  const approve = mode === 'approve';
  out({
    success: true,
    data: {
      paymentHeaderName: 'PAYMENT-SIGNATURE',
      paymentHeaderValue: `sig:${flag('--paymentId')}:${flag('--selectedIndex')}`,
      approveTxHash: approve ? '0x' + 'ab'.repeat(32) : null,
      binanceChainId: approve ? '56' : null,
      signatureExpiresAt: Math.floor(Date.now() / 1000) + 600,
    },
  });
}

if (group === 'wallet' && cmd === 'tx-history') {
  const sf = process.env.FAKE_BAW_STATE;
  let n = 0;
  if (sf) {
    try { n = Number(fs.readFileSync(sf, 'utf8')) || 0; } catch { /* first call */ }
    fs.writeFileSync(sf, String(n + 1));
  }
  out({
    success: true,
    data: { transactions: [{ txType: 'approve', txHash: flag('--tx'), binanceChainId: '56', status: n < 2 ? 'pending' : 'confirmed' }], hasMore: false },
  });
}

fail('UNKNOWN_COMMAND', `unknown command ${group} ${cmd}`);
