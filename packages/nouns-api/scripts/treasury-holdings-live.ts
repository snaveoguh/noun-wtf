// Read the live treasury holdings from mainnet and square them with the
// deployed /api/treasury/flows stats — the same code the route runs.
//
//   cd packages/nouns-api && npx tsx scripts/treasury-holdings-live.ts [rpc] [api]
//
// Defaults: publicnode for eth_call, the production Railway API for the flows.
import type { TreasuryFlowsResponse } from '../src/api/treasury/types.js';

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

import { reconcile } from '../src/api/treasury/holdings.js';
import { readHoldings } from '../src/api/treasury/readHoldings.js';

const RPC = process.argv[2] ?? 'https://ethereum-rpc.publicnode.com';
const API = process.argv[3] ?? 'https://spirited-flexibility-production-3c30.up.railway.app';

const rpc = createPublicClient({ chain: mainnet, transport: http(RPC, { timeout: 20_000 }) });
const h = await readHoldings(rpc);
const fmt = (n: number | null, d = 2) =>
  n === null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d });

console.log(`block ${h.block} · complete ${h.complete}`);
console.log(
  `rates: wstETH ${h.rates.wstETH} · rETH ${h.rates.rETH} · mETH ${h.rates.mETH} · ETH/USD ${h.ethUsd}`,
);
for (const holder of h.holders) {
  console.log(`\n${holder.name} ${holder.address}: Ξ${fmt(holder.eth)} + $${fmt(holder.usd)}`);
  for (const x of holder.holdings) {
    console.log(`  ${x.symbol.padEnd(7)} ${fmt(x.amount, 4).padStart(14)}  ≈Ξ ${fmt(x.eth)}`);
  }
}
console.log(`\nTOTAL Ξ${fmt(h.totalEth)} + $${fmt(h.totalUsd)} USDC (≈Ξ${fmt(h.usdInEth)})`);

const flows = (await (await fetch(`${API}/api/treasury/flows`)).json()) as TreasuryFlowsResponse;
const r = reconcile(flows.stats, h);
console.log('\nreconciliation (ETH):');
console.log(`  auction proceeds in      +${fmt(r.inEth)}`);
console.log(`  paid out (not forks)     −${fmt(r.paidOutEth)}`);
console.log(`  sold for USDC            −${fmt(r.soldForUsdcEth)}`);
console.log(`  fork payouts             −${fmt(r.forkEth)}`);
console.log(
  `  staked tokens paid out   −${fmt(r.stakedOutEth)}  (${r.stakedOut.map(s => `${fmt(s.amount)} ${s.symbol}`).join(', ')})`,
);
console.log(`  = by the flows            ${fmt(r.flowNetEth)}`);
console.log(`  staking yield & other    +${fmt(r.residualEth)}  (derived)`);
console.log(`  = treasury now            ${fmt(r.nowEth)}  + $${fmt(r.nowUsd)} USDC`);
