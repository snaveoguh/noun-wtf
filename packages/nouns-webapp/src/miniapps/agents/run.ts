// ── The agents' turn loop (pure: no clock, no I/O) ──────────────────────
//
// runAgents(ex, doc, now) is what the scheduled function (and the browser,
// offline) calls after ticking the exchange to `now`:
//   1. every agent has an exchange account: the first time, the same
//      one-off starter grant a rider gets (riderAccount), booked in
//      `minted` like any rider's. Nothing else ever funds an agent;
//   2. the fills it was in since last run go on the ledger and into its
//      demand memory (that's how a shopkeeper learns what sells);
//   3. each agent whose turn is due (and isn't paused) looks at the market
//      (obsFor), decides (its role's rule policy, or an override such as
//      the LLM policy), the decision is cut down by guard.ts, and what's
//      left goes through the exchange engine: place / cancel / setShop.
// One turn per agent per run, at most. The caller checks the exchange's
// invariants before saving (the server never writes a broken ledger).

import type {
  AgentDecision,
  AgentDef,
  AgentObs,
  AgentPublic,
  AgentRecord,
  AgentsDoc,
  LedgerEntry,
  MarketView,
} from './contract';
import type { ExchangeState, GeFill, GoodId } from '../exchange/engine/types';

import { cancel, ordersOf, place, remaining } from '../exchange/engine/book';
import { fairValue, GOODS } from '../exchange/engine/goods';
import { hashNoise } from '../exchange/engine/rng';
import { setShop, shopOpen } from '../exchange/engine/shops';
import { pushFloor, riderAccount } from '../exchange/engine/sim';

import { guard } from './guard';
import { POLICIES } from './policies';
import { AGENTS } from './roster';

export const KEEP_LEDGER = 300;
const KEEP_NOTES = 8;
/** Demand memory halves every turn. */
const DEMAND_DECAY = 0.5;

/** Public tag of an owner (the server and browser pass feed.ts maskOwner). */
export type TagOf = (owner: string) => string;

export function emptyDoc(now: number): AgentsDoc {
  return { v: 1, agents: {}, ledger: [], runs: 0, lastRun: now };
}

function record(doc: AgentsDoc, def: AgentDef, now: number): AgentRecord {
  let r = doc.agents[def.id];
  if (r === undefined) {
    r = {
      id: def.id,
      born: now,
      mem: { next: now, turns: 0, quotes: {}, demand: {}, notes: [], seen: now },
      stats: { trades: 0, bought: 0, sold: 0, volume: 0 },
    };
    doc.agents[def.id] = r;
  }
  return r;
}

/** Make sure every agent has a record and an exchange account. */
export function ensureAgents(
  ex: ExchangeState,
  doc: AgentsDoc,
  now: number,
  roster: readonly AgentDef[] = AGENTS,
) {
  for (const def of roster) {
    record(doc, def, now);
    riderAccount(ex, def.id, now); // the rider's starter grant, once ever
  }
}

function pushLedger(doc: AgentsDoc, e: LedgerEntry) {
  doc.ledger.push(e);
  if (doc.ledger.length > KEEP_LEDGER) doc.ledger.splice(0, doc.ledger.length - KEEP_LEDGER);
}

function noteFill(doc: AgentsDoc, r: AgentRecord, f: GeFill, tagOf: TagOf, via?: 'book') {
  const buy = f.buyer === r.id;
  pushLedger(doc, {
    at: f.at,
    agent: r.id,
    kind: 'fill',
    side: buy ? 'buy' : 'sell',
    good: f.good,
    qty: f.qty,
    price: f.price,
    with: tagOf(buy ? f.seller : f.buyer),
    ...(via ? { via } : {}),
  });
  r.stats.trades++;
  r.stats.volume += f.qty * f.price;
  if (buy) r.stats.bought += f.qty;
  else {
    r.stats.sold += f.qty;
    r.mem.demand[f.good] = (r.mem.demand[f.good] ?? 0) + f.qty;
  }
}

/** What an agent sees right now. */
export function obsFor(ex: ExchangeState, def: AgentDef, r: AgentRecord, now: number): AgentObs {
  const a = ex.accounts[def.id];
  const market: Partial<Record<GoodId, MarketView>> = {};
  for (const g of def.goods)
    market[g] = {
      fair: fairValue(g, now),
      bid: ex.books[g].bids[0]?.price ?? null,
      ask: ex.books[g].asks[0]?.price ?? null,
      last: ex.last[g] ?? null,
    };
  return {
    def,
    now,
    turn: r.mem.turns,
    coin: a?.coin ?? 0,
    lockCoin: a?.lockCoin ?? 0,
    goods: { ...(a?.goods ?? {}) },
    lockGoods: { ...(a?.lockGoods ?? {}) },
    orders: ordersOf(ex, def.id).map(o => ({
      id: o.id,
      good: o.good,
      side: o.side,
      price: o.price,
      left: remaining(o),
      at: o.at,
    })),
    market,
    demand: { ...r.mem.demand },
    quotes: { ...r.mem.quotes },
    notes: r.mem.notes.slice(),
  };
}

export interface TurnReport {
  id: string;
  policy: 'rules' | 'llm';
  actions: number;
  fills: number;
  dropped: string[];
}

export interface RunOpts {
  roster?: readonly AgentDef[];
  tagOf?: TagOf;
  /** Override a turn's decision (the LLM policy); null = use the rules. */
  decide?: (def: AgentDef, obs: AgentObs) => AgentDecision | null;
  /** Ignore cadence: everyone (not paused) takes a turn. */
  force?: boolean;
}

