/* eslint-disable @typescript-eslint/no-floating-promises -- node:test's describe/it return promises the runner awaits */
import { describe, it } from 'node:test';

import { buildTreasuryFlows, codeKindFromBytecode, toSec } from './buildFlows.js';
import { B, BUILD_INPUT, C, F, S2 } from './fixtures.js';
import { expect } from './testExpect.js';

const r = buildTreasuryFlows(BUILD_INPUT);
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('stats', () => {
  it('total in = winning auction bids only', () => {
    close(r.stats.inEth, 10 + 20.5 + 30);
    expect(r.stats.auctions).toBe(3);
    expect(r.stats.nounsBurned).toBe(1);
    expect(r.stats.nounsToTreasury).toBe(1);
  });

  it('total out = direct + streams (net of refunds) + calls + forks', () => {
    // ETH 5 (prop 1) + stETH 4800 (352) + WETH stream 25 (271) + call 2 (9003) + fork 1000
    close(r.stats.outEth, 5 + 4800 + 25 + 2 + 1000);
    // Payer 450,000 (192) + cancelled USDC stream: 20k withdrawn + 10k at cancel (9002)
    close(r.stats.outUsd, 450_000 + 30_000);
  });

  it('per-kind totals', () => {
    expect(r.stats.byKind.direct).toEqual({ eth: 4805, usd: 0, count: 3 }); // ETH, stETH, Noun 542
    expect(r.stats.byKind.stream).toEqual({ eth: 25, usd: 30_000, count: 2 });
    expect(r.stats.byKind.payer).toEqual({ eth: 0, usd: 450_000, count: 1 });
    expect(r.stats.byKind.call).toEqual({ eth: 2, usd: 0, count: 1 });
    expect(r.stats.byKind.fork).toEqual({ eth: 1000, usd: 0, count: 1 });
  });

  it('conversions are not spending; net subtracts only the ETH swapped to USDC', () => {
    close(r.stats.convertedEth, 53.1 + 100);
    close(r.stats.ethToUsdc, 100);
    close(r.stats.netEth, 60.5 - 5832 - 100);
  });

  it('counts recipients, streams, proposals, nouns', () => {
    expect(r.stats.recipients).toBe(8);
    expect(r.stats.streams).toEqual({
      total: 2,
      vesting: 0,
      ended: 1,
      cancelled: 1,
      notStarted: 0,
    });
    expect(r.stats.propsExecuted).toBe(10);
    expect(r.stats.propsWithPayouts).toBe(7);
    expect(r.stats.nounsGiven).toBe(1);
    expect(r.stats.nounderNouns).toBe(2);
    expect(r.stats.unpriced).toBe(0);
  });

  it('year slices add up to the totals', () => {
    const sum = (k: 'inEth' | 'outEth' | 'outUsd') => r.years.reduce((s, y) => s + y[k], 0);
    close(sum('inEth'), r.stats.inEth);
    close(sum('outEth'), r.stats.outEth);
    close(sum('outUsd'), r.stats.outUsd);
    expect(r.years.map(y => y.year)).toEqual([2021, 2022, 2023]);
  });
});

