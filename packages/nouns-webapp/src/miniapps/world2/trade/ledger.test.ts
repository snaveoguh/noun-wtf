import type { TownId, TradeAction } from './contract';

import { describe, expect, it } from 'vitest';

import {
  age,
  applyAction,
  audit,
  minTravelMs,
  newRow,
  normalizeRow,
  parseAction,
  RULES,
  stateOf,
  travelCheck,
  type Outcome,
  type TradeRow,
} from './ledger';
import { freshMarkets, targetStock, type Markets } from './market';
import { BASE_CAPACITY, BIGBOX_SLOTS } from './upgrades';

const T0 = Date.UTC(2026, 9, 18, 12);
const MIN = 60_000;

/** A little world: one rider, the markets, a clock. */
function world(coin: number = RULES.STARTER_COIN) {
  let row = newRow('r1', T0);
  row = { ...row, coin, book: { ...row.book, granted: coin } };
  let markets: Markets = freshMarkets(T0);
  let now = T0;
  const w = {
    get row() {
      return row;
    },
    get markets() {
      return markets;
    },
    get now() {
      return now;
    },
    wait(ms: number) {
      now += ms;
    },
    /** Drive honestly at a real van speed (30 m/s, under the 52 m/s cap). */
    drive(metres: number) {
      now += (metres / 30) * 1000;
    },
    act(a: TradeAction, id?: string): Outcome {
      now += 600; // a human click
      const o = applyAction(row, markets, a, now, id);
      row = o.row;
      if (o.ok) markets = o.markets;
      return o;
    },
  };
  return w;
}

const ok = (o: Outcome) => {
  if (!o.ok) throw new Error(`rejected: ${o.reason}`);
  return o;
};
const no = (o: Outcome) => {
  if (o.ok) throw new Error('accepted');
  return o;
};

describe('buy / sell / books', () => {
  it('buy takes coin and stock, sell gives coin back and fills stock; the books balance', () => {
    const w = world();
    const s0 = w.markets.city.stock.ICECREAM;
    const b = ok(w.act({ t: 'buy', town: 'city', good: 'ICECREAM', qty: 5 }));
    expect(b.coin).toBeLessThan(0);
    expect(w.row.coin).toBe(RULES.STARTER_COIN + b.coin);
    expect(stateOf(w.row).cargo.ICECREAM).toBe(5);
    expect(w.markets.city.stock.ICECREAM).toBeCloseTo(s0 - 5, 3);
    const s = ok(w.act({ t: 'sell', town: 'city', good: 'ICECREAM', qty: 5 }));
    expect(s.coin).toBeGreaterThan(0);
    expect(s.coin).toBeLessThan(-b.coin); // a round trip loses the spread
    expect(stateOf(w.row).cargo.ICECREAM).toBeUndefined();
    expect(audit(w.row)).toBe(true);
    expect(w.row.book.trades).toBe(2);
  });

  it("refuses what you can't afford, don't have, or can't fit", () => {
    const w = world(30);
    expect(no(w.act({ t: 'buy', town: 'city', good: 'DRIP', qty: 1 })).kind).toBe('funds');
    expect(no(w.act({ t: 'sell', town: 'city', good: 'FISH', qty: 1 })).kind).toBe('cargo');
    const rich = world(100_000);
    // WATER is 2 slots a unit: 20 fill the stock van, the 21st doesn't fit
    ok(rich.act({ t: 'buy', town: 'city', good: 'WATER', qty: BASE_CAPACITY / 2 }));
    expect(no(rich.act({ t: 'buy', town: 'city', good: 'WATER', qty: 1 })).kind).toBe('capacity');
    expect(no(rich.act({ t: 'buy', town: 'city', good: 'NOGGLES', qty: 1 })).reason).toMatch(
      /no room/,
    );
    expect(audit(rich.row)).toBe(true);
  });

  it("can't buy more than the town has", () => {
    const w = world(1_000_000);
    ok(w.act({ t: 'upgrade', town: 'city', up: 'bigbox' }));
    const have = targetStock('cowboy', 'WATER'); // 34
    w.drive(11_400);
    const o = no(w.act({ t: 'buy', town: 'cowboy', good: 'WATER', qty: have + 1 }));
    expect(o.kind).toBe('stock');
  });

  it('a rejected action changes nothing but the rate bucket', () => {
    const w = world(30);
    const before = w.row;
    const o = no(w.act({ t: 'buy', town: 'city', good: 'DRIP', qty: 1 }));
    expect(o.row.coin).toBe(before.coin);
    expect(o.row.last).toBe(before.last);
    expect(o.row.bucket.n).toBeLessThan(RULES.BUCKET_MAX);
  });
});

