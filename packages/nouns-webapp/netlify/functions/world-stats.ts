import { connectLambda, getStore } from '@netlify/blobs';

import { decodeTrace, verifyRun } from '../lib/runProof';
import { checkLink } from '../lib/walletAuth';

// Noun World stats: every rider's records and lifetime totals, plus how
// many people have played. One blob holds the riders, one the counters.
//
// GET  → { riders, sessions, days, boards: { [metric]: top 100 rows } }
// POST { rider, name, session?: true, best?: {...}, add?: {...}, comboLabel? }
//      `best` values only ever raise a record; `add` values are deltas
//      since the client's last post, added to lifetime totals.
//
// Replaces the earlier world-fastest / world-combo boards: their stores'
// rows are imported the first time this one is empty.
//
// The competition records (top speed, highest jump, hang time) only rise
// with a proof: `proofs: [{ keys, d }]`, the trace of the ride that set
// them, checked against the game's physics (../lib/runProof.ts).
//
// Wallet links (one identity per ETH address, so prize winners can be paid):
// POST { action: 'link', rider, name, address, ts, sig }
//      `sig` signs linkMessage(rider, address, name, ts) (net/Stats.ts),
//      checked in ../lib/walletAuth.ts and refused after 10 minutes. The
//      address then owns the row and its name: the rider id becomes one of
//      the row's `ids`, and linking the same address from another browser
//      merges that browser's row in (records: max, totals: sum, only values
//      the server already accepted). Linking again with a new name renames.
// A linked row's name only changes with a fresh signature, and nobody else
// can post a name a linked address holds (case-insensitive). Boards carry
// `addr` (full address) on linked rows; `winners` is the top linked rider of
// each competition board, for payouts. Posts answer with `linked`.

interface HandlerEvent {
  body: string | null;
  blobs?: string;
  headers?: Record<string, string>;
  httpMethod: string;
  rawUrl?: string;
}

interface HandlerResponse {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
}

/** Records: higher is better, a post can only raise them. */
const BEST = {
  kmh: 20_000, // top speed, km/h (the streak has no top speed)
  combo: 100_000_000, // best single banked combo, points
  session: 1_000_000_000, // best session score, points
  airM: 500, // highest jump above take-off, m
  airS: 120, // longest hang time, s
  grindM: 5000, // longest single grind, m
  downM: 1_000_000, // furthest downhill from the city, m
} as const;
/** Lifetime totals: per-post caps keep a bad client from inflating them. */
const ADD = {
  km: 200, // distance skated
  tricks: 5000, // tricks landed
  playS: 3600, // time in the world
} as const;
type BestKey = keyof typeof BEST;
const PROVED = new Set<BestKey>(['kmh', 'airM', 'airS']);
const MAX_PROOFS = 3;
const MAX_PROOF_CHARS = 2_000_000;

/** What the posted proofs back up: the highest value each proved key may take. */
function provenCaps(raw: unknown): {
  caps: Partial<Record<BestKey, number>>;
  why: Record<string, string>;
  failed: { keys: BestKey[]; reason: string; d: string }[];
} {
  const caps: Partial<Record<BestKey, number>> = {};
  const why: Record<string, string> = {};
  const failed: { keys: BestKey[]; reason: string; d: string }[] = [];
  if (!Array.isArray(raw)) return { caps, why, failed };
  for (const p of raw.slice(0, MAX_PROOFS) as { keys?: unknown; d?: unknown }[]) {
    const keys = (Array.isArray(p?.keys) ? p.keys : []).filter((k): k is BestKey =>
      PROVED.has(k as BestKey),
    );
    if (keys.length === 0 || typeof p.d !== 'string' || p.d.length > MAX_PROOF_CHARS) continue;
    const trace = decodeTrace(p.d);
    const check = trace === null ? null : verifyRun(trace);
    if (check === null || !check.ok) {
      const reason = check?.reason ?? 'unreadable proof';
      for (const k of keys) why[k] = reason;
      failed.push({ keys, reason, d: p.d });
      continue;
    }
    // Proof checked out but holds nothing for this key (e.g. no clean jump)
    for (const k of keys) why[k] ??= 'not in its ride proof';
    const up = (k: BestKey, v: number) => {
      if (!keys.includes(k)) return;
      caps[k] = Math.max(caps[k] ?? 0, v);
    };
    up('kmh', check.maxV * 3.6 + 0.3);
    for (const a of check.airs) {
      up('airM', a.m + 0.2);
      up('airS', a.s + 0.06);
    }
  }
  return { caps, why, failed };
}

