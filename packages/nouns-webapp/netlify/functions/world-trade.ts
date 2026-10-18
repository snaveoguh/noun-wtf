import type { TownId, TradeResult } from '../../src/miniapps/world2/trade/contract';

import { connectLambda, getStore } from '@netlify/blobs';

import {
  allQuotes,
  applyAction,
  applyDelta,
  newRow,
  normalizeRow,
  parseAction,
  stateOf,
  SUSPICIOUS,
  validActionId,
  type RejectKind,
  type StockDelta,
} from '../../src/miniapps/world2/trade/ledger';
import { normalizeMarkets, townQuotes, type Markets } from '../../src/miniapps/world2/trade/market';
import { isTown } from '../../src/miniapps/world2/trade/towns';

// Noun Trade ledger: every rider's coin + van cargo, and every town's stock.
// The server is the authority: a client never reports a balance, it asks for
// an action and gets back the books as they now stand. The rules (prices,
// spoilage, capacity, travel time, rate limits) are the pure ledger in
// src/miniapps/world2/trade/ledger.ts, which the client's offline mode runs
// too.
//
// GET  ?rider=<id>[&town=<id>] → { ok, state, quotes, at }
//      the rider's books (a fresh purse if unknown; nothing is written) and
//      that town's quotes (all towns' without `town`)
// GET  (no rider)              → { quotes, at }   every town's quotes
// POST { rider, id?, action }  → TradeResult + { at, kind?, dup? }
//      action: TradeAction (contract.ts); `id` is a client nonce: a retried
//      request is answered with the books, not applied twice. Refused
//      actions answer 200 { ok: false, reason, kind, state } (429 when rate
//      limited, 400 when malformed).
//
// Storage (Netlify Blobs store `noun-world-trade`):
//   rider/<id>  one TradeRow per rider (etag-guarded, so concurrent posts
//               from one rider can't lose or double coin: the loser retries
//               on the fresh row)
//   markets     every town's stock (etag-guarded; a lost race re-applies
//               just this action's stock move to the fresh markets)
//   rejections  the last 100 suspicious refusals (teleports, rate, junk)

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

type Store = ReturnType<typeof getStore>;

const MAX_BODY = 2000;
const ATTEMPTS = 8;
const LOG_KEEP = 100;

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

const riderKey = (rider: string) => `rider/${rider}`;

/** A rider id as world-stats takes it (a browser UUID). */
function riderOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const r = v.replace(/[^\dA-Za-z-]/g, '').slice(0, 64);
  return r.length >= 8 && r === v ? r : null;
}

async function readRow(store: Store, rider: string, now: number) {
  const cur = await store.getWithMetadata(riderKey(rider), { type: 'json' });
  return {
    row: cur !== null ? normalizeRow(cur.data, rider, now) : newRow(rider, now),
    etag: cur?.etag,
  };
}

async function readMarkets(store: Store, now: number) {
  const cur = await store.getWithMetadata('markets', { type: 'json' });
  return { markets: normalizeMarkets(cur?.data ?? null, now), etag: cur?.etag };
}

const put = (store: Store, key: string, v: unknown, etag: string | undefined) =>
  etag !== undefined
    ? store.setJSON(key, v, { onlyIfMatch: etag })
    : store.setJSON(key, v, { onlyIfNew: true });

/**
 * After the rider's row is committed, move the town's stock. First try the
 * markets this action was priced on; if someone traded meanwhile, re-apply
 * only this action's stock move to the fresh markets.
 */
async function commitMarkets(
  store: Store,
  priced: Markets,
  etag: string | undefined,
  delta: StockDelta,
  now: number,
) {
  if ((await put(store, 'markets', priced, etag)).modified) return true;
  for (let i = 0; i < ATTEMPTS; i++) {
    const cur = await readMarkets(store, now);
    const next = applyDelta(cur.markets, delta, now);
    if ((await put(store, 'markets', next, cur.etag)).modified) return true;
  }
  return false;
}