describe('spoilage', () => {
  it('ice cream melts ~2%/min in the van; the freezer slows it 4×; whole units only', () => {
    const w = world(10_000);
    ok(w.act({ t: 'buy', town: 'city', good: 'ICECREAM', qty: 40 }));
    const at = w.now;
    const later = age(w.row, at + 10 * MIN);
    // 40 · (1 − 0.98^10) = 7.3 melted: 7 whole units gone, 0.3 owed
    expect(stateOf(later).cargo.ICECREAM).toBe(33);
    expect(later.melt.ICECREAM).toBeCloseTo(40 * (1 - Math.pow(0.98, 10)) - 7, 6);
    // A quick resale loses nothing to the melt
    const quick = age(w.row, at + 1000);
    expect(stateOf(quick).cargo.ICECREAM).toBe(40);

    const f = world(10_000);
    ok(f.act({ t: 'upgrade', town: 'city', up: 'freezer' }));
    ok(f.act({ t: 'buy', town: 'city', good: 'ICECREAM', qty: 30 }));
    const cold = age(f.row, f.now + 10 * MIN);
    expect(stateOf(cold).cargo.ICECREAM).toBe(29); // 30 · (1 − 0.995^10) = 1.47 melted
    // Non-spoiling goods keep forever
    ok(f.act({ t: 'buy', town: 'city', good: 'NOGGLES', qty: 3 }));
    expect(stateOf(age(f.row, f.now + 600 * MIN)).cargo.NOGGLES).toBe(3);
  });

  it("melted units can't be sold, and owed melt is never handed back", () => {
    const w = world(10_000);
    ok(w.act({ t: 'buy', town: 'city', good: 'ICECREAM', qty: 2 }));
    w.wait(30 * MIN); // 2 · (1 − 0.98^30) = 0.91 owed: both still there
    ok(w.act({ t: 'sell', town: 'city', good: 'ICECREAM', qty: 1 }));
    w.wait(10 * MIN); // 0.91 + 1 · 0.18 > 1: the last one's gone
    expect(no(w.act({ t: 'sell', town: 'city', good: 'ICECREAM', qty: 1 })).kind).toBe('cargo');
    expect(w.row.held.ICECREAM).toBeUndefined();
    // Spoiling in whole units only: the total melted tracks the model
    const big = world(10_000);
    ok(big.act({ t: 'buy', town: 'city', good: 'ICECREAM', qty: 40 }));
    let r = big.row;
    for (let i = 1; i <= 60; i++) r = age(r, big.now + i * 20_000); // 20 min in 20 s steps
    expect(stateOf(r).cargo.ICECREAM).toBeGreaterThanOrEqual(
      Math.floor(40 * Math.pow(0.98, 20)) - 1,
    );
    expect(stateOf(r).cargo.ICECREAM).toBeLessThanOrEqual(Math.ceil(40 * Math.pow(0.98, 20)));
  });
});

