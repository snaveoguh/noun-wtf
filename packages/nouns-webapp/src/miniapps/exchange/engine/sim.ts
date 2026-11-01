// ── Grand Exchange: the sim driver (time, bots, player actions, views) ────
//
// Time is injected: `tick(s, now)` advances the simulated clock from s.now
// to `now` in STEP_MS steps, letting each bot act when its cadence comes
// up. Work per call is bounded (maxSteps): a long gap skips ahead instead
// of replaying hours of bot trading, so the server can tick lazily on each
// request with no cron.

import type { BotAction, BotCtx, BotDef, BookTop, BotTurn } from './bots/types';
import type {
  Account,
  BotPublic,
  ExchangeSnapshot,
  ExchangeState,
  FloorEvent,
  GeFill,
  GoodId,
  Level,
  PlaceResult,
  Side,
  Ticker,
} from './types';

import {
  account,
  cancel,
  createState,
  FEE_BPS,
  KEEP_FLOOR,
  mint,
  ordersOf,
  place,
  placeMarket,
  remaining,
  townTrade,
} from './book';
import { BOT_BY_ID, isBot, ROSTER } from './bots/roster';
import { STRATEGIES } from './bots/strategies';
import {
  fairValue,
  GOODS,
  modelTownFeed,
  TOWN_INFO,
  TOWNS,
  type TownFeed,
  type TownId,
} from './goods';
import { rngFrom, type Rng } from './rng';
import { isAgent } from './shops';

export const STEP_MS = 5_000;
export const MAX_STEPS = 120; // 10 sim-minutes per call
/** Bots never trade further than this from fair value (no walking a thin book). */
export const BOT_BAND = 0.5;
const MIN = 60_000;
const HOUR = 3_600_000;
/** Most actions one bot turn may apply. */
const MAX_TURN_ACTIONS = 30;

export interface SimOpts {
  roster?: readonly BotDef[];
  feed?: TownFeed;
}

export function pushFloor(s: ExchangeState, e: FloorEvent) {
  s.floor.push(e);
  if (s.floor.length > KEEP_FLOOR) s.floor.splice(0, s.floor.length - KEEP_FLOOR);
}

/** Mint each roster bot its genesis budget (once). */
export function ensureBots(s: ExchangeState, roster: readonly BotDef[] = ROSTER) {
  for (const b of roster) {
    if (b.id in s.bots) continue;
    mint(s, b.id, b.budget.coin, b.budget.goods);
    s.bots[b.id] = { next: s.now, townUsed: 0, townHour: Math.floor(s.now / HOUR), k: {} };
  }
}

function top(s: ExchangeState, g: GoodId): BookTop {
  const { bids, asks } = s.books[g];
  const fair = fairValue(g, s.now);
  let bidDepth = 0;
  let askDepth = 0;
  for (const o of bids) if (o.price >= fair * 0.7) bidDepth += remaining(o);
  for (const o of asks) if (o.price <= fair * 1.3) askDepth += remaining(o);
  const bid = bids[0]?.price ?? null;
  const ask = asks[0]?.price ?? null;
  let bidQty = 0;
  let askQty = 0;
  for (const o of bids) if (o.price === bid) bidQty += remaining(o);
  for (const o of asks) if (o.price === ask) askQty += remaining(o);
  return { bid, ask, bidQty, askQty, bidDepth, askDepth };
}

function closes(s: ExchangeState, g: GoodId, n: number, now: number): number[] {
  const m = s.candles[g].m;
  const from = Math.floor(now / MIN) * MIN - (n - 1) * MIN;
  return m.filter(c => c.t >= from).map(c => c.c);
}

