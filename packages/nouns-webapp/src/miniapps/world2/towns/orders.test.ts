import { describe, expect, it } from 'vitest';

import { CAST, WALK_EDGE } from './cast';
import {
  DRIVE_BY,
  OrderBoard,
  SERVE_R,
  inServeRange,
  mulberry32,
  orderDuration,
  pickGood,
  streetPrice,
  tipFor,
  type Order,
} from './orders';
import { TOWNS, hotGoods } from './specs';

const order = (o: Partial<Order> = {}): Order => ({
  customer: 'cowboy:273',
  town: 'cowboy',
  good: 'WATER',
  t0: 100,
  dur: 20,
  ...o,
});

describe('order timers', () => {
  it('ice cream melts fastest in the desert', () => {
    expect(orderDuration('cowboy', 'ICECREAM')).toBeLessThan(orderDuration('beach', 'ICECREAM'));
    expect(orderDuration('beach', 'ICECREAM')).toBeLessThan(orderDuration('beach', 'FISH'));
    expect(orderDuration('cowboy', 'ICECREAM')).toBeLessThan(orderDuration('cowboy', 'WATER'));
  });

  it('expires orders on time and re-opens them after a cooldown', () => {
    const b = new OrderBoard('cowboy', ['a', 'b'], mulberry32(1), { maxOpen: 2, cooldown: [5, 5] });
    let ev = b.update(0);
    expect(ev).toHaveLength(0);
    ev = b.update(20);
    expect(ev.filter(e => e.t === 'open')).toHaveLength(2);
    const a = b.open.get('a')!;
    ev = b.update(a.t0 + a.dur - 0.01);
    expect(b.open.has('a')).toBe(true);
    ev = b.update(a.t0 + a.dur + 0.01);
    expect(ev.some(e => e.t === 'expire' && e.order.customer === 'a')).toBe(true);
    expect(b.open.has('a')).toBe(false);
    // Cooldown: not again until 5 s later
    expect(b.update(a.t0 + a.dur + 4).some(e => e.t === 'open' && e.order.customer === 'a')).toBe(
      false,
    );
    expect(b.update(a.t0 + a.dur + 5.1).some(e => e.t === 'open' && e.order.customer === 'a')).toBe(
      true,
    );
  });

  it('caps the number of open orders', () => {
    const b = new OrderBoard('beach', ['a', 'b', 'c', 'd', 'e'], mulberry32(2), {
      maxOpen: 3,
      cooldown: [1, 2],
    });
    b.update(100);
    expect(b.open.size).toBe(3);
  });

  it('is deterministic for a given random source', () => {
    const run = () => {
      const b = new OrderBoard('beach', ['a', 'b', 'c'], mulberry32(7));
      const out: string[] = [];
      for (let t = 0; t < 200; t += 0.5)
        for (const e of b.update(t)) out.push(`${e.t}:${e.order.customer}:${e.order.good}`);
      return out.join(',');
    };
    expect(run()).toBe(run());
  });
});

describe('what customers want', () => {
  it('asks for what the town pays for, never what it makes', () => {
    const rnd = mulberry32(3);
    const n: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const g = pickGood('cowboy', rnd);
      n[g] = (n[g] ?? 0) + 1;
    }
    for (const g of TOWNS.cowboy.market.makes) expect(n[g] ?? 0).toBe(0);
    // Ice cream + water dominate out west
    expect(n.WATER).toBeGreaterThan(n.DRIP);
    expect(n.ICECREAM).toBeGreaterThan(n.PIZZA);
    const m: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const g = pickGood('beach', rnd);
      m[g] = (m[g] ?? 0) + 1;
    }
    expect(m.FISH ?? 0).toBe(0);
    expect(m.DRIP).toBeGreaterThan(m.ICECREAM);
  });

  it('banners list the hot goods', () => {
    expect(hotGoods('cowboy').slice(0, 2)).toEqual(['WATER', 'ICECREAM']);
    expect(hotGoods('beach')[0]).toBe('DRIP');
    expect(streetPrice('beach', 'DRIP')).toBeGreaterThan(streetPrice('cowboy', 'DRIP'));
    expect(streetPrice('beach', 'FISH')).toBeLessThan(streetPrice('city', 'FISH'));
  });
});

describe('tips', () => {
  it('grows with time left and with hand-off speed', () => {
    const o = order();
    const fresh = tipFor(o, 101, 0);
    const late = tipFor(o, 118, 0);
    expect(fresh.tip).toBeGreaterThan(late.tip);
    const fast = tipFor(o, 101, 30);
    expect(fast.tip).toBeGreaterThan(fresh.tip);
    expect(fast.grade).toBe('DRIVE-BY!');
    expect(tipFor(o, 101, DRIVE_BY - 1).grade).toBe('SPEEDY!');
    expect(tipFor(o, 117, 0).grade).toBe('SERVED');
    expect(fast.total).toBe(fast.price + fast.tip);
  });

  it('caps the speed bonus and uses the server price when given', () => {
    const o = order();
    expect(tipFor(o, 101, 500).tip).toBe(tipFor(o, 101, 35).tip);
    expect(tipFor(o, 101, 0, 40).price).toBe(40);
  });

  it('serving pays once, then the customer rests', () => {
    const b = new OrderBoard('cowboy', ['a'], mulberry32(4), { maxOpen: 1, cooldown: [10, 10] });
    b.update(10);
    const o = b.open.get('a')!;
    const ev = b.serve('a', o.t0 + 1, 20);
    expect(ev?.t).toBe('served');
    expect(b.serve('a', o.t0 + 1.1, 20)).toBeNull();
    expect(b.open.size).toBe(0);
    expect(b.update(o.t0 + 5)).toHaveLength(0);
    // Too late: an expired order can't be served
    const b2 = new OrderBoard('cowboy', ['a'], mulberry32(4), { maxOpen: 1, cooldown: [10, 10] });
    b2.update(10);
    const o2 = b2.open.get('a')!;
    expect(b2.serve('a', o2.t0 + o2.dur + 1, 0)).toBeNull();
  });
});

describe('serving range', () => {
  it('is 6 m horizontally, a few metres vertically', () => {
    const c = { x: 0, y: 0.32, z: 0 };
    expect(SERVE_R).toBe(6);
    expect(inServeRange({ x: 5.9, y: 0, z: 0 }, c)).toBe(true);
    expect(inServeRange({ x: 4.3, y: 0, z: 4.3 }, c)).toBe(false);
    expect(inServeRange({ x: 0, y: 6, z: 1 }, c)).toBe(false);
    // Pull over to the kerb side of main street (5 m off the line) to serve;
    // blasting down the crown of the road is out of reach
    for (const town of ['cowboy', 'beach'] as const)
      for (const d of CAST[town]) {
        expect(Math.abs(d.vp)).toBeGreaterThanOrEqual(WALK_EDGE);
        const kerb = { x: Math.sign(d.vp) * 5, y: 0, z: 2 };
        expect(inServeRange(kerb, { x: d.vp, y: d.y, z: 0 })).toBe(true);
        expect(inServeRange({ x: 0, y: 0, z: 0 }, { x: d.vp, y: d.y, z: 0 })).toBe(false);
      }
  });

  it('customer ids are unique and carry the noun id', () => {
    const ids = [...CAST.cowboy, ...CAST.beach].map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of CAST.cowboy) expect(d.id).toBe(`cowboy:${d.noun}`);
  });
});