describe('upgrades', () => {
  it('cost coin once, raise capacity (bigbox), and are never bought twice', () => {
    const w = world(1000);
    expect(stateOf(w.row).capacity).toBe(BASE_CAPACITY);
    const o = ok(w.act({ t: 'upgrade', town: 'city', up: 'bigbox' }));
    expect(o.coin).toBe(-500);
    expect(stateOf(w.row).capacity).toBe(BASE_CAPACITY + BIGBOX_SLOTS);
    expect(no(w.act({ t: 'upgrade', town: 'city', up: 'bigbox' })).kind).toBe('owned');
    expect(no(w.act({ t: 'upgrade', town: 'city', up: 'engine' })).kind).toBe('funds');
    expect(audit(w.row)).toBe(true);
  });

  it('the horn makes street customers pay 5% more', () => {
    const run = (horn: boolean) => {
      const w = world(5000);
      if (horn) ok(w.act({ t: 'upgrade', town: 'city', up: 'horn' }));
      ok(w.act({ t: 'buy', town: 'city', good: 'ICECREAM', qty: 1 }));
      w.drive(11_400);
      return ok(w.act({ t: 'serve', town: 'cowboy', good: 'ICECREAM', customer: 'noun:42' })).coin;
    };
    expect(run(true)).toBeGreaterThan(run(false));
  });
});

describe('street sales (serve)', () => {
  it('pays a premium over the bid, once per customer per cooldown, one at a time', () => {
    const w = world(5000);
    ok(w.act({ t: 'buy', town: 'city', good: 'ICECREAM', qty: 6 }));
    w.drive(11_400);
    const bid = Math.floor(27.6 * Math.pow(52 / 53, 0.7) * 0.94);
    const s = ok(w.act({ t: 'serve', town: 'cowboy', good: 'ICECREAM', customer: 'noun:1' }));
    expect(s.coin).toBeGreaterThan(bid);
    expect(
      no(w.act({ t: 'serve', town: 'cowboy', good: 'ICECREAM', customer: 'noun:2' })).kind,
    ).toBe('rate');
    w.wait(RULES.SERVE_GAP_MS);
    expect(
      no(w.act({ t: 'serve', town: 'cowboy', good: 'ICECREAM', customer: 'noun:1' })).kind,
    ).toBe('cooldown');
    ok(w.act({ t: 'serve', town: 'cowboy', good: 'ICECREAM', customer: 'noun:2' }));
    w.wait(RULES.CUSTOMER_COOLDOWN_MS);
    ok(w.act({ t: 'serve', town: 'cowboy', good: 'ICECREAM', customer: 'noun:1' }));
    expect(no(w.act({ t: 'serve', town: 'cowboy', good: 'FISH', customer: 'noun:9' })).kind).toBe(
      'cargo',
    );
    expect(audit(w.row)).toBe(true);
  });
});

describe('anti-cheat: travel time', () => {
  it('a teleport between towns is refused; an honest drive is accepted', () => {
    const w = world(5000);
    ok(w.act({ t: 'buy', town: 'city', good: 'ICECREAM', qty: 10 }));
    // Straight to the desert 8 km away, 0.6 s later: teleport
    const tp = no(w.act({ t: 'sell', town: 'cowboy', good: 'ICECREAM', qty: 10 }));
    expect(tp.kind).toBe('travel');
    expect(tp.reason).toMatch(/too fast: 11\.4 km from city/);
    // A real drive at 30 m/s (~6.3 min) is fine
    w.drive(11_400);
    ok(w.act({ t: 'sell', town: 'cowboy', good: 'ICECREAM', qty: 9 }));
  });

  it('cowboy → beach runs on down the same line (17.4 km), not back through the city', () => {
    const w = world(5000);
    ok(w.act({ t: 'buy', town: 'city', good: 'NOGGLES', qty: 2 }));
    w.drive(11_400);
    ok(w.act({ t: 'sell', town: 'cowboy', good: 'NOGGLES', qty: 1 }));
    w.drive(5_000); // not far enough yet
    expect(no(w.act({ t: 'sell', town: 'beach', good: 'NOGGLES', qty: 1 })).kind).toBe('travel');
    w.drive(12_400);
    ok(w.act({ t: 'sell', town: 'beach', good: 'NOGGLES', qty: 1 }));
  });

  it('the limit: just under the minimum fails, the minimum passes; the engine allows 10% faster', () => {
    const r: TradeRow = { ...newRow('r', T0), last: { town: 'city', at: T0 } };
    const need = minTravelMs('city', 'beach', []);
    expect(need).toBeCloseTo((28_800 / RULES.VAN_MAX_SPEED - RULES.TRAVEL_GRACE_S) * 1000);
    expect(travelCheck(r, 'beach', T0 + need - 1000)).toMatch(/too fast/);
    expect(travelCheck(r, 'beach', T0 + Math.ceil(need))).toBeNull();
    expect(minTravelMs('city', 'beach', ['engine'])).toBeLessThan(need);
    expect(travelCheck({ ...r, upgrades: ['engine'] }, 'beach', T0 + need - 1000)).toBeNull();
    // Same town / first ever trade: nothing to check
    expect(travelCheck(r, 'city', T0)).toBeNull();
    expect(travelCheck({ ...r, last: null }, 'jersey', T0)).toBeNull();
  });

  it('a refused teleport does not move "last" (no laundering through a failed hop)', () => {
    const w = world(5000);
    ok(w.act({ t: 'buy', town: 'city', good: 'NOGGLES', qty: 1 }));
    no(w.act({ t: 'sell', town: 'beach', good: 'NOGGLES', qty: 1 }));
    expect(w.row.last?.town).toBe('city');
  });
});

