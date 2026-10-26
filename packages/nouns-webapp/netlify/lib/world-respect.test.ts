import { beforeEach, describe, expect, it, vi } from 'vitest';

// (Lives in netlify/lib, not netlify/functions: Netlify would bundle a test
// file there as a function and break the deploy.)

const opened: unknown[] = [];
vi.mock('@netlify/blobs', () => ({
  getStore: (opts: unknown) => {
    opened.push(opts);
    return store;
  },
}));

// ── An in-memory Blobs store with etags ──
const blobs = new Map<string, { v: string; etag: string }>();
let etags = 0;
/** Force the next N conditional writes to lose (a concurrent writer). */
let loseNext = 0;
const store = {
  async getWithMetadata(k: string) {
    const b = blobs.get(k);
    return b !== undefined ? { data: JSON.parse(b.v) as unknown, etag: b.etag } : null;
  },
  async setJSON(k: string, v: unknown, o: { onlyIfMatch?: string; onlyIfNew?: boolean } = {}) {
    const b = blobs.get(k);
    if (loseNext > 0) {
      loseNext--;
      // someone else wrote meanwhile
      blobs.set(k, {
        v: b?.v ?? JSON.stringify({ book: { score: 0, at: 0, log: [] } }),
        etag: `e${++etags}`,
      });
      return { modified: false };
    }
    if (
      (o.onlyIfNew === true && b !== undefined) ||
      (o.onlyIfMatch !== undefined && b?.etag !== o.onlyIfMatch)
    )
      return { modified: false };
    blobs.set(k, { v: JSON.stringify(v), etag: `e${++etags}` });
    return { modified: true };
  },
};

const {
  default: fn,
  handleRespect,
  applyBatch,
  RESPECT_STORE,
} = await import('../functions/world-respect');

const T0 = Date.UTC(2026, 9, 26, 12);
const R1 = '0f8e0c1a-1111-4aaa-8bbb-000000000001';

let n = 0;
const ev = (e: unknown, at = T0) => ({ id: `ev-${++n}-abcdef`, at, e });
const post = (body: unknown, now = T0) =>
  handleRespect(store, 'POST', {}, typeof body === 'string' ? body : JSON.stringify(body), now);
const get = (rider: string, now = T0) => handleRespect(store, 'GET', { rider }, null, now);
const body = (r: { body: string }) => JSON.parse(r.body) as Record<string, unknown>;

beforeEach(() => {
  blobs.clear();
  loseNext = 0;
});

describe('world-respect GET', () => {
  it('an unknown rider is a fresh stranger (nothing written)', async () => {
    const r = await get(R1);
    expect(r.statusCode).toBe(200);
    expect(body(r)).toMatchObject({ ok: true, known: false, score: 0, tier: 'stranger' });
    expect(blobs.size).toBe(0);
  });

  it('rejects a bad rider id', async () => {
    expect((await get('x')).statusCode).toBe(400);
    expect((await get('../../etc')).statusCode).toBe(400);
  });
});

