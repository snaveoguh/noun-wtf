import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ownerTag, type FmTrack } from '../../../nouns-party/src/fmStation';

// ── An in-memory Netlify Blobs store with eventual consistency ──
// (same model as world-graffiti.test.ts: a blob that's been read is served
// from a stale edge copy until settle(); listings show the origin as of the
// last settle; writes and their conditions are checked at the origin)
const origin = new Map<string, { v: string; etag: string }>();
const edge = new Map<string, { v: string; etag: string } | null>();
let listed = new Set<string>();
let etags = 0;

function read(k: string) {
  if (edge.has(k)) return edge.get(k) ?? null;
  const b = origin.get(k) ?? null;
  if (b !== null) edge.set(k, b);
  return b;
}

function settle() {
  edge.clear();
  listed = new Set(origin.keys());
}

const store = {
  async get(k: string, o?: { type?: string }) {
    const b = read(k);
    if (b === null) return null;
    return o?.type === 'json' ? JSON.parse(b.v) : b.v;
  },
  async getWithMetadata(k: string, o?: { type?: string }) {
    const b = read(k);
    if (b === null) return null;
    return { data: o?.type === 'json' ? JSON.parse(b.v) : b.v, etag: b.etag };
  },
  async setJSON(k: string, v: unknown, o: { onlyIfMatch?: string; onlyIfNew?: boolean } = {}) {
    const b = origin.get(k);
    if (o.onlyIfNew === true && b !== undefined) return { modified: false };
    if (o.onlyIfMatch !== undefined && b?.etag !== o.onlyIfMatch) return { modified: false };
    origin.set(k, { v: JSON.stringify(v), etag: `e${++etags}` });
    return { modified: true };
  },
  async delete(k: string) {
    origin.delete(k);
  },
  async list(o: { prefix?: string } = {}) {
    const p = o.prefix ?? '';
    const blobs = Array.from(listed)
      .filter(k => k.startsWith(p) && origin.has(k))
      .map(key => ({ key, etag: origin.get(key)!.etag }));
    return { blobs, directories: [] };
  },
};
vi.mock('@netlify/blobs', () => ({ connectLambda: () => undefined, getStore: () => store }));

const { handler, LIB_PUBLISH_PER_WINDOW, LIB_PER_RIDER, LIB_WINDOW_MS } = await import(
  '../functions/world-fm-library'
);

const KEY_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const KEY_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const yt = (n: number, dur = 200): FmTrack => ({
  src: { kind: 'youtube', id: `vid${String(n).padStart(8, '0')}` },
  title: `Track ${n}`,
  artist: 'Artist',
  dur,
});

async function call(method: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await handler({
    httpMethod: method,
    body: body === undefined ? null : JSON.stringify(body),
    headers,
  });
  return { status: res.statusCode, out: JSON.parse(res.body) as Record<string, unknown> };
}

const publish = (key: string, name: string, tracks: FmTrack[], dj = 'DJ pip', h = {}) =>
  call('POST', { t: 'publish', key, dj, name, tracks }, h);

async function library() {
  const r = await call('GET');
  return r.out as {
    sets: { id: string; name: string; dj: string; plays: number; by: string; tracks: FmTrack[] }[];
    total: number;
  };
}

beforeEach(() => {
  origin.clear();
  edge.clear();
  listed.clear();
  etags = 0;
  vi.useRealTimers();
});