/**
 * Every refused proof is kept (the last 40, traces capped) so a false
 * rejection can be replayed and fixed rather than guessed at. Best effort:
 * a lost race just drops a log line.
 */
async function logRejections(
  store: ReturnType<typeof getStore>,
  entry: {
    rider: string;
    name: string;
    claimed: Record<string, unknown>;
    failed: { keys: string[]; reason: string; d: string }[];
    rejected: Record<string, string>;
  },
) {
  try {
    const cur = ((await store.get('rejections', { type: 'json' })) as unknown[] | null) ?? [];
    const failed = entry.failed.map(f => ({
      keys: f.keys,
      reason: f.reason,
      d: f.d.length <= 400_000 ? f.d : null,
    }));
    const next = [...cur, { at: Date.now(), ...entry, failed }].slice(-40);
    await store.setJSON('rejections', next);
  } catch {
    // logging must never break a post
  }
}
type AddKey = keyof typeof ADD;

interface Rider {
  rider: string;
  name: string;
  /** Linked rows: the owning address (checksummed)… */
  addr?: string;
  /** …every browser rider id posting into this row… */
  ids?: string[];
  /** …and the timestamp of the last accepted signature (no replays). */
  linkTs?: number;
  best: Partial<Record<BestKey, number>>;
  add: Partial<Record<AddKey, number>>;
  comboLabel?: string;
  sessions: number;
  first: number;
  last: number;
}
interface Meta {
  sessions: number;
  /** Sessions started per UTC day, last 90 days. */
  days: Record<string, number>;
}

const MAX_RIDERS = 20_000;
const TOP = 100;

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

const clean = (v: unknown, n: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, n);

/** The row a browser posts into: its linked identity, else its own row. */
const rowOf = (riders: Rider[], rider: string) =>
  riders.find(x => (x.addr ? (x.ids ?? []).includes(rider) : x.rider === rider));

/** Names held by linked addresses, lower-cased → address. */
function claimedNames(riders: Rider[]) {
  const out = new Map<string, string>();
  for (const r of riders) if (r.addr) out.set(r.name.toLowerCase(), r.addr);
  return out;
}

/** An unlinked rider whose name a linked address holds. */
const fallbackName = (r: Rider) => `noun ${r.rider.slice(0, 4)}`;

/** Two rows of one identity: records take the max, totals add up. */
function mergeInto(into: Rider, from: Rider) {
  for (const k of Object.keys(BEST) as BestKey[]) {
    const v = from.best[k];
    if (v === undefined || !(v > (into.best[k] ?? 0))) continue;
    into.best[k] = v;
    if (k === 'combo') into.comboLabel = from.comboLabel;
  }
  for (const k of Object.keys(ADD) as AddKey[]) {
    const v = from.add[k];
    if (v !== undefined && v > 0) into.add[k] = (into.add[k] ?? 0) + v;
  }
  into.sessions += from.sessions;
  into.first = Math.min(into.first, from.first);
  into.last = Math.max(into.last, from.last);
}

const linkedOf = (r: Rider) => (r.addr ? { address: r.addr, name: r.name } : null);

type BoardRow = { name: string; value: number; label?: string; at: number; addr?: string };

function boards(riders: Rider[]) {
  const claimed = claimedNames(riders);
  const show = (r: Rider) => ({
    name: !r.addr && claimed.has(r.name.toLowerCase()) ? fallbackName(r) : r.name,
    ...(r.addr ? { addr: r.addr } : {}),
  });
  const out: Record<string, BoardRow[]> = {};
  for (const k of Object.keys(BEST) as BestKey[]) {
    out[k] = riders
      .filter(r => (r.best[k] ?? 0) > 0)
      .sort((a, b) => (b.best[k] ?? 0) - (a.best[k] ?? 0))
      .slice(0, TOP)
      .map(r => ({
        ...show(r),
        value: r.best[k]!,
        ...(k === 'combo' && r.comboLabel ? { label: r.comboLabel } : {}),
        at: r.last,
      }));
  }
  for (const k of Object.keys(ADD) as AddKey[]) {
    out[k] = riders
      .filter(r => (r.add[k] ?? 0) > 0)
      .sort((a, b) => (b.add[k] ?? 0) - (a.add[k] ?? 0))
      .slice(0, TOP)
      .map(r => ({ ...show(r), value: Math.round(r.add[k]! * 100) / 100, at: r.last }));
  }
  return out;
}

