#!/usr/bin/env node
// One-shot: submit a grant proposal via the relayer wallet, attributed to a
// specific signer in the description comment. Use this to manually replay a
// grant whose original gasless submission silently dropped from the mempool.
//
// Run with `railway run` so the relayer private key is loaded from Railway env:
//   railway link -p spirited-flexibility -s spirited-flexibility
//   railway run node packages/nouns-api/scripts/replay-grant.mjs
//
// Required env (or override via flags):
//   NOUNIRL_PRIVATE_KEY  — relayer private key
//   NOUNIRL_RPC_URL      — RPC URL
//
// Required CLI flags:
//   --signer 0x...       — wallet address to attribute the grant to
//   --eth 0.05           — ETH amount the grant is for (sent to signer)
//   --title "..."        — grant title (becomes "# Title")
//   --body  "..."        — grant body (markdown)

import { resolve } from 'path';

const viemPath = resolve('packages/nouns-api/node_modules/viem/_cjs/index.js');
const accountsPath = resolve('packages/nouns-api/node_modules/viem/_cjs/accounts/index.js');
const chainsPath = resolve('packages/nouns-api/node_modules/viem/_cjs/chains/index.js');
const [viem, viemAccounts, viemChains] = await Promise.all([
  import(viemPath),
  import(accountsPath),
  import(chainsPath),
]);
const { createWalletClient, createPublicClient, http, parseEther } = viem;
const { privateKeyToAccount } = viemAccounts;
const { mainnet } = viemChains;

const SMALL_GRANTS_ADDRESS = '0xBAc9233725440c595b19d975309CC98cb259253a';

// Minimal ABI — just the propose() function we need.
const proposeAbi = [
  {
    type: 'function',
    name: 'propose',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'targets', type: 'address[]' },
      { name: 'values', type: 'uint256[]' },
      { name: 'signatures', type: 'string[]' },
      { name: 'calldatas', type: 'bytes[]' },
      { name: 'description', type: 'string' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

const signer = arg('signer');
const ethAmount = arg('eth');
const title = arg('title');
const body = arg('body', '');

if (!signer || !signer.startsWith('0x') || signer.length !== 42) {
  console.error('Missing or invalid --signer 0x...');
  process.exit(1);
}
if (!ethAmount || isNaN(parseFloat(ethAmount))) {
  console.error('Missing or invalid --eth <amount>');
  process.exit(1);
}
if (!title) {
  console.error('Missing --title "..."');
  process.exit(1);
}

const pk = process.env.NOUNIRL_PRIVATE_KEY;
const rpc = process.env.NOUNIRL_RPC_URL || process.env.PONDER_RPC_URL_1;
if (!pk || !rpc) {
  console.error('NOUNIRL_PRIVATE_KEY and NOUNIRL_RPC_URL must be set in env');
  console.error('Run via: railway run node packages/nouns-api/scripts/replay-grant.mjs ...');
  process.exit(1);
}

const account = privateKeyToAccount(pk);
const wallet = createWalletClient({ chain: mainnet, transport: http(rpc), account });
const publicClient = createPublicClient({ chain: mainnet, transport: http(rpc) });

const description = `<!-- signer:${signer} -->\n# ${title.trim()}\n\n${body.trim()}`;
const targets = [signer];
const values = [parseEther(ethAmount)];
const signatures = [''];
const calldatas = ['0x'];

console.log('===== Replay Grant =====');
console.log('Relayer:        ', account.address);
console.log('Signer (target):', signer);
console.log('ETH amount:     ', ethAmount);
console.log('Title:          ', title);
console.log('Description:');
console.log(description.split('\n').map(l => '    ' + l).join('\n'));
console.log('========================');

// Compute gas params explicitly
const fees = await publicClient.estimateFeesPerGas();
const minPriority = 1_500_000_000n;
const maxPriorityFeePerGas =
  fees.maxPriorityFeePerGas && fees.maxPriorityFeePerGas > minPriority
    ? fees.maxPriorityFeePerGas
    : minPriority;
const baseGuess = fees.maxFeePerGas
  ? fees.maxFeePerGas - (fees.maxPriorityFeePerGas ?? 0n)
  : 5_000_000_000n;
const maxFeePerGas = baseGuess * 2n + maxPriorityFeePerGas;

console.log(`maxPriorityFeePerGas: ${maxPriorityFeePerGas} wei`);
console.log(`maxFeePerGas:         ${maxFeePerGas} wei`);

console.log('Press Ctrl-C in 5s to abort...');
await new Promise(r => setTimeout(r, 5000));

const txHash = await wallet.writeContract({
  address: SMALL_GRANTS_ADDRESS,
  abi: proposeAbi,
  functionName: 'propose',
  args: [targets, values, signatures, calldatas, description],
  maxPriorityFeePerGas,
  maxFeePerGas,
});

console.log(`Broadcast: ${txHash}`);
console.log(`https://etherscan.io/tx/${txHash}`);
console.log('Awaiting receipt (120s timeout)...');

const receipt = await publicClient.waitForTransactionReceipt({
  hash: txHash,
  timeout: 120_000,
  pollingInterval: 4_000,
});

console.log(`Status: ${receipt.status}`);
console.log(`Block:  ${receipt.blockNumber}`);
console.log(`Gas used: ${receipt.gasUsed}`);
if (receipt.status !== 'success') {
  console.error('TX REVERTED');
  process.exit(1);
}
console.log('SUCCESS — grant proposal landed on chain');
