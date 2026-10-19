import { createHash } from 'node:crypto';

import { connectLambda, getStore } from '@netlify/blobs';

import {
  cleanName,
  FM_SET_MAX_MS,
  FM_SET_MAX_TRACKS,
  ownerTag,
  setLength,
  validTrack,
  type FmTrack,
} from '../../../nouns-party/src/fmStation';
import { libSetKey, type LibSet } from '../../src/miniapps/world2/radio/library';
import { adminCheck } from '../lib/appeals';

// NOUN FM's shared set library: every DJ set a rider shares, browsable and
// playable by anyone in Noun World. The station itself (today's bookings)
// stays on the PartyKit relay; this only keeps the sets.
//
// GET  ?offset=0&limit=200        → { sets: LibSet[], total }
//                                   newest activity first (published,
//                                   re-published or played)
// POST { t: 'publish', key, dj, name, tracks }
//                                 → { ok, id, dup }  `key` is the rider's
//                                   private NOUN FM key; only its public tag
//                                   (ownerTag) is stored. An identical set
//                                   (same DJ, name and track list) isn't
//                                   stored twice: it's bumped to the top.
// POST { t: 'played', id, key }   → { ok }  counts a play (once per rider
//                                   per set per hour)
// POST { t: 'delete', id, key }   → { ok }  its publisher, or anyone with
//      (or DELETE ?id=…)                    X-World-Admin: WORLD_ADMIN_TOKEN
//
// Tracks are checked with the station's own rules (fmStation.ts validTrack:
// YouTube ids / Audius permalinks / https audio files only, no rippers,
// 5 s..10 min a track), at most FM_SET_MAX_TRACKS tracks and 2 hours.
//
// Storage (Netlify Blobs reads are eventually consistent, so nothing here is
// a read-modify-write that has to win):
//   set/<id>                  the set, written once (id = hash of DJ, name,
//                             track sources), never rewritten
//   e/<id>/<p|u>.<tag>.<hr>   a play / re-publish marker; plays and "last
//                             active" are counted from a listing
//   x/<id>                    tombstone of a deleted set (hides stale copies)
//   rl/<who>/<win>/<n>        rate-limit slots (rider, IP) per 10 minutes
//   index                     cache of every set (one fetch per read), kept
//                             best effort; a read lists set/ and folds in
//                             whatever the cache is missing

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

/** A set as stored (its activity lives in the e/ markers). */
interface Doc {
  id: string;
  dj: string;
  name: string;
  tracks: FmTrack[];
  /** Publisher's public tag. */
  by: string;
  at: number;
}

type Store = ReturnType<typeof getStore>;

export const LIB_MAX_BODY = 24_000;
/** Sets kept in all; past this the least recently active go. */
export const LIB_MAX_SETS = 400;
export const LIB_PAGE_MAX = 200;
export const LIB_PER_RIDER = 40;
/** Rate limits are per window (slots claimed in the store). */
export const LIB_WINDOW_MS = 10 * 60_000;
export const LIB_PUBLISH_PER_WINDOW = 6;
export const LIB_PUBLISH_PER_IP_WINDOW = 12;
export const LIB_PLAYS_PER_WINDOW = 10;
/** Set blobs fetched per read when the cache is missing them. */
const MAX_FETCH = 100;
/** A fresh set may not show in a listing yet: keep cached ones this young. */
const FRESH_MS = 120_000;
const KEY_RE = /^[\w-]{16,64}$/;
const ID_RE = /^[\da-f]{16}$/;
const HOUR = 3600_000;

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-World-Admin',
  'Cache-Control': 'no-store',
};
const json = (status: number, body: unknown): HandlerResponse => ({
  statusCode: status,
  headers,
  body: JSON.stringify(body),
});

const setKey = (id: string) => `set/${id}`;
const tombKey = (id: string) => `x/${id}`;
const hourOf = (t: number) => Math.floor(t / HOUR);
const markKey = (id: string, k: 'p' | 'u', tag: string, t: number) =>
  `e/${id}/${k}.${tag}.${hourOf(t).toString(36)}`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function libSetId(dj: string, name: string, tracks: FmTrack[]): string {
  return sha(libSetKey(dj, name, tracks)).slice(0, 16);
}