/** Payouts: the best linked rider on each competition board. */
function winners(riders: Rider[]) {
  const out: Record<string, { name: string; address: string; value: number }> = {};
  for (const k of PROVED) {
    let top: Rider | undefined;
    for (const r of riders) {
      if (r.addr && (r.best[k] ?? 0) > (top?.best[k] ?? 0)) top = r;
    }
    if (top !== undefined) out[k] = { name: top.name, address: top.addr!, value: top.best[k]! };
  }
  return out;
}

/** Put a riders list back, trimming the least-recently-seen unlinked rows. */
async function saveRiders(
  store: ReturnType<typeof getStore>,
  riders: Rider[],
  etag: string | undefined,
) {
  // Way past capacity: drop the least-recently-seen riders (linked ones stay)
  const next =
    riders.length > MAX_RIDERS
      ? riders
          .sort((a, b) => Number(!!b.addr) - Number(!!a.addr) || b.last - a.last)
          .slice(0, MAX_RIDERS)
      : riders;
  const res = etag
    ? await store.setJSON('riders', next, { onlyIfMatch: etag })
    : await store.setJSON('riders', next, { onlyIfNew: true });
  return res.modified;
}

/** POST action 'link': tie this browser's rider to a signing address. */
async function link(
  store: ReturnType<typeof getStore>,
  input: Record<string, unknown>,
): Promise<HandlerResponse> {
  const rawName = typeof input.name === 'string' ? input.name : '';
  const name = clean(rawName, 42);
  const rider = clean(input.rider, 64).replace(/[^\dA-Za-z-]/g, '');
  if (!name || name !== rawName) return json(400, { error: 'Bad name' });
  if (!rider || rider !== input.rider) return json(400, { error: 'Bad rider' });
  const check = await checkLink(rider, name, input.address, input.ts, input.sig);
  if (!check.ok) return json(check.status, { error: check.error });
  const { address, ts } = check;
  const now = Date.now();

  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await store.getWithMetadata('riders', { type: 'json' });
    const riders = ((cur?.data as Rider[] | null) ?? (await imported())).slice();
    const holder = claimedNames(riders).get(name.toLowerCase());
    if (holder !== undefined && holder !== address) {
      return json(409, { error: `"${name}" belongs to another wallet` });
    }
    let target = riders.find(x => x.addr === address);
    if (target !== undefined && ts <= (target.linkTs ?? 0)) {
      return json(401, { error: 'Signature already used, sign again' });
    }
    const source = rowOf(riders, rider);
    if (source !== undefined && source !== target) {
      if (source.addr) {
        // This browser was linked to another wallet: it moves, that
        // wallet's row (and its records) stays with that wallet
        source.ids = (source.ids ?? []).filter(id => id !== rider);
      } else if (target !== undefined) {
        // Second browser of an identity: fold its row in
        mergeInto(target, source);
        riders.splice(riders.indexOf(source), 1);
      } else {
        // First link: this browser's row becomes the identity's
        target = source;
      }
    }
    if (target === undefined) {
      target = { rider, name, best: {}, add: {}, sessions: 0, first: now, last: now };
      riders.push(target);
    }
    target.addr = address;
    target.ids = [...new Set([...(target.ids ?? []), rider])];
    target.linkTs = ts;
    target.name = name;
    target.last = Math.max(target.last, now);
    if (!(await saveRiders(store, riders, cur?.etag))) continue;
    return json(200, {
      ok: true,
      linked: linkedOf(target),
      you: { best: target.best, add: target.add, sessions: target.sessions },
    });
  }
  return json(409, { error: 'Busy, try again' });
}