function ctxFor(s: ExchangeState, def: BotDef, rng: Rng, feed: TownFeed): BotCtx {
  const mem = s.bots[def.id];
  const hour = Math.floor(s.now / HOUR);
  if (mem.townHour !== hour) {
    mem.townHour = hour;
    mem.townUsed = 0;
  }
  return {
    def,
    now: s.now,
    rng,
    me: account(s, def.id),
    mine: ordersOf(s, def.id),
    mem,
    fair: g => fairValue(g, s.now),
    top: g => top(s, g),
    last: g => s.last[g] ?? null,
    closes: (g, n) => closes(s, g, n, s.now),
    towns: g =>
      TOWNS.map((t: TownId) => {
        const q = feed.quote(t, g, s.now);
        return { town: t, name: TOWN_INFO[t].name, ask: q.ask, bid: q.bid };
      }),
    townLeft: Math.max(0, (def.townCap ?? 0) - mem.townUsed),
  };
}

/** Apply one bot turn through the engine, clamped. Returns fills made. */
export function applyTurn(
  s: ExchangeState,
  def: BotDef,
  turn: BotTurn,
  feed: TownFeed = modelTownFeed,
): GeFill[] {
  const fills: GeFill[] = [];
  const mem = s.bots[def.id];
  let n = 0;
  for (const a of turn.actions as BotAction[]) {
    if (++n > MAX_TURN_ACTIONS) break;
    if (a.t === 'cancel') {
      cancel(s, def.id, a.id);
    } else if (a.t === 'mem') {
      if (Number.isFinite(a.v)) mem.k[a.k] = a.v;
    } else if (a.t === 'place') {
      const fair = fairValue(a.good, s.now);
      const lo = Math.max(1, Math.floor(fair * (1 - BOT_BAND)));
      const hi = Math.ceil(fair * (1 + BOT_BAND));
      const price = Math.min(hi, Math.max(lo, Math.round(a.price)));
      const qty = Math.min(def.maxQty, Math.floor(a.qty));
      if (!(qty > 0)) continue;
      const r = place(s, {
        owner: def.id,
        side: a.side,
        good: a.good,
        qty,
        price,
        tif: a.ioc === true ? 'ioc' : 'gtc',
      });
      fills.push(...r.fills);
    } else if (a.t === 'town') {
      const left = Math.max(0, (def.townCap ?? 0) - mem.townUsed);
      const have = account(s, def.id).goods[a.good] ?? 0;
      const q = feed.quote(a.town, a.good, s.now);
      const px = a.side === 'buy' ? q.ask : q.bid;
      const cap = a.side === 'buy' ? Math.floor(account(s, def.id).coin / px) : have;
      const qty = Math.min(Math.floor(a.qty), left, cap, def.maxQty);
      if (qty > 0 && townTrade(s, def.id, a.side, a.good, qty, px)) mem.townUsed += qty;
    }
  }
  return fills;
}

/** COIN the treasury hands a broke bot, at most once per BAIL_EVERY. */
export const BAIL_COIN = 150;
const BAIL_EVERY = 2 * HOUR;

/**
 * A bot that has blown its COIN gets a small top-up from the fee treasury
 * (a transfer, never a mint), so the floor stays alive without printing.
 */
function bailout(s: ExchangeState, def: BotDef) {
  const a = account(s, def.id);
  const mem = s.bots[def.id];
  if (a.coin + a.lockCoin >= def.budget.coin * 0.1) return;
  if (s.now - (mem.k.bail ?? -Infinity) < BAIL_EVERY) return;
  const amt = Math.min(BAIL_COIN, s.treasury);
  if (amt < 10) return;
  s.treasury -= amt;
  a.coin += amt;
  mem.k.bail = s.now;
  pushFloor(s, {
    at: s.now,
    who: 'gx',
    text: `Treasury bails ${def.name} out with ${amt} COIN. Moral hazard.`,
  });
}

