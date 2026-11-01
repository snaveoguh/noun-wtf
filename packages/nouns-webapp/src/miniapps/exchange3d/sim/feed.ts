// ── 3D Grand Exchange: what the floor is fed (pure) ──────────────────────
//
// REAL: the Grand Exchange itself (netlify/functions/world-exchange, the
// engine in src/miniapps/exchange/engine). Its GET with `floor=1` adds
// `floor3d` (publicFloor below): the recent fills of every good and the
// resting orders near the touch, with rider ids masked (a rider id is the
// rider's only key, so it never leaves the server; bots keep theirs).
// FeedTracker turns successive frames into new fills, orders and bot lines.
//
// SIMULATED: SimFlow, an ambient crowd on top so the floor is never empty:
// shouts and fills priced off the real tickers (or, before the first poll,
// off the exchange's own fair value: the town quotes its bots trade
// against, with the towns' spread). The view labels it, and backs it off as
// real fills pick up. Real orders and fills always win.

import type {
  BotPublic,
  DealsView,
  ExchangeState,
  FloorEvent,
  GeFill,
  GoodId,
  Ticker,
  YouView,
} from '../../exchange/engine/types';

import { remaining } from '../../exchange/engine/book';
import { fairValue, GOOD_INFO, GOODS as GOOD_IDS, TOWN_SPREAD } from '../../exchange/engine/goods';
import { rngFrom, type Rng } from '../../exchange/engine/rng';

import { hashStr } from './looks';

export interface PublicOrder {
  owner: string;
  side: 'buy' | 'sell';
  good: GoodId;
  /** Units still open. */
  qty: number;
  price: number;
  at: number;
}

export interface Floor3d {
  v: 1;
  now: number;
  fills: GeFill[];
  orders: PublicOrder[];
}

/** Bots, agents and the exchange keep their names; the viewer is 'you'; other riders a tag. */
export function maskOwner(owner: string, viewer: string | null): string {
  if (owner.startsWith('bot:') || owner.startsWith('agent:') || owner === 'gx') return owner;
  if (viewer !== null && owner === viewer) return 'you';
  return `r:${hashStr(`gx3d:${owner}`).toString(36).padStart(7, '0').slice(0, 7)}`;
}

export const FLOOR_FILLS = 80;
export const FLOOR_LEVELS = 5;

/** The floor's public view of the exchange (the server adds this to GET ?floor=1). */
export function publicFloor(s: ExchangeState, viewer: string | null): Floor3d {
  const m = (o: string) => maskOwner(o, viewer);
  const orders: PublicOrder[] = [];
  for (const good of Object.keys(s.books) as GoodId[]) {
    const book = s.books[good];
    for (const [side, list] of [
      ['buy', book.bids],
      ['sell', book.asks],
    ] as const)
      for (const o of list.slice(0, FLOOR_LEVELS))
        orders.push({ owner: m(o.owner), side, good, qty: remaining(o), price: o.price, at: o.at });
  }
  return {
    v: 1,
    now: s.now,
    fills: s.fills.slice(-FLOOR_FILLS).map(f => ({ ...f, buyer: m(f.buyer), seller: m(f.seller) })),
    orders,
  };
}

// ── Client side ──

export type FeedMode = 'live' | 'offline' | 'fallback';

/** One poll of the floor, whatever the source. */
export interface FloorFrame {
  mode: FeedMode;
  now: number;
  tickers: Ticker[];
  fills: GeFill[];
  orders: PublicOrder[];
  floor: FloorEvent[];
  bots: BotPublic[];
  /** Your balances and your direct deals in / out (when the source knows you). */
  you?: YouView | null;
  deals?: DealsView;
}

export const fillKey = (f: GeFill) =>
  `${f.at}|${f.good}|${f.buyer}|${f.seller}|${f.qty}|${f.price}`;
const orderKey = (o: PublicOrder) => `${o.owner}|${o.side}|${o.good}|${o.price}|${o.qty}`;
const sayKey = (e: FloorEvent) => `${e.at}|${e.who}|${e.text}`;

export interface FeedNews {
  fills: GeFill[];
  orders: PublicOrder[];
  says: FloorEvent[];
}

/** On the first frame, replay this much recent history so the floor starts busy. */
export const FIRST_REPLAY_MS = 120_000;
const FIRST_MAX = 14;
const KEEP_KEYS = 1200;

class KeySet {
  private set = new Set<string>();
  private order: string[] = [];
  has(k: string) {
    return this.set.has(k);
  }
  add(k: string) {
    if (this.set.has(k)) return;
    this.set.add(k);
    this.order.push(k);
    if (this.order.length > KEEP_KEYS) this.set.delete(this.order.shift()!);
  }
}

/** Frames in, only what's new out (oldest first). */
export class FeedTracker {
  private fills = new KeySet();
  private orders = new KeySet();
  private says = new KeySet();
  private first = true;

  take(f: FloorFrame): FeedNews {
    const first = this.first;
    this.first = false;
    const fills = [...f.fills]
      .sort((a, b) => a.at - b.at)
      .filter(x => {
        const k = fillKey(x);
        if (this.fills.has(k)) return false;
        this.fills.add(k);
        return !first || f.now - x.at <= FIRST_REPLAY_MS;
      });
    const orders = f.orders.filter(o => {
      const k = orderKey(o);
      if (this.orders.has(k)) return false;
      this.orders.add(k);
      return true;
    });
    const says = [...f.floor]
      .sort((a, b) => a.at - b.at)
      .filter(e => {
        const k = sayKey(e);
        if (this.says.has(k)) return false;
        this.says.add(k);
        return !first || f.now - e.at <= FIRST_REPLAY_MS;
      });
    return {
      fills: first ? fills.slice(-FIRST_MAX) : fills,
      orders,
      says: first ? says.slice(-4) : says,
    };
  }
}

