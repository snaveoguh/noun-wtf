// Escrow + conservation invariants under seeded random fuzz.

import { describe, expect, it } from 'vitest';

import { cancel, checkInvariants, createState, mint, ordersOf, place, placeMarket } from './book';
import { GOODS } from './goods';
import { pick, randInt, rngFrom } from './rng';
import { genesis, playerAct, snapshot, tick } from './sim';

const T0 = Date.UTC(2026, 9, 18, 12);
const HOUR = 3_600_000;

describe('fuzz: raw order flow', () => {
  for (const seed of [1, 7, 42, 1337, 90210]) {
    it(`seed ${seed}: 3000 random orders/cancels keep every invariant`, () => {
      const r = rngFrom(seed);
      const s = createState(seed, T0);
      const owners = ['a', 'b', 'c', 'd', 'e', 'f'];
      for (const o of owners) {
        const goods: Record<string, number> = {};
        for (const g of GOODS) goods[g] = randInt(r, 0, 60);
        mint(s, o, randInt(r, 50, 3000), goods);
      }
      let fills = 0;
      for (let i = 0; i < 3000; i++) {
        const owner = pick(r, owners);
        const good = pick(r, GOODS);
        const roll = r();
        const now = T0 + i * 1000;
        if (roll < 0.15) {
          const mine = ordersOf(s, owner);
          if (mine.length) cancel(s, owner, pick(r, mine).id);
          // and a bogus cancel of someone else's order never works
          const theirs = ordersOf(s, pick(r, owners));
          if (theirs.length && theirs[0].owner !== owner)
            expect(cancel(s, owner, theirs[0].id).ok).toBe(false);
        } else if (roll < 0.3) {
          fills += placeMarket(
            s,
            { owner, side: r() < 0.5 ? 'buy' : 'sell', good, qty: randInt(r, 1, 20) },
            now,
          ).fills.length;
        } else {
          fills += place(
            s,
            {
              owner,
              side: r() < 0.5 ? 'buy' : 'sell',
              good,
              qty: randInt(r, 1, 25),
              price: randInt(r, 1, 30),
              tif: r() < 0.2 ? 'ioc' : 'gtc',
            },
            now,
          ).fills.length;
        }
        const errs = checkInvariants(s);
        if (errs.length) throw new Error(`step ${i}: ${errs.join('; ')}`);
      }
      expect(fills).toBeGreaterThan(100);
      expect(s.treasury).toBeGreaterThanOrEqual(0);
    });
  }
});

describe('fuzz: bots + riders over sim-hours', () => {
  it('invariants hold after every tick and every rider action', () => {
    const r = rngFrom(99);
    const s = genesis(99, T0, HOUR);
    const riders = ['rider-aaaaaaaa', 'rider-bbbbbbbb', 'rider-cccccccc'];
    let t = T0;
    for (let i = 0; i < 400; i++) {
      t += randInt(r, 1_000, 60_000);
      tick(s, t);
      expect(checkInvariants(s)).toEqual([]);
      const who = pick(r, riders);
      const good = pick(r, GOODS);
      const roll = r();
      if (roll < 0.2) {
        const mine = ordersOf(s, who);
        if (mine.length) playerAct(s, who, { t: 'cancel', order: pick(r, mine).id }, t);
      } else {
        const last = s.last[good] ?? 10;
        playerAct(
          s,
          who,
          {
            t: 'order',
            side: r() < 0.5 ? 'buy' : 'sell',
            good,
            qty: randInt(r, 1, 8),
            price: Math.max(1, Math.round(last * (0.85 + r() * 0.3))),
            kind: roll < 0.4 ? 'market' : 'limit',
          },
          t,
        );
      }
      const errs = checkInvariants(s);
      if (errs.length) throw new Error(`step ${i}: ${errs.join('; ')}`);
    }
    // Starter grants are the only COIN riders ever got
    for (const id of riders) expect(s.accounts[id]?.grant).toBe(500);
    expect(s.fills.length).toBeGreaterThan(50);
  });

  it('is deterministic: same seed + same clock = same exchange', () => {
    const a = genesis(5, T0, HOUR);
    const b = genesis(5, T0, HOUR);
    tick(a, T0 + 600_000);
    tick(b, T0 + 600_000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = genesis(6, T0, HOUR);
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });

  it('bounded work: a day-long gap only replays the last few minutes', () => {
    const s = genesis(3, T0, HOUR);
    const r = tick(s, T0 + 24 * HOUR);
    expect(r.steps).toBe(120);
    expect(r.skipped).toBeGreaterThan(23 * HOUR);
    expect(s.now).toBe(T0 + 24 * HOUR);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('JSON round-trips (what the server stores is what it reads)', () => {
    const s = genesis(8, T0, HOUR);
    const copy = JSON.parse(JSON.stringify(s));
    tick(s, T0 + 300_000);
    tick(copy, T0 + 300_000);
    expect(copy).toEqual(s);
    expect(snapshot(copy, { good: 'FISH', tf: 'h' }).candles.length).toBeGreaterThan(0);
  });
});
