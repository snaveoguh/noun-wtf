// ── Agent economy: the contract (types only) ────────────────────────────
//
// Agents are economic actors in Noun World that keep the city's economy
// moving while nobody's online. Each one is an ordinary account on the
// Grand Exchange (owner id 'agent:<slug>', COIN + goods, same order limits
// as a rider) plus a persistent record (this file's AgentRecord) in the
// Netlify Blobs store `noun-world-agents`: its goal, its memory and its
// trading history. A scheduled function (netlify/functions/
// world-agents-tick.ts) runs their turns; the policies are pure functions
// from what an agent sees (AgentObs) to what it wants (AgentDecision), and
// every decision goes through guard.ts and then the exchange engine's own
// rules. Design: docs/agent-economy.md.

import type { GoodId, Goods, ShopLine, Side } from '../exchange/engine/types';

export type AgentRole = 'shopkeeper' | 'maker' | 'collector';

/** [background, body, accessory, head, glasses] (V1 Nouns art). */
export type AgentSeed = [number, number, number, number, number];

/** Who an agent is (static: agents/roster.ts). */
export interface AgentDef {
  /** 'agent:<slug>' — the exchange owner id, public (never a key). */
  id: string;
  name: string;
  role: AgentRole;
  seed: AgentSeed;
  /** One line about them (HUD, ledger). */
  blurb: string;
  /** Their shop's sign, if they keep one. */
  shop?: string;
  /** Interior kinds whose counter they may run (interiors/ InteriorKind). */
  rooms: readonly string[];
  /** The only goods they trade. */
  goods: readonly GoodId[];
  /** Mean ms between turns (the tick runs every few minutes). */
  cadence: number;
  /** Biggest single order (units). */
  maxQty: number;
  /** What they're after, in words (shown, and given to the LLM policy). */
  goal: string;
  /** Policy knobs. */
  p: Record<string, number>;
  /** May use the LLM policy when it's switched on (AGENT_LLM=1 + a key). */
  llm?: boolean;
}

export interface AgentNote {
  at: number;
  text: string;
}

/** What an agent remembers between turns (plain JSON). */
export interface AgentMemory {
  /** Next turn (ms). */
  next: number;
  turns: number;
  /** Last posted shop quotes, per good (prices move a step at a time). */
  quotes: Partial<Record<GoodId, { bid: number | null; ask: number | null }>>;
  /** Units it sold (+) per good, decayed each turn: how fast stock moves. */
  demand: Partial<Record<GoodId, number>>;
  /** The last few things it decided, newest last. */
  notes: AgentNote[];
  /** Exchange fills seen up to (ms). */
  seen: number;
  /** Last LLM call (ms). */
  llmAt?: number;
}

export interface AgentStats {
  trades: number;
  /** Units bought / sold. */
  bought: number;
  sold: number;
  /** COIN traded (notional). */
  volume: number;
}

/** The persistent record (Blobs `noun-world-agents`, key `agents`). */
export interface AgentRecord {
  id: string;
  born: number;
  mem: AgentMemory;
  stats: AgentStats;
  /** Paused by an admin: no turns. */
  paused?: boolean;
  /** Last line it said (HUD). */
  say?: string;
  /** Which policy ran its last turn. */
  policy?: 'rules' | 'llm';
}

/** One line of the agent ledger. */
export interface LedgerEntry {
  at: number;
  agent: string;
  kind: 'fill' | 'note';
  side?: Side;
  good?: GoodId;
  qty?: number;
  price?: number;
  /** The other side: a public tag ('r:…', 'bot:…', 'agent:…'), never a raw rider id. */
  with?: string;
  /** 'book' (order book) or 'deal' (hand to hand / shop). */
  via?: 'book' | 'deal';
  text?: string;
}

export interface AgentsDoc {
  v: 1;
  agents: Record<string, AgentRecord>;
  /** Newest last, capped (KEEP_LEDGER). */
  ledger: LedgerEntry[];
  runs: number;
  lastRun: number;
}

/** One good as an agent sees the market. */
export interface MarketView {
  fair: number;
  bid: number | null;
  ask: number | null;
  last: number | null;
}

/** An agent's own resting order. */
export interface OwnOrder {
  id: string;
  good: GoodId;
  side: Side;
  price: number;
  left: number;
  at: number;
}

/** Everything a policy sees (read-only). */
export interface AgentObs {
  def: AgentDef;
  now: number;
  turn: number;
  coin: number;
  lockCoin: number;
  goods: Goods;
  lockGoods: Goods;
  orders: OwnOrder[];
  market: Partial<Record<GoodId, MarketView>>;
  demand: Partial<Record<GoodId, number>>;
  quotes: AgentMemory['quotes'];
  notes: AgentNote[];
}

export type AgentAction =
  | { t: 'place'; good: GoodId; side: Side; qty: number; price: number; ioc?: boolean }
  | { t: 'cancel'; id: string }
  | { t: 'shop'; lines: Partial<Record<GoodId, ShopLine>> }
  | { t: 'note'; text: string };

export interface AgentDecision {
  actions: AgentAction[];
  /** One line for the trading floor / their bubble, or null. */
  say: string | null;
}

export type Policy = (obs: AgentObs) => AgentDecision;

/** An agent as anyone may see it (no secrets in here). */
export interface AgentPublic {
  id: string;
  name: string;
  role: AgentRole;
  seed: AgentSeed;
  blurb: string;
  goal: string;
  shop: string | null;
  rooms: readonly string[];
  goods: readonly GoodId[];
  coin: number;
  /** Free stock (what the shop can sell now). */
  stock: Goods;
  /** Mark-to-fair (free + escrow). */
  equity: number;
  /** Shop board, when open. */
  lines: Partial<Record<GoodId, ShopLine>> | null;
  say: string | null;
  policy: 'rules' | 'llm';
  paused: boolean;
}
