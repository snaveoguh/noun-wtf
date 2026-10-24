// ─── Treasury holdings + reconciliation (pure) ───────────────────────────────
//
// What the DAO holds right now, valued in ETH at on-chain rates, and how that
// squares with the flows buildFlows.ts counts. The route reads the raw
// balances and rates in one multicall (routes/treasury.ts `readHoldings`);
// everything here is plain arithmetic so it can be tested against fixtures.
//
// Valuation (ETH per token, read on chain each refresh):
//   ETH, WETH, stETH — 1:1 (stETH rebases, so its balance already includes yield)
//   wstETH — Lido wstETH.stEthPerToken()
//   rETH   — Rocket Pool rETH.getExchangeRate()
//   mETH   — Mantle staking contract mETHToETH(1e18) (mETH.stakingContract())
//   USDC   — stays in dollars. Never added to ETH totals; an ETH-equivalent is
//            given separately at Chainlink's ETH/USD price.
//   others — listed, not valued (e.g. ENS the DAO was granted).

import type {
  FlowStats,
  Holder,
  Holding,
  HoldingTokenKind,
  Reconciliation,
  TreasuryHoldings,
} from './types.js';

import { formatUnits } from 'viem';

import {
  ENS_TOKEN,
  GOVERNOR,
  METH,
  PAYER,
  RETH,
  STETH,
  TOKEN_BUYER,
  TREASURY_V1,
  TREASURY_V2,
  USDC,
  WETH,
  WSTETH,
} from './knownAddresses.js';

export interface HoldingToken {
  symbol: string;
  address: string;
  decimals: number;
  kind: HoldingTokenKind;
}

/** ERC-20s read for every holder. ETH itself is read separately. */
export const HOLDING_TOKENS: readonly HoldingToken[] = [
  { symbol: 'WETH', address: WETH, decimals: 18, kind: 'eth' },
  { symbol: 'stETH', address: STETH, decimals: 18, kind: 'eth' },
  { symbol: 'wstETH', address: WSTETH, decimals: 18, kind: 'wsteth' },
  { symbol: 'rETH', address: RETH, decimals: 18, kind: 'reth' },
  { symbol: 'mETH', address: METH, decimals: 18, kind: 'meth' },
  { symbol: 'USDC', address: USDC, decimals: 6, kind: 'usd' },
  { symbol: 'ENS', address: ENS_TOKEN, decimals: 18, kind: 'other' },
];

export interface HolderInfo {
  address: string;
  name: string;
  description: string;
}

/** Every DAO contract that holds DAO money. Order = display order. */
export const HOLDERS: readonly HolderInfo[] = [
  {
    address: TREASURY_V2,
    name: 'nouns.eth (treasury)',
    description: 'The DAO treasury: Timelock V2. Proposals spend from here.',
  },
  {
    address: TREASURY_V1,
    name: 'Timelock V1 (legacy)',
    description: 'The original treasury, emptied into nouns.eth in the 2023 V3 migration.',
  },
  {
    address: GOVERNOR,
    name: 'DAO Governor',
    description: 'Holds ETH to refund voters’ gas.',
  },
  {
    address: PAYER,
    name: 'USDC Payer',
    description: 'Holds USDC waiting to pay proposal recipients.',
  },
  {
    address: TOKEN_BUYER,
    name: 'Token Buyer',
    description: 'Holds ETH waiting to be swapped into USDC for the Payer.',
  },
];

/** On-chain rate sources (also returned to the client, so it can cite them). */
export const RATE_SOURCES = {
  wstETH: { address: WSTETH, fn: 'stEthPerToken()' },
  rETH: { address: RETH, fn: 'getExchangeRate()' },
  mETH: { address: '0xe3cbd06d7dadb3f4e6557bab7edd924cd1489e8f', fn: 'mETHToETH(1e18)' },
  ethUsd: { address: '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419', fn: 'latestRoundData()' },
} as const;