/** Advance the sim to `now`. Bounded: at most maxSteps steps of STEP_MS. */
export function tick(
  s: ExchangeState,
  now: number,
  opts: SimOpts & { maxSteps?: number } = {},
): { steps: number; skipped: number } {
  const roster = opts.roster ?? ROSTER;
  const feed = opts.feed ?? modelTownFeed;
  const max = opts.maxSteps ?? MAX_STEPS;
  if (!(now > s.now)) return { steps: 0, skipped: 0 };
  ensureBots(s, roster);
  let skipped = 0;
  let steps = Math.ceil((now - s.now) / STEP_MS);
  if (steps > max) {
    skipped = now - max * STEP_MS - s.now;
    s.now = now - max * STEP_MS;
    steps = max;
    // Sleeping bots wake up into the present, not into the gap
    for (const b of roster) s.bots[b.id].next = Math.min(s.bots[b.id].next, s.now);
  }
  const rng = rngFrom(s.rng);
  for (let i = 0; i < steps; i++) {
    s.now = Math.min(now, s.now + STEP_MS);
    for (const def of roster) {
      const mem = s.bots[def.id];
      if (s.now < mem.next) continue;
      mem.next = s.now + def.cadence * (0.5 + rng());
      bailout(s, def);
      const turn = STRATEGIES[def.style](ctxFor(s, def, rng, feed));
      applyTurn(s, def, turn, feed);
      if (turn.say) pushFloor(s, { at: s.now, who: def.id, good: turn.good, text: turn.say });
    }
  }
  s.rng = rng.state();
  return { steps, skipped };
}

/** A fresh exchange with bots funded and `warmMs` of trading history. */
export function genesis(seed: number, now: number, warmMs = 3 * HOUR, opts: SimOpts = {}) {
  const s = createState(seed, now - warmMs);
  ensureBots(s, opts.roster ?? ROSTER);
  while (s.now < now)
    tick(s, Math.min(now, s.now + MAX_STEPS * STEP_MS), { ...opts, maxSteps: MAX_STEPS });
  pushFloor(s, { at: now, who: 'gx', text: 'The Grand Exchange is open. Bots are on the floor.' });
  return s;
}

// ── Player actions ──

export const STARTER_COIN = 500;

/** A rider's account, with the starter grant on first sight (once, ever). */
export function riderAccount(s: ExchangeState, owner: string, now = s.now): Account {
  if (owner in s.accounts) return s.accounts[owner];
  mint(s, owner, STARTER_COIN);
  const a = account(s, owner, now);
  a.first = now;
  a.last = now;
  return a;
}

export type ExchangeAction =
  | {
      t: 'order';
      side: Side;
      good: GoodId;
      qty: number;
      /** Limit price; ignored for market orders. */
      price: number;
      kind?: 'limit' | 'market';
    }
  | { t: 'cancel'; order: string };

export interface ActResult {
  ok: boolean;
  reason?: string;
  fills: GeFill[];
  order?: PlaceResult['order'];
}

export function playerAct(
  s: ExchangeState,
  owner: string,
  a: ExchangeAction,
  now = s.now,
): ActResult {
  if (isBot(owner) || isAgent(owner)) return { ok: false, reason: 'reserved', fills: [] };
  riderAccount(s, owner, now);
  if (a.t === 'cancel') {
    const r = cancel(s, owner, String(a.order));
    return { ok: r.ok, reason: r.reason, fills: [] };
  }
  if (a.t !== 'order') return { ok: false, reason: 'unknown action', fills: [] };
  const r =
    a.kind === 'market'
      ? placeMarket(s, { owner, side: a.side, good: a.good, qty: a.qty }, now)
      : place(
          s,
          { owner, side: a.side, good: a.good, qty: a.qty, price: a.price, tif: 'gtc' },
          now,
        );
  if (r.fills.length > 0) {
    const q = r.fills.reduce((x, f) => x + f.qty, 0);
    const avg = r.fills.reduce((x, f) => x + f.qty * f.price, 0) / q;
    const from = [...new Set(r.fills.map(f => (a.side === 'buy' ? f.seller : f.buyer)))];
    pushFloor(s, {
      at: now,
      who: owner,
      good: a.good,
      text: `${a.side === 'buy' ? 'bought' : 'sold'} ${q} ${a.good} @ ${Math.round(avg * 10) / 10}${
        from.every(isBot) ? ` from ${from.map(f => BOT_BY_ID[f]?.name ?? f).join(', ')}` : ''
      }`,
    });
  }
  return { ok: r.ok, reason: r.reason, fills: r.fills, order: r.order };
}

