// ── Grand Exchange: engine types ─────────────────────────────────────────
//
// The exchange is a closed, in-game ledger: every COIN and every unit of a
// good is accounted for. COIN enters only through `mint` (a rider's starter
// grant, a bot's genesis budget) and through the arbitrageur's town leg;
// goods enter through genesis inventories and the town leg. Nothing else
// creates or destroys either. Fees move COIN to the treasury counter (they
// are not burned), so `checkInvariants` can prove conservation exactly.
//
// All state is plain JSON so the server can keep it in one Netlify Blob and
// the browser (`?offline=1`) can run the same engine in memory.
//
// ── On-chain bridge (later, not built) ──
// Goods are token-shaped (GoodId = an uppercase symbol, integer units, 0
// decimals) so each could map 1:1 to an ERC-20 on Base, and COIN to one
// more. A bridge would need: (1) a custody contract per token holding the
// on-chain supply that backs in-game balances; (2) deposit = a signed
// transfer into custody, credited here via `mint` with the tx hash as an
// idempotency key; (3) withdraw = debit here first (free balance only,
// never escrow), then a server-signed voucher the rider redeems on-chain;
// (4) `minted` / `ext` below become the reconciliation counters against
// custody balances; (5) wallet-linked identities (see world-stats' signed
// `link`) instead of anonymous browser rider ids. Until then COIN is
// in-game only and has no cash value.

import type { GeFill, GeOrder, GoodId } from '../../world2/trade/contract';

export type { GeFill, GeOrder, GoodId };

export type Side = 'buy' | 'sell';
/** gtc = rests on the book; ioc = fills what it can now, the rest is cancelled. */
export type Tif = 'gtc' | 'ioc';

export type Goods = Partial<Record<GoodId, number>>;

export interface Account {
  owner: string;
  /** Free COIN (spendable). */
  coin: number;
  /** COIN escrowed by open buy orders. */
  lockCoin: number;
  /** Free goods. */
  goods: Goods;
  /** Goods escrowed by open sell orders. */
  lockGoods: Goods;
  /** Everything ever minted to this account (starter grant, bot budget). */
  grant: number;
  /** Rate limit window (server). */
  rl?: { t: number; n: number };
  /** First / last activity (ms). */
  first: number;
  last: number;
}

export interface Candle {
  /** Bucket start (ms). */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** Units traded. */
  v: number;
}

export interface Book {
  /** Best first: price desc, then time (id seq) asc. */
  bids: GeOrder[];
  /** Best first: price asc, then time asc. */
  asks: GeOrder[];
}

/** A line on the trading floor feed. */
export interface FloorEvent {
  at: number;
  /** 'bot:abacus', a rider id, or 'gx' for exchange news. */
  who: string;
  good?: GoodId;
  text: string;
}

export interface ExchangeState {
  v: 1;
  /** Simulated clock: the last time bots were ticked to (ms). */
  now: number;
  /** Order / event id counter. */
  seq: number;
  /** RNG state (mulberry32), so a reload replays identically. */
  rng: number;
  books: Record<GoodId, Book>;
  accounts: Record<string, Account>;
  /** Fees collected (COIN). */
  treasury: number;
  /** Total COIN minted into accounts (starter grants + bot budgets). */
  minted: number;
  /** Total goods minted (bot genesis inventories). */
  mintedGoods: Goods;
  /**
   * Flows to/from the town markets outside the exchange (the arbitrageur's
   * town leg). coin > 0 = COIN paid out to towns; goods > 0 = goods bought
   * in from towns. Integration point: the trade/ economy settles these.
   */
  ext: { coin: number; goods: Goods };
  last: Partial<Record<GoodId, number>>;
  candles: Record<GoodId, { m: Candle[]; h: Candle[] }>;
  /** Recent fills, all goods, newest last. */
  fills: GeFill[];
  floor: FloorEvent[];
  /** Per-bot memory (cooldowns, town-leg budget). */
  bots: Record<string, BotMemory>;
  /**
   * Direct offers between two traders (deals.ts): "I'll sell you 3 FISH at
   * 12". Nothing is escrowed; both sides are checked when it's accepted.
   * Optional: blobs saved before deals existed don't have it.
   */
  deals?: Deal[];
}

/** A direct offer (server side: `from` is the proposer's raw rider id). */
export interface Deal {
  id: string;
  from: string;
  /** The proposer's public tag (what the target sees). */
  fromTag: string;
  /** The target: a rider's public tag ('r:…') or a bot id ('bot:…'). */
  to: string;
  /** What the proposer does: 'sell' = sells to the target. */
  side: Side;
  good: GoodId;
  qty: number;
  price: number;
  at: number;
}

/** A deal as one of its two sides sees it (never a raw rider id). */
export interface PublicDeal {
  id: string;
  /** incoming: the proposer's tag; outgoing: the target's tag / bot id. */
  who: string;
  side: Side;
  good: GoodId;
  qty: number;
  price: number;
  at: number;
  /** Expires at (ms). */
  exp: number;
}

export interface DealsView {
  incoming: PublicDeal[];
  outgoing: PublicDeal[];
}

export interface BotMemory {
  /** Next sim time this bot may act. */
  next: number;
  /** Town-leg units used in the current hour window. */
  townUsed: number;
  townHour: number;
  /** Free-form per-strategy scratch (numbers only, keeps it JSON). */
  k: Record<string, number>;
}

export interface PlaceInput {
  owner: string;
  side: Side;
  good: GoodId;
  qty: number;
  price: number;
  tif?: Tif;
}

export interface PlaceResult {
  ok: boolean;
  reason?: string;
  /** The order as placed (resting remainder if gtc; filled/cancelled if ioc). */
  order?: GeOrder;
  fills: GeFill[];
  /** Units not filled and not resting (ioc remainder, or nothing). */
  cancelled?: number;
}

/** Aggregated price level for the ladder. */
export interface Level {
  price: number;
  qty: number;
  /** Orders at this level. */
  n: number;
  /** Units at this level that belong to the viewer. */
  mine?: number;
}

export interface Ticker {
  good: GoodId;
  last: number | null;
  bid: number | null;
  ask: number | null;
  /** Change vs ~1h ago, fraction (0.05 = +5%). */
  chg: number | null;
  /** Units traded in the last hour. */
  vol: number;
  /** Town fair value right now. */
  fair: number;
}

export interface BotPublic {
  id: string;
  name: string;
  noun: number;
  seed: [number, number, number, number, number];
  style: BotStyle;
  blurb: string;
  coin: number;
  /** Mark-to-fair equity (free + escrow). */
  equity: number;
  /** equity - genesis budget value. */
  pnl: number;
}

export type BotStyle = 'maker' | 'arb' | 'momentum' | 'meanrev' | 'whale' | 'degen';

export interface YouView {
  owner: string;
  coin: number;
  lockCoin: number;
  goods: Goods;
  lockGoods: Goods;
  orders: GeOrder[];
  fills: GeFill[];
  equity: number;
}

export interface ExchangeSnapshot {
  now: number;
  good: GoodId;
  tf: 'm' | 'h';
  feeBps: number;
  tickers: Ticker[];
  depth: { bids: Level[]; asks: Level[] };
  candles: Candle[];
  tape: GeFill[];
  floor: FloorEvent[];
  bots: BotPublic[];
  treasury: number;
  you: YouView | null;
}
