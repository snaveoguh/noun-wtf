import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { audit, RULES, type TradeRow } from '../../src/miniapps/world2/trade/ledger';
import { targetStock } from '../../src/miniapps/world2/trade/market';

// (Lives in netlify/lib, not netlify/functions: Netlify would bundle a test
// file there as a function and break the deploy.)

// ── An in-memory Netlify Blobs store (etags and all) ──
const blobs = new Map<string, { v: string; etag: string }>();
let etags = 0;
let conflicts = 0;
/** Let other in-flight requests run between every store call (forces races). */
const yieldMany = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};
const store = {
  async get(k: string, o?: { type?: string }) {
    await yieldMany();
    const b = blobs.get(k);
    if (b === undefined) return null;
    return o?.type === 'json' ? JSON.parse(b.v) : b.v;
  },
  async getWithMetadata(k: string) {
    await yieldMany();
    const b = blobs.get(k);
    return b !== undefined ? { data: JSON.parse(b.v), etag: b.etag } : null;
  },
  async setJSON(k: string, v: unknown, o: { onlyIfMatch?: string; onlyIfNew?: boolean } = {}) {
    await yieldMany();
    const b = blobs.get(k);
    if (
      (o.onlyIfNew === true && b !== undefined) ||
      (o.onlyIfMatch !== undefined && b?.etag !== o.onlyIfMatch)
    ) {
      conflicts++;
      return { modified: false };
    }
    blobs.set(k, { v: JSON.stringify(v), etag: `e${++etags}` });
    return { modified: true };
  },
};
vi.mock('@netlify/blobs', () => ({ connectLambda: () => undefined, getStore: () => store }));

const { handler } = await import('../functions/world-trade');

const T0 = Date.UTC(2026, 9, 18, 12);
const R1 = '0f8e0c1a-1111-4aaa-8bbb-000000000001';
const R2 = '0f8e0c1a-2222-4aaa-8bbb-000000000002';