// ── Views ──

function levels(list: ExchangeState['books'][GoodId]['bids'], owner: string | null, n: number) {
  const out: Level[] = [];
  for (const o of list) {
    const left = remaining(o);
    let l = out[out.length - 1] as Level | undefined;
    if (l === undefined || l.price !== o.price) {
      if (out.length >= n) break;
      l = { price: o.price, qty: 0, n: 0 };
      out.push(l);
    }
    l.qty += left;
    l.n++;
    if (owner && o.owner === owner) l.mine = (l.mine ?? 0) + left;
  }
  return out;
}

function equity(s: ExchangeState, a: Account) {
  let e = a.coin + a.lockCoin;
  for (const g of GOODS) e += ((a.goods[g] ?? 0) + (a.lockGoods[g] ?? 0)) * fairValue(g, s.now);
  return Math.round(e);
}

export function tickers(s: ExchangeState): Ticker[] {
  return GOODS.map(g => {
    const m = s.candles[g].m;
    const ago = s.now - HOUR;
    let ref: number | null = null;
    let vol = 0;
    for (const c of m) {
      if (c.t < ago) ref = c.c;
      else {
        if (ref === null) ref = c.o;
        vol += c.v;
      }
    }
    const last = s.last[g] ?? null;
    return {
      good: g,
      last,
      bid: s.books[g].bids[0]?.price ?? null,
      ask: s.books[g].asks[0]?.price ?? null,
      chg: last !== null && ref !== null && ref > 0 ? last / ref - 1 : null,
      vol,
      fair: Math.round(fairValue(g, s.now) * 10) / 10,
    };
  });
}

export function botsPublic(s: ExchangeState, roster: readonly BotDef[] = ROSTER): BotPublic[] {
  return roster.map(b => {
    const a = s.accounts[b.id] as Account | undefined;
    const eq = a !== undefined ? equity(s, a) : 0;
    let start = b.budget.coin;
    for (const g of GOODS) start += (b.budget.goods[g] ?? 0) * fairValue(g, s.now);
    return {
      id: b.id,
      name: b.name,
      noun: b.noun,
      seed: b.seed,
      style: b.style,
      blurb: b.blurb,
      coin: a?.coin ?? 0,
      equity: eq,
      pnl: Math.round(eq - start),
    };
  });
}

export function snapshot(
  s: ExchangeState,
  q: { good: GoodId; tf?: 'm' | 'h'; owner?: string | null; depth?: number },
): ExchangeSnapshot {
  const tf = q.tf ?? 'm';
  const owner = q.owner ?? null;
  const a = owner ? s.accounts[owner] : undefined;
  const n = q.depth ?? 14;
  return {
    now: s.now,
    good: q.good,
    tf,
    feeBps: FEE_BPS,
    tickers: tickers(s),
    depth: {
      bids: levels(s.books[q.good].bids, owner, n),
      asks: levels(s.books[q.good].asks, owner, n),
    },
    candles: (tf === 'm' ? s.candles[q.good].m.slice(-90) : s.candles[q.good].h.slice(-48)).map(
      c => ({ ...c }),
    ),
    tape: s.fills
      .filter(f => f.good === q.good)
      .slice(-30)
      .reverse(),
    floor: s.floor.slice(-40).reverse(),
    bots: botsPublic(s),
    treasury: s.treasury,
    you:
      owner && a
        ? {
            owner,
            coin: a.coin,
            lockCoin: a.lockCoin,
            goods: { ...a.goods },
            lockGoods: { ...a.lockGoods },
            orders: ordersOf(s, owner).map(o => ({ ...o })),
            fills: s.fills
              .filter(f => f.buyer === owner || f.seller === owner)
              .slice(-20)
              .reverse(),
            equity: equity(s, a),
          }
        : null,
  };
}
