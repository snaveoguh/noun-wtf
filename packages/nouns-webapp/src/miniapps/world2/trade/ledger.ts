// ── Noun Trade: the ledger rules (pure, deterministic) ───────────────────
//
// One rider's books (TradeRow) and the towns' markets, and the single
// function that applies an action to them. The server
// (netlify/functions/world-trade.ts) is the authority and runs exactly this;
// the client's offline mode runs the same code in memory.
//
// COIN only ever enters a rider's books two ways: the one-off starter purse
// (STARTER_COIN, booked as `granted`) and modelled sales to a town (sell /
// serve, booked as `earned`). It leaves through buys and upgrades (`spent`).
// So `coin === granted + earned − spent` always holds (see `audit`).
//
// Anti-cheat lives here too, so it's tested once and enforced everywhere:
//  • travel: a trade in town B after one in town A needs at least
//    travelMetres(A, B) / (VAN_MAX_SPEED · engine) − TRAVEL_GRACE_S seconds
//    between them (server clock), else it's a teleport;
//  • rate: a token bucket (BUCKET_MAX burst, BUCKET_RATE per second);
//  • street sales: one per SERVE_GAP_MS, and each customer pays once per
//    CUSTOMER_COOLDOWN_MS;
//  • every number is an integer in range, every id a known one.

import type { GoodId, TownId, TradeAction, TradeState, VanUpgrade } from './contract';

import { GOOD_IDS, GOODS, isGood } from './goods';
import {
  buyCost,
  marketAt,
  midPrice,
  quoteAt,
  sellProceeds,
  stockCap,
  townQuotes,
  type Markets,
} from './market';
import { isTown, travelMetres } from './towns';
import { capacityOf, isUpgrade, serveMultOf, speedMultOf, spoilMultOf, UPGRADES } from './upgrades';

export const RULES = {
  /** One-off starter purse for a new rider. */
  STARTER_COIN: 150,
  /** Fastest the van can cover road, m/s (keep ≥ the van's real top speed). */
  VAN_MAX_SPEED: 52, // the van's boost (~180 km/h, van/physics.ts) with a little headroom
  /** Clock / latency slack on the travel check (s). */
  TRAVEL_GRACE_S: 15,
  /** Largest single buy / sell. */
  MAX_QTY: 200,
  /** Token bucket: burst and refill per second. */
  BUCKET_MAX: 12,
  BUCKET_RATE: 2,
  /** Street sales: min gap, per-customer cooldown, premium over mid. */
  SERVE_GAP_MS: 2000,
  CUSTOMER_COOLDOWN_MS: 10 * 60_000,
  SERVE_PREMIUM: 1.1,
  /** Bookkeeping caps. */
  SERVED_KEEP: 200,
  IDS_KEEP: 32,
} as const;

export interface TradeBook {
  /** Starter purse. */
  granted: number;
  /** From sales (sell + serve). */
  earned: number;
  /** On buys + upgrades. */
  spent: number;
  trades: number;
}

/** A rider's server-side row: TradeState plus the bookkeeping it's derived from. */
export interface TradeRow {
  v: 1;
  rider: string;
  coin: number;
  /** Cargo in whole units. */
  held: Partial<Record<GoodId, number>>;
  /**
   * Melt owed per spoiling good (0 ≤ m < 1): the expected loss accrues
   * here and whole units leave `held` as it passes 1. It's carried even
   * when the van empties, so no fraction of a unit is ever given back.
   */
  melt: Partial<Record<GoodId, number>>;
  /** When `held` was last aged (ms). */
  heldAt: number;
  upgrades: VanUpgrade[];
  last: { town: TownId; at: number } | null;
  created: number;
  bucket: { n: number; at: number };
  /** Street customers served (id → ms) and the last street sale. */
  served: Record<string, number>;
  serveAt: number;
  /** Recent action ids (a retried request is answered, not repeated). */
  ids: string[];
  book: TradeBook;
}

export type RejectKind =
  | 'invalid'
  | 'unsupported'
  | 'travel'
  | 'rate'
  | 'funds'
  | 'capacity'
  | 'stock'
  | 'full'
  | 'cargo'
  | 'owned'
  | 'cooldown';

/** Rejections worth logging server-side (cheats or broken clients). */
export const SUSPICIOUS: ReadonlySet<RejectKind> = new Set(['invalid', 'travel', 'rate']);

/** How one accepted action moved a town's stock (re-applied on a market write race). */
export interface StockDelta {
  town: TownId;
  good: GoodId;
  dq: number;
}