/** A publish as it arrives: cleaned and checked, or why not. */
export function validPublish(
  input: Record<string, unknown>,
): { ok: true; dj: string; name: string; tracks: FmTrack[] } | { ok: false; error: string } {
  const raw = Array.isArray(input.tracks) ? input.tracks : [];
  if (raw.length === 0) return { ok: false, error: 'a set needs at least one track' };
  if (raw.length > FM_SET_MAX_TRACKS)
    return { ok: false, error: `sets are capped at ${FM_SET_MAX_TRACKS} tracks` };
  const tracks: FmTrack[] = [];
  for (const r of raw) {
    const t = validTrack(r);
    if (typeof t === 'string') return { ok: false, error: t };
    tracks.push(t);
  }
  if (setLength(tracks) > FM_SET_MAX_MS)
    return { ok: false, error: `sets are capped at ${FM_SET_MAX_MS / HOUR} hours` };
  return {
    ok: true,
    dj: cleanName(input.dj, 20, 'DJ NOUN'),
    name: cleanName(input.name, 32, 'untitled set'),
    tracks,
  };
}

function validDoc(v: unknown): Doc | null {
  if (typeof v !== 'object' || v === null) return null;
  const d = v as Record<string, unknown>;
  if (typeof d.id !== 'string' || !ID_RE.test(d.id)) return null;
  if (typeof d.by !== 'string' || typeof d.at !== 'number') return null;
  const p = validPublish(d);
  if (!p.ok) return null;
  return { id: d.id, dj: p.dj, name: p.name, tracks: p.tracks, by: d.by, at: d.at };
}

/**
 * Rate limit: `max` actions per LIB_WINDOW_MS. Each action claims a slot
 * blob with onlyIfNew, which the origin checks (a counter blob would be read
 * stale from the edge and never fill up). False when every slot is taken.
 */
async function rateOk(store: Store, who: string, max: number, now: number): Promise<boolean> {
  const w = Math.floor(now / LIB_WINDOW_MS).toString(36);
  try {
    for (let n = 0; n < max; n++) {
      const r = await store.setJSON(`rl/${who}/${w}/${n}`, { at: now }, { onlyIfNew: true });
      if (r.modified) return true;
    }
    return false;
  } catch {
    return true; // a broken limiter never blocks a rider
  }
}

function clientIp(h: Record<string, string> | undefined): string | null {
  const x = h ?? {};
  const ip =
    x['x-nf-client-connection-ip'] ?? x['client-ip'] ?? x['x-forwarded-for']?.split(',')[0] ?? '';
  return ip.trim() === '' ? null : sha(`fm-lib:${ip.trim()}`).slice(0, 16);
}

interface Library {
  docs: Doc[];
  plays: Map<string, number>;
  last: Map<string, number>;
}

