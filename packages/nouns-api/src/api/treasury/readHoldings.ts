// ─── Live treasury holdings read (one multicall) ─────────────────────────────
// Every holder's ETH (Multicall3.getEthBalance) and token balances, plus the
// wstETH / rETH / mETH rates and Chainlink ETH/USD, in a single eth_call.
// The arithmetic is in holdings.ts (pure, tested); this only does the read.
// Kept out of routes/ so a plain script can run it against mainnet.

import type { TreasuryHoldings } from './types.js';

import { parseAbi, type PublicClient } from 'viem';

import { buildHoldings, HOLDERS, HOLDING_TOKENS, RATE_SOURCES } from './holdings.js';

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const holdingsAbi = parseAbi([
  'function getEthBalance(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function stEthPerToken() view returns (uint256)',
  'function getExchangeRate() view returns (uint256)',
  'function mETHToETH(uint256) view returns (uint256)',
  'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)',
]);

export async function readHoldings(rpc: PublicClient): Promise<TreasuryHoldings> {
  type Call = {
    address: `0x${string}`;
    abi: typeof holdingsAbi;
    functionName: string;
    args?: readonly unknown[];
  };
  const calls: Call[] = [];
  const at = (address: string, functionName: string, args?: readonly unknown[]) =>
    calls.push({ address: address as `0x${string}`, abi: holdingsAbi, functionName, args }) - 1;
  const ethIdx = HOLDERS.map(h => at(MULTICALL3, 'getEthBalance', [h.address]));
  const tokIdx = HOLDERS.map(h => HOLDING_TOKENS.map(t => at(t.address, 'balanceOf', [h.address])));
  const iW = at(RATE_SOURCES.wstETH.address, 'stEthPerToken');
  const iR = at(RATE_SOURCES.rETH.address, 'getExchangeRate');
  const iM = at(RATE_SOURCES.mETH.address, 'mETHToETH', [10n ** 18n]);
  const iP = at(RATE_SOURCES.ethUsd.address, 'latestRoundData');

  const [block, res] = await Promise.all([
    rpc.getBlockNumber().catch(() => null),
    rpc.multicall({ contracts: calls as never, allowFailure: true, multicallAddress: MULTICALL3 }),
  ]);
  const big = (i: number): bigint | null => {
    const r = res[i] as { status: string; result?: unknown } | undefined;
    return r?.status === 'success' && typeof r.result === 'bigint' ? r.result : null;
  };
  const price = res[iP] as { status: string; result?: readonly bigint[] } | undefined;
  const answer = price?.status === 'success' ? price.result?.[1] : undefined;
  const updatedAt = price?.status === 'success' ? price.result?.[3] : undefined;
  return buildHoldings({
    at: Math.floor(Date.now() / 1000),
    block: block === null ? null : Number(block),
    eth: Object.fromEntries(HOLDERS.map((h, i) => [h.address, big(ethIdx[i]!)])),
    tokens: Object.fromEntries(
      HOLDERS.map((h, i) => [
        h.address,
        Object.fromEntries(HOLDING_TOKENS.map((t, j) => [t.address, big(tokIdx[i]![j]!)])),
      ]),
    ),
    rates: { wstETH: big(iW), rETH: big(iR), mETH: big(iM) },
    ethUsd:
      answer !== undefined && answer > 0n
        ? { answer, decimals: 8, updatedAt: Number(updatedAt ?? 0n) }
        : null,
  });
}
