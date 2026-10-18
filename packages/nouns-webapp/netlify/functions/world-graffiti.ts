import { createHash } from 'node:crypto';

import { connectLambda, getStore } from '@netlify/blobs';

import { MAX_TAG_CHARS, validTag } from '../../src/miniapps/world2/graffiti/strokes';

// Noun World graffiti that stays up. PartyKit still carries tags live
// between players, but its room storage forgets old tags (last 20 per wall)
// and only a few walls fit its index, so every tag is also written here.
//
// GET  ?level=plaza            → { walls: string[] }   walls with paint
// GET  ?level=plaza&ids=[...]  → { walls: { [wallId]: string[] } }
//                                 tags per wall, oldest first (≤ 40 ids)
// POST { wallId, data }        → append one tag: `g3:` strokes, a `g3r:`
//                                 undo, or a legacy `g2:` dab tag
//
// Tags are decoded with the game's own codec (graffiti/strokes.ts) before
// they're kept: colour bytes, nozzle size range, point and stroke caps, and
// coordinates within the wall cell are all checked there.
//
// Storage: every tag is its own blob, `t/<wall>/<hash>` = { d, at }, written
// once and never rewritten. That write can't lose a race, which matters:
// Netlify Blobs reads are eventually consistent (an edge copy can be up to a
// minute old), so a read-modify-write of one shared blob reads a stale etag
// whenever two writes land within that minute, and every retry reads the same
// stale copy. The old one-blob-per-wall store lost all but the first tag or
// two of every burst that way, and visitors only saw the missing layers once
// someone sprayed there and PartyKit rebroadcast the wall.
//
// `wall/<wall>` is still kept as a cache of a wall's tags (one fetch to read
// it) and is where tags saved before this layout live. It's updated best
// effort; a read lists the wall's tag blobs and folds in any the cache is
// missing. A wall keeps every tag until it holds ~400 KB of paint (or 1500
// tags), then sheds its oldest (long since painted over).

interface HandlerEvent {
  body: string | null;
  blobs?: string;
  headers?: Record<string, string>;
  httpMethod: string;
  queryStringParameters?: Record<string, string | undefined> | null;
}

interface HandlerResponse {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
}

interface Tag {
  d: string;
  at: number;
}

interface Wall {
  wallId: string;
  tags: Tag[];
}

type Store = ReturnType<typeof getStore>;

const LEVELS = new Set(['plaza', 'park']);
const MAX_TAGS = 1500;
const MAX_WALL = 400_000;
const MAX_IDS = 40;
/** Tag blobs fetched per wall per read (the rest come on the next read). */
const MAX_FETCH = 400;
// level|nx,ny,nz|d|cu|cv
const WALL_RE = /^(plaza|park)\|(?:-?\d+\.\d{2},){2}(?:-?\d+\.\d{2}\|){2}-?\d+\|-?\d+$/;

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};
const json = (status: number, body: unknown): HandlerResponse => ({
  statusCode: status,
  headers,
  body: JSON.stringify(body),
});

const wallKey = (wallId: string) => `wall/${encodeURIComponent(wallId)}`;
const indexKey = (level: string) => `index/${level}`;
const tagDir = (wallId: string) => `t/${encodeURIComponent(wallId)}/`;
const tagHash = (d: string) => createHash('sha256').update(d).digest('hex').slice(0, 24);
const tagKey = (wallId: string, d: string) => tagDir(wallId) + tagHash(d);

const isTag = (x: unknown): x is Tag =>
  typeof x === 'object' &&
  x !== null &&
  typeof (x as Tag).d === 'string' &&
  typeof (x as Tag).at === 'number';

/** Over budget: the oldest tags go. */
function trim(tags: Tag[]): { keep: Tag[]; gone: Tag[] } {
  const keep = tags.slice();
  const gone: Tag[] = [];
  let size = keep.reduce((n, t) => n + t.d.length, 0);
  while ((size > MAX_WALL || keep.length > MAX_TAGS) && keep.length > 1) {
    const t = keep.shift()!;
    size -= t.d.length;
    gone.push(t);
  }
  return { keep, gone };
}

/** Write a wall's cached copy if nobody changed it since `etag`. */
async function saveCache(store: Store, wallId: string, tags: Tag[], etag: string | undefined) {
  const wall: Wall = { wallId, tags };
  const res =
    typeof etag === 'string'
      ? await store.setJSON(wallKey(wallId), wall, { onlyIfMatch: etag })
      : await store.setJSON(wallKey(wallId), wall, { onlyIfNew: true });
  return res.modified;
}

async function dropTags(store: Store, wallId: string, gone: Tag[]) {
  await Promise.all(gone.map(t => store.delete(tagKey(wallId, t.d)).catch(() => undefined)));
}