/**
 * Spread a batch of fills over the poll window so a 3 s poll doesn't land
 * as one burst: delays (ms) in order, keeping their relative timing where
 * it fits, at least `minGap` apart.
 */
export function spreadDelays(ats: readonly number[], windowMs: number, minGap = 120): number[] {
  if (ats.length === 0) return [];
  const t0 = ats[0]!;
  const span = Math.max(1, ats[ats.length - 1]! - t0);
  const scale = Math.min(1, (windowMs * 0.9) / span);
  const out: number[] = [];
  let prev = -Infinity;
  for (const a of ats) {
    const d = Math.max((a - t0) * scale, prev + minGap);
    out.push(d);
    prev = d;
  }
  // Too many to fit with minGap: squeeze them all into the window
  const last = out[out.length - 1]!;
  if (last > windowMs) return out.map(d => (d * windowMs * 0.95) / last);
  return out;
}

// ── The simulated crowd's order flow ──

export interface PriceRef {
  bid: number;
  ask: number;
  last: number;
  /** Units traded in the last hour (real), for where the crowd gathers. */
  vol: number;
}

/** Reference prices per good: the real tickers, else the exchange's fair-value model. */
export function refPrices(
  tickers: readonly Ticker[] | null,
  now: number,
): Record<GoodId, PriceRef> {
  const out = {} as Record<GoodId, PriceRef>;
  for (const g of GOOD_IDS) {
    const t = tickers?.find(x => x.good === g);
    const mid = t?.fair ?? fairValue(g, now);
    const mBid = Math.max(1, Math.floor(mid * (1 - TOWN_SPREAD)));
    const mAsk = Math.max(mBid + 1, Math.ceil(mid * (1 + TOWN_SPREAD)));
    const bid = t?.bid ?? null;
    const ask = t?.ask ?? null;
    const last = t?.last ?? null;
    const b = bid ?? (last !== null ? Math.max(1, Math.floor(last * (1 - TOWN_SPREAD))) : mBid);
    const a = ask ?? (last !== null ? Math.max(b + 1, Math.ceil(last * (1 + TOWN_SPREAD))) : mAsk);
    out[g] = {
      bid: b,
      ask: Math.max(a, b + 1),
      last: last ?? Math.round((b + a) / 2),
      vol: t?.vol ?? 0,
    };
  }
  return out;
}

export interface SimShout {
  side: 'buy' | 'sell';
  good: GoodId;
  qty: number;
  price: number;
}
export interface SimFill {
  good: GoodId;
  qty: number;
  price: number;
}

export interface SimFlowOpts {
  seed?: number;
  /** Shouts per second across the floor. */
  shoutsPerSec: number;
  /** Simulated fills per minute when no real ones are happening. */
  fillsPerMin: number;
}

/** A typical order size for a good: cheap goods trade in bigger lots. */
export function lotSize(good: GoodId, r: number): number {
  const max = Math.min(40, Math.max(3, Math.round(160 / GOOD_INFO[good].base)));
  return Math.max(1, Math.round(Math.exp(r * Math.log(max))));
}

export class SimFlow {
  private rng: Rng;
  private shoutAcc = 0;
  private fillAcc = 0;
  constructor(private readonly o: SimFlowOpts) {
    this.rng = rngFrom(o.seed ?? 99);
  }

  private pickGood(refs: Record<GoodId, PriceRef>): GoodId {
    let tot = 0;
    const w = GOOD_IDS.map(g => {
      const v = 1 + Math.sqrt(refs[g].vol);
      tot += v;
      return v;
    });
    let r = this.rng() * tot;
    for (let i = 0; i < GOOD_IDS.length; i++) {
      r -= w[i]!;
      if (r <= 0) return GOOD_IDS[i]!;
    }
    return GOOD_IDS[GOOD_IDS.length - 1]!;
  }

  /**
   * Advance by dt (s). `realPerMin` is how many real fills the floor saw in
   * the last minute: simulated fills back off by that much.
   */
  step(
    dt: number,
    refs: Record<GoodId, PriceRef>,
    realPerMin = 0,
  ): { shouts: SimShout[]; fills: SimFill[] } {
    const shouts: SimShout[] = [];
    const fills: SimFill[] = [];
    if (!(dt > 0)) return { shouts, fills };
    this.shoutAcc += dt * this.o.shoutsPerSec;
    const fpm = Math.max(this.o.fillsPerMin * 0.15, this.o.fillsPerMin - realPerMin);
    this.fillAcc += (dt * fpm) / 60;
    while (this.shoutAcc >= 1) {
      this.shoutAcc -= 1;
      const good = this.pickGood(refs);
      const p = refs[good];
      const side = this.rng() < 0.5 ? 'buy' : 'sell';
      // Bids at or under the best bid, offers at or over the best ask
      const off = Math.floor(this.rng() * 3);
      const price = side === 'buy' ? Math.max(1, p.bid - off) : p.ask + off;
      shouts.push({ side, good, qty: lotSize(good, this.rng()), price });
    }
    while (this.fillAcc >= 1) {
      this.fillAcc -= 1;
      const good = this.pickGood(refs);
      const p = refs[good];
      // Fills print inside the spread, near the last trade
      const lo = Math.min(p.bid, p.last);
      const hi = Math.max(p.ask, p.last);
      const price = Math.min(hi, Math.max(lo, Math.round(p.last + (this.rng() - 0.5) * 2)));
      fills.push({ good, qty: lotSize(good, this.rng()), price });
    }
    return { shouts, fills };
  }
}
