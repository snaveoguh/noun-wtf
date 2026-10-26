import { getStore } from '@netlify/blobs';

import {
  apply,
  drift,
  newBook,
  normalizeBook,
  parseEvent,
  type RespectBook,
} from '../../src/miniapps/world2/respect/rules';

// Noun World RESPECT: the authoritative score per rider.
//
// The client never reports a score. It reports what happened (RespectEvents,
// interiors/contract.ts) and this function scores them itself with the same
// pure rules the game runs (src/miniapps/world2/respect/rules.ts): the same
// deltas, per-kind-per-minute limits, per-target cooldowns, the +40 / −60 a
// minute caps and the idle drift, all kept in the rider's book here.
//
// GET  ?rider=<id>              → { ok, known, score, tier, at }
//      the book drifted to now (nothing is written; known: false = new rider)
// POST { rider, events: [{ id, at, e }] }  (1..20 events)
//                               → { ok, known, score, tier, at, applied: [{ id, d }] }
//      `id` is a client nonce (a resent batch isn't counted twice), `at` the
//      client's time for it, `e` the event. Unknown kinds and malformed
//      fields are skipped (d: 0); a batch with nothing valid is a 400.
//
// What it does NOT trust:
//   • scores, tiers, deltas: never read from the client;
//   • times: an event's `at` is clamped to [max(now − 15 min, last applied),
//     now], so the limits run on a clock that only moves forward and can
//     back-date at most 15 minutes (a flushed offline queue still fits);
//   • amounts: `custom` is clamped to ±10, gifts to 12, etc. by the rules.
// What is still spoofable (documented, bounded by the limits above):
//   • that an event happened at all: a script can POST "trick 150000" or
//     "gift" events it never earned, up to the per-kind limits and +40 a
//     minute of real time (≈ 2,400 an hour, so legend in ~15 min of
//     scripting). Gifts and purchases aren't cross-checked with the
//     world-trade ledger, tricks aren't checked against a ride proof;
//   • the rider id is a bearer secret (the private browser UUID world-stats
//     and world-trade use): whoever has it can post as that rider;
//   • the legend badge others see is relayed in the multiplayer pose blob
//     and isn't checked against this book.
//
// Storage: Netlify Blobs store `noun-world-respect` (strong consistency, a
// v2 function), `rider/<id>` = { book, seen } with an etag compare-and-swap
// so two tabs can't lose each other's events.

interface HandlerResponse {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
}

/** The subset of a Blobs store this needs (the in-memory one in tests too). */
export interface RespectStore {
  getWithMetadata(
    key: string,
    opts: { type: 'json' },
  ): Promise<{ data: unknown; etag?: string } | null>;
  setJSON(
    key: string,
    value: unknown,
    opts?: { onlyIfMatch?: string; onlyIfNew?: boolean },
  ): Promise<{ modified: boolean } | void>;
}

export const RESPECT_STORE = 'noun-world-respect';
const MAX_BODY = 12_000;
const MAX_EVENTS = 20;
const SEEN_KEEP = 400;
const BACKDATE_MS = 15 * 60_000;
const ATTEMPTS = 8;
const ID_RE = /^[\w-]{6,48}$/;

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

/** A rider id as world-stats / world-trade take it (a browser UUID). */
function riderOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const r = v.replace(/[^\dA-Za-z-]/g, '').slice(0, 64);
  return r.length >= 8 && r === v ? r : null;
}

interface Row {
  book: RespectBook;
  seen: string[];
}

function normalizeRow(v: unknown, now: number): Row {
  const o = (v !== null && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    book: normalizeBook(o.book, now),
    seen: Array.isArray(o.seen)
      ? o.seen.filter((s): s is string => typeof s === 'string').slice(-SEEN_KEEP)
      : [],
  };
}

const key = (rider: string) => `rider/${rider}`;

async function readRow(store: RespectStore, rider: string, now: number) {
  const cur = await store.getWithMetadata(key(rider), { type: 'json' });
  return {
    row: cur !== null ? normalizeRow(cur.data, now) : { book: newBook(now), seen: [] },
    etag: cur?.etag,
    known: cur !== null,
  };
}

