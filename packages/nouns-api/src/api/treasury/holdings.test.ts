/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises the runner awaits */
import type { FlowStats } from './types.js';

import { describe, it } from 'node:test';

import { buildHoldings, ethPerToken, isDust, reconcile, type RawHoldings } from './holdings.js';
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
import { expect } from './testExpect.js';

const close = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);
const e18 = (s: string) => BigInt(s);
const none = () => ({
  [WETH]: 0n,
  [STETH]: 0n,
  [WSTETH]: 0n,
  [RETH]: 0n,
  [METH]: 0n,
  [USDC]: 0n,
  [ENS_TOKEN]: 0n,
});

// Real mainnet reads, block ~26.26M (2026-10-24): balances and rates as raw ints.
export const RAW: RawHoldings = {
  at: 1792862400,
  block: 26263960,
  eth: {
    [TREASURY_V2]: e18('82728852758519958533'),
    [TREASURY_V1]: 0n,
    [GOVERNOR]: e18('8906576355819037475'),
    [PAYER]: 0n,
    [TOKEN_BUYER]: e18('5176643623857'),
  },
  tokens: {
    [TREASURY_V2]: {
      ...none(),
      [WETH]: e18('20599300000028798'),
      [STETH]: e18('53217476991161268'),
      [WSTETH]: e18('2248784480134295450958'),
      [RETH]: e18('163089311649794073248'),
      [METH]: e18('934894459986595743649'),
      [USDC]: 484743288784n,
      [ENS_TOKEN]: e18('500000000000000000000'),
    },
    [TREASURY_V1]: { ...none(), [STETH]: 1n },
    [GOVERNOR]: { ...none(), [WETH]: 100000000000n },
    [PAYER]: { ...none(), [USDC]: 88858865700n },
    [TOKEN_BUYER]: none(),
  },
  rates: {
    wstETH: e18('1247096059322723249'),
    rETH: e18('1174372982072649288'),
    mETH: e18('1101303046508483213'),
  },
  ethUsd: { answer: 231516901609n, decimals: 8, updatedAt: 1792860932 },
};

const h = buildHoldings(RAW);

describe('rates', () => {
  it('values ETH-like 1:1 and staked tokens at their on-chain rate', () => {
    expect(ethPerToken('eth', RAW.rates)).toBe(1);
    close(ethPerToken('wsteth', RAW.rates)!, 1.247096059322723);
    close(ethPerToken('reth', RAW.rates)!, 1.174372982072649);
    close(ethPerToken('meth', RAW.rates)!, 1.101303046508483);
    expect(ethPerToken('usd', RAW.rates)).toBe(null);
    expect(ethPerToken('other', RAW.rates)).toBe(null);
  });
  it('dust is under 0.001 ETH, $1, or 1e-6 of an unvalued token', () => {
    expect(isDust({ amount: 1e-18, eth: 1e-18, usd: null })).toBe(true);
    expect(isDust({ amount: 0.5, eth: 0.5, usd: null })).toBe(false);
    expect(isDust({ amount: 0.4, eth: null, usd: 0.4 })).toBe(true);
    expect(isDust({ amount: 500, eth: null, usd: null })).toBe(false);
  });
});

