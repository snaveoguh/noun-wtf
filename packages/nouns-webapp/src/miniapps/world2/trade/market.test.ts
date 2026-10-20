import type { GoodId, TownId } from './contract';

import { describe, expect, it } from 'vitest';

import { GOOD_IDS, GOODS } from './goods';
import {
  buyCost,
  freshMarket,
  HALF_LIFE_S,
  marketAt,
  midPrice,
  normalizeMarkets,
  quoteAt,
  relax,
  sellProceeds,
  stockCap,
  targetStock,
  unitAsk,
  unitBid,
} from './market';
import { TOWN_IDS, TOWN_SPECS, travelMetres } from './towns';

const T0 = Date.UTC(2026, 9, 18);

describe('goods + towns tables', () => {
  it('every good is token-shaped (symbol = id, integer base, sane bulk / spoil)', () => {
    for (const g of GOOD_IDS) {
      const s = GOODS[g];
      expect(s.symbol).toBe(g);
      expect(s.id).toBe(g);
      expect(Number.isInteger(s.base) && s.base > 0).toBe(true);
      expect(s.bulk).toBeGreaterThanOrEqual(1);
      expect(s.spoil).toBeGreaterThanOrEqual(0);
    }
    expect(GOODS.ICECREAM.spoil).toBe(0.02);
    expect(GOOD_IDS).toHaveLength(Object.keys(GOODS).length);
  });

  it('towns: the city is the hub, road distance goes through it between lines', () => {
    expect(TOWN_SPECS.city.s).toBe(0);
    expect(travelMetres('city', 'cowboy')).toBe(11_400);
    // Same line: straight on down, not back through the city
    expect(travelMetres('cowboy', 'beach')).toBe(17_400);
    expect(travelMetres('beach', 'cowboy')).toBe(17_400);
    // Different lines: through the city
    expect(travelMetres('jersey', 'beach')).toBe(21_656 + 28_800);
    expect(travelMetres('jersey', 'jersey')).toBe(0);
  });

  it('the design: the deserts pay most for cold, beach makes FISH cheap and pays most for DRIP', () => {
    const at = (t: TownId, g: GoodId) => quoteAt(t, g, targetStock(t, g));
    const best = (g: GoodId, ts = TOWN_IDS) =>
      ts.slice().sort((a, b) => at(b, g).bid - at(a, g).bid)[0];
    const cheapest = (g: GoodId) => TOWN_IDS.slice().sort((a, b) => at(a, g).ask - at(b, g).ask)[0];
    // Crater Lil (out past the Bowl) tops them; Dry Gulch is the near desert
    expect(best('ICECREAM')).toBe('crater');
    expect(best('WATER')).toBe('crater');
    const near: TownId[] = ['city', 'jersey', 'cowboy', 'beach', 'noggle'];
    expect(best('ICECREAM', near)).toBe('cowboy');
    expect(best('WATER', near)).toBe('cowboy');
    expect(best('DRIP')).toBe('beach');
    expect(cheapest('FISH')).toBe('beach');
    expect(cheapest('ICECREAM')).toBe('city');
  });

  it('the weird towns: each makes something cheap that another pays well for', () => {
    const at = (t: TownId, g: GoodId) => quoteAt(t, g, targetStock(t, g));
    const cheapest = (g: GoodId) => TOWN_IDS.slice().sort((a, b) => at(a, g).ask - at(b, g).ask)[0];
    expect(cheapest('NOGGLES')).toBe('noggle');
    expect(cheapest('WATER')).toBe('shroom');
    expect(cheapest('DRIP')).toBe('neon');
    // A haul from where it's made to where it's wanted clears the spread
    for (const [from, to, g] of [
      ['noggle', 'shroom', 'NOGGLES'],
      ['shroom', 'crater', 'WATER'],
      ['neon', 'beach', 'DRIP'],
      ['shroom', 'neon', 'PIZZA'],
    ] as [TownId, TownId, GoodId][])
      expect(at(to, g).bid).toBeGreaterThan(at(from, g).ask * 1.5);
  });
});

