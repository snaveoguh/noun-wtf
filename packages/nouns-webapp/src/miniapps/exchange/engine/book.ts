// ── Grand Exchange: the order book and ledger (pure) ─────────────────────
//
// Price-time priority limit order books, one per good. Orders escrow what
// they could spend: a buy locks qty * limit COIN, a sell locks qty goods.
// Fills happen at the resting (maker) order's price; a taker buy that fills
// below its limit gets the difference back. The seller pays the fee
// (FEE_BPS of the notional, floored) to the treasury counter.
//
// Self-trade prevention: an incoming order that would cross its own owner's
// resting order cancels that resting order (escrow released) and carries on.
//
// Every function mutates the ExchangeState it is given (the server reads a
// fresh copy per attempt; tests clone). No clock, no DOM, no randomness.

import type {
  Account,
  Book,
  Candle,
  ExchangeState,
  GeFill,
  GeOrder,
  GoodId,
  Goods,
  PlaceInput,
  PlaceResult,
  Side,
} from './types';

import { GOODS, isGood } from './goods';

export const FEE_BPS = 100; // 1%, paid by the seller
export const MAX_QTY = 10_000;
export const MAX_PRICE = 1_000_000;
/** Open orders per owner (players and bots alike). */
export const MAX_OPEN = 12;
/** Bots quote several goods at once. */
export const MAX_OPEN_BOT = 16;
/** Resting orders per book side; past this the worst-priced one is evicted. */
export const MAX_SIDE = 80;
export const KEEP_FILLS = 400;
export const KEEP_FLOOR = 80;
export const KEEP_MIN_CANDLES = 240;
export const KEEP_HOUR_CANDLES = 96;

const MIN = 60_000;
const HOUR = 3_600_000;

export function emptyBooks(): Record<GoodId, Book> {
  const out = {} as Record<GoodId, Book>;
  for (const g of GOODS) out[g] = { bids: [], asks: [] };
  return out;
}

export function createState(seed: number, now: number): ExchangeState {
  const candles = {} as ExchangeState['candles'];
  for (const g of GOODS) candles[g] = { m: [], h: [] };
  return {
    v: 1,
    now,
    seq: 0,
    rng: seed >>> 0,
    books: emptyBooks(),
    accounts: {},
    treasury: 0,
    minted: 0,
    mintedGoods: {},
    ext: { coin: 0, goods: {} },
    last: {},
    candles,
    fills: [],
    floor: [],
    bots: {},
  };
}

const add = (m: Goods, g: GoodId, n: number) => {
  const v = (m[g] ?? 0) + n;
  if (v === 0) delete m[g];
  else m[g] = v;
};

export function account(s: ExchangeState, owner: string, now = s.now): Account {
  let a = s.accounts[owner] as Account | undefined;
  if (a === undefined) {
    a = { owner, coin: 0, lockCoin: 0, goods: {}, lockGoods: {}, grant: 0, first: now, last: now };
    s.accounts[owner] = a;
  }
  return a;
}

/** Create COIN / goods out of thin air, on the books (`minted`). */
export function mint(s: ExchangeState, owner: string, coin: number, goods: Goods = {}) {
  const a = account(s, owner);
  a.coin += coin;
  a.grant += coin;
  s.minted += coin;
  for (const g of Object.keys(goods) as GoodId[]) {
    const n = goods[g] ?? 0;
    if (n <= 0) continue;
    add(a.goods, g, n);
    add(s.mintedGoods, g, n);
  }
  return a;
}

/** Town leg: an account trades with a town outside the book (counted in `ext`). */
export function townTrade(
  s: ExchangeState,
  owner: string,
  side: Side,
  good: GoodId,
  qty: number,
  price: number,
): boolean {
  const a = account(s, owner);
  const cost = qty * price;
  if (!(qty > 0) || !(price > 0)) return false;
  if (side === 'buy') {
    if (a.coin < cost) return false;
    a.coin -= cost;
    add(a.goods, good, qty);
    s.ext.coin += cost;
    add(s.ext.goods, good, qty);
  } else {
    if ((a.goods[good] ?? 0) < qty) return false;
    add(a.goods, good, -qty);
    a.coin += cost;
    s.ext.coin -= cost;
    add(s.ext.goods, good, -qty);
  }
  return true;
}

export const feeOf = (notional: number) => Math.floor((notional * FEE_BPS) / 10_000);

const openCount = (s: ExchangeState, owner: string) => {
  let n = 0;
  for (const g of GOODS) {
    for (const o of s.books[g].bids) if (o.owner === owner) n++;
    for (const o of s.books[g].asks) if (o.owner === owner) n++;
  }
  return n;
};

export const remaining = (o: GeOrder) => o.qty - o.filled;