/** A wall's tags, oldest first: its cached copy plus any tag blob it's missing. */
async function readWall(store: Store, wallId: string): Promise<Tag[]> {
  const prefix = tagDir(wallId);
  const [cur, listing] = await Promise.all([
    store.getWithMetadata(wallKey(wallId), { type: 'json' }),
    store.list({ prefix }),
  ]);
  const cached = ((cur?.data as Wall | null)?.tags ?? []).filter(isTag);
  const have = new Set(cached.map(t => tagHash(t.d)));
  const missing = listing.blobs
    .map(b => b.key)
    .filter(k => !have.has(k.slice(prefix.length)))
    .slice(0, MAX_FETCH);
  if (missing.length === 0) return cached;
  const got = await Promise.all(
    missing.map(k => store.get(k, { type: 'json' }) as Promise<unknown>),
  );
  const tags = cached.slice();
  for (const t of got) {
    if (!isTag(t) || have.has(tagHash(t.d))) continue;
    have.add(tagHash(t.d));
    tags.push({ d: t.d, at: t.at });
  }
  tags.sort((a, b) => a.at - b.at);
  const { keep, gone } = trim(tags);
  // Fold them into the cache so the next read is one fetch. A stale etag
  // just means a later read does this again.
  try {
    if (await saveCache(store, wallId, keep, cur?.etag)) await dropTags(store, wallId, gone);
  } catch {
    // the tags are safe in their own blobs either way
  }
  return keep;
}

/** Every wall with paint on a level: tag blobs, cached walls, the old index. */
async function readIndex(store: Store, level: string): Promise<string[]> {
  const pre = encodeURIComponent(`${level}|`);
  const [old, tagList, wallList] = await Promise.all([
    store.get(indexKey(level), { type: 'json' }) as Promise<string[] | null>,
    store.list({ prefix: `t/${pre}` }),
    store.list({ prefix: `wall/${pre}` }),
  ]);
  const walls = new Set<string>(Array.isArray(old) ? old : []);
  const add = (enc: string) => {
    try {
      walls.add(decodeURIComponent(enc));
    } catch {
      // not ours
    }
  };
  for (const { key } of tagList.blobs) add(key.slice(2, key.indexOf('/', 2)));
  for (const { key } of wallList.blobs) add(key.slice(5));
  return [...walls].filter(id => WALL_RE.test(id));
}

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return json(204, {});
  connectLambda({ blobs: event.blobs ?? '', headers: event.headers ?? {} });
  const store = getStore('noun-world-graffiti');

  if (method === 'GET') {
    const q = event.queryStringParameters ?? {};
    const level = q.level ?? '';
    if (!LEVELS.has(level)) return json(400, { error: 'Unknown level' });
    if (q.ids === undefined) return json(200, { walls: await readIndex(store, level) });
    let ids: unknown;
    try {
      ids = JSON.parse(q.ids);
    } catch {
      return json(400, { error: 'Bad ids' });
    }
    if (!Array.isArray(ids)) return json(400, { error: 'Bad ids' });
    const want = ids
      .filter((id): id is string => typeof id === 'string' && WALL_RE.test(id))
      .filter(id => id.startsWith(`${level}|`))
      .slice(0, MAX_IDS);
    const walls: Record<string, string[]> = {};
    await Promise.all(
      want.map(async id => {
        const tags = await readWall(store, id);
        if (tags.length > 0) walls[id] = tags.map(t => t.d);
      }),
    );
    return json(200, { walls });
  }
  if (method !== 'POST') return json(405, { error: 'Method not allowed' });

  let input: Record<string, unknown>;
  try {
    input = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Bad JSON' });
  }
  const wallId = String(input.wallId ?? '');
  const data = String(input.data ?? '');
  if (!WALL_RE.test(wallId)) return json(400, { error: 'Bad wall' });
  if (data.length > MAX_TAG_CHARS || !validTag(data)) return json(400, { error: 'Bad tag' });

  // The tag's own blob is what keeps it. Same tag twice (a retry, or an old
  // PartyKit tag carried over again) finds it there and is a no-op.
  const tag: Tag = { d: data, at: Date.now() };
  const res = await store.setJSON(tagKey(wallId, data), tag, { onlyIfNew: true });
  if (!res.modified) return json(200, { ok: true });

  // Best effort: fold it into the wall's cached copy too
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = await store.getWithMetadata(wallKey(wallId), { type: 'json' });
      const tags = ((cur?.data as Wall | null)?.tags ?? []).filter(isTag);
      if (tags.some(t => t.d === data)) break;
      const { keep, gone } = trim([...tags, tag]);
      if (await saveCache(store, wallId, keep, cur?.etag)) {
        await dropTags(store, wallId, gone);
        break;
      }
    }
  } catch {
    // a later read folds it in
  }
  return json(200, { ok: true });
}
