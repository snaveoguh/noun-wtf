import { describe, expect, it } from 'vitest';

import { genesis, playerAct, riderAccount } from '../../exchange/engine';

import {
  FeedTracker,
  fillKey,
  lotSize,
  maskOwner,
  publicFloor,
  refPrices,
  SimFlow,
  spreadDelays,
  type FloorFrame,
} from './feed';
import { hashStr, rasterNoun, seedFromId, SPRITE } from './looks';

const T0 = 1_760_000_000_000;

describe('publicFloor (the server view)', () => {
  it('lists every good, masks riders, keeps bots, calls the viewer you', () => {
    const s = genesis(5, T0, 30 * 60_000);
    const rider = '0f8e2b7c-1111-4222-8333-944455556666';
    riderAccount(s, rider, T0);
    playerAct(
      s,
      rider,
      { t: 'order', side: 'buy', good: 'FRIES', qty: 3, price: 1, kind: 'limit' },
      T0,
    );
    const pub = publicFloor(s, null);
    expect(pub.fills.length).toBeGreaterThan(0);
    expect(new Set(pub.orders.map(o => o.good)).size).toBe(7);
    const json = JSON.stringify(pub);
    expect(json).not.toContain(rider);
    expect(json).toContain('bot:');
    const mine = publicFloor(s, rider).orders.filter(o => o.owner === 'you');
    // its bid at 1 may sit below the top levels; when listed it's 'you'
    for (const o of mine) expect(o.good).toBe('FRIES');
    expect(maskOwner(rider, null)).toMatch(/^r:[\da-z]{7}$/);
    expect(maskOwner(rider, null)).toBe(maskOwner(rider, 'someone-else'));
    expect(maskOwner('bot:till', rider)).toBe('bot:till');
    expect(maskOwner(rider, rider)).toBe('you');
  });
});

const frame = (
  fills: FloorFrame['fills'],
  now = T0,
  orders: FloorFrame['orders'] = [],
): FloorFrame => ({
  mode: 'live',
  now,
  tickers: [],
  fills,
  orders,
  floor: [],
  bots: [],
});
const fill = (at: number, qty = 1) => ({
  good: 'FISH' as const,
  qty,
  price: 6,
  buyer: 'bot:a',
  seller: 'bot:b',
  at,
});

describe('FeedTracker', () => {
  it('replays only recent history on the first frame, then only what is new', () => {
    const tr = new FeedTracker();
    const first = tr.take(frame([fill(T0 - 10 * 60_000), fill(T0 - 5_000), fill(T0 - 1_000)]));
    expect(first.fills.map(f => f.at)).toEqual([T0 - 5_000, T0 - 1_000]);
    const second = tr.take(frame([fill(T0 - 1_000), fill(T0 + 2_000)], T0 + 3_000));
    expect(second.fills.map(f => f.at)).toEqual([T0 + 2_000]);
    expect(tr.take(frame([fill(T0 + 2_000)], T0 + 6_000)).fills).toHaveLength(0);
    expect(fillKey(fill(1))).not.toBe(fillKey(fill(1, 2)));
  });

  it('reports orders when they appear or change', () => {
    const tr = new FeedTracker();
    const o = {
      owner: 'bot:a',
      side: 'buy' as const,
      good: 'FISH' as const,
      qty: 5,
      price: 6,
      at: T0,
    };
    expect(tr.take(frame([], T0, [o])).orders).toHaveLength(1);
    expect(tr.take(frame([], T0, [o])).orders).toHaveLength(0);
    expect(tr.take(frame([], T0, [{ ...o, qty: 3 }])).orders).toHaveLength(1);
  });
});

describe('spreadDelays', () => {
  it('keeps relative timing, a minimum gap, and fits the window', () => {
    expect(spreadDelays([], 3000)).toEqual([]);
    const d = spreadDelays([0, 1000, 1000, 2000], 3000, 100);
    expect(d).toEqual([0, 1000, 1100, 2000]);
    const many = spreadDelays(
      Array.from({ length: 80 }, () => 0),
      3000,
      100,
    );
    expect(many[many.length - 1]).toBeLessThanOrEqual(3000);
    for (let i = 1; i < many.length; i++) expect(many[i]).toBeGreaterThan(many[i - 1]!);
  });
});