/** Every set: the cache plus any set blob it's missing, minus deleted ones. */
async function readLibrary(store: Store, now: number): Promise<Library> {
  const [cur, setList, evList, tombList] = await Promise.all([
    store.getWithMetadata('index', { type: 'json' }),
    store.list({ prefix: 'set/' }),
    store.list({ prefix: 'e/' }),
    store.list({ prefix: 'x/' }),
  ]);
  const gone = new Set(tombList.blobs.map(b => b.key.slice(2)));
  const listed = new Set(setList.blobs.map(b => b.key.slice(4)).filter(id => ID_RE.test(id)));
  const raw = (cur?.data as { sets?: unknown[] } | null)?.sets;
  const cached = (Array.isArray(raw) ? raw : []).map(validDoc).filter((d): d is Doc => d !== null);
  const have = new Set(cached.map(d => d.id));
  const missing = [...listed].filter(id => !have.has(id) && !gone.has(id)).slice(0, MAX_FETCH);
  const got = await Promise.all(
    missing.map(id => store.get(setKey(id), { type: 'json' }) as Promise<unknown>),
  );
  let changed = false;
  const docs: Doc[] = [];
  for (const d of cached) {
    // Dropped: deleted, or long gone from the listing (pruned / deleted)
    if (gone.has(d.id) || (!listed.has(d.id) && now - d.at > FRESH_MS)) {
      changed = true;
      continue;
    }
    docs.push(d);
  }
  for (const v of got) {
    const d = validDoc(v);
    if (d === null || have.has(d.id) || gone.has(d.id)) continue;
    have.add(d.id);
    docs.push(d);
    changed = true;
  }
  const plays = new Map<string, number>();
  const last = new Map<string, number>();
  for (const { key } of evList.blobs) {
    const [, id, mark] = key.split('/');
    if (id === undefined || mark === undefined) continue;
    const [k, , h] = mark.split('.');
    const t = parseInt(h ?? '', 36) * HOUR;
    if (k === 'p') plays.set(id, (plays.get(id) ?? 0) + 1);
    if (Number.isFinite(t)) last.set(id, Math.max(last.get(id) ?? 0, t));
  }
  if (changed) {
    try {
      const sets = docs.slice(0, LIB_MAX_SETS + 50);
      if (typeof cur?.etag === 'string')
        await store.setJSON('index', { sets }, { onlyIfMatch: cur.etag });
      else await store.setJSON('index', { sets }, { onlyIfNew: true });
    } catch {
      // the next read folds them in again
    }
  }
  return { docs, plays, last };
}

const lastActive = (lib: Library, d: Doc) => Math.max(d.at, lib.last.get(d.id) ?? 0);

function sorted(lib: Library): Doc[] {
  return lib.docs.slice().sort((a, b) => lastActive(lib, b) - lastActive(lib, a) || b.at - a.at);
}

function toWire(lib: Library, d: Doc): LibSet {
  return {
    id: d.id,
    dj: d.dj,
    name: d.name,
    tracks: d.tracks,
    by: d.by,
    at: d.at,
    lastAt: lastActive(lib, d),
    plays: lib.plays.get(d.id) ?? 0,
  };
}

/** Best effort: add or drop one set in the cache. */
async function patchCache(store: Store, fn: (sets: unknown[]) => unknown[]) {
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = await store.getWithMetadata('index', { type: 'json' });
      const raw = (cur?.data as { sets?: unknown[] } | null)?.sets;
      const sets = fn(Array.isArray(raw) ? raw : []);
      const res =
        typeof cur?.etag === 'string'
          ? await store.setJSON('index', { sets }, { onlyIfMatch: cur.etag })
          : await store.setJSON('index', { sets }, { onlyIfNew: true });
      if (res.modified) return;
    }
  } catch {
    // a later read folds it in
  }
}