describe('anti-cheat: rate + ids + input', () => {
  it('a burst past the bucket is refused, then refills', () => {
    let row = newRow('r', T0);
    const m = freshMarkets(T0);
    let refused = 0;
    for (let i = 0; i < 40; i++) {
      const o = applyAction(row, m, { t: 'upgrade', town: 'city', up: 'engine' }, T0 + i);
      row = o.row;
      if (!o.ok && o.kind === 'rate') refused++;
    }
    expect(refused).toBe(40 - RULES.BUCKET_MAX);
    const later = applyAction(row, m, { t: 'buy', town: 'city', good: 'FRIES', qty: 1 }, T0 + 2000);
    expect(later.ok).toBe(true);
  });

  it('a retried action id is answered, not repeated', () => {
    const w = world();
    ok(w.act({ t: 'buy', town: 'city', good: 'FRIES', qty: 3 }, 'a1'));
    const coin = w.row.coin;
    const again = ok(w.act({ t: 'buy', town: 'city', good: 'FRIES', qty: 3 }, 'a1'));
    expect(again.dup).toBe(true);
    expect(w.row.coin).toBe(coin);
    expect(stateOf(w.row).cargo.FRIES).toBe(3);
  });

  it('parseAction: only known towns / goods / upgrades and whole quantities in range', () => {
    expect(parseAction({ t: 'buy', town: 'city', good: 'FISH', qty: 2 })).toEqual({
      a: { t: 'buy', town: 'city', good: 'FISH', qty: 2 },
    });
    for (const bad of [
      null,
      { t: 'buy', town: 'mars', good: 'FISH', qty: 2 },
      { t: 'buy', town: 'city', good: 'GOLD', qty: 2 },
      { t: 'buy', town: 'city', good: 'FISH', qty: 2.5 },
      { t: 'sell', town: 'city', good: 'FISH', qty: -3 },
      { t: 'sell', town: 'city', good: 'FISH', qty: 1e9 },
      { t: 'serve', town: 'city', good: 'FISH', customer: '<script>' },
      { t: 'upgrade', town: 'city', up: 'rocket' },
      { t: 'order', side: 'buy', good: 'FISH', qty: 1, price: 1 },
      { t: 'mint', amount: 1e6 },
    ])
      expect('error' in parseAction(bad)).toBe(true);
  });

  it('normalizeRow repairs a corrupt row without minting coin', () => {
    const r = normalizeRow(
      { coin: -50, held: { FISH: 3, GOLD: 9, WATER: NaN }, upgrades: ['freezer', 'x', 'freezer'] },
      'r9',
      T0,
    );
    expect(r.coin).toBe(0);
    expect(r.held).toEqual({ FISH: 3 });
    expect(r.upgrades).toEqual(['freezer']);
    expect(normalizeRow(null, 'r9', T0)).toEqual(newRow('r9', T0));
  });
});

