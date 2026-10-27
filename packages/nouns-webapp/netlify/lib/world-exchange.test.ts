import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkInvariants,
  fairValue,
  STARTER_COIN,
  type ExchangeState,
} from '../../src/miniapps/exchange/engine';
import { maskOwner } from '../../src/miniapps/exchange3d/sim/feed';
import { formAction, openForm } from '../../src/miniapps/exchange3d/sim/tradeForm';

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

describe('world-exchange: privacy', () => {
  it("never shows another rider's id (it would let anyone trade as them)", async () => {
    await get();
    const ask = saved().books.FISH.asks[0]!;
    await post({ rider: R1, action: { t: 'join' } });
    await post({
      rider: R1,
      action: { t: 'order', side: 'buy', good: 'FISH', qty: 1, price: ask.price },
    });
    // Someone else looking: R1 appears only as an anonymous tag
    const other = JSON.stringify((await get(`?good=FISH&rider=${R2}&floor=1`)).out);
    expect(other).not.toContain(R1);
    const anon = JSON.stringify((await get('?good=FISH&floor=1')).out);
    expect(anon).not.toContain(R1);
    // R1 still recognises their own trades
    const mine = (await get(`?good=FISH&rider=${R1}`)).out;
    expect(mine.tape.some((f: { buyer: string }) => f.buyer === R1)).toBe(true);
  });
});

