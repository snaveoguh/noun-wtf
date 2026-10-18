import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkInvariants,
  STARTER_COIN,
  type ExchangeState,
} from '../../src/miniapps/exchange/engine';

// ── An in-memory Netlify Blobs store (etags and all) ──
const blobs = new Map<string, { v: string; etag: string }>();
let etags = 0;
/** Yield between read and write so concurrent handlers really interleave. */
const yieldTick = () => new Promise(r => setTimeout(r, 0));
const store = {
  async get(k: string, o?: { type?: string }) {
    const b = blobs.get(k);
    if (!b) return null;
    return o?.type === 'json' ? JSON.parse(b.v) : b.v;
  },
  async getWithMetadata(k: string) {
    await yieldTick();
    const b = blobs.get(k);
    return b ? { data: JSON.parse(b.v), etag: b.etag } : null;
  },
  async setJSON(k: string, v: unknown, o: { onlyIfMatch?: string; onlyIfNew?: boolean } = {}) {
    await yieldTick();
    const b = blobs.get(k);
    if (o.onlyIfNew && b) return { modified: false };
    if (o.onlyIfMatch && b?.etag !== o.onlyIfMatch) return { modified: false };
    blobs.set(k, { v: JSON.stringify(v), etag: `e${++etags}` });
    return { modified: true };
  },
};
vi.mock('@netlify/blobs', () => ({ connectLambda: () => undefined, getStore: () => store }));

const { handler, MAX_ACCOUNTS } = await import('../functions/world-exchange');

const T0 = Date.UTC(2026, 9, 18, 12);
const R1 = 'rider-0001-aaaa';
const R2 = 'rider-0002-bbbb';

async function post(body: unknown) {
  const res = await handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  return { status: res.statusCode, out: JSON.parse(res.body) };
}
async function get(qs = '') {
  const res = await handler({
    httpMethod: 'GET',
    body: null,
    rawUrl: `https://noun.wtf/.netlify/functions/world-exchange${qs}`,
  });
  return { status: res.statusCode, out: JSON.parse(res.body) };
}
const saved = () => JSON.parse(blobs.get('state')!.v) as ExchangeState;

