import type { Flow, FlowNode, TreasuryFlowsResponse } from './types';

import { describe, expect, it } from 'vitest';

import {
  bidderRows,
  fmtEth,
  fmtUsd,
  matchesQuery,
  recipientRows,
  viewTotals,
  type ViewFilter,
} from './model';

const T2022 = 1_650_000_000;
const T2023 = 1_690_000_000;

const node = (
  id: string,
  type: FlowNode['type'],
  name = id,
  extra: Partial<FlowNode> = {},
): FlowNode => ({
  id,
  type,
  name,
  ens: null,
  receivedEth: 0,
  receivedUsd: 0,
  paidEth: 0,
  auctionsWon: 0,
  nounsReceived: 0,
  streams: 0,
  proposals: [],
  kinds: [],
  firstT: 0,
  lastT: 0,
  ...extra,
});

const flow = (f: Partial<Flow> & Pick<Flow, 'id' | 'kind' | 'from' | 'to' | 't'>): Flow => ({
  asset: 'ETH',
  amount: f.eth ?? 0,
  eth: 0,
  usd: 0,
  ...f,
});

const DATA: TreasuryFlowsResponse = {
  version: 2,
  generatedAt: T2023,
  indexing: { complete: true, block: 1, timestamp: 1 },
  stats: {
    inEth: 110,
    auctions: 3,
    outEth: 60,
    outUsd: 5000,
    convertedEth: 12,
    ethToUsdc: 10,
    netEth: 40,
    byKind: {
      direct: { eth: 50, usd: 0, count: 1 },
      stream: { eth: 10, usd: 0, count: 1 },
      payer: { eth: 0, usd: 5000, count: 1 },
      call: { eth: 0, usd: 0, count: 0 },
      fork: { eth: 0, usd: 0, count: 0 },
    },
    recipients: 2,
    streams: { total: 1, vesting: 1, ended: 0, cancelled: 0, notStarted: 0 },
    propsExecuted: 2,
    propsWithPayouts: 2,
    nounsGiven: 0,
    nounderNouns: 0,
    nounsToTreasury: 0,
    nounsBurned: 0,
    unpriced: 0,
    otherTokens: {},
  },
  years: [
    { year: 2022, inEth: 100, outEth: 50, outUsd: 0, ethToUsdc: 0, auctions: 2, props: 1 },
    { year: 2023, inEth: 10, outEth: 10, outUsd: 5000, ethToUsdc: 10, auctions: 1, props: 1 },
  ],
  nodes: [
    node('treasury', 'treasury', 'Nouns Treasury'),
    node('0xaaa1', 'person', 'alice.eth', { ens: 'alice.eth', proposals: [7] }),
    node('0xbbb2', 'multisig', '0xbbb2…', { proposals: [9] }),
    node('0xccc3', 'bidder', 'whale.eth'),
  ],
  flows: [
    flow({ id: 'a1', kind: 'auction', from: '0xccc3', to: 'treasury', t: T2022, eth: 60 }),
    flow({ id: 'a2', kind: 'auction', from: '0xccc3', to: 'treasury', t: T2022, eth: 40 }),
    flow({ id: 'a3', kind: 'auction', from: '0xaaa1', to: 'treasury', t: T2023, eth: 10 }),
    flow({
      id: 'p7',
      kind: 'direct',
      from: 'treasury',
      to: '0xaaa1',
      t: T2022,
      eth: 50,
      proposalId: 7,
    }),
    flow({
      id: 'p9a',
      kind: 'stream',
      from: 'treasury',
      to: '0xbbb2',
      t: T2023,
      eth: 10,
      asset: 'WETH',
      proposalId: 9,
    }),
    flow({
      id: 'p9b',
      kind: 'payer',
      from: 'treasury',
      to: '0xbbb2',
      t: T2023,
      usd: 5000,
      asset: 'USDC',
      amount: 5000,
      proposalId: 9,
    }),
  ],
  proposals: {
    '7': { id: 7, title: 'Fund the glasses factory', proposer: '0x1', executedAt: T2022 },
    '9': { id: 9, title: 'Nouns esports season', proposer: '0x2', executedAt: T2023 },
  },
};

const all: ViewFilter = { year: null, types: new Set(), query: '' };

describe('viewTotals', () => {
  it('all time matches the API stats', () => {
    const t = viewTotals(DATA, null);
    expect(t.inEth).toBe(DATA.stats.inEth);
    expect(t.outEth).toBe(DATA.stats.outEth);
    expect(t.outUsd).toBe(DATA.stats.outUsd);
    expect(t.netEth).toBe(DATA.stats.netEth);
    expect(t.recipients).toBe(2);
    expect(t.proposals).toBe(2);
    expect(t.auctions).toBe(3);
  });
  it('a year uses only that year, including its Token Buyer swaps', () => {
    const t = viewTotals(DATA, 2023);
    expect(t.inEth).toBe(10);
    expect(t.outEth).toBe(10);
    expect(t.outUsd).toBe(5000);
    expect(t.netEth).toBe(10 - 10 - 10);
    expect(t.byKind.payer).toEqual({ eth: 0, usd: 5000, count: 1 });
  });
});

describe('rows', () => {
  it('recipients aggregate per address, scoped by year', () => {
    const rows = recipientRows(DATA, all);
    const b = rows.find(r => r.node.id === '0xbbb2')!;
    expect(b.eth).toBe(10);
    expect(b.usd).toBe(5000);
    expect(b.kinds.sort()).toEqual(['payer', 'stream']);
    expect(recipientRows(DATA, { ...all, year: 2022 }).map(r => r.node.id)).toEqual(['0xaaa1']);
  });
  it('type filter and bidders', () => {
    expect(
      recipientRows(DATA, { ...all, types: new Set(['multisig']) }).map(r => r.node.id),
    ).toEqual(['0xbbb2']);
    const bids = bidderRows(DATA, all);
    expect(bids.find(r => r.node.id === '0xccc3')).toMatchObject({ eth: 100, auctions: 2 });
  });
});

describe('search', () => {
  const alice = DATA.nodes[1]!;
  it('matches ENS, address, prop number and proposal title', () => {
    expect(matchesQuery(alice, 'ALICE', DATA.proposals)).toBe(true);
    expect(matchesQuery(alice, '0xaaa', DATA.proposals)).toBe(true);
    expect(matchesQuery(alice, '#7', DATA.proposals)).toBe(true);
    expect(matchesQuery(alice, 'prop 7', DATA.proposals)).toBe(true);
    expect(matchesQuery(alice, 'glasses', DATA.proposals)).toBe(true);
    expect(matchesQuery(alice, 'esports', DATA.proposals)).toBe(false);
    expect(matchesQuery(alice, '9', DATA.proposals)).toBe(false);
  });
});

describe('format', () => {
  it('eth and usd', () => {
    expect(fmtEth(55486.3)).toBe('Ξ55,486');
    expect(fmtEth(-1875.7, { sign: true })).toBe('−Ξ1,876');
    expect(fmtEth(12.34, { sign: true })).toBe('+Ξ12.3');
    expect(fmtUsd(29_635_557)).toBe('$29.6M');
    expect(fmtUsd(41_500)).toBe('$42k');
    expect(fmtUsd(450)).toBe('$450');
  });
});
