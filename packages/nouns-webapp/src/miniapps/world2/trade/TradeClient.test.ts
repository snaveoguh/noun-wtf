import type { TradeResult, TradeState } from './contract';

import { describe, expect, it, vi } from 'vitest';

import { RULES } from './ledger';
import { TradeClient } from './TradeClient';

const T0 = Date.UTC(2026, 9, 18, 12);
const RIDER = '0f8e0c1a-1111-4aaa-8bbb-000000000001';

describe('TradeClient offline (the same ledger, in memory)', () => {
  it('buys and sells with no network; the teleport rule still holds', async () => {
    let now = T0;
    const fetchFn = vi.fn();
    const c = new TradeClient({ offline: true, rider: RIDER, now: () => now, fetchFn });
    expect(c.state).toMatchObject({ coin: RULES.STARTER_COIN, cargo: {} });
    const b = await c.act({ t: 'buy', town: 'city', good: 'ICECREAM', qty: 4 });
    expect(b.ok).toBe(true);
    expect(c.state!.cargo.ICECREAM).toBe(4);
    expect(c.quote('city', 'ICECREAM')!.stock).toBe(236);
    const tp = await c.act({ t: 'sell', town: 'beach', good: 'ICECREAM', qty: 4 });
    expect(tp).toMatchObject({ ok: false });
    expect(tp.reason).toMatch(/too fast/);
    now += 12 * 60_000; // 28.8 km at 45 m/s ≈ 10.7 min
    expect((await c.act({ t: 'sell', town: 'beach', good: 'ICECREAM', qty: 3 })).ok).toBe(true);
    expect(c.seen.beach?.quotes.ICECREAM).toBeDefined();
    expect(c.notice).toMatchObject({ ok: true, text: 'Sold 3 ICECREAM' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('TradeClient online', () => {
  const server = (state: TradeState, extra: Partial<TradeResult> = {}) =>
    ({ ok: true, state, ...extra }) as TradeResult;

  it('shows the optimistic books at once, then takes the server answer', async () => {
    let resolve!: (v: Response) => void;
    const fetchFn = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>(r => {
          resolve = r;
          void init;
        }),
    );
    const c = new TradeClient({
      offline: false,
      rider: RIDER,
      now: () => T0,
      fetchFn: fetchFn as never,
    });
    c.state = { rider: RIDER, coin: 150, cargo: {}, capacity: 40, upgrades: [], last: null };
    const p = c.act({ t: 'buy', town: 'city', good: 'FRIES', qty: 2 });
    await Promise.resolve();
    await Promise.resolve();
    // Optimistic: already holding the fries, coin down
    expect(c.state.cargo.FRIES).toBe(2);
    expect(c.state.coin).toBeLessThan(150);
    expect(c.pending).toBe(1);
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ rider: RIDER, action: { t: 'buy', qty: 2 } });
    expect(body.id).toMatch(/^[\w-]{8,40}$/);
    // The server says otherwise: the server wins
    const truth = {
      rider: RIDER,
      coin: 137,
      cargo: { FRIES: 2 },
      capacity: 40,
      upgrades: [],
      last: null,
    };
    resolve(new Response(JSON.stringify(server(truth))));
    const r = await p;
    expect(r.ok).toBe(true);
    expect(c.state).toEqual(truth);
    expect(c.pending).toBe(0);
  });

  it('a refusal or a dropped connection rolls the books back', async () => {
    const start: TradeState = {
      rider: RIDER,
      coin: 150,
      cargo: {},
      capacity: 40,
      upgrades: [],
      last: null,
    };
    const refuse = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, reason: 'too fast: 8.0 km', state: start }), {
          status: 200,
        }),
    );
    const c = new TradeClient({ offline: false, rider: RIDER, fetchFn: refuse as never });
    c.state = start;
    const r = await c.act({ t: 'buy', town: 'cowboy', good: 'FRIES', qty: 1 });
    expect(r).toMatchObject({ ok: false, reason: 'too fast: 8.0 km' });
    expect(c.state).toEqual(start);
    expect(c.notice).toMatchObject({ ok: false });

    const down = new TradeClient({
      offline: false,
      rider: RIDER,
      fetchFn: (async () => {
        throw new Error('net');
      }) as never,
    });
    down.state = start;
    const d = await down.act({ t: 'buy', town: 'city', good: 'FRIES', qty: 1 });
    expect(d).toMatchObject({ ok: false, reason: 'offline, try again' });
    expect(down.state).toEqual(start);
  });

  it('actions go out one at a time, in order', async () => {
    const order: string[] = [];
    let inFlight = 0;
    const fetchFn = vi.fn(async (_u: string, init?: RequestInit) => {
      inFlight++;
      expect(inFlight).toBe(1);
      const a = JSON.parse(init!.body as string).action;
      order.push(`${a.t}:${a.qty}`);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return new Response(
        JSON.stringify({
          ok: true,
          state: { rider: RIDER, coin: 1, cargo: {}, capacity: 40, upgrades: [], last: null },
        }),
      );
    });
    const c = new TradeClient({ offline: false, rider: RIDER, fetchFn: fetchFn as never });
    await Promise.all([
      c.act({ t: 'buy', town: 'city', good: 'FRIES', qty: 1 }),
      c.act({ t: 'buy', town: 'city', good: 'FRIES', qty: 2 }),
      c.act({ t: 'sell', town: 'city', good: 'FRIES', qty: 3 }),
    ]);
    expect(order).toEqual(['buy:1', 'buy:2', 'sell:3']);
  });
});