describe('SimFlow (the simulated crowd)', () => {
  const refs = refPrices(null, T0);

  it('prices off the real tickers when there are some', () => {
    const r = refPrices(
      [{ good: 'FISH', last: 7, bid: 6, ask: 8, chg: 0, vol: 40, fair: 6.5 }],
      T0,
    );
    expect(r.FISH).toEqual({ bid: 6, ask: 8, last: 7, vol: 40 });
    for (const g of Object.keys(refs) as (keyof typeof refs)[]) {
      expect(refs[g].ask).toBeGreaterThan(refs[g].bid);
      expect(refs[g].bid).toBeGreaterThanOrEqual(1);
    }
  });

  it('shouts and fills at the asked rates, at sane prices', () => {
    const f = new SimFlow({ shoutsPerSec: 6, fillsPerMin: 30 });
    let shouts = 0;
    let fills = 0;
    for (let i = 0; i < 600; i++) {
      const o = f.step(0.1, refs);
      shouts += o.shouts.length;
      fills += o.fills.length;
      for (const s of o.shouts) {
        const p = refs[s.good];
        if (s.side === 'buy') expect(s.price).toBeLessThanOrEqual(p.bid);
        else expect(s.price).toBeGreaterThanOrEqual(p.ask);
        expect(s.qty).toBeGreaterThanOrEqual(1);
      }
      for (const x of o.fills) {
        const p = refs[x.good];
        expect(x.price).toBeGreaterThanOrEqual(Math.min(p.bid, p.last));
        expect(x.price).toBeLessThanOrEqual(Math.max(p.ask, p.last));
      }
    }
    expect(shouts).toBe(360);
    expect(fills).toBe(30);
  });

  it('backs off as real fills pick up', () => {
    const f = new SimFlow({ shoutsPerSec: 0, fillsPerMin: 30 });
    let fills = 0;
    for (let i = 0; i < 600; i++) fills += f.step(0.1, refs, 30).fills.length;
    expect(fills).toBeLessThan(8);
  });

  it('cheap goods trade in bigger lots', () => {
    let water = 0;
    let drip = 0;
    for (let i = 0; i < 100; i++) {
      water += lotSize('WATER', i / 100);
      drip += lotSize('DRIP', i / 100);
    }
    expect(water).toBeGreaterThan(drip * 2);
  });
});

describe('looks', () => {
  it('a stable seed per id, inside the art', () => {
    const n = { bodies: 30, accessories: 140, heads: 240, glasses: 23, backgrounds: 2 };
    const a = seedFromId('sim:1', n);
    expect(seedFromId('sim:1', n)).toEqual(a);
    expect(seedFromId('sim:2', n)).not.toEqual(a);
    expect(a.head).toBeLessThan(240);
    expect(a.glasses).toBeLessThan(23);
    expect(hashStr('x')).toBe(hashStr('x'));
  });

  it('rasters run-length parts, later parts on top, colour 0 transparent', () => {
    // bounds top 1, right 3, bottom 2, left 1: a 2×1 strip at y = 1, x = 1..2
    const pal = ['', 'ff0000', '00ff00'];
    const px = rasterNoun(['0x00' + '01030201' + '0201'], pal);
    const at = (x: number, y: number) =>
      Array.from(px.slice((y * SPRITE + x) * 4, (y * SPRITE + x) * 4 + 4));
    expect(at(1, 1)).toEqual([255, 0, 0, 255]);
    expect(at(2, 1)).toEqual([255, 0, 0, 255]);
    expect(at(0, 1)[3]).toBe(0);
    rasterNoun(['0x00' + '01030201' + '0100' + '0102'], pal, px);
    expect(at(1, 1)).toEqual([255, 0, 0, 255]); // colour 0 left it alone
    expect(at(2, 1)).toEqual([0, 255, 0, 255]);
  });
});