describe('buildHoldings', () => {
  const v2 = h.holders.find(x => x.address === TREASURY_V2)!;
  const eq = (sym: string) => v2.holdings.find(x => x.symbol === sym)!;

  it('values each nouns.eth balance in ETH', () => {
    close(eq('ETH').eth!, 82.728853);
    close(eq('wstETH').eth!, 2248.78448 * 1.247096059, 3);
    close(eq('rETH').eth!, 163.089312 * 1.174372982, 3);
    close(eq('mETH').eth!, 934.89446 * 1.101303047, 3);
    expect(eq('USDC')).toMatchObject({ eth: null, usd: 484743.288784, rate: null });
    expect(eq('ENS')).toMatchObject({ amount: 500, eth: null, usd: null });
  });

  it('totals: ETH-equivalent across holders, USDC apart', () => {
    const expected = 82.728853 + 0.0206 + 0.053217 + 2804.4497 + 191.5258 + 1029.5983 + 8.906576; // + governor
    close(h.totalEth, expected, 1);
    close(h.totalUsd, 484743.288784 + 88858.8657, 4);
    close(h.usdInEth!, h.totalUsd / 2315.16901609, 4);
    expect(h.complete).toBe(true);
  });

  it('drops dust rows but keeps every holder listed', () => {
    expect(h.holders.map(x => x.address)).toEqual([
      TREASURY_V2,
      TREASURY_V1,
      GOVERNOR,
      PAYER,
      TOKEN_BUYER,
    ]);
    expect(h.holders.find(x => x.address === TREASURY_V1)!.holdings).toEqual([]);
    expect(h.holders.find(x => x.address === TOKEN_BUYER)!.holdings).toEqual([]);
    // 1e-7 WETH at the governor is dust; its ETH isn't
    expect(h.holders.find(x => x.address === GOVERNOR)!.holdings.map(x => x.symbol)).toEqual([
      'ETH',
    ]);
  });

  it('byToken sums holders, biggest ETH value first', () => {
    expect(h.byToken.map(t => t.symbol).slice(0, 3)).toEqual(['wstETH', 'mETH', 'rETH']);
    close(h.byToken.find(t => t.symbol === 'ETH')!.amount, 82.728853 + 8.906576);
    close(h.byToken.find(t => t.symbol === 'USDC')!.usd!, 573602.154484, 4);
  });

  it('a failed rate leaves that token unvalued and marks the read incomplete', () => {
    const p = buildHoldings({ ...RAW, rates: { ...RAW.rates, mETH: null } });
    expect(p.complete).toBe(false);
    const m = p.holders[0]!.holdings.find(x => x.symbol === 'mETH')!;
    expect(m.eth).toBe(null);
    close(p.totalEth, h.totalEth - 934.89446 * 1.101303047, 2);
  });

  it('a failed balance read marks it incomplete', () => {
    const p = buildHoldings({ ...RAW, eth: { ...RAW.eth, [GOVERNOR]: null } });
    expect(p.complete).toBe(false);
    expect(p.ethUsd).toBe(2315.169016);
    const q = buildHoldings({ ...RAW, ethUsd: null });
    expect(q.usdInEth).toBe(null);
    expect(q.complete).toBe(true);
  });
});

describe('reconcile', () => {
  // The live /api/treasury/flows stats on 2026-10-24 (the parts reconcile reads).
  const zero = { eth: 0, usd: 0, count: 0 };
  const stats = {
    inEth: 55486.317678,
    outEth: 40253.650746,
    ethToUsdc: 13352.216288,
    byKind: {
      direct: zero,
      stream: zero,
      payer: zero,
      call: zero,
      fork: { eth: 20227.969411, usd: 408895.655298, count: 90 },
    },
    otherTokens: { wstETH: 20.699985, rETH: 355.419901, USDC: 0, '0xabc': 3e27 },
  } as unknown as FlowStats;
  const r = reconcile(stats, h);

  it('splits forks out of "out" without counting them twice', () => {
    close(r.paidOutEth + r.forkEth, stats.outEth);
    close(r.paidOutEth, 20025.681335);
  });

  it('values staked-token payouts at today’s rate, ignores everything else', () => {
    expect(r.stakedOut.map(s => s.symbol)).toEqual(['wstETH', 'rETH']);
    close(r.stakedOutEth, 20.699985 * 1.247096059 + 355.419901 * 1.174372982, 3);
  });

  it('the steps add up to the treasury now, with the residual as the balancing item', () => {
    close(
      r.inEth - r.paidOutEth - r.soldForUsdcEth - r.forkEth - r.stakedOutEth + r.residualEth,
      r.nowEth,
      4,
    );
    close(r.nowEth, h.totalEth);
    close(r.nowUsd, h.totalUsd);
    // with the live numbers: ~1,437 ETH by flows, ~2,680 ETH of yield & other
    close(r.flowNetEth, 1437.24, 1);
    close(r.residualEth, 2680.05, 1);
  });
});