/** Insert keeping price-time priority (equal prices: after existing ones). */
function insert(book: Book, o: GeOrder) {
  const list = o.side === 'buy' ? book.bids : book.asks;
  const better = (x: GeOrder) => (o.side === 'buy' ? x.price >= o.price : x.price <= o.price);
  let i = 0;
  while (i < list.length && better(list[i])) i++;
  list.splice(i, 0, o);
}

/** Release a resting order's escrow and remove it from its book. */
function unrest(s: ExchangeState, o: GeOrder) {
  const book = s.books[o.good];
  const list = o.side === 'buy' ? book.bids : book.asks;
  const i = list.indexOf(o);
  if (i >= 0) list.splice(i, 1);
  const a = account(s, o.owner);
  const left = remaining(o);
  if (o.side === 'buy') {
    a.lockCoin -= left * o.price;
    a.coin += left * o.price;
  } else {
    add(a.lockGoods, o.good, -left);
    add(a.goods, o.good, left);
  }
}

function bump(list: Candle[], t: number, price: number, qty: number, keep: number) {
  const c = list[list.length - 1] as Candle | undefined;
  if (c !== undefined && c.t === t) {
    c.h = Math.max(c.h, price);
    c.l = Math.min(c.l, price);
    c.c = price;
    c.v += qty;
    return;
  }
  if (c !== undefined && c.t > t) return; // never rewrite history
  list.push({ t, o: price, h: price, l: price, c: price, v: qty });
  if (list.length > keep) list.splice(0, list.length - keep);
}

function record(s: ExchangeState, f: GeFill) {
  s.fills.push(f);
  if (s.fills.length > KEEP_FILLS) s.fills.splice(0, s.fills.length - KEEP_FILLS);
  s.last[f.good] = f.price;
  const c = s.candles[f.good];
  bump(c.m, Math.floor(f.at / MIN) * MIN, f.price, f.qty, KEEP_MIN_CANDLES);
  bump(c.h, Math.floor(f.at / HOUR) * HOUR, f.price, f.qty, KEEP_HOUR_CANDLES);
}

/** Validate an order's shape (not funds). */
export function validate(p: PlaceInput): string | null {
  if (!isGood(p.good)) return 'unknown good';
  if (p.side !== 'buy' && p.side !== 'sell') return 'bad side';
  if (!Number.isInteger(p.qty) || p.qty < 1 || p.qty > MAX_QTY) return `qty must be 1–${MAX_QTY}`;
  if (!Number.isInteger(p.price) || p.price < 1 || p.price > MAX_PRICE)
    return `price must be 1–${MAX_PRICE}`;
  if (typeof p.owner !== 'string' || !p.owner) return 'no owner';
  return null;
}