export interface RawHoldings {
  /** unix s */
  at: number;
  block: number | null;
  /** holder (lowercase) → ETH balance in wei; missing = read failed */
  eth: Record<string, bigint | null>;
  /** holder → token (lowercase) → raw balance; missing/null = read failed */
  tokens: Record<string, Record<string, bigint | null>>;
  /** 1e18-scaled ETH per token; null = read failed */
  rates: { wstETH: bigint | null; rETH: bigint | null; mETH: bigint | null };
  /** Chainlink ETH/USD: answer + decimals + updatedAt; null = read failed */
  ethUsd: { answer: bigint; decimals: number; updatedAt: number } | null;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const units = (raw: bigint, decimals: number) => Number(formatUnits(raw, decimals));

/** ETH per token for a valuation kind; null when it can't be valued in ETH. */
/** Below these a balance is dust: < 0.001 ETH-equivalent, < $1, or < 1e-6 of an unpriced token. */
export function isDust(h: Pick<Holding, 'amount' | 'eth' | 'usd'>): boolean {
  if (h.eth !== null) return h.eth < 0.001;
  if (h.usd !== null) return h.usd < 1;
  return h.amount < 1e-6;
}

export function ethPerToken(kind: HoldingTokenKind, rates: RawHoldings['rates']): number | null {
  const rate = (r: bigint | null) => (r === null ? null : units(r, 18));
  switch (kind) {
    case 'eth':
      return 1;
    case 'wsteth':
      return rate(rates.wstETH);
    case 'reth':
      return rate(rates.rETH);
    case 'meth':
      return rate(rates.mETH);
    default:
      return null;
  }
}

export function buildHoldings(raw: RawHoldings): TreasuryHoldings {
  const ethUsd = raw.ethUsd ? units(raw.ethUsd.answer, raw.ethUsd.decimals) : null;
  let complete = true;
  const holders: Holder[] = [];
  const byToken = new Map<
    string,
    { symbol: string; amount: number; eth: number | null; usd: number | null; rate: number | null }
  >();

  const add = (h: Holding) => {
    const t = byToken.get(h.symbol);
    if (t) {
      t.amount += h.amount;
      if (t.eth !== null && h.eth !== null) t.eth += h.eth;
      if (t.usd !== null && h.usd !== null) t.usd += h.usd;
    } else {
      byToken.set(h.symbol, {
        symbol: h.symbol,
        amount: h.amount,
        eth: h.eth,
        usd: h.usd,
        rate: h.rate,
      });
    }
  };

  for (const info of HOLDERS) {
    const rows: Holding[] = [];
    const weiEth = raw.eth[info.address];
    if (weiEth === null || weiEth === undefined) complete = false;
    else if (weiEth > 0n) {
      const amount = units(weiEth, 18);
      rows.push({ symbol: 'ETH', token: null, amount, rate: 1, eth: amount, usd: null });
    }
    for (const tk of HOLDING_TOKENS) {
      const bal = raw.tokens[info.address]?.[tk.address];
      if (bal === null || bal === undefined) {
        complete = false;
        continue;
      }
      if (bal === 0n) continue;
      const amount = units(bal, tk.decimals);
      const rate = ethPerToken(tk.kind, raw.rates);
      if (rate === null && tk.kind !== 'usd' && tk.kind !== 'other') complete = false;
      rows.push({
        symbol: tk.symbol,
        token: tk.address,
        amount,
        rate,
        eth: rate === null ? null : amount * rate,
        usd: tk.kind === 'usd' ? amount : null,
      });
    }
    // Dust (a wei of stETH, a few gwei left in the Token Buyer) isn't listed.
    const listed = rows.filter(h => !isDust(h));
    const eth = listed.reduce((s, h) => s + (h.eth ?? 0), 0);
    const usd = listed.reduce((s, h) => s + (h.usd ?? 0), 0);
    listed.forEach(add);
    holders.push({
      address: info.address,
      name: info.name,
      description: info.description,
      eth: r6(eth),
      usd: r6(usd),
      holdings: listed.map(h => ({
        ...h,
        amount: r6(h.amount),
        rate: h.rate === null ? null : r6(h.rate),
        eth: h.eth === null ? null : r6(h.eth),
        usd: h.usd === null ? null : r6(h.usd),
      })),
    });
  }

  const totalEth = holders.reduce((s, h) => s + h.eth, 0);
  const totalUsd = holders.reduce((s, h) => s + h.usd, 0);
  return {
    at: raw.at,
    block: raw.block,
    complete,
    totalEth: r6(totalEth),
    totalUsd: r6(totalUsd),
    usdInEth: ethUsd ? r6(totalUsd / ethUsd) : null,
    ethUsd: ethUsd === null ? null : r6(ethUsd),
    ethUsdUpdatedAt: raw.ethUsd?.updatedAt ?? null,
    rates: {
      wstETH: ethPerToken('wsteth', raw.rates),
      rETH: ethPerToken('reth', raw.rates),
      mETH: ethPerToken('meth', raw.rates),
    },
    rateSources: RATE_SOURCES,
    byToken: [...byToken.values()]
      .map(t => ({
        ...t,
        amount: r6(t.amount),
        eth: t.eth === null ? null : r6(t.eth),
        usd: t.usd === null ? null : r6(t.usd),
      }))
      .sort((a, b) => (b.eth ?? 0) - (a.eth ?? 0) || (b.usd ?? 0) - (a.usd ?? 0)),
    holders,
  };
}

/** Payout symbols (stats.otherTokens) that are staked ETH and can be valued at today's rate. */
const STAKED_SYMBOLS: Record<string, keyof TreasuryHoldings['rates']> = {
  wstETH: 'wstETH',
  rETH: 'rETH',
  mETH: 'mETH',
};

/**
 * auction proceeds − paid out (ETH, not forks) − ETH sold for USDC − fork
 * payouts − staked tokens paid out + staking yield & other = treasury now
 * (ETH-equivalent).
 *
 * - Fork payouts are `byKind.fork`, part of `stats.outEth`; they're split out
 *   here, never subtracted twice.
 * - "Staked tokens paid out" are the wstETH / rETH / mETH payouts the flow
 *   builder can't price (stats.otherTokens, proposals and forks alike), valued
 *   at TODAY's rate: an estimate, a few % high for old payouts.
 * - "Staking yield & other" is the residual: what the flows can't account
 *   for. Mostly staking yield (stETH rebases; wstETH/rETH/mETH appreciate),
 *   plus ETH that came back (refunds, cancelled payments), other income and
 *   small items.
 * - USDC held is NOT in "now": the "sold for USDC" step already took that ETH
 *   out, and the USDC is shown in dollars beside it.
 */
export function reconcile(stats: FlowStats, holdings: TreasuryHoldings): Reconciliation {
  const forkEth = stats.byKind.fork.eth;
  const paidOutEth = stats.outEth - forkEth;
  let stakedOutEth = 0;
  const stakedOut: Reconciliation['stakedOut'] = [];
  for (const [symbol, amount] of Object.entries(stats.otherTokens)) {
    const key = STAKED_SYMBOLS[symbol];
    if (!key || !(amount > 0)) continue;
    const rate = holdings.rates[key];
    if (rate === null) continue;
    stakedOutEth += amount * rate;
    stakedOut.push({ symbol, amount: r6(amount), rate, eth: r6(amount * rate) });
  }
  const flowNetEth = stats.inEth - paidOutEth - stats.ethToUsdc - forkEth - stakedOutEth;
  return {
    inEth: r6(stats.inEth),
    paidOutEth: r6(paidOutEth),
    soldForUsdcEth: r6(stats.ethToUsdc),
    forkEth: r6(forkEth),
    stakedOutEth: r6(stakedOutEth),
    stakedOut,
    flowNetEth: r6(flowNetEth),
    residualEth: r6(holdings.totalEth - flowNetEth),
    nowEth: r6(holdings.totalEth),
    nowUsd: r6(holdings.totalUsd),
    complete: holdings.complete,
  };
}