/** First run: bring over the rows from the old single-stat boards. */
async function imported(): Promise<Rider[]> {
  const out = new Map<string, Rider>();
  const get = (rider: string, name: string, at: number) => {
    let r = out.get(rider);
    if (!r) {
      r = { rider, name, best: {}, add: {}, sessions: 0, first: at, last: at };
      out.set(rider, r);
    }
    return r;
  };
  const fast = (await getStore('noun-world-fastest').get('board', { type: 'json' })) as
    | { rider: string; name: string; kmh: number; downM: number; at: number }[]
    | null;
  for (const e of fast ?? []) {
    const r = get(e.rider, e.name, e.at);
    r.best.kmh = Math.max(r.best.kmh ?? 0, e.kmh);
    if (e.downM > 0) r.best.downM = Math.max(r.best.downM ?? 0, e.downM);
  }
  const combo = (await getStore('noun-world-combo').get('board', { type: 'json' })) as
    | { rider: string; name: string; points: number; label: string; at: number }[]
    | null;
  for (const e of combo ?? []) {
    const r = get(e.rider, e.name, e.at);
    if (e.points > (r.best.combo ?? 0)) {
      r.best.combo = e.points;
      r.comboLabel = e.label;
    }
  }
  return [...out.values()];
}

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return json(204, {});
  connectLambda({ blobs: event.blobs ?? '', headers: event.headers ?? {} });
  const store = getStore('noun-world-stats');

  if (method === 'GET') {
    const riders =
      ((await store.get('riders', { type: 'json' })) as Rider[] | null) ?? (await imported());
    const meta = ((await store.get('meta', { type: 'json' })) as Meta | null) ?? {
      sessions: 0,
      days: {},
    };
    return json(200, {
      riders: riders.length,
      sessions: meta.sessions,
      days: meta.days,
      boards: boards(riders),
      winners: winners(riders),
    });
  }
  if (method !== 'POST') return json(405, { error: 'Method not allowed' });

  let input: Record<string, unknown>;
  try {
    input = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Bad JSON' });
  }
  if (input.action === 'link') return link(store, input);
  const name = clean(input.name, 42);
  const rider = clean(input.rider, 64).replace(/[^\dA-Za-z-]/g, '');
  if (!name || !rider) return json(400, { error: 'Missing name or rider' });
  const best = (input.best ?? {}) as Record<string, unknown>;
  const add = (input.add ?? {}) as Record<string, unknown>;
  const newSession = input.session === true;
  const now = Date.now();
  const { caps, why, failed } = provenCaps(input.proofs);
  const rejected: Record<string, string> = {};

  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await store.getWithMetadata('riders', { type: 'json' });
    const riders = ((cur?.data as Rider[] | null) ?? (await imported())).slice();
    let r = rowOf(riders, rider);
    if (!r) {
      r = { rider, name, best: {}, add: {}, sessions: 0, first: now, last: now };
      riders.push(r);
    }
    // A linked row's name only changes with a signature (action 'link'); an
    // unlinked rider can't take a name a linked address holds
    let nameTaken = false;
    if (!r.addr) {
      const claimed = claimedNames(riders);
      if (!claimed.has(name.toLowerCase())) r.name = name;
      else {
        nameTaken = true;
        if (claimed.has(r.name.toLowerCase())) r.name = fallbackName(r);
      }
    }
    r.last = now;
    if (newSession) r.sessions++;
    for (const k of Object.keys(BEST) as BestKey[]) {
      const v = Number(best[k]);
      if (!Number.isFinite(v) || v <= 0 || v > BEST[k]) continue;
      if (v > (r.best[k] ?? 0)) {
        if (PROVED.has(k) && !(v <= (caps[k] ?? 0))) {
          rejected[k] = caps[k] === undefined ? (why[k] ?? 'no proof') : 'beyond its proof';
          continue;
        }
        r.best[k] = Math.round(v * 100) / 100;
        if (k === 'combo') r.comboLabel = clean(input.comboLabel, 200);
      }
    }
    for (const k of Object.keys(ADD) as AddKey[]) {
      const v = Number(add[k]);
      if (!Number.isFinite(v) || v <= 0) continue;
      r.add[k] = (r.add[k] ?? 0) + Math.min(v, ADD[k]);
    }
    if (!(await saveRiders(store, riders, cur?.etag))) continue;

    if (newSession) {
      // Counters: same etag dance, best effort (a lost race costs one count)
      for (let m = 0; m < 4; m++) {
        const mc = await store.getWithMetadata('meta', { type: 'json' });
        const meta = (mc?.data as Meta | null) ?? { sessions: 0, days: {} };
        const day = new Date(now).toISOString().slice(0, 10);
        meta.sessions++;
        meta.days[day] = (meta.days[day] ?? 0) + 1;
        const keep = Object.keys(meta.days).sort().slice(-90);
        meta.days = Object.fromEntries(keep.map(d => [d, meta.days[d]!]));
        const mr = mc?.etag
          ? await store.setJSON('meta', meta, { onlyIfMatch: mc.etag })
          : await store.setJSON('meta', meta, { onlyIfNew: true });
        if (mr.modified) break;
      }
    }
    if (Object.keys(rejected).length > 0) {
      const claimed: Record<string, unknown> = {};
      for (const k of Object.keys(rejected)) claimed[k] = best[k];
      await logRejections(store, { rider, name: r.name, claimed, failed, rejected });
    }
    return json(200, {
      ok: true,
      you: { best: r.best, add: r.add, sessions: r.sessions },
      linked: linkedOf(r),
      ...(nameTaken ? { nameTaken: true } : {}),
      ...(Object.keys(rejected).length > 0 ? { rejected } : {}),
    });
  }
  return json(409, { error: 'Busy, try again' });
}
