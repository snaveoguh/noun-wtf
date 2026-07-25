// Propose a new NounV2 art trait via governance. Wraps src/agent/traitProposal.ts.
// Run with node's TS stripper:
//
//   node --experimental-strip-types scripts/propose-trait.mjs \
//     --category head --title "Joker" --description-file ./desc.md \
//     --derive-from index-card --swap-runs 1,7 \
//     [--rle 0x..] [--recolor 57:141,141:57] \
//     [--simulate --from 0xPROPOSER] \
//     [--send --key-env NOUNIRL_PRIVATE_KEY --rpc "$RPC"]
//
// Provide EITHER --rle <hex>, OR --derive-from <name|index> with --swap-runs / --recolor.
// Nothing is broadcast unless --send is passed. Keys are read from env, never printed.

import { readFileSync } from 'node:fs';
import { buildTraitProposal, V2_TREASURY } from '../src/agent/traitProposal.ts';

const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = name => process.argv.includes(`--${name}`);

const category = arg('category') || 'head';
const title = arg('title') || 'New trait';
const description = arg('description-file')
  ? readFileSync(arg('description-file'), 'utf8')
  : arg('description') || '';

const derivation = {};
if (arg('swap-runs')) derivation.swapRunColors = arg('swap-runs').split(',').map(Number);
if (arg('recolor'))
  derivation.recolor = arg('recolor').split(',').map(p => p.split(':').map(Number));

const imageData = JSON.parse(
  readFileSync(new URL('../src/agent/image-data-v2.json', import.meta.url), 'utf8'),
);

const proposal = buildTraitProposal({
  category, title, description,
  rleHex: arg('rle'),
  deriveFrom: arg('derive-from') ? { imageData, source: arg('derive-from'), derivation } : undefined,
});

console.log(`\n── ${category} trait proposal ───────────────────────────────`);
console.log('RLE (raw)   :', proposal.add.rleHex, `(${proposal.add.decompressedLength} B)`);
console.log('DEFLATE     :', proposal.add.compressedHex);
console.log('signature   :', proposal.signatures[0]);
console.log('target      :', proposal.targets[0], '(V2 descriptor)');
console.log('treasury    :', V2_TREASURY);
console.log('\npropose() fields:');
console.log('  targets   :', JSON.stringify(proposal.targets));
console.log('  values    :', JSON.stringify(proposal.values.map(String)));
console.log('  signatures:', JSON.stringify(proposal.signatures));
console.log('  calldatas :', JSON.stringify(proposal.calldatas));
console.log('\nfull propose() calldata (raw send to treasury):');
console.log(proposal.proposeCalldata);

async function onchain() {
  const { createPublicClient, createWalletClient, http } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');
  const { mainnet } = await import('viem/chains');
  const rpc = arg('rpc') || process.env.NOUNIRL_RPC_URL;
  if (!rpc) throw new Error('need --rpc or NOUNIRL_RPC_URL');
  const pub = createPublicClient({ chain: mainnet, transport: http(rpc) });

  if (has('simulate')) {
    const from = arg('from');
    if (!from) throw new Error('--simulate needs --from <proposer address>');
    await pub.call({ account: from, to: V2_TREASURY, data: proposal.proposeCalldata });
    console.log('\nSIMULATE    : OK from', from, '(propose would not revert)');
  }
  if (has('send')) {
    const keyEnv = arg('key-env') || 'NOUNIRL_PRIVATE_KEY';
    const pk = process.env[keyEnv];
    if (!pk) throw new Error(`${keyEnv} not set in env`);
    const account = privateKeyToAccount(pk);
    await pub.call({ account: account.address, to: V2_TREASURY, data: proposal.proposeCalldata });
    const wallet = createWalletClient({ account, chain: mainnet, transport: http(rpc) });
    const hash = await wallet.sendTransaction({ to: V2_TREASURY, data: proposal.proposeCalldata });
    console.log('\nBROADCAST   : https://etherscan.io/tx/' + hash, '\nproposer    :', account.address);
  }
}
if (has('simulate') || has('send'))
  onchain().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