describe('world-respect POST', () => {
  it('scores events with the shared rules and keeps the score', async () => {
    const r = await post({ rider: R1, events: [ev({ kind: 'gift', to: 'Nadia', coin: 5 })] });
    expect(r.statusCode).toBe(200);
    expect(body(r)).toMatchObject({ ok: true, known: true, score: 4, tier: 'stranger' });
    expect(body(await get(R1))).toMatchObject({ known: true, score: 4 });
  });

  it('never reads a score, tier or delta from the client', async () => {
    const r = await post({
      rider: R1,
      score: 9999,
      tier: 'legend',
      events: [{ ...ev({ kind: 'hoops_win' }), d: 500, delta: 500 }],
    });
    expect(body(r)).toMatchObject({ score: 8, tier: 'stranger' });
  });

  it('skips unknown kinds and malformed fields; nothing valid is a 400', async () => {
    const r = await post({
      rider: R1,
      events: [
        ev({ kind: 'score', amount: 1e6 }),
        ev({ kind: 'trick', score: 'lots' }),
        ev({ kind: 'helped', who: 'Ziggy' }),
      ],
    });
    expect(body(r).score).toBe(5);
    const applied = body(r).applied as { d: number; bad?: boolean }[];
    expect(applied.filter(a => a.bad === true)).toHaveLength(2);
    expect((await post({ rider: R1, events: [ev({ kind: 'nope' })] })).statusCode).toBe(400);
  });

  it.each([
    ['not JSON', '{'],
    ['no rider', { events: [{ id: 'abcdefg', at: T0, e: { kind: 'hoops_win' } }] }],
    ['no events', { rider: R1, events: [] }],
    [
      'too many events',
      { rider: R1, events: Array.from({ length: 21 }, () => ev({ kind: 'hoops_win' })) },
    ],
    ['bad ids only', { rider: R1, events: [{ id: '!', at: T0, e: { kind: 'hoops_win' } }] }],
  ])('400s on %s', async (_n, b) => {
    expect((await post(b)).statusCode).toBe(400);
  });

  it('413s on a huge body', async () => {
    expect((await post('x'.repeat(20_000))).statusCode).toBe(413);
  });

  it('applies the same rate limits as the game', async () => {
    const big = () => ev({ kind: 'trick', score: 1_000_000 });
    const r = await post({ rider: R1, events: [big(), big(), big(), big(), big()] });
    expect(body(r).score).toBe(12); // 3 a minute, +4 each
  });

  it('caps a batch of fakes at +40 a minute', async () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      ev({ kind: 'custom', label: `x${i}`, amount: 10 }),
    );
    expect(body(await post({ rider: R1, events })).score).toBe(40);
  });

  it('a resent batch (same ids) is not counted twice', async () => {
    const events = [ev({ kind: 'hoops_win' })];
    await post({ rider: R1, events });
    const again = await post({ rider: R1, events });
    expect(body(again).score).toBe(8);
    expect((body(again).applied as { dup?: boolean }[])[0]!.dup).toBe(true);
  });

  it('clamps times: no future, at most 15 minutes back, never before the last event', async () => {
    // A minute's worth of fakes stamped across the last hour only spreads over 15 min
    const events = Array.from({ length: 20 }, (_, i) =>
      ev({ kind: 'hoops_win' }, T0 - 3600_000 + i * 180_000),
    );
    const r = await post({ rider: R1, events });
    // hoops 2 a minute; all 20 squeezed into [now − 15 min, now]
    expect(body(r).score).toBeLessThanOrEqual(15 * 2 * 8 + 16);
    // Future-dated events land at now (no banking ahead)
    const fut = Array.from({ length: 5 }, () =>
      ev({ kind: 'helped', who: 'a' + n }, T0 + 3600_000),
    );
    const before = body(await get(R1)).score as number;
    const r2 = await post({ rider: R1, events: fut });
    expect((body(r2).score as number) - before).toBeLessThanOrEqual(15);
  });

  it('back-dating cannot reopen a minute already spent', async () => {
    const w = () => ev({ kind: 'hoops_win' }, T0);
    await post({ rider: R1, events: [w(), w()] }, T0);
    // Same moment, now stamped a minute earlier: clamped to the last event's time
    const r = await post(
      { rider: R1, events: [ev({ kind: 'hoops_win' }, T0 - 60_000)] },
      T0 + 1000,
    );
    expect(body(r).score).toBe(16);
  });

  it('retries a lost compare-and-swap', async () => {
    await post({ rider: R1, events: [ev({ kind: 'hoops_win' })] });
    loseNext = 2;
    const r = await post({ rider: R1, events: [ev({ kind: 'helped', who: 'z' })] }, T0 + 1000);
    expect(r.statusCode).toBe(200);
    expect(body(r).score).toBe(13);
  });

  it('applyBatch is pure and orders by time', () => {
    const row = {
      book: { score: 0, tier: 'stranger' as const, at: T0 - 10_000, log: [] },
      seen: [],
    };
    const out = applyBatch(
      row,
      [
        { id: 'b-later-1', at: T0, raw: { kind: 'bail_into', who: 'z' } },
        { id: 'a-first-1', at: T0 - 5000, raw: { kind: 'bail_into', who: 'z' } },
      ],
      T0,
    );
    expect(out.applied.map(a => a.id)).toEqual(['a-first-1', 'b-later-1']);
    expect(out.row.book.score).toBeCloseTo(-3, 1); // (5 s of forgiveness)
    expect(row.book.score).toBe(0);
  });
});

describe('world-respect handler', () => {
  it('opens a strong store and answers CORS', async () => {
    const res = await fn(
      new Request(`https://noun.wtf/.netlify/functions/world-respect?rider=${R1}`, {
        method: 'GET',
      }),
    );
    expect(res.status).toBe(200);
    expect(opened.at(-1)).toEqual({ name: RESPECT_STORE, consistency: 'strong' });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const opt = await fn(
      new Request('https://noun.wtf/.netlify/functions/world-respect', { method: 'OPTIONS' }),
    );
    expect(opt.status).toBe(204);
  });
});