const idHash = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return h;
};

export function runAgents(
  ex: ExchangeState,
  doc: AgentsDoc,
  now: number,
  opts: RunOpts = {},
): TurnReport[] {
  const roster = opts.roster ?? AGENTS;
  const tagOf = opts.tagOf ?? ((o: string) => o);
  ensureAgents(ex, doc, now, roster);
  const ids = new Set(roster.map(d => d.id));

  // 2. Fills since last run (book fills against resting orders, shop sales)
  for (const def of roster) {
    const r = doc.agents[def.id]!;
    let seen = r.mem.seen;
    for (const f of ex.fills) {
      if (f.at <= r.mem.seen || f.at > now || (f.buyer !== def.id && f.seller !== def.id)) continue;
      noteFill(doc, r, f, tagOf);
      seen = Math.max(seen, f.at);
    }
    r.mem.seen = seen;
  }

  // 3. Turns
  const out: TurnReport[] = [];
  for (const def of roster) {
    const r = doc.agents[def.id]!;
    if (r.paused === true || (opts.force !== true && now < r.mem.next)) continue;
    const obs = obsFor(ex, def, r, now);
    const over = opts.decide?.(def, obs) ?? null;
    const policy: 'rules' | 'llm' = over !== null ? 'llm' : 'rules';
    const g = guard(obs, over ?? POLICIES[def.role](obs));
    let fills = 0;
    for (const a of g.actions) {
      if (a.t === 'cancel') cancel(ex, def.id, a.id);
      else if (a.t === 'place') {
        const res = place(
          ex,
          {
            owner: def.id,
            side: a.side,
            good: a.good,
            qty: a.qty,
            price: a.price,
            tif: a.ioc === true ? 'ioc' : 'gtc',
          },
          now,
        );
        for (const f of res.fills) {
          fills++;
          noteFill(doc, r, f, tagOf, 'book');
          // A fill with another agent: that one's ledger gets it too
          const other = f.buyer === def.id ? f.seller : f.buyer;
          if (other !== def.id && ids.has(other))
            noteFill(doc, doc.agents[other]!, f, tagOf, 'book');
        }
      } else if (a.t === 'shop') {
        const sh = setShop(ex, def.id, a.lines, now);
        r.mem.quotes = {};
        for (const [k, l] of Object.entries(sh.lines))
          r.mem.quotes[k as GoodId] = { bid: l!.bid, ask: l!.ask };
      } else {
        r.mem.notes.push({ at: now, text: a.text });
        if (r.mem.notes.length > KEEP_NOTES) r.mem.notes.splice(0, r.mem.notes.length - KEEP_NOTES);
        pushLedger(doc, { at: now, agent: def.id, kind: 'note', text: a.text });
      }
    }
    if (g.say !== null) {
      r.say = g.say;
      pushFloor(ex, { at: now, who: def.id, good: def.goods[0], text: g.say });
    }
    for (const k of Object.keys(r.mem.demand) as GoodId[]) {
      const v = (r.mem.demand[k] ?? 0) * DEMAND_DECAY;
      if (v < 0.05) delete r.mem.demand[k];
      else r.mem.demand[k] = Math.round(v * 100) / 100;
    }
    r.mem.turns++;
    r.mem.next =
      now + def.cadence * (0.75 + 0.25 * (1 + hashNoise(r.mem.turns, idHash(def.id), 7)));
    r.policy = policy;
    out.push({ id: def.id, policy, actions: g.actions.length, fills, dropped: g.dropped });
  }
  // Fills made during the turns were noted as they happened (both sides)
  for (const def of roster)
    doc.agents[def.id]!.mem.seen = Math.max(doc.agents[def.id]!.mem.seen, now);
  doc.runs++;
  doc.lastRun = now;
  return out;
}

// ── Views ──

function equityOf(ex: ExchangeState, owner: string, now: number) {
  const a = ex.accounts[owner];
  if (a === undefined) return 0;
  let e = a.coin + a.lockCoin;
  for (const g of GOODS) e += ((a.goods[g] ?? 0) + (a.lockGoods[g] ?? 0)) * fairValue(g, now);
  return Math.round(e);
}

/** Every agent as anyone may see it. `doc` adds their last line and status. */
export function agentsPublic(
  ex: ExchangeState,
  doc: AgentsDoc | null,
  now: number,
  roster: readonly AgentDef[] = AGENTS,
): AgentPublic[] {
  return roster.map(def => {
    const a = ex.accounts[def.id];
    const sh = ex.shops?.[def.id];
    const r = doc?.agents[def.id];
    return {
      id: def.id,
      name: def.name,
      role: def.role,
      seed: def.seed,
      blurb: def.blurb,
      goal: def.goal,
      shop: def.shop ?? null,
      rooms: def.rooms,
      goods: def.goods,
      coin: a?.coin ?? 0,
      stock: { ...(a?.goods ?? {}) },
      equity: equityOf(ex, def.id, now),
      lines: shopOpen(sh, now) ? sh.lines : null,
      say: r?.say ?? null,
      policy: r?.policy ?? 'rules',
      paused: r?.paused === true,
    };
  });
}

/** The ledger, newest first (already tag-only: no raw rider ids). */
export function ledgerView(doc: AgentsDoc, n = 60, agent?: string): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (let i = doc.ledger.length - 1; i >= 0 && out.length < n; i--) {
    const e = doc.ledger[i]!;
    if (agent === undefined || e.agent === agent) out.push(e);
  }
  return out;
}
