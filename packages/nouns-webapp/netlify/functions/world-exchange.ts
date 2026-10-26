import { connectLambda, getStore } from '@netlify/blobs';

import {
  checkInvariants,
  genesis,
  isGood,
  playerAct,
  riderAccount,
  snapshot,
  STEP_MS,
  tick,
  type ExchangeAction,
  type ExchangeState,
  type GoodId,
} from '../../src/miniapps/exchange/engine';
import { publicFloor } from '../../src/miniapps/exchange3d/sim/feed';

// Noun Trade's Grand Exchange: one order book per good, NPC bot traders and
// riders' limit / market orders, all in-game COIN (never real money, nothing
// on-chain). The whole exchange is one blob ('state'), written with etag
// optimistic concurrency like world-stats; the engine is pure and shared
// with the browser (src/miniapps/exchange/engine).
//
// No cron: every request ticks the bots forward to now (bounded work per
// request, see engine/sim.ts tick), so the floor moves whenever anyone looks.
//
// GET  ?good=FISH&tf=m|h&rider=<id>
//      → ExchangeSnapshot (book ladder, candles, tape, floor, bots, you).
//        Read-mostly: it saves the ticked state only when the clock lagged
//        SAVE_LAG_MS, and never creates an account.
//      &floor=1 adds `floor3d` (the 3D trading floor's feed): every good's
//        recent fills and the resting orders near the touch, rider ids masked.
// POST { rider, action }
//      action = { t: 'join' }                       starter grant (once per rider)
//             | { t: 'order', side, good, qty, price, kind?: 'limit' | 'market' }
//             | { t: 'cancel', order }
//      → { ok, reason?, fills, snapshot }
//
// Riders are the random browser ids from net/Stats.ts (riderId()). A new
// rider gets STARTER_COIN once. Limits: body size, ACTIONS_PER_MIN per
// rider, MAX_ACCOUNTS riders in total.
//
// Integration with the trade/ economy (world-trade) is deliberately not
// wired yet: the seams are TownFeed in engine/goods.ts (town prices) and
// the ledger notes in engine/types.ts (accounts, mint, ext).

interface HandlerEvent {
  body: string | null;
  blobs?: string;
  headers?: Record<string, string>;
  httpMethod: string;
  rawUrl?: string;
  queryStringParameters?: Record<string, string | undefined> | null;
}

interface HandlerResponse {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
}

const KEY = 'state';
const MAX_BODY = 4_000;
const ACTIONS_PER_MIN = 40;
export const MAX_ACCOUNTS = 5_000;
/** GETs save the ticked state only when it lagged this much (keeps writes rare). */
const SAVE_LAG_MS = 15_000;
const ATTEMPTS = 6;

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

const cleanRider = (v: unknown) =>
  String(v ?? '')
    .slice(0, 64)
    .replace(/[^\dA-Za-z-]/g, '');

type Store = ReturnType<typeof getStore>;

async function load(store: Store): Promise<{ s: ExchangeState; etag: string | undefined }> {
  const cur = await store.getWithMetadata(KEY, { type: 'json' });
  if (cur?.data) return { s: cur.data as ExchangeState, etag: cur.etag };
  return { s: genesis((Date.now() ^ 0x5eed) >>> 0, Date.now()), etag: undefined };
}

async function save(store: Store, s: ExchangeState, etag: string | undefined) {
  const res = etag
    ? await store.setJSON(KEY, s, { onlyIfMatch: etag })
    : await store.setJSON(KEY, s, { onlyIfNew: true });
  return res.modified !== false;
}

function query(event: HandlerEvent): Record<string, string> {
  const out: Record<string, string> = {};
  if (event.rawUrl) {
    try {
      new URL(event.rawUrl).searchParams.forEach((v, k) => (out[k] = v));
    } catch {
      // ignore
    }
  }
  for (const [k, v] of Object.entries(event.queryStringParameters ?? {}))
    if (v !== undefined) out[k] = v;
  return out;
}

