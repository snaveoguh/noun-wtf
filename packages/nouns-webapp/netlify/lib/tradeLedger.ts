// ── Noun Trade: the game's own ledger, as the on-chain layer sees it ──────
//
// world-trade.ts keeps one TradeRow per rider at `rider/<id>` in the
// `noun-world-trade` store. Cash-outs (world-trade-claim) and deposits
// (world-trade-deposit) move coin and goods in and out of exactly those rows,
// through the pure ledger's moveForChain (starter purse and ICECREAM stay in
// the game), with the same etag compare-and-swap world-trade uses. So the
// balance the HUD shows is the one a cash-out debits.
//
// Every store here is opened with strong consistency: Netlify Blobs reads are
// otherwise eventually consistent (up to ~60 s stale), and a compare-and-swap
// on a stale read keeps losing, or worse, a stale row comes back as "the books".

import type { LedgerDelta, LedgerPort, LedgerResult } from './tradeClaim';

import { getStore } from '@netlify/blobs';

import {
  moveForChain,
  newRow,
  normalizeRow,
  stateOf,
  type TradeRow,
} from '../../src/miniapps/world2/trade/ledger';

/** The economy's store (world-trade.ts). */
export const TRADE_LEDGER_STORE = 'noun-world-trade';

export const riderKey = (rider: string) => `rider/${rider}`;

/** A store with read-your-writes (needs a v2 function: `export default async (req) =>`). */
export const strongStore = (name: string) => getStore({ name, consistency: 'strong' });

/** The subset of a Blobs store the ledger needs (the in-memory one in tests too). */
export interface RowStore {
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

const CAS_TRIES = 8;

/**
 * LedgerPort over the game's rider rows. Atomic (one CAS write per op) and
 * idempotent by opId (kept in the row's `ops`).
 */
export function rowLedger(store: RowStore, now: () => number = Date.now): LedgerPort {
  async function apply(
    rider: string,
    delta: LedgerDelta,
    opId: string,
    dir: 1 | -1,
  ): Promise<LedgerResult> {
    for (let i = 0; i < CAS_TRIES; i++) {
      const t = now();
      const cur = await store.getWithMetadata(riderKey(rider), { type: 'json' });
      if (cur === null && dir < 0) return { ok: false, reason: 'No trade balance yet' };
      const row: TradeRow = cur !== null ? normalizeRow(cur.data, rider, t) : newRow(rider, t);
      const out = moveForChain(row, { goods: delta.goods, coin: delta.coin }, opId, dir, t);
      if (!out.ok) return out;
      if (!out.applied) return { ok: true, state: stateOf(out.row), applied: false };
      const res = await store.setJSON(
        riderKey(rider),
        out.row,
        cur?.etag !== undefined ? { onlyIfMatch: cur.etag } : { onlyIfNew: true },
      );
      if (res === undefined || res.modified === true)
        return { ok: true, state: stateOf(out.row), applied: true };
    }
    return { ok: false, reason: 'Ledger busy, try again' };
  }
  return {
    debit: (rider, delta, opId) => apply(rider, delta, opId, -1),
    credit: (rider, delta, opId) => apply(rider, delta, opId, 1),
  };
}