async function removeSet(store: Store, id: string, tomb = true) {
  if (tomb) await store.setJSON(tombKey(id), { at: Date.now() });
  await store.delete(setKey(id));
  const ev = await store.list({ prefix: `e/${id}/` }).catch(() => ({ blobs: [] }));
  await Promise.all(ev.blobs.map(b => store.delete(b.key).catch(() => undefined)));
  await patchCache(store, sets => sets.filter(s => (s as { id?: string } | null)?.id !== id));
}

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return json(204, {});
  connectLambda({ blobs: event.blobs ?? '', headers: event.headers ?? {} });
  const store = getStore('noun-fm-library');
  const now = Date.now();

  if (method === 'GET') {
    const q = event.queryStringParameters ?? {};
    const offset = Math.max(0, Math.floor(Number(q.offset) || 0));
    const limit = Math.min(LIB_PAGE_MAX, Math.max(1, Math.floor(Number(q.limit) || LIB_PAGE_MAX)));
    const lib = await readLibrary(store, now);
    const all = sorted(lib);
    return json(200, {
      sets: all.slice(offset, offset + limit).map(d => toWire(lib, d)),
      total: all.length,
    });
  }
  if (method !== 'POST' && method !== 'DELETE') return json(405, { error: 'Method not allowed' });

  const body = event.body ?? '';
  if (body.length > LIB_MAX_BODY) return json(413, { error: 'that set is too big' });
  let input: Record<string, unknown> = {};
  if (body !== '') {
    try {
      const v = JSON.parse(body) as unknown;
      if (typeof v !== 'object' || v === null || Array.isArray(v))
        return json(400, { error: 'Bad JSON' });
      input = v as Record<string, unknown>;
    } catch {
      return json(400, { error: 'Bad JSON' });
    }
  }
  const t = method === 'DELETE' ? 'delete' : input.t;
  const key = typeof input.key === 'string' && KEY_RE.test(input.key) ? input.key : null;
  const tag = key === null ? null : ownerTag(key);

  if (t === 'delete') {
    const id = String(input.id ?? event.queryStringParameters?.id ?? '');
    if (!ID_RE.test(id)) return json(400, { error: 'Bad id' });
    const doc = validDoc(await store.get(setKey(id), { type: 'json' }));
    if (doc === null) return json(404, { error: 'no such set' });
    const isAdmin =
      event.headers?.['x-world-admin'] !== undefined ||
      event.headers?.['X-World-Admin'] !== undefined
        ? adminCheck(event.headers)
        : null;
    if (isAdmin !== null && !isAdmin.ok) return json(isAdmin.status, { error: isAdmin.error });
    if (isAdmin === null && (tag === null || doc.by !== tag))
      return json(403, { error: 'only whoever shared a set can delete it' });
    await removeSet(store, id);
    return json(200, { ok: true });
  }

  if (tag === null) return json(400, { error: 'Bad key' });

  if (t === 'played') {
    const id = String(input.id ?? '');
    if (!ID_RE.test(id)) return json(400, { error: 'Bad id' });
    const doc = await store.get(setKey(id), { type: 'json' });
    if (validDoc(doc) === null) return json(404, { error: 'no such set' });
    if (!(await rateOk(store, `p.${tag}`, LIB_PLAYS_PER_WINDOW, now)))
      return json(429, { error: 'slow down' });
    await store.setJSON(markKey(id, 'p', tag, now), { at: now }, { onlyIfNew: true });
    return json(200, { ok: true });
  }

  if (t !== 'publish') return json(400, { error: 'Bad action' });
  const p = validPublish(input);
  if (!p.ok) return json(400, { error: p.error });
  if (!(await rateOk(store, `u.${tag}`, LIB_PUBLISH_PER_WINDOW, now)))
    return json(429, {
      error: 'you have shared a lot of sets just now, try again in a few minutes',
    });
  const ip = clientIp(event.headers);
  if (ip !== null && !(await rateOk(store, `ip.${ip}`, LIB_PUBLISH_PER_IP_WINDOW, now)))
    return json(429, {
      error: 'too many sets shared from here just now, try again in a few minutes',
    });

  const id = libSetId(p.dj, p.name, p.tracks);
  const bump = async () => {
    // Same set again: bump it to the top (and undelete it if it was deleted)
    await store.delete(tombKey(id)).catch(() => undefined);
    await store.setJSON(markKey(id, 'u', tag, now), { at: now }, { onlyIfNew: true });
    return json(200, { ok: true, id, dup: true });
  };
  const lib = await readLibrary(store, now);
  if (lib.docs.some(d => d.id === id)) return bump();
  if (lib.docs.filter(d => d.by === tag).length >= LIB_PER_RIDER)
    return json(400, { error: `you have ${LIB_PER_RIDER} sets in the library: delete one first` });
  const doc: Doc = { id, dj: p.dj, name: p.name, tracks: p.tracks, by: tag, at: now };
  const fresh = await store.setJSON(setKey(id), doc, { onlyIfNew: true });
  if (!fresh.modified) return bump();
  await store.delete(tombKey(id)).catch(() => undefined);
  await patchCache(store, sets => [doc, ...sets.filter(s => (s as Doc | null)?.id !== id)]);
  // Over the library's size: the least recently active sets go
  const all = sorted({ ...lib, docs: [doc, ...lib.docs] });
  for (const d of all.slice(LIB_MAX_SETS))
    await removeSet(store, d.id, false).catch(() => undefined);
  return json(200, { ok: true, id, dup: false });
}