describe('world-fm-library', () => {
  it('publishes a set anyone can read back, stored under the public tag only', async () => {
    const r = await publish(KEY_A, 'Sunset session', [yt(1), yt(2)]);
    expect(r.status).toBe(200);
    expect(r.out.dup).toBe(false);
    settle();
    const lib = await library();
    expect(lib.total).toBe(1);
    expect(lib.sets[0]).toMatchObject({ name: 'Sunset session', dj: 'DJ pip', plays: 0 });
    expect(lib.sets[0]!.by).toBe(ownerTag(KEY_A));
    expect(JSON.stringify([...origin.values()])).not.toContain(KEY_A);
  });

  it('keeps every set published in a burst (no shared read-modify-write)', async () => {
    const res = await Promise.all(
      [1, 2, 3, 4, 5, 6].map(n => publish(n % 2 ? KEY_A : KEY_B, `set ${n}`, [yt(n)])),
    );
    expect(res.every(r => r.status === 200)).toBe(true);
    settle();
    expect((await library()).total).toBe(6);
  });

  it('a set shows up before the listing catches up (fresh cache entry)', async () => {
    await publish(KEY_A, 'one', [yt(1)]);
    settle();
    await library(); // warms the edge copy of the cache
    await publish(KEY_B, 'two', [yt(2)]);
    // listing is stale and the edge cache copy is stale too, but a new read after settle has both
    settle();
    expect((await library()).sets.map(s => s.name).sort()).toEqual(['one', 'two']);
  });

  it('dedupes an identical set and bumps it to the top', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 1, 10) });
    await publish(KEY_A, 'first', [yt(1)]);
    vi.setSystemTime(Date.UTC(2026, 9, 1, 12));
    await publish(KEY_A, 'second', [yt(2)]);
    vi.setSystemTime(Date.UTC(2026, 9, 1, 15));
    const again = await publish(KEY_B, 'FIRST', [yt(1)]);
    expect(again.out.dup).toBe(true);
    settle();
    const lib = await library();
    expect(lib.total).toBe(2);
    expect(lib.sets.map(s => s.name)).toEqual(['first', 'second']);
  });

  it('refuses tracks the station would refuse', async () => {
    const bad = [
      [{ ...yt(1), src: { kind: 'direct', url: 'https://y2mate.com/x.mp3' } }],
      [{ ...yt(1), src: { kind: 'direct', url: 'http://example.com/x.mp3' } }],
      [{ ...yt(1), src: { kind: 'youtube', id: 'short' } }],
      [{ ...yt(1), dur: 601 }],
      [{ ...yt(1), dur: 2 }],
      Array.from({ length: 21 }, (_, i) => yt(i)),
      Array.from({ length: 13 }, (_, i) => yt(i, 590)), // past 2 hours
      [],
    ];
    for (const tracks of bad)
      expect((await publish(KEY_A, 'bad', tracks as FmTrack[])).status).toBe(400);
    expect(
      (await call('POST', { t: 'publish', key: 'short', dj: 'x', name: 'y', tracks: [yt(1)] }))
        .status,
    ).toBe(400);
    const huge = { t: 'publish', key: KEY_A, name: 'x'.repeat(30_000), tracks: [yt(1)] };
    expect((await call('POST', huge)).status).toBe(413);
    // Audius + direct files are fine
    const ok = await publish(KEY_A, 'mix', [
      {
        src: { kind: 'audius', id: 'abc12', url: 'https://audius.co/pip/tune' },
        title: 'a',
        artist: 'b',
        dur: 100,
      },
      {
        src: { kind: 'direct', url: 'https://cdn.example.com/a.mp3' },
        title: 'c',
        artist: 'd',
        dur: 100,
      },
    ]);
    expect(ok.status).toBe(200);
  });

  it('cleans names', async () => {
    await publish(KEY_A, '<script>alert(1)</script> set', [yt(1)], '<b>DJ</b>');
    settle();
    const s = (await library()).sets[0]!;
    expect(s.name).not.toMatch(/[<>]/);
    expect(s.dj).not.toMatch(/[<>]/);
  });

  it('rate-limits publishing per rider', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 1) });
    for (let i = 0; i < LIB_PUBLISH_PER_WINDOW; i++)
      expect((await publish(KEY_A, `s${i}`, [yt(i)])).status).toBe(200);
    expect((await publish(KEY_A, 'one more', [yt(99)])).status).toBe(429);
    expect((await publish(KEY_B, 'other rider', [yt(98)])).status).toBe(200);
    vi.setSystemTime(Date.now() + LIB_WINDOW_MS);
    expect((await publish(KEY_A, 'one more', [yt(99)])).status).toBe(200);
  });

  it('caps the sets one rider keeps in the library', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 1) });
    for (let i = 0; i < LIB_PER_RIDER; i++) {
      if (i % LIB_PUBLISH_PER_WINDOW === 0) vi.setSystemTime(Date.now() + LIB_WINDOW_MS);
      expect((await publish(KEY_A, `s${i}`, [yt(i)])).status).toBe(200);
      settle();
    }
    vi.setSystemTime(Date.now() + LIB_WINDOW_MS);
    const r = await publish(KEY_A, 'too many', [yt(500)]);
    expect(r.status).toBe(400);
    expect(String(r.out.error)).toContain('delete one');
  });

  it('counts plays once per rider per hour', async () => {
    const { out } = await publish(KEY_A, 'played', [yt(1)]);
    const id = String(out.id);
    for (const k of [KEY_B, KEY_B, KEY_A])
      expect((await call('POST', { t: 'played', id, key: k })).status).toBe(200);
    expect((await call('POST', { t: 'played', id: '0123456789abcdef', key: KEY_B })).status).toBe(
      404,
    );
    settle();
    expect((await library()).sets[0]!.plays).toBe(2);
  });

  it('lets only the publisher (or an admin) delete a set', async () => {
    const { out } = await publish(KEY_A, 'mine', [yt(1)]);
    const id = String(out.id);
    expect((await call('POST', { t: 'delete', id, key: KEY_B })).status).toBe(403);
    expect((await call('POST', { t: 'delete', id, key: KEY_A })).status).toBe(200);
    settle();
    expect((await library()).total).toBe(0);

    const two = String((await publish(KEY_A, 'again', [yt(2)])).out.id);
    process.env.WORLD_ADMIN_TOKEN = 'admin-token-1234567890';
    expect(
      (await call('DELETE', { id: two }, { 'x-world-admin': 'wrong-token-xxxxxxxx' })).status,
    ).toBe(401);
    expect(
      (await call('DELETE', { id: two }, { 'x-world-admin': 'admin-token-1234567890' })).status,
    ).toBe(200);
    delete process.env.WORLD_ADMIN_TOKEN;
    settle();
    expect((await library()).total).toBe(0);
  });

  it('a deleted set stays gone even where a stale cache still has it', async () => {
    const { out } = await publish(KEY_A, 'gone', [yt(1)]);
    await publish(KEY_A, 'stays', [yt(2)]);
    settle();
    await library(); // edge now holds the cache with both
    await call('POST', { t: 'delete', id: String(out.id), key: KEY_A });
    settle();
    expect((await library()).sets.map(s => s.name)).toEqual(['stays']);
  });

  it('pages the library', async () => {
    for (let i = 0; i < 5; i++) await publish(i % 2 ? KEY_A : KEY_B, `p${i}`, [yt(i)]);
    settle();
    const res = await handler({
      httpMethod: 'GET',
      body: null,
      queryStringParameters: { offset: '2', limit: '2' },
    });
    const page = JSON.parse(res.body) as { sets: unknown[]; total: number };
    expect(page.total).toBe(5);
    expect(page.sets.length).toBe(2);
  });
});