describe('pricing', () => {
  it('ask > bid everywhere, both integers ≥ 1', () => {
    for (const t of TOWN_IDS)
      for (const g of GOOD_IDS)
        for (const s of [1, 5, targetStock(t, g), stockCap(t, g) - 1]) {
          const q = quoteAt(t, g, s);
          expect(Number.isInteger(q.ask) && Number.isInteger(q.bid)).toBe(true);
          expect(q.bid).toBeGreaterThanOrEqual(1);
          expect(q.ask).toBeGreaterThan(q.bid);
        }
  });

  it('price falls as stock rises, and stays within its clamp', () => {
    const t: TownId = 'cowboy';
    const g: GoodId = 'ICECREAM';
    let prev = Infinity;
    for (let s = 1; s < stockCap(t, g); s += 7) {
      const m = midPrice(t, g, s);
      expect(m).toBeLessThanOrEqual(prev);
      prev = m;
    }
    const ref = GOODS[g].base * 2.3;
    expect(midPrice(t, g, 0)).toBeCloseTo(ref * 6);
    expect(midPrice(t, g, 1e9)).toBeCloseTo(ref * 0.15);
  });

  it('at target stock, mid is base × bias (numbers in the report)', () => {
    expect(midPrice('city', 'ICECREAM', targetStock('city', 'ICECREAM'))).toBeCloseTo(9);
    expect(midPrice('cowboy', 'ICECREAM', targetStock('cowboy', 'ICECREAM'))).toBeCloseTo(27.6);
    expect(midPrice('beach', 'DRIP', targetStock('beach', 'DRIP'))).toBeCloseTo(112);
    expect(midPrice('beach', 'FISH', targetStock('beach', 'FISH'))).toBeCloseTo(4);
    expect(quoteAt('city', 'ICECREAM', 240)).toMatchObject({ ask: 10, bid: 8 });
    expect(quoteAt('cowboy', 'ICECREAM', targetStock('cowboy', 'ICECREAM'))).toMatchObject({
      ask: 30,
      bid: 25,
    });
  });

  it('a round trip in one town always loses (any size, any stock)', () => {
    for (const t of TOWN_IDS)
      for (const g of GOOD_IDS)
        for (const s of [3, 20, targetStock(t, g), 400])
          for (const q of [1, 2, 10, 50]) {
            const cost = buyCost(t, g, s, q);
            if (cost === null) continue;
            const back = sellProceeds(t, g, s - q, q);
            if (back === null) continue;
            expect(back).toBeLessThan(cost);
          }
  });

  it('a big order walks the price (slippage): 50 at once costs more than 50 × the first unit', () => {
    const s = targetStock('city', 'ICECREAM');
    expect(buyCost('city', 'ICECREAM', s, 50)!).toBeGreaterThan(
      50 * unitAsk('city', 'ICECREAM', s),
    );
    expect(sellProceeds('cowboy', 'ICECREAM', 52, 50)!).toBeLessThan(
      50 * unitBid('cowboy', 'ICECREAM', 52),
    );
  });

  it("can't buy past the stock or sell past the cap", () => {
    expect(buyCost('cowboy', 'FRIES', 3.4, 3)).not.toBeNull();
    expect(buyCost('cowboy', 'FRIES', 3.4, 4)).toBeNull();
    const cap = stockCap('cowboy', 'WATER');
    expect(sellProceeds('cowboy', 'WATER', cap - 2, 2)).not.toBeNull();
    expect(sellProceeds('cowboy', 'WATER', cap - 2, 3)).toBeNull();
    expect(quoteAt('cowboy', 'WATER', cap).bid).toBe(0);
    expect(quoteAt('cowboy', 'WATER', 0).ask).toBe(0);
  });
});

describe('mean reversion', () => {
  it('a flooded town drifts halfway back to target per half-life (~1 h)', () => {
    const t = targetStock('cowboy', 'ICECREAM');
    const flooded = t + 200;
    expect(relax('cowboy', 'ICECREAM', flooded, HALF_LIFE_S * 1000)).toBeCloseTo(t + 100);
    expect(relax('cowboy', 'ICECREAM', flooded, 2 * HALF_LIFE_S * 1000)).toBeCloseTo(t + 50);
    // A drained one refills the same way
    expect(relax('beach', 'FISH', 0, HALF_LIFE_S * 1000)).toBeCloseTo(120);
    expect(relax('beach', 'FISH', 17, 0)).toBe(17);
    expect(relax('beach', 'FISH', 17, -5000)).toBe(17);
  });

  it('marketAt is deterministic, a copy, and never runs time backwards', () => {
    const m = freshMarket('cowboy', T0);
    m.stock.ICECREAM = 300;
    const a = marketAt('cowboy', m, T0 + 3_600_000);
    const b = marketAt('cowboy', m, T0 + 3_600_000);
    expect(a).toEqual(b);
    expect(m.stock.ICECREAM).toBe(300);
    expect(a.stock.ICECREAM).toBeCloseTo((300 + 52) / 2);
    const back = marketAt('cowboy', a, T0);
    expect(back.at).toBe(a.at);
    expect(back.stock.ICECREAM).toBeCloseTo(a.stock.ICECREAM);
  });

  it('normalizeMarkets repairs junk (bad towns / stocks reset, future clocks pulled back)', () => {
    const m = normalizeMarkets(
      { cowboy: { at: T0 + 9e9, stock: { ICECREAM: -4, WATER: 10 } }, mars: {}, beach: 'x' },
      T0,
    );
    expect(m.cowboy.at).toBe(T0);
    expect(m.cowboy.stock.ICECREAM).toBe(targetStock('cowboy', 'ICECREAM'));
    expect(m.cowboy.stock.WATER).toBe(10);
    expect(m.beach.stock.FISH).toBe(240);
    expect(Object.keys(m).sort()).toEqual(TOWN_IDS.slice().sort());
  });
});