describe('world-exchange: direct deals (player to player, player to bot)', () => {
  const tag = (r: string) => maskOwner(r, null);
  /** R1 holds some FISH (bought off the book), R2 has joined. */
  async function setup() {
    await get();
    const ask = saved().books.FISH.asks[0]!;
    await post({ rider: R1, action: { t: 'join' } });
    await post({
      rider: R1,
      action: { t: 'order', side: 'buy', good: 'FISH', qty: 2, price: ask.price + 5 },
    });
    await post({ rider: R2, action: { t: 'join' } });
    return saved().accounts[R1]!.goods.FISH ?? 0;
  }
  const offer = (from: string, a: Record<string, unknown>) =>
    post({
      rider: from,
      action: { t: 'offer', to: tag(R2), side: 'sell', good: 'FISH', qty: 1, price: 30, ...a },
    });

  it('offer → the target sees it by tag → accept settles it, ledger intact', async () => {
    const fish = await setup();
    expect(fish).toBeGreaterThanOrEqual(1);
    const o = await offer(R1, {});
    expect(o.out.ok).toBe(true);
    expect(o.out.deal).toMatchObject({
      who: tag(R2),
      side: 'sell',
      good: 'FISH',
      qty: 1,
      price: 30,
    });
    expect(o.out.deals.outgoing).toHaveLength(1);
    // The target polls (a GET, as the floor does) and sees it from R1's tag
    const seen = (await get(`?rider=${R2}&floor=1`)).out;
    expect(seen.deals.incoming).toHaveLength(1);
    expect(seen.deals.incoming[0].who).toBe(tag(R1));
    const coin1 = saved().accounts[R1]!.coin;
    const coin2 = saved().accounts[R2]!.coin;
    const id = seen.deals.incoming[0].id;
    const a = await post({ rider: R2, action: { t: 'accept', deal: id } });
    expect(a.out.ok).toBe(true);
    const s = saved();
    expect(s.accounts[R2]!.goods.FISH).toBe(1);
    expect(s.accounts[R2]!.coin).toBe(coin2 - 30);
    expect(s.accounts[R1]!.coin).toBe(coin1 + 30); // the 1% fee floors to 0 on 30
    expect(s.accounts[R1]!.goods.FISH ?? 0).toBe(fish - 1);
    expect(s.deals).toEqual([]);
    expect(s.fills.at(-1)).toMatchObject({ buyer: R2, seller: R1, qty: 1, price: 30 });
    expect(checkInvariants(s)).toEqual([]);
    // Accepting twice does nothing
    expect((await post({ rider: R2, action: { t: 'accept', deal: id } })).out).toMatchObject({
      ok: false,
      reason: 'that offer has gone',
    });
  });

  it('never hands out a raw rider id, in deals or on the tape', async () => {
    await setup();
    await offer(R1, {});
    const seen = (await get(`?rider=${R2}&floor=1`)).out;
    expect(JSON.stringify(seen)).not.toContain(R1);
    const a = await post({ rider: R2, action: { t: 'accept', deal: seen.deals.incoming[0].id } });
    expect(JSON.stringify(a.out)).not.toContain(R1);
    expect(JSON.stringify((await get('?floor=1')).out)).not.toContain(R2);
  });

  it("the target's account stays on the server (toOwner never goes out)", async () => {
    await setup();
    const o = await offer(R1, {});
    expect(saved().deals![0]!.toOwner).toBe(R2);
    expect(JSON.stringify(o.out)).not.toContain(R2);
    expect(JSON.stringify((await get(`?rider=${R1}&floor=1`)).out)).not.toContain(R2);
    expect(JSON.stringify((await get(`?rider=${R2}&floor=1`)).out)).not.toContain(R1);
  });

  it("the 3D floor's trade panel: its actions go through as they are", async () => {
    await setup();
    const tickers = (await get()).out.tickers;
    const you = (await get(`?rider=${R1}`)).out.you;
    // Clicked another player (by their public tag): a direct offer
    const peer = {
      kind: 'peer' as const,
      key: 'peer:x',
      name: 'BOB',
      tag: tag(R2),
      seedKey: '0-0-0-0-0',
    };
    const f = { ...openForm(peer, tickers, you, 'FISH'), side: 'sell' as const, qty: 1, price: 25 };
    const sent = await post({ rider: R1, action: formAction(peer, f) });
    expect(sent.out).toMatchObject({ ok: true, deal: { who: tag(R2), qty: 1, price: 25 } });
    expect((await get(`?rider=${R2}`)).out.deals.incoming[0]).toMatchObject({ who: tag(R1) });
    // A simulated trader: a limit order on the real book
    const sim = { kind: 'sim' as const, key: 'sim:1', name: 'TRADER #1', good: 'WATER' as const };
    const g = openForm(sim, tickers, you, 'FISH');
    expect(g.good).toBe('WATER');
    const order = await post({
      rider: R1,
      action: formAction(sim, { ...g, side: 'buy', price: 1 }),
    });
    expect(order.out.ok).toBe(true);
    expect(saved().books.WATER.bids.some(b => b.owner === R1)).toBe(true);
    // A forged target (a raw rider id instead of a tag) is refused
    const forged = { ...peer, tag: R2 };
    expect((await post({ rider: R1, action: formAction(forged, f) })).out.ok).toBe(false);
    expect(checkInvariants(saved())).toEqual([]);
  });

  it('only the target can accept; either side can decline', async () => {
    await setup();
    const R3 = 'rider-0003-cccc';
    await post({ rider: R3, action: { t: 'join' } });
    const id = (await offer(R1, {})).out.deal.id;
    expect((await post({ rider: R3, action: { t: 'accept', deal: id } })).out).toMatchObject({
      ok: false,
      reason: 'not your offer',
    });
    expect((await post({ rider: R1, action: { t: 'accept', deal: id } })).out.ok).toBe(false);
    expect((await post({ rider: R3, action: { t: 'decline', deal: id } })).out.ok).toBe(false);
    expect((await post({ rider: R2, action: { t: 'decline', deal: id } })).out.ok).toBe(true);
    expect(saved().deals).toEqual([]);
  });

  it('validates offers server-side', async () => {
    await setup();
    expect((await offer(R1, { to: tag(R1) })).out.reason).toBe("that's you");
    expect((await offer(R1, { to: 'r:zzzzzzz' })).out.reason).toBe('no trader by that tag');
    expect((await offer(R1, { to: 'nobody' })).out.reason).toBe('bad target');
    expect((await offer(R1, { qty: 0 })).out.ok).toBe(false);
    expect((await offer(R1, { qty: 1.5 })).out.ok).toBe(false);
    expect((await offer(R1, { price: -3 })).out.ok).toBe(false);
    expect((await offer(R1, { qty: 400 })).out.reason).toBe('not enough FISH');
    expect((await offer(R1, { side: 'buy', qty: 100, price: 900 })).out.reason).toBe(
      'not enough COIN',
    );
    expect((await offer(R1, { good: 'GOLD' })).status).toBe(400);
    expect(saved().deals ?? []).toEqual([]);
  });

  it("an offer the proposer can't cover any more fails on accept and is dropped", async () => {
    const fish = await setup();
    const o = await offer(R1, { qty: fish, price: 5 });
    // R1 sells the FISH on the book first
    const bid = saved().books.FISH.bids[0]!;
    await post({
      rider: R1,
      action: { t: 'order', side: 'sell', good: 'FISH', qty: fish, price: bid.price },
    });
    expect(saved().accounts[R1]!.goods.FISH ?? 0).toBeLessThan(fish);
    const a = await post({ rider: R2, action: { t: 'accept', deal: o.out.deal.id } });
    expect(a.out).toMatchObject({ ok: false, reason: "they can't cover it any more" });
    expect(saved().deals).toEqual([]);
    expect(checkInvariants(saved())).toEqual([]);
  });

  it('offers lapse after the TTL and are capped per rider', async () => {
    await setup();
    for (let i = 0; i < 6; i++) await offer(R1, { side: 'buy', good: 'WATER', price: 1 + i });
    expect(saved().deals!.length).toBe(4);
    vi.setSystemTime(T0 + 100_000);
    expect((await get(`?rider=${R2}`)).out.deals.incoming).toEqual([]);
  });

  it('a bot answers at once: takes a good price, passes on a bad one', async () => {
    await get();
    await post({ rider: R1, action: { t: 'join' } });
    const fair = fairValue('WATER', saved().now);
    const toBot = (price: number) =>
      post({
        rider: R1,
        action: { t: 'offer', to: 'bot:abacus', side: 'buy', good: 'WATER', qty: 2, price },
      });
    const bad = await toBot(1);
    expect(bad.out.ok).toBe(false);
    expect(bad.out.reason).toMatch(/Abacus won't sell/);
    const good = await toBot(Math.ceil(fair * 1.2));
    expect(good.out.ok).toBe(true);
    expect(good.out.fills[0]).toMatchObject({ buyer: R1, seller: 'bot:abacus', qty: 2 });
    expect(saved().accounts[R1]!.goods.WATER).toBe(2);
    expect(checkInvariants(saved())).toEqual([]);
  }, 30_000);
});
