import { describe, expect, it } from 'vitest';

import { LocalExchange } from './client';
import { checkInvariants } from './engine';

describe('LocalExchange (?offline=1)', () => {
  it('runs the floor in memory: starter COIN, an order, a fill, a cancel', async () => {
    const x = new LocalExchange(3, 1);
    const s0 = await x.load('ICECREAM', 'm');
    expect(s0.you?.coin).toBe(500);
    expect(s0.bots.length).toBeGreaterThanOrEqual(6);
    expect(s0.candles.length).toBeGreaterThan(0);
    const ask = s0.depth.asks[0].price;
    const buy = await x.act(
      { t: 'order', side: 'buy', good: 'ICECREAM', qty: 1, price: ask },
      'ICECREAM',
      'm',
    );
    expect(buy.ok).toBe(true);
    expect(buy.fills[0].buyer).toBe(x.owner);
    const rest = await x.act(
      { t: 'order', side: 'buy', good: 'WATER', qty: 2, price: 1 },
      'WATER',
      'h',
    );
    const id = rest.snapshot.you!.orders[0].id;
    const c = await x.act({ t: 'cancel', order: id }, 'WATER', 'h');
    expect(c.ok).toBe(true);
    expect(c.snapshot.you!.orders).toHaveLength(0);
    expect(checkInvariants(x.state)).toEqual([]);
  });
});