/** Place a limit order (gtc rests, ioc doesn't). */
export function place(s: ExchangeState, p: PlaceInput, now = s.now): PlaceResult {
  const bad = validate(p);
  if (bad) return { ok: false, reason: bad, fills: [] };
  const tif = p.tif ?? 'gtc';
  const a = account(s, p.owner, now);
  if (p.side === 'buy') {
    if (a.coin < p.qty * p.price) return { ok: false, reason: 'not enough COIN', fills: [] };
  } else if ((a.goods[p.good] ?? 0) < p.qty) {
    return { ok: false, reason: `not enough ${p.good}`, fills: [] };
  }
  const cap = p.owner.startsWith('bot:') ? MAX_OPEN_BOT : MAX_OPEN;
  if (tif === 'gtc' && openCount(s, p.owner) >= cap) {
    return { ok: false, reason: `max ${cap} open orders`, fills: [] };
  }
  // Escrow the whole order up front
  if (p.side === 'buy') {
    a.coin -= p.qty * p.price;
    a.lockCoin += p.qty * p.price;
  } else {
    add(a.goods, p.good, -p.qty);
    add(a.lockGoods, p.good, p.qty);
  }
  a.last = now;
  const o: GeOrder = {
    id: `o${++s.seq}`,
    owner: p.owner,
    side: p.side,
    good: p.good,
    qty: p.qty,
    filled: 0,
    price: p.price,
    at: now,
  };
  const book = s.books[p.good];
  const opp = p.side === 'buy' ? book.asks : book.bids;
  const fills: GeFill[] = [];
  while (remaining(o) > 0 && opp.length > 0) {
    const m = opp[0];
    const crosses = p.side === 'buy' ? m.price <= o.price : m.price >= o.price;
    if (!crosses) break;
    if (m.owner === o.owner) {
      unrest(s, m); // self-trade prevention: cancel the resting one
      continue;
    }
    const q = Math.min(remaining(o), remaining(m));
    const px = m.price;
    const buy = p.side === 'buy' ? o : m;
    const sell = p.side === 'buy' ? m : o;
    const ba = account(s, buy.owner);
    const sa = account(s, sell.owner);
    // Buyer: release escrow at its limit, pay at px, refund the difference
    ba.lockCoin -= q * buy.price;
    ba.coin += q * (buy.price - px);
    add(ba.goods, p.good, q);
    // Seller: escrowed goods go to the buyer, proceeds less fee
    add(sa.lockGoods, p.good, -q);
    const notional = q * px;
    const fee = feeOf(notional);
    sa.coin += notional - fee;
    s.treasury += fee;
    o.filled += q;
    m.filled += q;
    if (remaining(m) === 0) opp.shift();
    const f: GeFill = {
      good: p.good,
      qty: q,
      price: px,
      buyer: buy.owner,
      seller: sell.owner,
      at: now,
    };
    fills.push(f);
    record(s, f);
  }
  let cancelled = 0;
  if (remaining(o) > 0) {
    if (tif === 'ioc') {
      cancelled = remaining(o);
      // Not on the book: release what's left directly
      if (o.side === 'buy') {
        a.lockCoin -= cancelled * o.price;
        a.coin += cancelled * o.price;
      } else {
        add(a.lockGoods, o.good, -cancelled);
        add(a.goods, o.good, cancelled);
      }
      o.qty = o.filled; // what it became
    } else {
      const side = o.side === 'buy' ? book.bids : book.asks;
      if (side.length >= MAX_SIDE) {
        const worst = side[side.length - 1];
        const better = o.side === 'buy' ? o.price > worst.price : o.price < worst.price;
        if (!better) {
          // Book full and this isn't better than the worst: give it back
          cancelled = remaining(o);
          if (o.side === 'buy') {
            a.lockCoin -= cancelled * o.price;
            a.coin += cancelled * o.price;
          } else {
            add(a.lockGoods, o.good, -cancelled);
            add(a.goods, o.good, cancelled);
          }
          o.qty = o.filled;
          return {
            ok: fills.length > 0,
            reason: 'book full at that price',
            order: o,
            fills,
            cancelled,
          };
        }
        unrest(s, worst);
      }
      insert(book, o);
    }
  }
  return { ok: true, order: o, fills, cancelled };
}

/**
 * The limit price a market order needs to fill `qty` (the worst level it
 * would touch), and for buys the qty it can afford at those levels.
 */
export function marketTerms(
  s: ExchangeState,
  owner: string,
  side: Side,
  good: GoodId,
  qty: number,
): { qty: number; price: number } | null {
  const book = s.books[good];
  const opp = side === 'buy' ? book.asks : book.bids;
  const a = s.accounts[owner];
  let left = side === 'sell' ? Math.min(qty, a?.goods[good] ?? 0) : qty;
  let got = 0;
  let worst = 0;
  const coin = a?.coin ?? 0;
  for (const o of opp) {
    if (o.owner === owner) continue;
    if (left <= 0) break;
    let q = Math.min(left, remaining(o));
    if (side === 'buy') {
      // Escrow is (total qty) * (worst price), so stop where that stops being affordable
      q = Math.min(q, Math.floor(coin / o.price) - got);
      if (q <= 0) break;
    }
    worst = o.price;
    got += q;
    left -= q;
  }
  if (got <= 0) return null;
  return { qty: got, price: worst };
}

/** Market order = ioc limit at the worst level needed. */
export function placeMarket(
  s: ExchangeState,
  p: Omit<PlaceInput, 'price' | 'tif'>,
  now = s.now,
): PlaceResult {
  if (!isGood(p.good)) return { ok: false, reason: 'unknown good', fills: [] };
  if (!Number.isInteger(p.qty) || p.qty < 1 || p.qty > MAX_QTY)
    return { ok: false, reason: `qty must be 1–${MAX_QTY}`, fills: [] };
  const t = marketTerms(s, p.owner, p.side, p.good, p.qty);
  if (!t) {
    return {
      ok: false,
      reason: p.side === 'buy' ? 'no offers you can afford' : 'no bids',
      fills: [],
    };
  }
  return place(s, { ...p, qty: t.qty, price: t.price, tif: 'ioc' }, now);
}

export function findOrder(s: ExchangeState, id: string): GeOrder | null {
  for (const g of GOODS) {
    const b = s.books[g];
    const o = b.bids.find(x => x.id === id) ?? b.asks.find(x => x.id === id);
    if (o) return o;
  }
  return null;
}