beforeEach(() => {
  blobs.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('world-exchange: reads', () => {
  it('first GET opens the exchange (bots funded, history warmed) and saves it', async () => {
    const { status, out } = await get('?good=FISH&tf=m');
    expect(status).toBe(200);
    expect(out.good).toBe('FISH');
    expect(out.depth.bids.length + out.depth.asks.length).toBeGreaterThan(0);
    expect(out.candles.length).toBeGreaterThan(0);
    expect(out.bots.length).toBeGreaterThanOrEqual(6);
    expect(out.you).toBeNull();
    expect(checkInvariants(saved())).toEqual([]);
  });

  it('GETs tick the bots lazily, and only write when the clock lagged', async () => {
    await get();
    const e1 = blobs.get('state')!.etag;
    vi.setSystemTime(T0 + 5_000);
    await get();
    expect(blobs.get('state')!.etag).toBe(e1);
    vi.setSystemTime(T0 + 60_000);
    const { out } = await get();
    expect(out.now).toBe(T0 + 60_000);
    expect(blobs.get('state')!.etag).not.toBe(e1);
    expect(saved().now).toBe(T0 + 60_000);
  });

  it('a GET never creates an account', async () => {
    await get(`?rider=${R1}`);
    expect(saved().accounts[R1]).toBeUndefined();
  });
});

describe('world-exchange: riders', () => {
  it('join grants the starter COIN exactly once', async () => {
    const a = await post({ rider: R1, action: { t: 'join' } });
    expect(a.out.ok).toBe(true);
    expect(a.out.snapshot.you.coin).toBe(STARTER_COIN);
    await post({ rider: R1, action: { t: 'join' } });
    expect(saved().accounts[R1].grant).toBe(STARTER_COIN);
  });

  it('places, fills against the bots, and cancels', async () => {
    await get();
    const s = saved();
    const ask = s.books.FISH.asks[0];
    expect(ask).toBeDefined();
    // A marketable limit buy at the best ask fills against a bot
    const r = await post({
      rider: R1,
      action: { t: 'order', side: 'buy', good: 'FISH', qty: 1, price: ask.price },
    });
    expect(r.out.ok).toBe(true);
    expect(r.out.fills[0]).toMatchObject({ buyer: R1, price: ask.price });
    expect(r.out.snapshot.you.goods.FISH).toBe(1);
    expect(r.out.snapshot.floor[0].text).toMatch(/^bought 1 FISH/);
    // A resting bid far below, then cancel it
    const rest = await post({
      rider: R1,
      action: { t: 'order', side: 'buy', good: 'WATER', qty: 5, price: 1 },
    });
    const id = rest.out.snapshot.you.orders.find((o: { good: string }) => o.good === 'WATER').id;
    expect(rest.out.snapshot.you.lockCoin).toBe(5);
    const c = await post({ rider: R1, action: { t: 'cancel', order: id } });
    expect(c.out.ok).toBe(true);
    expect(c.out.snapshot.you.lockCoin).toBe(0);
    // Someone else can't cancel your order
    const again = await post({
      rider: R1,
      action: { t: 'order', side: 'buy', good: 'WATER', qty: 1, price: 1 },
    });
    const id2 = again.out.snapshot.you.orders.find((o: { good: string }) => o.good === 'WATER').id;
    expect((await post({ rider: R2, action: { t: 'cancel', order: id2 } })).out).toMatchObject({
      ok: false,
      reason: 'not your order',
    });
    expect(checkInvariants(saved())).toEqual([]);
  });

  it('market orders fill what is there and can be afforded', async () => {
    await get();
    const r = await post({
      rider: R1,
      action: { t: 'order', side: 'buy', good: 'NOGGLES', qty: 100, price: 0, kind: 'market' },
    });
    expect(r.out.ok).toBe(true);
    const spent = r.out.fills.reduce(
      (x: number, f: { qty: number; price: number }) => x + f.qty * f.price,
      0,
    );
    expect(spent).toBeLessThanOrEqual(STARTER_COIN);
    expect(r.out.snapshot.you.coin).toBe(STARTER_COIN - spent);
  });

  it('refuses what it should, with a reason', async () => {
    expect((await post({ rider: 'x', action: { t: 'join' } })).status).toBe(400);
    expect((await post({ rider: R1, action: { t: 'steal' } })).status).toBe(400);
    expect(
      (
        await post({
          rider: R1,
          action: { t: 'order', side: 'buy', good: 'GOLD', qty: 1, price: 1 },
        })
      ).status,
    ).toBe(400);
    const res = await handler({ httpMethod: 'POST', body: '{nope' });
    expect(res.statusCode).toBe(400);
    const big = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ rider: R1, pad: 'x'.repeat(5000) }),
    });
    expect(big.statusCode).toBe(413);
    const broke = await post({
      rider: R1,
      action: { t: 'order', side: 'buy', good: 'DRIP', qty: 100, price: 900 },
    });
    expect(broke.out).toMatchObject({ ok: false, reason: 'not enough COIN' });
    const frac = await post({
      rider: R1,
      action: { t: 'order', side: 'buy', good: 'DRIP', qty: 0.5, price: 9 },
    });
    expect(frac.out.ok).toBe(false);
    // Bot ids can't be posted as (the ':' is stripped, so it is just another rider)
    await post({ rider: 'bot:abacus', action: { t: 'join' } });
    expect(saved().accounts['botabacus'].grant).toBe(STARTER_COIN);
    expect(checkInvariants(saved())).toEqual([]);
  });

  it('rate-limits each rider per minute', async () => {
    let last = 0;
    for (let i = 0; i < 45; i++) last = (await post({ rider: R1, action: { t: 'join' } })).status;
    expect(last).toBe(429);
    expect((await post({ rider: R2, action: { t: 'join' } })).status).toBe(200);
    vi.setSystemTime(T0 + 61_000);
    expect((await post({ rider: R1, action: { t: 'join' } })).status).toBe(200);
  });

  it('caps the number of riders', async () => {
    await get();
    const s = saved();
    for (let i = 0; i < MAX_ACCOUNTS; i++) {
      s.accounts[`filler-${i}`] = {
        owner: `filler-${i}`,
        coin: 0,
        lockCoin: 0,
        goods: {},
        lockGoods: {},
        grant: 0,
        first: T0,
        last: T0,
      };
    }
    blobs.set('state', { v: JSON.stringify(s), etag: 'seeded' });
    expect((await post({ rider: R1, action: { t: 'join' } })).status).toBe(503);
  });
});

describe('world-exchange: concurrency', () => {
  it('concurrent riders never lose an update (etag retries)', async () => {
    await get();
    const riders = Array.from({ length: 6 }, (_, i) => `rider-conc-${i}000`);
    const results = await Promise.all(
      riders.map(r =>
        post({ rider: r, action: { t: 'order', side: 'buy', good: 'WATER', qty: 2, price: 1 } }),
      ),
    );
    const okd = results.filter(r => r.status === 200);
    expect(okd.length).toBe(riders.length);
    const s = saved();
    for (const r of riders) {
      expect(s.accounts[r].grant).toBe(STARTER_COIN);
      expect(s.books.WATER.bids.some(o => o.owner === r)).toBe(true);
    }
    expect(checkInvariants(s)).toEqual([]);
  });

  it('first-ever requests racing still produce one exchange', async () => {
    const results = await Promise.all([get(), get(), post({ rider: R1, action: { t: 'join' } })]);
    expect(results.every(r => r.status === 200)).toBe(true);
    const s = saved();
    expect(s.accounts[R1].grant).toBe(STARTER_COIN);
    expect(checkInvariants(s)).toEqual([]);
  });
});