const view = (book: RespectBook, now: number, known: boolean) => {
  const b = drift(book, now);
  return { ok: true, known, score: b.score, tier: b.tier, at: now };
};

interface InEvent {
  id: string;
  at: number;
  raw: unknown;
}

/** Score a batch onto a row. Pure (exported for tests). */
export function applyBatch(row: Row, events: InEvent[], now: number) {
  let book = row.book;
  const seen = new Set(row.seen);
  const applied: { id: string; d: number; dup?: true; bad?: true }[] = [];
  // Oldest first, on a clock that never goes back
  const sorted = [...events].sort((a, b) => a.at - b.at);
  for (const ev of sorted) {
    if (seen.has(ev.id)) {
      applied.push({ id: ev.id, d: 0, dup: true });
      continue;
    }
    const e = parseEvent(ev.raw);
    if (e === null) {
      applied.push({ id: ev.id, d: 0, bad: true });
      continue;
    }
    const at = Math.min(now, Math.max(now - BACKDATE_MS, book.at, ev.at));
    const r = apply(book, e, at);
    book = r.book;
    seen.add(ev.id);
    applied.push({ id: ev.id, d: r.delta });
  }
  return { row: { book, seen: [...seen].slice(-SEEN_KEEP) }, applied };
}

async function post(store: RespectStore, body: string | null, now: number) {
  if ((body ?? '').length > MAX_BODY) return json(413, { ok: false, reason: 'too big' });
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(body ?? '{}') as Record<string, unknown>;
  } catch {
    return json(400, { ok: false, reason: 'bad JSON' });
  }
  if (input === null || typeof input !== 'object')
    return json(400, { ok: false, reason: 'bad JSON' });
  const rider = riderOf(input.rider);
  if (rider === null) return json(400, { ok: false, reason: 'bad rider' });
  const list = input.events;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_EVENTS)
    return json(400, { ok: false, reason: 'bad events' });
  const events: InEvent[] = [];
  for (const v of list) {
    if (v === null || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    if (typeof o.id !== 'string' || !ID_RE.test(o.id)) continue;
    const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : now;
    events.push({ id: o.id, at, raw: o.e });
  }
  if (!events.some(ev => parseEvent(ev.raw) !== null))
    return json(400, { ok: false, reason: 'no valid events' });

  for (let i = 0; i < ATTEMPTS; i++) {
    const r = await readRow(store, rider, now);
    const out = applyBatch(r.row, events, now);
    const put =
      r.etag !== undefined
        ? await store.setJSON(key(rider), out.row, { onlyIfMatch: r.etag })
        : await store.setJSON(key(rider), out.row, { onlyIfNew: true });
    if (put !== undefined && put.modified === false) continue;
    return json(200, { ...view(out.row.book, now, true), applied: out.applied });
  }
  return json(409, { ok: false, reason: 'busy, try again' });
}

/** One request against a store (the default export opens the real one). */
export async function handleRespect(
  store: RespectStore,
  method: string,
  query: Record<string, string | undefined>,
  body: string | null,
  now: number = Date.now(),
): Promise<HandlerResponse> {
  if (method === 'OPTIONS') return json(204, {});
  if (method === 'GET') {
    const rider = riderOf(query.rider);
    if (rider === null) return json(400, { ok: false, reason: 'bad rider' });
    const r = await readRow(store, rider, now);
    return json(200, view(r.row.book, now, r.known));
  }
  if (method === 'POST') return post(store, body, now);
  return json(405, { ok: false, reason: 'method not allowed' });
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const out = await handleRespect(
    getStore({ name: RESPECT_STORE, consistency: 'strong' }) as unknown as RespectStore,
    req.method,
    Object.fromEntries(url.searchParams),
    req.method === 'POST' ? await req.text() : null,
  );
  return new Response(out.statusCode === 204 ? null : out.body, {
    status: out.statusCode,
    headers: out.headers,
  });
};