async function post(body: unknown) {
  const res = await handler({
    httpMethod: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.statusCode, out: JSON.parse(res.body) };
}
async function get(q: Record<string, string> = {}) {
  const res = await handler({ httpMethod: 'GET', body: null, queryStringParameters: q });
  return { status: res.statusCode, out: JSON.parse(res.body) };
}
const act = (rider: string, action: unknown, id?: string) =>
  post({ rider, action, ...(id ? { id } : {}) });
const row = (rider: string) => JSON.parse(blobs.get(`rider/${rider}`)!.v) as TradeRow;
const markets = () => JSON.parse(blobs.get('markets')!.v);
const rejections = () =>
  (blobs.has('rejections') ? JSON.parse(blobs.get('rejections')!.v) : []) as {
    kind: string;
    reason: string;
  }[];
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

beforeEach(() => {
  blobs.clear();
  conflicts = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('world-trade: reads', () => {
  it('GET with no rider: every town × good quote', async () => {
    const { status, out } = await get();
    expect(status).toBe(200);
    expect(out.quotes).toHaveLength(4 * 7);
    expect(out.quotes[0]).toMatchObject({ town: 'city' });
  });

  it("GET a new rider: the starter purse, one town's quotes, and nothing written", async () => {
    const { out } = await get({ rider: R1, town: 'cowboy' });
    expect(out.state).toMatchObject({
      rider: R1,
      coin: RULES.STARTER_COIN,
      cargo: {},
      capacity: 40,
    });
    expect(out.quotes.every((q: { town: string }) => q.town === 'cowboy')).toBe(true);
    expect(blobs.has(`rider/${R1}`)).toBe(false);
    expect((await get({ rider: 'x' })).status).toBe(400);
    expect((await get({ rider: R1, town: 'mars' })).status).toBe(400);
  });
});

describe('world-trade: the server holds the books', () => {
  it('buy then sell: coin, cargo and town stock move; the stored row balances', async () => {
    const b = await act(R1, { t: 'buy', town: 'city', good: 'ICECREAM', qty: 10 });
    expect(b.out.ok).toBe(true);
    expect(b.out.state.cargo).toEqual({ ICECREAM: 10 });
    const coin = b.out.state.coin;
    expect(coin).toBeLessThan(RULES.STARTER_COIN);
    expect(markets().city.stock.ICECREAM).toBeCloseTo(targetStock('city', 'ICECREAM') - 10, 3);
    expect(b.out.quotes).toHaveLength(7);
    advance(1000);
    const s = await act(R1, { t: 'sell', town: 'city', good: 'ICECREAM', qty: 4 });
    expect(s.out.state.coin).toBeGreaterThan(coin);
    expect(s.out.state.cargo).toEqual({ ICECREAM: 6 });
    expect(audit(row(R1))).toBe(true);
    // A fresh read sees the same books
    expect((await get({ rider: R1 })).out.state).toEqual(s.out.state);
  });

  it('client-reported balances are ignored: only the action counts', async () => {
    const r = await post({
      rider: R1,
      coin: 1e9,
      state: { coin: 1e9, cargo: { DRIP: 500 } },
      action: { t: 'buy', town: 'city', good: 'FRIES', qty: 1, price: 0, coin: 1e9 },
    });
    expect(r.out.ok).toBe(true);
    expect(r.out.state.coin).toBeLessThan(RULES.STARTER_COIN);
    expect(r.out.state.cargo).toEqual({ FRIES: 1 });
    // And no way to mint: unknown action types are refused
    expect((await act(R1, { t: 'mint', amount: 1e6 })).status).toBe(400);
    expect((await act(R1, { t: 'sell', town: 'city', good: 'DRIP', qty: 5 })).out).toMatchObject({
      ok: false,
      kind: 'cargo',
    });
  });

  it('malformed input: 400 / 413, and junk is logged', async () => {
    expect((await post('{nope')).status).toBe(400);
    expect((await post({ rider: 'short', action: {} })).status).toBe(400);
    expect((await post({ rider: `${R1}!`, action: {} })).status).toBe(400);
    expect((await post({ rider: R1, id: 'x'.repeat(80), action: {} })).status).toBe(400);
    expect((await post({ rider: R1, action: { t: 'buy', pad: 'x'.repeat(3000) } })).status).toBe(
      413,
    );
    const bad = await act(R1, { t: 'buy', town: 'city', good: 'FISH', qty: -2 });
    expect(bad.status).toBe(400);
    expect(rejections().at(-1)).toMatchObject({ kind: 'invalid' });
    const ge = await act(R1, { t: 'order', side: 'buy', good: 'FISH', qty: 1, price: 3 });
    expect(ge.out).toMatchObject({ ok: false, kind: 'unsupported' });
    expect((await handler({ httpMethod: 'PUT', body: null })).statusCode).toBe(405);
  });
});

describe('world-trade: anti-cheat', () => {
  it('a teleport is refused (and logged); the honest drive goes through', async () => {
    await act(R1, { t: 'buy', town: 'city', good: 'ICECREAM', qty: 8 });
    advance(5000);
    const tp = await act(R1, { t: 'sell', town: 'cowboy', good: 'ICECREAM', qty: 8 });
    expect(tp.status).toBe(200);
    expect(tp.out).toMatchObject({ ok: false, kind: 'travel' });
    expect(tp.out.state.cargo).toEqual({ ICECREAM: 8 });
    expect(rejections().at(-1)).toMatchObject({ kind: 'travel' });
    expect(rejections().at(-1)!.reason).toMatch(/too fast: 8\.0 km from city in 5 s/);
    // 8 km at 30 m/s ≈ 4.4 min
    advance(267_000);
    const sold = await act(R1, { t: 'sell', town: 'cowboy', good: 'ICECREAM', qty: 7 });
    expect(sold.out.ok).toBe(true);
    expect(row(R1).last).toEqual({ town: 'cowboy', at: Date.now() });
  });

  it('rate limit: a burst past the bucket gets 429, refusals included', async () => {
    const codes: number[] = [];
    for (let i = 0; i < RULES.BUCKET_MAX + 3; i++)
      codes.push((await act(R1, { t: 'buy', town: 'city', good: 'DRIP', qty: 1 })).status);
    expect(codes.filter(c => c === 429)).toHaveLength(3);
    expect(rejections().some(r => r.kind === 'rate')).toBe(true);
    advance(2000);
    expect((await act(R1, { t: 'buy', town: 'city', good: 'FRIES', qty: 1 })).out.ok).toBe(true);
  });

  it('a retried request id is answered, never applied twice', async () => {
    const a = await act(R1, { t: 'buy', town: 'city', good: 'PIZZA', qty: 2 }, 'n-1');
    const b = await act(R1, { t: 'buy', town: 'city', good: 'PIZZA', qty: 2 }, 'n-1');
    expect(b.out).toMatchObject({ ok: true, dup: true });
    expect(b.out.state).toEqual(a.out.state);
    expect(row(R1).held).toEqual({ PIZZA: 2 });
  });
});

describe('world-trade: concurrency', () => {
  it("two writes at once from one rider don't lose (or double) coin", async () => {
    await act(R1, { t: 'buy', town: 'city', good: 'FRIES', qty: 1 }); // the row exists
    const before = row(R1);
    const [a, b] = await Promise.all([
      act(R1, { t: 'buy', town: 'city', good: 'NOGGLES', qty: 1 }),
      act(R1, { t: 'buy', town: 'city', good: 'FRIES', qty: 2 }),
    ]);
    expect([a.out.ok, b.out.ok]).toEqual([true, true]);
    expect(conflicts).toBeGreaterThan(0); // they really raced
    const after = row(R1);
    expect(after.held).toEqual({ FRIES: 3, NOGGLES: 1 });
    const spent = after.book.spent - before.book.spent;
    expect(after.coin).toBe(before.coin - spent);
    expect(audit(after)).toBe(true);
    expect(after.book.trades).toBe(3);
  });

  it('a brand-new rider racing itself still gets exactly one starter purse', async () => {
    const res = await Promise.all(
      [1, 2, 3].map(() => act(R2, { t: 'buy', town: 'city', good: 'FRIES', qty: 1 })),
    );
    expect(res.map(r => r.out.ok)).toEqual([true, true, true]);
    const r = row(R2);
    expect(r.book.granted).toBe(RULES.STARTER_COIN);
    expect(r.held).toEqual({ FRIES: 3 });
    expect(audit(r)).toBe(true);
  });

  it('two riders trading one town at once: both stock moves land in the markets', async () => {
    await act(R1, { t: 'buy', town: 'city', good: 'WATER', qty: 1 }); // markets exist
    const s0 = markets().city.stock.WATER;
    conflicts = 0;
    await Promise.all([
      act(R1, { t: 'buy', town: 'city', good: 'WATER', qty: 5 }),
      act(R2, { t: 'buy', town: 'city', good: 'WATER', qty: 7 }),
    ]);
    expect(conflicts).toBeGreaterThan(0);
    expect(markets().city.stock.WATER).toBeCloseTo(s0 - 12, 3);
  });
});
