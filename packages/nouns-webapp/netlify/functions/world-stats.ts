import { connectLambda, getStore } from '@netlify/blobs';


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
  kmh: 2000, // top speed, km/h
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
type AddKey = keyof typeof ADD;

interface Rider {
  rider: string;
  name: string;
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

function boards(riders: Rider[]) {
  const out: Record<string, { name: string; value: number; label?: string; at: number }[]> = {};
  for (const k of Object.keys(BEST) as BestKey[]) {
    out[k] = riders
      .filter(r => (r.best[k] ?? 0) > 0)
      .sort((a, b) => (b.best[k] ?? 0) - (a.best[k] ?? 0))
      .slice(0, TOP)
      .map(r => ({
        name: r.name,
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
      .map(r => ({ name: r.name, value: Math.round(r.add[k]! * 100) / 100, at: r.last }));
  }
  return out;
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
    });
  }
  if (method !== 'POST') return json(405, { error: 'Method not allowed' });

  let input: Record<string, unknown>;
  try {
    input = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Bad JSON' });
  }
  const name = clean(input.name, 42);
  const rider = clean(input.rider, 64).replace(/[^a-zA-Z0-9-]/g, '');
  if (!name || !rider) return json(400, { error: 'Missing name or rider' });
  const best = (input.best ?? {}) as Record<string, unknown>;
  const add = (input.add ?? {}) as Record<string, unknown>;
  const newSession = input.session === true;
  const now = Date.now();

  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await store.getWithMetadata('riders', { type: 'json' });
    const riders = ((cur?.data as Rider[] | null) ?? (await imported())).slice();
    let r = riders.find(x => x.rider === rider);
    if (!r) {
      r = { rider, name, best: {}, add: {}, sessions: 0, first: now, last: now };
      riders.push(r);
    }
    r.name = name;
    r.last = now;
    if (newSession) r.sessions++;
    for (const k of Object.keys(BEST) as BestKey[]) {
      const v = Number(best[k]);
      if (!Number.isFinite(v) || v <= 0 || v > BEST[k]) continue;
      if (v > (r.best[k] ?? 0)) {
        r.best[k] = Math.round(v * 100) / 100;
        if (k === 'combo') r.comboLabel = clean(input.comboLabel, 200);
      }
    }
    for (const k of Object.keys(ADD) as AddKey[]) {
      const v = Number(add[k]);
      if (!Number.isFinite(v) || v <= 0) continue;
      r.add[k] = (r.add[k] ?? 0) + Math.min(v, ADD[k]);
    }
    // Way past capacity: drop the least-recently-seen riders
    const next =
      riders.length > MAX_RIDERS
        ? riders.sort((a, b) => b.last - a.last).slice(0, MAX_RIDERS)
        : riders;
    const res = cur?.etag
      ? await store.setJSON('riders', next, { onlyIfMatch: cur.etag })
      : await store.setJSON('riders', next, { onlyIfNew: true });
    if (!res.modified) continue;

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
    return json(200, { ok: true, you: { best: r.best, add: r.add, sessions: r.sessions } });
  }
  return json(409, { error: 'Busy, try again' });
}