describe('flows', () => {
  it('skips stream funding, timelock migration, cancelled props and foreign streams', () => {
    const ids = r.flows.map(f => f.id);
    expect(ids).not.toContain('p271-2'); // WETH into the stream address
    expect(ids).not.toContain('p9002-1'); // Payer into the stream address
    expect(ids).not.toContain('p356-0'); // V1 → V2
    expect(r.flows.some(f => f.proposalId === 247)).toBe(false);
    expect(
      r.flows.some(
        f => f.to === '0x2222222222222222222222222222222222222222' && f.kind === 'stream',
      ),
    ).toBe(false);
  });

  it('a cancelled stream reports what was paid and refunded', () => {
    const s = r.flows.find(f => f.stream?.address === S2)!;
    expect(s.to).toBe(B);
    expect(s.asset).toBe('USDC');
    expect(s.amount).toBe(30_000);
    expect(s.stream).toMatchObject({
      state: 'cancelled',
      total: 120_000,
      paidOut: 30_000,
      refunded: 90_000,
      progress: 0.25,
    });
    expect(s.proposalId).toBe(9002);
  });

  it('a finished stream is fully vested', () => {
    const s = r.flows.find(f => f.proposalId === 271)!;
    expect(s.kind).toBe('stream');
    expect(s.stream).toMatchObject({
      state: 'ended',
      progress: 1,
      total: 25,
      paidOut: 10,
      refunded: 0,
    });
  });

  it('times come from execution / settlement, in seconds', () => {
    expect(r.flows.find(f => f.proposalId === 1)!.t).toBe(1_630_000_000);
    expect(r.flows.find(f => f.nounId === 1 && f.kind === 'auction')!.t).toBe(1_629_000_060);
  });
});

describe('entity types (rules, not guesses)', () => {
  const type = (id: string) => r.nodes.find(n => n.id === id)?.type;
  it('derives each type from the known table, code and roles', () => {
    expect(r.nodes[0]!.id).toBe('treasury');
    expect(type('0x2573c60a6d127755aa2dc85e342f7da2378a0cc5')).toBe('nounders');
    expect(type(F)).toBe('subdao');
    expect(type(C)).toBe('contract');
    expect(type('0x0e09ceb98492715ec5b080d2b95b5004ddf43947')).toBe('contract');
    expect(type('0x79095391743e0f017a16c388de6a6a3f175a5cd5')).toBe('multisig');
    expect(type(B)).toBe('person');
    expect(type('0x2222222222222222222222222222222222222222')).toBe('bidder');
  });
  it('flags recipients whose code lookup failed', () => {
    const n = r.nodes.find(x => x.id === '0x3dfd76a87cf769275e5bc8c4ab77e47d50ecda49')!;
    expect(n.type).toBe('person');
    expect(n.codeUnknown).toBe(true);
    expect(n.nounsReceived).toBe(1);
  });
  it('names: known label > ENS > short address', () => {
    expect(r.nodes.find(n => n.id === '0x1111111111111111111111111111111111111111')!.name).toBe(
      'whale.eth',
    );
    expect(r.nodes.find(n => n.id === F)!.name).toBe('Nouns Fork #0 treasury');
    expect(r.nodes.find(n => n.id === B)!.name).toBe('0xbbbb…bbbb');
  });
  it('bidder totals', () => {
    const w1 = r.nodes.find(n => n.id === '0x1111111111111111111111111111111111111111')!;
    expect(w1.paidEth).toBe(40);
    expect(w1.auctionsWon).toBe(2);
  });
});

describe('helpers', () => {
  it('codeKindFromBytecode', () => {
    expect(codeKindFromBytecode('0x')).toBe('eoa');
    expect(codeKindFromBytecode('0xef01005a7fc11397e9a8ad41bf10bf13f22b0a63f96f6d')).toBe('eoa'); // 7702
    expect(
      codeKindFromBytecode(
        '0x608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea2646970667358221220d1429297349653a4918076d650332de1a1068c5f3e07c5c82360c277770b955264736f6c63430007060033',
      ),
    ).toBe('safe');
    expect(
      codeKindFromBytecode(
        '0x363d3d373d3d3d363d7339778bc77bd7a9456655b19fd4c5d0bf2071104e5af43d82803e903d91602b57fd5bf3',
      ),
    ).toBe('contract');
  });
  it('toSec handles Date-wrapped seconds and real ms', () => {
    expect(toSec(new Date(1_700_000_000))).toBe(1_700_000_000);
    expect(toSec(1_700_000_000_000)).toBe(1_700_000_000);
    expect(toSec('1683158400')).toBe(1_683_158_400);
  });
});
