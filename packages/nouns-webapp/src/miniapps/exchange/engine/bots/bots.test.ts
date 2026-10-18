// Each bot strategy is bounded: size caps, a price band around fair value,
// the town-leg budget, no mutation of what it is shown, no printing COIN.

import type { BotDef } from './types';

import { describe, expect, it } from 'vitest';

import { cancel, checkInvariants, createState, mint, ordersOf, place } from '../book';
import { fairValue, GOODS } from '../goods';
import { rngFrom } from '../rng';
import { BOT_BAND, ensureBots, genesis, STEP_MS, tick } from '../sim';

import { BOT_BY_ID, ROSTER } from './roster';
import { STRATEGIES } from './strategies';

const T0 = Date.UTC(2026, 9, 18, 12);
const HOUR = 3_600_000;

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

describe('roster', () => {
  it('every bot is a real Noun with a 5-part seed and a known strategy', () => {
    expect(ROSTER.length).toBeGreaterThanOrEqual(6);
    const styles = new Set(ROSTER.map(b => b.style));
    for (const s of ['maker', 'arb', 'momentum', 'meanrev', 'whale', 'degen'])
      expect(styles.has(s as never)).toBe(true);
    for (const b of ROSTER) {
      expect(b.id).toMatch(/^bot:[a-z]+$/);
      expect(b.seed).toHaveLength(5);
      expect(Number.isInteger(b.noun)).toBe(true);
      expect(STRATEGIES[b.style]).toBeTypeOf('function');
    }
  });
});

describe('bots alone (each strategy over 6 sim-hours)', () => {
  for (const def of ROSTER) {
    it(`${def.name} (${def.style}) stays inside its caps`, () => {
      // A market with only this bot, a wide passive liquidity provider and
      // a random taker ('flow') that hits whatever is best near fair
      const s = createState(11, T0);
      mint(s, 'lp', 100_000, Object.fromEntries(GOODS.map(g => [g, 2000])));
      mint(s, 'flow', 100_000, Object.fromEntries(GOODS.map(g => [g, 2000])));
      const others: BotDef[] = [def];
      ensureBots(s, others);
      const r = rngFrom(5);
      let t = T0;
      const minted = s.minted;
      for (let h = 0; h < 6 * 12; h++) {
        for (const o of ordersOf(s, 'lp')) cancel(s, 'lp', o.id);
        for (const g of GOODS) {
          const f = fairValue(g, t);
          place(
            s,
            {
              owner: 'lp',
              side: 'buy',
              good: g,
              qty: 30,
              price: Math.max(1, Math.floor(f * 0.88)),
            },
            t,
          );
          place(s, { owner: 'lp', side: 'sell', good: g, qty: 30, price: Math.ceil(f * 1.12) }, t);
        }
        // a crazy offer no bot may touch
        place(s, { owner: 'lp', side: 'sell', good: 'NOGGLES', qty: 5, price: 1_000_000 }, t);
        expect(checkInvariants(s)).toEqual([]);
        for (let k = 0; k < 5; k++) {
          t += 60_000;
          tick(s, t, { roster: others });
          const g = GOODS[Math.floor(r() * GOODS.length)];
          const f = fairValue(g, t);
          const buy = r() < 0.5;
          place(
            s,
            {
              owner: 'flow',
              side: buy ? 'buy' : 'sell',
              good: g,
              qty: 3,
              price: Math.round(f * (buy ? 1.1 : 0.9)),
              tif: 'ioc',
            },
            t,
          );
          expect(checkInvariants(s)).toEqual([]);
        }
      }
      // Never minted after genesis
      expect(s.minted).toBe(minted);
      const mine = s.fills.filter(f => f.buyer === def.id || f.seller === def.id);
      for (const f of mine) {
        // Orders are size-capped (one fill can't exceed the order)
        expect(f.qty).toBeLessThanOrEqual(def.maxQty);
        // and priced inside the band around fair value
        const fair = fairValue(f.good, f.at);
        expect(f.price).toBeLessThanOrEqual(Math.ceil(fair * (1 + BOT_BAND)));
        expect(f.price).toBeGreaterThanOrEqual(Math.floor(fair * (1 - BOT_BAND)));
      }
      // The absurd offer is never lifted
      expect(s.fills.some(f => f.price === 1_000_000)).toBe(false);
      // Town leg only for the arbitrageur, and bounded per hour
      if (def.style === 'arb') {
        expect(Math.abs(s.ext.coin)).toBeLessThanOrEqual(6 * (def.townCap ?? 0) * 80);
      } else {
        expect(s.ext.coin).toBe(0);
      }
      // Something happened (except the whale may sleep through it)
      if (def.style !== 'whale' && def.style !== 'momentum') expect(mine.length).toBeGreaterThan(0);
    });
  }
});

describe('strategies are pure', () => {
  it('a strategy only reads its context (deep-frozen inputs do not throw)', () => {
    const s = genesis(4, T0, HOUR);
    for (const def of ROSTER) {
      const me = deepFreeze(JSON.parse(JSON.stringify(s.accounts[def.id])));
      const mine = deepFreeze(
        [...GOODS.flatMap(g => [...s.books[g].bids, ...s.books[g].asks])]
          .filter(o => o.owner === def.id)
          .map(o => ({ ...o })),
      );
      const rng = rngFrom(1);
      const turn = STRATEGIES[def.style]({
        def,
        now: s.now,
        rng,
        me,
        mine,
        mem: deepFreeze({ next: 0, townUsed: 0, townHour: 0, k: {} }),
        fair: g => fairValue(g, s.now),
        top: g => ({
          bid: s.books[g].bids[0]?.price ?? null,
          ask: s.books[g].asks[0]?.price ?? null,
          bidQty: 5,
          askQty: 5,
          bidDepth: 50,
          askDepth: 50,
        }),
        last: g => s.last[g] ?? null,
        closes: () => [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15],
        towns: () => [
          { town: 'city', name: 'The City', ask: 9, bid: 8 },
          { town: 'cowboy', name: 'Dry Gulch', ask: 30, bid: 28 },
        ],
        townLeft: 10,
      });
      expect(Array.isArray(turn.actions)).toBe(true);
      expect(turn.say === null || typeof turn.say === 'string').toBe(true);
    }
  });
});

describe('the whole floor', () => {
  it('six hours of all bots: conserved, alive, nobody printing', () => {
    const s = genesis(21, T0, 6 * HOUR);
    expect(checkInvariants(s)).toEqual([]);
    // Every bot spoke at least once (the whale may only have napped)
    const spoke = new Set(s.floor.map(f => f.who));
    expect(spoke.size).toBeGreaterThanOrEqual(4);
    // Every good traded
    for (const g of GOODS)
      expect(s.fills.some(f => f.good === g) || s.candles[g].m.length > 0).toBe(true);
    // Equity can't run away: arbitrage is bounded by the town leg cap
    const arbDef = BOT_BY_ID['bot:sprinkles'];
    expect(-s.ext.coin).toBeLessThanOrEqual(6 * (arbDef.townCap ?? 0) * 80);
    // prices stay sane relative to fair value
    for (const g of GOODS) {
      const last = s.last[g];
      if (last === undefined) continue;
      const f = fairValue(g, s.now);
      expect(last / f).toBeGreaterThan(0.5);
      expect(last / f).toBeLessThan(1.6);
    }
    expect(STEP_MS).toBeGreaterThan(0);
  });
});