describe('arbitrage sanity', () => {
  /** One loop: fill up with ice cream in the city, drive to the desert, sell it all, drive back. */
  function loop(w: ReturnType<typeof world>) {
    const before = w.row.coin;
    const room = stateOf(w.row).capacity;
    let qty = room;
    // Buy as many as the coin allows
    while (
      qty > 0 &&
      !applyAction(w.row, w.markets, { t: 'buy', town: 'city', good: 'ICECREAM', qty }, w.now + 600)
        .ok
    )
      qty--;
    ok(w.act({ t: 'buy', town: 'city', good: 'ICECREAM', qty }));
    w.drive(11_400);
    const have = stateOf(age(w.row, w.now + 600)).cargo.ICECREAM ?? 0;
    ok(w.act({ t: 'sell', town: 'cowboy', good: 'ICECREAM', qty: have }));
    w.drive(11_400);
    return w.row.coin - before;
  }

  it('city → desert ice cream pays (even after the melt), but flooding the desert kills the margin', () => {
    const w = world(1000);
    const profits: number[] = [];
    for (let i = 0; i < 6; i++) profits.push(loop(w));
    // The first run is a solid business (~80% on 420 COIN of ice cream)…
    expect(profits[0]).toBeGreaterThan(250);
    // …each back-to-back run pays less as the desert fills up and the city drains…
    for (let i = 1; i < profits.length; i++) expect(profits[i]).toBeLessThan(profits[i - 1]);
    // …and by the third it loses money: the margin is bounded, not a money printer
    expect(profits[2]).toBeLessThan(0);
    expect(profits.filter(p => p > 0).reduce((a, b) => a + b, 0)).toBeLessThan(profits[0] * 1.6);
    expect(audit(w.row)).toBe(true);
  });

  it('dumping 200 at once fetches far less a unit than a modest load', () => {
    const w = world(1_000_000);
    ok(w.act({ t: 'upgrade', town: 'city', up: 'bigbox' }));
    ok(w.act({ t: 'buy', town: 'city', good: 'NOGGLES', qty: 80 }));
    w.drive(28_800);
    const small = applyAction(
      w.row,
      w.markets,
      { t: 'sell', town: 'beach', good: 'NOGGLES', qty: 10 },
      w.now,
    );
    const big = applyAction(
      w.row,
      w.markets,
      { t: 'sell', town: 'beach', good: 'NOGGLES', qty: 80 },
      w.now,
    );
    expect(small.ok && big.ok).toBe(true);
    if (small.ok && big.ok) expect(big.coin / 80).toBeLessThan((small.coin / 10) * 0.85);
  });

  it('left alone for a few hours, the desert recovers and the run pays again', () => {
    const w = world(1000);
    const first = loop(w);
    loop(w);
    const tired = loop(w);
    expect(tired).toBeLessThan(0);
    w.wait(5 * 3_600_000);
    const fresh = loop(w);
    expect(fresh).toBeGreaterThan(first * 0.6);
  });

  it('a desert town pays a fortune for water and beach fish is cheap (cross-goods route)', () => {
    const w = world(1000);
    ok(w.act({ t: 'buy', town: 'city', good: 'WATER', qty: 20 }));
    const spent = -w.row.coin + 1000;
    w.drive(11_400);
    const got = ok(w.act({ t: 'sell', town: 'cowboy', good: 'WATER', qty: 20 })).coin;
    expect(got).toBeGreaterThan(spent * 1.5);
  });
});

describe('determinism', () => {
  it('the same actions at the same times give the same books', () => {
    const run = () => {
      const w = world(800);
      const acts: [TownId, TradeAction][] = [
        ['city', { t: 'buy', town: 'city', good: 'ICECREAM', qty: 20 }],
        ['city', { t: 'buy', town: 'city', good: 'PIZZA', qty: 5 }],
        ['jersey', { t: 'sell', town: 'jersey', good: 'PIZZA', qty: 5 }],
        ['jersey', { t: 'sell', town: 'jersey', good: 'ICECREAM', qty: 5 }],
      ];
      let at: TownId = 'city';
      for (const [town, a] of acts) {
        if (town !== at) w.drive(60_000);
        at = town;
        w.act(a);
      }
      return { row: w.row, markets: w.markets };
    };
    expect(run()).toEqual(run());
  });
});