export type Outcome =
  | {
      ok: true;
      row: TradeRow;
      markets: Markets;
      delta: StockDelta | null;
      /** COIN this action moved (+ in, − out). */
      coin: number;
      dup?: true;
    }
  | { ok: false; reason: string; kind: RejectKind; row: TradeRow };

export function newRow(rider: string, now: number): TradeRow {
  return {
    v: 1,
    rider,
    coin: RULES.STARTER_COIN,
    held: {},
    melt: {},
    heldAt: now,
    upgrades: [],
    last: null,
    created: now,
    bucket: { n: RULES.BUCKET_MAX, at: now },
    served: {},
    serveAt: 0,
    ids: [],
    book: { granted: RULES.STARTER_COIN, earned: 0, spent: 0, trades: 0 },
  };
}

const int = (v: unknown, lo: number, hi: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const finite = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * Whatever a store held, as a valid row (fields that fail their checks fall
 * back to safe values; coin is never raised by a repair).
 */
export function normalizeRow(raw: unknown, rider: string, now: number): TradeRow {
  if (raw === null || typeof raw !== 'object') return newRow(rider, now);
  const r = raw as Partial<TradeRow>;
  const base = newRow(rider, now);
  const held: Partial<Record<GoodId, number>> = {};
  for (const [g, n] of Object.entries(r.held ?? {}))
    if (isGood(g) && typeof n === 'number' && Number.isFinite(n) && n >= 1) held[g] = Math.floor(n);
  const melt: Partial<Record<GoodId, number>> = {};
  for (const [g, m] of Object.entries(r.melt ?? {}))
    if (isGood(g) && typeof m === 'number' && m > 0 && m < 1) melt[g] = m;
  const last =
    r.last && isTown(r.last.town) && Number.isFinite(r.last.at)
      ? { town: r.last.town, at: r.last.at }
      : null;
  return {
    ...base,
    coin: Math.max(0, Math.floor(finite(r.coin, base.coin))),
    held,
    melt,
    heldAt: Math.min(finite(r.heldAt, now), now),
    upgrades: [...new Set((r.upgrades ?? []).filter(isUpgrade))],
    last,
    created: finite(r.created, now),
    bucket: {
      n: Math.min(RULES.BUCKET_MAX, finite(r.bucket?.n, RULES.BUCKET_MAX)),
      at: finite(r.bucket?.at, now),
    },
    served: r.served && typeof r.served === 'object' ? { ...r.served } : {},
    serveAt: finite(r.serveAt, 0),
    ids: Array.isArray(r.ids)
      ? r.ids.filter(x => typeof x === 'string').slice(-RULES.IDS_KEEP)
      : [],
    book: {
      granted: finite(r.book?.granted, base.book.granted),
      earned: finite(r.book?.earned, 0),
      spent: finite(r.book?.spent, 0),
      trades: finite(r.book?.trades, 0),
    },
  };
}

/** Whole units of each good in the van. */
export function cargoOf(row: Pick<TradeRow, 'held'>): Partial<Record<GoodId, number>> {
  const out: Partial<Record<GoodId, number>> = {};
  for (const g of GOOD_IDS) {
    const n = row.held[g] ?? 0;
    if (n > 0) out[g] = n;
  }
  return out;
}

/** Cargo slots in use. */
export function usedSlots(cargo: Partial<Record<GoodId, number>>): number {
  let s = 0;
  for (const g of GOOD_IDS) s += (cargo[g] ?? 0) * GOODS[g].bulk;
  return s;
}

/** The TradeState a client sees. */
export function stateOf(row: TradeRow): TradeState {
  return {
    rider: row.rider,
    coin: row.coin,
    cargo: cargoOf(row),
    capacity: capacityOf(row.upgrades),
    upgrades: [...row.upgrades],
    last: row.last ? { ...row.last } : null,
  };
}

/**
 * Melt cargo up to `now`: n units lose n·(1 − (1 − spoil)^minutes) in
 * expectation; that accrues as melt and whole units drop out as it passes 1.
 */
export function age(row: TradeRow, now: number): TradeRow {
  const dtMin = Math.max(0, now - row.heldAt) / 60_000;
  if (dtMin === 0) return row;
  const held = { ...row.held };
  const melt = { ...row.melt };
  const mult = spoilMultOf(row.upgrades);
  for (const g of GOOD_IDS) {
    const n = held[g] ?? 0;
    const sp = GOODS[g].spoil * mult;
    if (sp <= 0 || n <= 0) continue;
    const m = (melt[g] ?? 0) + n * (1 - Math.pow(1 - sp, dtMin));
    const gone = Math.min(n, Math.floor(m));
    if (n - gone > 0) held[g] = n - gone;
    else delete held[g];
    melt[g] = gone === n ? 0 : m - gone;
    if (!(melt[g]! > 0)) delete melt[g];
  }
  return { ...row, held, melt, heldAt: Math.max(row.heldAt, now) };
}

/** Shortest legal time (ms) to get from one town to another. */
export function minTravelMs(a: TownId, b: TownId, ups: readonly VanUpgrade[]): number {
  const m = travelMetres(a, b);
  if (m === 0) return 0;
  const s = m / (RULES.VAN_MAX_SPEED * speedMultOf(ups)) - RULES.TRAVEL_GRACE_S;
  return Math.max(0, s * 1000);
}

/** Why a trade in `town` at `now` is a teleport (null: it's fine). */
export function travelCheck(row: TradeRow, town: TownId, now: number): string | null {
  if (row.last === null || row.last.town === town) return null;
  const need = minTravelMs(row.last.town, town, row.upgrades);
  const took = now - row.last.at;
  if (took >= need) return null;
  const km = (travelMetres(row.last.town, town) / 1000).toFixed(1);
  return `too fast: ${km} km from ${row.last.town} in ${Math.max(0, Math.round(took / 1000))} s (needs ${Math.ceil(need / 1000)} s)`;
}

const CUSTOMER_RE = /^[\w.:-]{1,48}$/;
const ID_RE = /^[\w-]{1,40}$/;

/** Parse an untrusted action (null + why when it's malformed). */
export function parseAction(raw: unknown): { a: TradeAction } | { error: string } {
  if (raw === null || typeof raw !== 'object') return { error: 'no action' };
  const r = raw as Record<string, unknown>;
  switch (r.t) {
    case 'buy':
    case 'sell':
      if (!isTown(r.town)) return { error: 'unknown town' };
      if (!isGood(r.good)) return { error: 'unknown good' };
      if (!int(r.qty, 1, RULES.MAX_QTY)) return { error: `qty must be 1–${RULES.MAX_QTY}` };
      return { a: { t: r.t, town: r.town, good: r.good, qty: r.qty as number } };
    case 'serve':
      if (!isTown(r.town)) return { error: 'unknown town' };
      if (!isGood(r.good)) return { error: 'unknown good' };
      if (typeof r.customer !== 'string' || !CUSTOMER_RE.test(r.customer))
        return { error: 'bad customer' };
      return { a: { t: 'serve', town: r.town, good: r.good, customer: r.customer } };
    case 'upgrade':
      if (!isTown(r.town)) return { error: 'unknown town' };
      if (!isUpgrade(r.up)) return { error: 'unknown upgrade' };
      return { a: { t: 'upgrade', town: r.town, up: r.up } };
    case 'order':
    case 'cancel':
      return { error: 'unsupported' };
    default:
      return { error: 'unknown action' };
  }
}

export const validActionId = (id: unknown): id is string =>
  typeof id === 'string' && ID_RE.test(id);

/**
 * Apply one action at `now`. Pure: returns new objects, never mutates its
 * inputs. A rejection carries the row with only its rate bucket touched.
 */
export function applyAction(
  row0: TradeRow,
  markets0: Markets,
  action: TradeAction,
  now: number,
  id?: string,
): Outcome {
  // A retried request: answer with the books as they stand
  if (id !== undefined && row0.ids.includes(id))
    return { ok: true, row: row0, markets: markets0, delta: null, coin: 0, dup: true };

  let row = age(row0, now);
  // Rate limit: token bucket
  const n = Math.min(
    RULES.BUCKET_MAX,
    row.bucket.n + (Math.max(0, now - row.bucket.at) / 1000) * RULES.BUCKET_RATE,
  );
  if (n < 1) {
    return {
      ok: false,
      kind: 'rate',
      reason: 'slow down',
      row: { ...row, bucket: { n, at: now } },
    };
  }
  row = { ...row, bucket: { n: n - 1, at: now } };
  const reject = (kind: RejectKind, reason: string): Outcome => ({ ok: false, kind, reason, row });

  if (action.t === 'order' || action.t === 'cancel')
    return reject('unsupported', 'the Grand Exchange has its own desk');

  const town = action.town;
  const teleport = travelCheck(row, town, now);
  if (teleport !== null) return reject('travel', teleport);

  const live = marketAt(town, markets0[town], now);
  const cargo = cargoOf(row);
  let coin = 0;
  let delta: StockDelta | null = null;
  const held = { ...row.held };
  const book = { ...row.book };
  let upgrades = row.upgrades;
  let served = row.served;
  let serveAt = row.serveAt;

  switch (action.t) {
    case 'buy': {
      const { good, qty } = action;
      const room = capacityOf(row.upgrades) - usedSlots(cargo);
      if (qty * GOODS[good].bulk > room)
        return reject('capacity', `no room: ${room} slot${room === 1 ? '' : 's'} free`);
      const cost = buyCost(town, good, live.stock[good], qty);
      if (cost === null) return reject('stock', `only ${Math.floor(live.stock[good])} in stock`);
      if (cost > row.coin) return reject('funds', `costs ${cost}, you have ${row.coin}`);
      coin = -cost;
      held[good] = (held[good] ?? 0) + qty;
      delta = { town, good, dq: -qty };
      book.spent += cost;
      break;
    }
    case 'sell': {
      const { good, qty } = action;
      if ((cargo[good] ?? 0) < qty) return reject('cargo', `you have ${cargo[good] ?? 0}`);
      const got = sellProceeds(town, good, live.stock[good], qty);
      if (got === null) return reject('full', `${town} can't take that many`);
      coin = got;
      held[good] = (held[good] ?? 0) - qty;
      if (held[good]! <= 0) delete held[good];
      delta = { town, good, dq: qty };
      book.earned += got;
      break;
    }
    case 'serve': {
      const { good, customer } = action;
      if ((cargo[good] ?? 0) < 1) return reject('cargo', `no ${good} to serve`);
      if (now - row.serveAt < RULES.SERVE_GAP_MS) return reject('rate', 'one customer at a time');
      const seen = row.served[customer];
      if (seen !== undefined && now - seen < RULES.CUSTOMER_COOLDOWN_MS)
        return reject('cooldown', 'already served');
      if (live.stock[good] + 1 > stockCap(town, good)) return reject('full', 'nobody wants it');
      const price = Math.max(
        1,
        Math.floor(
          midPrice(town, good, live.stock[good] + 1) *
            RULES.SERVE_PREMIUM *
            serveMultOf(row.upgrades),
        ),
      );
      coin = price;
      held[good] = (held[good] ?? 0) - 1;
      if (held[good]! <= 0) delete held[good];
      delta = { town, good, dq: 1 };
      book.earned += price;
      // Keep the newest customers only
      const next = Object.entries({ ...row.served, [customer]: now })
        .filter(([, at]) => now - at < RULES.CUSTOMER_COOLDOWN_MS)
        .sort((a, b) => a[1] - b[1])
        .slice(-RULES.SERVED_KEEP);
      served = Object.fromEntries(next);
      serveAt = now;
      break;
    }
    case 'upgrade': {
      const up = UPGRADES[action.up];
      if (row.upgrades.includes(up.id)) return reject('owned', `${up.name} already fitted`);
      if (up.cost > row.coin) return reject('funds', `costs ${up.cost}, you have ${row.coin}`);
      coin = -up.cost;
      upgrades = [...row.upgrades, up.id];
      book.spent += up.cost;
      break;
    }
  }

  book.trades++;
  const markets = delta === null ? markets0 : applyDelta(markets0, delta, now);
  const next: TradeRow = {
    ...row,
    coin: row.coin + coin,
    held,
    upgrades,
    served,
    serveAt,
    last: { town, at: now },
    ids: id === undefined ? row.ids : [...row.ids, id].slice(-RULES.IDS_KEEP),
    book,
  };
  return { ok: true, row: next, markets, delta, coin };
}

/** Move a town's stock (relaxed to `now` first), kept within [0, cap]. */
export function applyDelta(markets: Markets, d: StockDelta, now: number): Markets {
  const live = marketAt(d.town, markets[d.town], now);
  const s = Math.min(stockCap(d.town, d.good), Math.max(0, live.stock[d.good] + d.dq));
  return { ...markets, [d.town]: { ...live, stock: { ...live.stock, [d.good]: s } } };
}

/** The books balance: every coin is accounted for. */
export function audit(row: TradeRow): boolean {
  return row.coin === row.book.granted + row.book.earned - row.book.spent && row.coin >= 0;
}

/** Every town's quotes at `now`. */
export function allQuotes(markets: Markets, now: number) {
  return (Object.keys(markets) as TownId[]).flatMap(t => townQuotes(t, markets[t], now));
}

export { quoteAt };