export function cancel(
  s: ExchangeState,
  owner: string,
  id: string,
): { ok: boolean; reason?: string; order?: GeOrder } {
  const o = findOrder(s, id);
  if (!o) return { ok: false, reason: 'no such open order' };
  if (o.owner !== owner) return { ok: false, reason: 'not your order' };
  unrest(s, o);
  return { ok: true, order: o };
}

export function ordersOf(s: ExchangeState, owner: string): GeOrder[] {
  const out: GeOrder[] = [];
  for (const g of GOODS) {
    for (const o of s.books[g].bids) if (o.owner === owner) out.push(o);
    for (const o of s.books[g].asks) if (o.owner === owner) out.push(o);
  }
  return out.sort((x, y) => Number(x.id.slice(1)) - Number(y.id.slice(1)));
}

export const bestBid = (s: ExchangeState, g: GoodId) => s.books[g].bids[0]?.price ?? null;
export const bestAsk = (s: ExchangeState, g: GoodId) => s.books[g].asks[0]?.price ?? null;

/**
 * Every invariant the ledger promises. Empty = healthy.
 * - balances and escrow are non-negative integers;
 * - each account's escrow equals what its open orders hold;
 * - books are sorted by price-time priority and never crossed;
 * - COIN: accounts + treasury + paid-out-to-towns = minted;
 * - goods: accounts = minted + bought-in-from-towns.
 */
export function checkInvariants(s: ExchangeState): string[] {
  const errs: string[] = [];
  const lockC: Record<string, number> = {};
  const lockG: Record<string, Goods> = {};
  for (const g of GOODS) {
    const { bids, asks } = s.books[g];
    for (let i = 0; i < bids.length; i++) {
      const o = bids[i];
      if (o.side !== 'buy' || o.good !== g) errs.push(`${o.id} on wrong side/book`);
      if (!(remaining(o) > 0)) errs.push(`${o.id} resting with nothing left`);
      lockC[o.owner] = (lockC[o.owner] ?? 0) + remaining(o) * o.price;
      const p = bids[i - 1] as GeOrder | undefined;
      if (p !== undefined && (p.price < o.price || (p.price === o.price && seqOf(p) > seqOf(o))))
        errs.push(`${g} bids out of order at ${o.id}`);
    }
    for (let i = 0; i < asks.length; i++) {
      const o = asks[i];
      if (o.side !== 'sell' || o.good !== g) errs.push(`${o.id} on wrong side/book`);
      if (!(remaining(o) > 0)) errs.push(`${o.id} resting with nothing left`);
      ((lockG[o.owner] ??= {}) as Goods)[g] = (lockG[o.owner][g] ?? 0) + remaining(o);
      const p = asks[i - 1] as GeOrder | undefined;
      if (p !== undefined && (p.price > o.price || (p.price === o.price && seqOf(p) > seqOf(o))))
        errs.push(`${g} asks out of order at ${o.id}`);
    }
    if (bids.length > 0 && asks.length > 0 && bids[0].price >= asks[0].price)
      errs.push(`${g} book crossed`);
    if (bids.length > MAX_SIDE || asks.length > MAX_SIDE) errs.push(`${g} side over cap`);
  }
  let coin = s.treasury + s.ext.coin;
  const goods: Goods = {};
  const int = (v: number) => Number.isInteger(v) && v >= 0;
  for (const a of Object.values(s.accounts)) {
    if (!int(a.coin) || !int(a.lockCoin)) errs.push(`${a.owner} coin ${a.coin}/${a.lockCoin}`);
    if (a.lockCoin !== (lockC[a.owner] ?? 0))
      errs.push(`${a.owner} lockCoin ${a.lockCoin} != orders ${lockC[a.owner] ?? 0}`);
    coin += a.coin + a.lockCoin;
    for (const g of GOODS) {
      const free = a.goods[g] ?? 0;
      const lk = a.lockGoods[g] ?? 0;
      if (!int(free) || !int(lk)) errs.push(`${a.owner} ${g} ${free}/${lk}`);
      if (lk !== (lockG[a.owner]?.[g] ?? 0))
        errs.push(`${a.owner} lock ${g} ${lk} != orders ${lockG[a.owner]?.[g] ?? 0}`);
      goods[g] = (goods[g] ?? 0) + free + lk;
    }
  }
  if (coin !== s.minted) errs.push(`COIN not conserved: ${coin} vs minted ${s.minted}`);
  for (const g of GOODS) {
    const want = (s.mintedGoods[g] ?? 0) + (s.ext.goods[g] ?? 0);
    if ((goods[g] ?? 0) !== want) errs.push(`${g} not conserved: ${goods[g] ?? 0} vs ${want}`);
  }
  if (!int(s.treasury)) errs.push(`treasury ${s.treasury}`);
  return errs;
}

const seqOf = (o: GeOrder) => Number(o.id.slice(1));
