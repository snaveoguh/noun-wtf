// ── Noun Trade: shared contract (van driving × towns × economy) ──────────
//
// Phase 1+2 of the ice cream van game, built by three agents at once:
//   van/      — the drivable ice cream van (enter/exit, physics, camera, HUD)
//   towns/    — new towns on the mountain lines (cowboy, beach), their
//               customers (real Nouns) and serving on the move
//   trade/    — the economy: goods, town markets, cargo, coin, the Grand
//               Exchange (order book + NPC bot traders), server ledger
// Everyone builds against THIS file and only ever ADDS to it.
//
// Goods are token-shaped (a stable uppercase symbol, integer units, 0
// decimals) so each can later map 1:1 to a token on Base. Nothing here is
// on-chain: balances live in the server ledger (netlify/functions/world-trade).

// ── Goods ──

export type GoodId =
  | 'ICECREAM' // made at the van / depots; melts in transit
  | 'FRIES' // the Nouns accessory, as food
  | 'FISH' // cheap at the beach
  | 'DRIP' // clothes: Noun-trait fashion
  | 'NOGGLES' // glasses
  | 'PIZZA'
  | 'WATER'; // the desert pays for it

export interface GoodSpec {
  id: GoodId;
  name: string;
  /** Token-ready symbol (same as id). */
  symbol: GoodId;
  /** Reference price in COIN (integer). */
  base: number;
  /** Cargo slots per unit. */
  bulk: number;
  /** Fraction lost per minute in transit (ICECREAM melts); 0 = keeps. */
  spoil: number;
}

/** In-game currency (integer units). Never real money. */
export const COIN = 'COIN' as const;

// ── Towns ──

export type TownId =
  | 'city'
  | 'jersey'
  | 'cowboy'
  | 'beach'
  | 'noggle'
  | 'shroom'
  | 'neon'
  | 'crater'
  // The road trip's side towns (towns/road/places.ts)
  | 'peak'
  | 'pines'
  | 'diesel';
export type TownStyle =
  | 'city'
  | 'suburb'
  | 'cowboy'
  | 'beach'
  | 'noggle'
  | 'shroom'
  | 'neon'
  | 'crater'
  | 'ski'
  | 'lake'
  | 'truckstop';

export interface TownMarketSpec {
  /** Per good: multiplier on GoodSpec.base for this town (demand > 1, supply < 1). */
  bias: Partial<Record<GoodId, number>>;
  /** Goods this town produces (buyable here at a discount). */
  makes: GoodId[];
}

export interface TownSpec {
  id: TownId;
  name: string;
  style: TownStyle;
  /** Main line it sits on (tracks.ts track id) and how far out (m, along-track). */
  track: number;
  s: number;
  market: TownMarketSpec;
}

/** Resolved in the world once the town's site is grown (towns/ fills this). */
export interface TownPlacement {
  id: TownId;
  /** World x/z of the market square (where trading happens). */
  x: number;
  z: number;
  y: number;
  /** Radius (m) inside which you count as "in town". */
  r: number;
}

// ── Markets ──

/** One town's live quote for a good (COIN per unit). */
export interface Quote {
  town: TownId;
  good: GoodId;
  /** You buy at ask, sell at bid (ask > bid). */
  ask: number;
  bid: number;
  /** Town stock (units); moves with trades, drifts back over time. */
  stock: number;
}

// ── Player economy state (server-authoritative; the client mirrors it) ──

export interface TradeState {
  rider: string;
  coin: number;
  /** Cargo in the van. */
  cargo: Partial<Record<GoodId, number>>;
  /** Cargo slots (van upgrades raise it). */
  capacity: number;
  /** Purchased upgrades. */
  upgrades: VanUpgrade[];
  /** Where the server last saw you trade, and when (for travel-time checks). */
  last: { town: TownId; at: number } | null;
}

/** 'dragon' isn't fitted to the van: it's the Dragon Roost's mount (dragon/), bought the same way. */
export type VanUpgrade = 'freezer' | 'bigbox' | 'engine' | 'horn' | 'neon' | 'dragon';

// ── Client → server (netlify/functions/world-trade) ──

export type TradeAction =
  | { t: 'buy'; town: TownId; good: GoodId; qty: number }
  | { t: 'sell'; town: TownId; good: GoodId; qty: number }
  | { t: 'serve'; town: TownId; good: GoodId; customer: string } // street sale to a customer
  | { t: 'upgrade'; town: TownId; up: VanUpgrade }
  | { t: 'order'; side: 'buy' | 'sell'; good: GoodId; qty: number; price: number } // Grand Exchange
  | { t: 'cancel'; order: string }
  // Inside a building (interiors/): COIN spent on the spot, nothing to carry:
  // a gift to a resident, a meal eaten in, a service (a haircut, a day pass)
  | { t: 'spend'; town: TownId; to: string; coin: number; what: 'gift' | 'meal' | 'service' };

export interface TradeResult {
  ok: boolean;
  reason?: string;
  state: TradeState;
  quotes?: Quote[];
}

// ── Grand Exchange (city) ──

export interface GeOrder {
  id: string;
  owner: string; // rider id or 'bot:<name>'
  side: 'buy' | 'sell';
  good: GoodId;
  qty: number;
  filled: number;
  price: number;
  at: number;
}

export interface GeFill {
  good: GoodId;
  qty: number;
  price: number;
  buyer: string;
  seller: string;
  at: number;
}

// ── Seams between the three parts (all optional hooks on Game) ──

/** van/ exposes this on Game as `game.van2` (name chosen to avoid the NOUN FM `van`). */
export interface VanDriveApi {
  /** True while the player is driving the van. */
  readonly driving: boolean;
  /** Van world position / heading / speed (m/s). */
  readonly pos: { x: number; y: number; z: number };
  readonly heading: number;
  readonly speed: number;
  /** Fired when the player gets in / out. */
  on(ev: 'enter' | 'exit', fn: () => void): () => void;
}

/** towns/ exposes this on Game as `game.towns`. */
export interface TownsApi {
  /** Placed towns (grown lazily as lines grow). */
  placed(): TownPlacement[];
  /** The town the point is in, if any. */
  townAt(x: number, z: number): TownId | null;
  /** Fired when the player (on foot, board or van) enters / leaves a town. */
  on(ev: 'enter' | 'leave', fn: (town: TownId) => void): () => void;
}

/** trade/ exposes this on Game as `game.trade`; towns/ calls serve() for street sales. */
export interface TradeApi {
  readonly state: TradeState | null;
  quote(town: TownId, good: GoodId): Quote | null;
  act(a: TradeAction): Promise<TradeResult>;
}
