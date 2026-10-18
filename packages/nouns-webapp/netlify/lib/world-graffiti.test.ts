import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeStrokes, type Stroke } from '../../src/miniapps/world2/graffiti/strokes';

// ── An in-memory Netlify Blobs store with eventual consistency ──
//
// Like the real thing: a blob that's been read is served from the edge
// cache until the cache settles (up to 60 s), so a read right after someone
// else's write sees the old copy and its old etag. Writes and their
// onlyIfMatch / onlyIfNew conditions are checked at the origin. A key that
// was never read comes straight from the origin (new blobs are visible at
// once), and a listing shows what the origin had when it last settled.
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

/** A minute later: every edge copy is fresh again. */
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

const { handler } = await import('../functions/world-graffiti');

const WALL = 'plaza|0.00,0.00,-1.00|-38.75|-3|0';
const OTHER = 'plaza|1.00,0.00,0.00|0.60|0|0';

/** A one-stroke `g3:` tag; `k` makes each one different. */
function tag(k: number) {
  const s: Stroke = {
    color: 0x112233 + k,
    r: 40,
    hard: false,
    opacity: 16,
    pts: [100 + k * 10, 200, 900, 1200 + k],
  };
  return encodeStrokes({ id: (0x100000000000 + k).toString(16).slice(-12), strokes: [s] });
}

async function post(wallId: string, data: string) {
  const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ wallId, data }) });
  return { status: res.statusCode, out: JSON.parse(res.body) };
}

async function walls(ids: string[]) {
  const res = await handler({
    httpMethod: 'GET',
    body: null,
    queryStringParameters: { level: 'plaza', ids: JSON.stringify(ids) },
  });
  return (JSON.parse(res.body) as { walls: Record<string, string[]> }).walls;
}

async function index() {
  const res = await handler({
    httpMethod: 'GET',
    body: null,
    queryStringParameters: { level: 'plaza' },
  });
  return (JSON.parse(res.body) as { walls: string[] }).walls;
}

beforeEach(() => {
  origin.clear();
  edge.clear();
  listed.clear();
  etags = 0;
});

describe('world-graffiti store', () => {
  it('keeps every layer a painter sends to one wall in quick succession', async () => {
    // One piece, sent as a tag per burst a second or so apart: well inside
    // the edge cache's window, so every write after the second reads stale
    const sent = [0, 1, 2, 3, 4, 5].map(tag);
    for (const d of sent) expect((await post(WALL, d)).status).toBe(200);

    // A visitor arriving a minute later gets all six layers, oldest first
    settle();
    expect((await walls([WALL]))[WALL]).toEqual(sent);
  });

  it('keeps layers carried over from PartyKit in one burst', async () => {
    // A client carrying old PartyKit tags into the store posts them at once
    const sent = [10, 11, 12, 13, 14, 15, 16, 17].map(tag);
    const res = await Promise.all(sent.map(d => post(WALL, d)));
    expect(res.every(r => r.status === 200)).toBe(true);
    settle();
    expect(new Set((await walls([WALL]))[WALL])).toEqual(new Set(sent));
  });

  it('lists every painted wall, even ones first painted moments apart', async () => {
    const ids = [WALL, OTHER, 'plaza|0.00,1.00,0.00|0.00|2|-11'];
    for (const [i, id] of ids.entries()) await post(id, tag(i));
    settle();
    expect(new Set(await index())).toEqual(new Set(ids));
  });

  it('ignores a retried tag and refuses bad ones', async () => {
    const d = tag(1);
    await post(WALL, d);
    await post(WALL, d);
    expect((await post(WALL, 'g3:nope')).status).toBe(400);
    expect((await post('plaza|nope', d)).status).toBe(400);
    settle();
    expect((await walls([WALL]))[WALL]).toEqual([d]);
  });

  it('sheds the oldest layers past the wall budget, blobs and all', async () => {
    // ~5.6k-char tags: 80 of them run past the 400 KB a wall keeps
    const big = (k: number) => {
      const strokes: Stroke[] = [0, 1, 2].map(j => {
        const pts: number[] = [];
        for (let i = 0; i < 400; i++)
          pts.push(500 + (i % 2) * 200 + j, 500 + ((i >> 1) % 2) * 200 + k);
        return { color: k * 3 + j, r: 40, hard: false, opacity: 16, pts };
      });
      return encodeStrokes({ id: (0x100000000000 + k).toString(16).slice(-12), strokes });
    };
    const sent = Array.from({ length: 80 }, (_, k) => big(k));
    expect(sent[0].length).toBeGreaterThan(5000);
    for (const d of sent) expect((await post(WALL, d)).status).toBe(200);
    settle();
    const got = (await walls([WALL]))[WALL];
    expect(got.length).toBeLessThan(80);
    expect(got.join('').length).toBeLessThanOrEqual(400_000);
    expect(got).toEqual(sent.slice(80 - got.length));
    // The shed tags' own blobs went with them
    const tagBlobs = Array.from(origin.keys()).filter(k => k.startsWith('t/'));
    expect(tagBlobs.length).toBe(got.length);
    settle();
    expect((await walls([WALL]))[WALL]).toEqual(got);
  });

  it('still serves walls saved in the old one-blob format', async () => {
    origin.set(`wall/${encodeURIComponent(OTHER)}`, {
      v: JSON.stringify({ wallId: OTHER, tags: [{ d: tag(7), at: 1 }] }),
      etag: 'old',
    });
    origin.set('index/plaza', { v: JSON.stringify([OTHER]), etag: 'oldidx' });
    settle();
    await post(OTHER, tag(8));
    settle();
    expect((await walls([OTHER]))[OTHER]).toEqual([tag(7), tag(8)]);
    expect(await index()).toEqual([OTHER]);
  });
});