/** Suspicious refusals are kept (the last 100) so a false one can be looked into. */
async function logRejection(
  store: Store,
  entry: { rider: string; kind: RejectKind; reason: string; action: unknown },
) {
  try {
    const cur = ((await store.get('rejections', { type: 'json' })) as unknown[] | null) ?? [];
    const action = JSON.stringify(entry.action ?? null).slice(0, 300);
    await store.setJSON(
      'rejections',
      [...cur, { at: Date.now(), ...entry, action }].slice(-LOG_KEEP),
    );
  } catch {
    // logging must never break a trade
  }
}

async function get(store: Store, q: Record<string, string | undefined>) {
  const now = Date.now();
  const { markets } = await readMarkets(store, now);
  const town = q.town;
  if (town !== undefined && !isTown(town)) return json(400, { ok: false, reason: 'unknown town' });
  const quotes =
    town !== undefined
      ? townQuotes(town as TownId, markets[town as TownId], now)
      : allQuotes(markets, now);
  if (q.rider === undefined) return json(200, { quotes, at: now });
  const rider = riderOf(q.rider);
  if (rider === null) return json(400, { ok: false, reason: 'bad rider' });
  const { row } = await readRow(store, rider, now);
  return json(200, { ok: true, state: stateOf(row), quotes, at: now });
}

async function post(store: Store, body: string | null): Promise<HandlerResponse> {
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
  if (input.id !== undefined && !validActionId(input.id))
    return json(400, { ok: false, reason: 'bad id' });
  const id = input.id as string | undefined;
  const parsed = parseAction(input.action);
  if ('error' in parsed) {
    const kind: RejectKind = parsed.error === 'unsupported' ? 'unsupported' : 'invalid';
    if (kind === 'invalid')
      await logRejection(store, { rider, kind, reason: parsed.error, action: input.action });
    return json(400, { ok: false, reason: parsed.error, kind });
  }
  const action = parsed.a;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const now = Date.now();
    const r = await readRow(store, rider, now);
    const m = await readMarkets(store, now);
    const out = applyAction(r.row, m.markets, action, now, id);

    if (!out.ok) {
      // Keep the spent rate token (best effort), log what looks like a cheat
      await put(store, riderKey(rider), out.row, r.etag).catch(() => undefined);
      if (SUSPICIOUS.has(out.kind))
        await logRejection(store, { rider, kind: out.kind, reason: out.reason, action });
      const res: TradeResult & { at: number; kind: RejectKind } = {
        ok: false,
        reason: out.reason,
        kind: out.kind,
        state: stateOf(out.row),
        at: now,
      };
      return json(out.kind === 'rate' ? 429 : 200, res);
    }

    const town = 'town' in action ? action.town : null;
    const quotes = (mk: Markets) => (town !== null ? townQuotes(town, mk[town], now) : undefined);
    if (out.dup)
      return json(200, {
        ok: true,
        dup: true,
        state: stateOf(out.row),
        quotes: quotes(m.markets),
        at: now,
      });

    // The rider's books first: this write is what makes coin safe
    if (!(await put(store, riderKey(rider), out.row, r.etag)).modified) continue;
    if (out.delta !== null) await commitMarkets(store, out.markets, m.etag, out.delta, now);
    const res: TradeResult & { at: number } = {
      ok: true,
      state: stateOf(out.row),
      quotes: quotes(out.markets),
      at: now,
    };
    return json(200, res);
  }
  return json(409, { ok: false, reason: 'busy, try again' });
}

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return json(204, {});
  connectLambda({ blobs: event.blobs ?? '', headers: event.headers ?? {} });
  const store = getStore('noun-world-trade');
  if (method === 'GET') return get(store, event.queryStringParameters ?? {});
  if (method === 'POST') return post(store, event.body);
  return json(405, { ok: false, reason: 'method not allowed' });
}