function parseAction(raw: unknown): ExchangeAction | { t: 'join' } | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (a.t === 'join') return { t: 'join' };
  if (a.t === 'cancel' && typeof a.order === 'string' && a.order.length <= 24) {
    return { t: 'cancel', order: a.order };
  }
  if (a.t === 'order') {
    if (a.side !== 'buy' && a.side !== 'sell') return null;
    if (!isGood(a.good)) return null;
    const qty = Number(a.qty);
    const price = Number(a.price ?? 0);
    const kind = a.kind === 'market' ? 'market' : 'limit';
    if (!Number.isFinite(qty) || !Number.isFinite(price)) return null;
    return { t: 'order', side: a.side, good: a.good, qty, price, kind };
  }
  return null;
}

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return json(204, {});
  connectLambda({ blobs: event.blobs ?? '', headers: event.headers ?? {} });
  const store = getStore('noun-world-exchange');
  const q = query(event);

  if (method === 'GET') {
    const good: GoodId = isGood(q.good) ? q.good : 'ICECREAM';
    const tf = q.tf === 'h' ? 'h' : 'm';
    const rider = cleanRider(q.rider) || null;
    let { s, etag } = await load(store);
    const now = Date.now();
    if (etag === undefined || now - s.now >= SAVE_LAG_MS) {
      tick(s, now);
      if (!(await save(store, s, etag))) {
        // Someone else moved it on: show theirs
        ({ s, etag } = await load(store));
        tick(s, now);
      }
    } else if (now - s.now >= STEP_MS) {
      tick(s, now); // in-memory only; the next write persists its own tick
    }
    const snap = snapshot(s, { good, tf, owner: rider });
    return json(200, q.floor === '1' ? { ...snap, floor3d: publicFloor(s, rider) } : snap);
  }
  if (method !== 'POST') return json(405, { error: 'Method not allowed' });
  if ((event.body ?? '').length > MAX_BODY) return json(413, { error: 'Body too big' });

  let input: Record<string, unknown>;
  try {
    input = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Bad JSON' });
  }
  const rider = cleanRider(input.rider);
  if (rider.length < 8) return json(400, { error: 'Missing rider' });
  const action = parseAction(input.action);
  if (!action) return json(400, { error: 'Bad action' });
  const good: GoodId = isGood(input.good)
    ? input.good
    : 'good' in action
      ? action.good
      : 'ICECREAM';
  const tf = input.tf === 'h' ? 'h' : 'm';

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { s, etag } = await load(store);
    const now = Date.now();
    tick(s, now);
    const known = s.accounts[rider] !== undefined;
    if (!known && Object.keys(s.accounts).length >= MAX_ACCOUNTS) {
      return json(503, { error: 'The exchange is full right now' });
    }
    const a = riderAccount(s, rider, now);
    // Rate limit (per rider, per minute)
    const win = Math.floor(now / 60_000);
    if (!a.rl || a.rl.t !== win) a.rl = { t: win, n: 0 };
    if (++a.rl.n > ACTIONS_PER_MIN) {
      return json(429, { ok: false, reason: 'slow down', fills: [] });
    }
    const r =
      action.t === 'join'
        ? { ok: true, fills: [], reason: known ? undefined : 'welcome' }
        : playerAct(s, rider, action, now);
    // Never write a broken ledger
    const errs = checkInvariants(s);
    if (errs.length > 0) {
      console.error('world-exchange invariant', errs.slice(0, 5));
      return json(500, { error: 'Ledger check failed, nothing saved' });
    }
    if (!(await save(store, s, etag))) continue;
    return json(200, {
      ok: r.ok,
      ...(r.reason ? { reason: r.reason } : {}),
      fills: r.fills,
      snapshot: snapshot(s, { good, tf, owner: rider }),
    });
  }
  return json(409, { error: 'Busy, try again' });
}
