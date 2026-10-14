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
// One blob per wall plus one index per level. A wall keeps every tag until
// it holds ~400 KB of paint (or 1500 tags), then sheds its oldest (long
// since painted over).

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

interface Wall {
  wallId: string;
  tags: { d: string; at: number }[];
}

const LEVELS = new Set(['plaza', 'park']);
const MAX_TAGS = 1500;
const MAX_WALL = 400_000;
const MAX_WALLS = 20_000;
const MAX_IDS = 40;
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

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return json(204, {});
  connectLambda({ blobs: event.blobs ?? '', headers: event.headers ?? {} });
  const store = getStore('noun-world-graffiti');

  if (method === 'GET') {
    const q = event.queryStringParameters ?? {};
    const level = q.level ?? '';
    if (!LEVELS.has(level)) return json(400, { error: 'Unknown level' });
    if (q.ids === undefined) {
      const walls = ((await store.get(indexKey(level), { type: 'json' })) as string[] | null) ?? [];
      return json(200, { walls });
    }
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
        const w = (await store.get(wallKey(id), { type: 'json' })) as Wall | null;
        if (w !== null) walls[id] = w.tags.map(t => t.d);
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
  const level = wallId.split('|')[0];

  let created = false;
  let saved = false;
  for (let attempt = 0; attempt < 6 && !saved; attempt++) {
    const cur = await store.getWithMetadata(wallKey(wallId), { type: 'json' });
    const wall: Wall = (cur?.data as Wall | null) ?? { wallId, tags: [] };
    // Same tag twice (a retry, or an old PartyKit tag carried over): no-op
    if (wall.tags.some(t => t.d === data)) return json(200, { ok: true });
    wall.tags.push({ d: data, at: Date.now() });
    let size = wall.tags.reduce((n, t) => n + t.d.length, 0);
    while ((size > MAX_WALL || wall.tags.length > MAX_TAGS) && wall.tags.length > 1)
      size -= wall.tags.shift()!.d.length;
    const res =
      typeof cur?.etag === 'string'
        ? await store.setJSON(wallKey(wallId), wall, { onlyIfMatch: cur.etag })
        : await store.setJSON(wallKey(wallId), wall, { onlyIfNew: true });
    saved = res.modified;
    created = saved && cur === null;
  }
  if (!saved) return json(409, { error: 'Busy, try again' });

  // First paint on this wall: add it to the level's index
  if (created) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const cur = await store.getWithMetadata(indexKey(level), { type: 'json' });
      const walls = ((cur?.data as string[] | null) ?? []).slice();
      if (walls.includes(wallId)) break;
      walls.push(wallId);
      if (walls.length > MAX_WALLS) walls.splice(0, walls.length - MAX_WALLS);
      const res =
        typeof cur?.etag === 'string'
          ? await store.setJSON(indexKey(level), walls, { onlyIfMatch: cur.etag })
          : await store.setJSON(indexKey(level), walls, { onlyIfNew: true });
      if (res.modified) break;
    }
  }
  return json(200, { ok: true });
}
