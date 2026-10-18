import type { TownId } from '../../../world2/trade/contract';
import type { Account, BotMemory, BotStyle, GeOrder, GoodId, Goods, Side } from '../types';

/** A bot's identity and budget. Seeds are the exact on-chain Noun seeds. */
export interface BotDef {
  id: string; // 'bot:<slug>'
  name: string;
  /** Real Noun id (NounsToken on mainnet). */
  noun: number;
  /** [background, body, accessory, head, glasses], NounsToken.seeds(noun). */
  seed: [number, number, number, number, number];
  style: BotStyle;
  blurb: string;
  /** Mean sim-ms between acts. */
  cadence: number;
  /** Genesis budget (minted once). */
  budget: { coin: number; goods: Goods };
  /** Biggest single order (units). */
  maxQty: number;
  /** Town-leg units per hour (arbitrageur only). */
  townCap?: number;
  /** Strategy knobs. */
  p: Record<string, number>;
}

export interface BookTop {
  bid: number | null;
  ask: number | null;
  bidQty: number;
  askQty: number;
  /** Units on each side within ±30% of fair (what a sweep could reach). */
  bidDepth: number;
  askDepth: number;
}

/** What a strategy sees. Read-only: strategies return actions, never mutate. */
export interface BotCtx {
  def: BotDef;
  now: number;
  rng: () => number;
  me: Readonly<Account>;
  mine: readonly GeOrder[];
  mem: Readonly<BotMemory>;
  fair(g: GoodId): number;
  top(g: GoodId): BookTop;
  last(g: GoodId): number | null;
  /** Minute closes, oldest first (only minutes that traded). */
  closes(g: GoodId, n: number): number[];
  /** Towns' quotes for a good (integration point: the economy's live quotes). */
  towns(g: GoodId): { town: TownId; name: string; ask: number; bid: number }[];
  /** Town-leg units left this hour. */
  townLeft: number;
}

export type BotAction =
  | { t: 'place'; good: GoodId; side: Side; qty: number; price: number; ioc?: boolean }
  | { t: 'cancel'; id: string }
  | { t: 'town'; town: TownId; good: GoodId; side: Side; qty: number }
  | { t: 'mem'; k: string; v: number };

export interface BotTurn {
  actions: BotAction[];
  /** One line for the trading floor, or null to stay quiet. */
  say: string | null;
  /** The good the thought is about. */
  good?: GoodId;
}

export type Strategy = (ctx: BotCtx) => BotTurn;
