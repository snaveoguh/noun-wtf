// Deploy ExactBlockSettler from the NounIRL bot wallet.
// Run from packages/nouns-api with the bot env injected (key stays in env, never printed):
//   railway run node scripts/deploy-settler.mjs
// Prints ONLY the deployer address, tx hash, and deployed contract address.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

const pk = process.env.NOUNIRL_PRIVATE_KEY;
if (!pk) {
  console.error('NOUNIRL_PRIVATE_KEY not set — run via `railway run` so the bot env is injected.');
  process.exit(1);
}

const rpc = process.env.NOUNIRL_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
console.log('Deployer:', account.address);

const here = dirname(fileURLToPath(import.meta.url));
const artifact = JSON.parse(
  readFileSync(join(here, '../contracts/out/ExactBlockSettler.sol/ExactBlockSettler.json'), 'utf8'),
);
const bytecode = artifact.bytecode.object;
if (!bytecode || bytecode.length < 100) {
  console.error('Artifact bytecode missing — run `forge build` in packages/nouns-api/contracts first.');
  process.exit(1);
}

const publicClient = createPublicClient({ chain: mainnet, transport: http(rpc) });
const walletClient = createWalletClient({ account, chain: mainnet, transport: http(rpc) });

const balance = await publicClient.getBalance({ address: account.address });
console.log('Balance:', Number(balance) / 1e18, 'ETH');

const hash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode,
});
console.log('Deploy tx:', hash);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== 'success') {
  console.error('Deploy REVERTED');
  process.exit(1);
}
console.log('ExactBlockSettler deployed at:', receipt.contractAddress);
console.log('Gas used:', receipt.gasUsed.toString());
console.log('\nNext steps:');
console.log(`  railway variables --set NOUNIRL_SETTLER_ADDRESS=${receipt.contractAddress}`);
console.log('  railway redeploy   # variables --set does NOT restart the service');
