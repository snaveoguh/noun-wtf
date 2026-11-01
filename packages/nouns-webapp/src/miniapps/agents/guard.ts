// ── Guardrails: what any decision (rules or LLM) is cut down to ──────────
//
// Applied before anything reaches the exchange, and the exchange engine
// then applies its own rules on top (funds, escrow, open-order caps, the
// fee), exactly as for a rider. Here:
//   · at most MAX_ACTIONS actions a turn (the rest are dropped);
//   · only the agent's own goods, only cancels of its own resting orders;
//   · prices are whole COIN inside the exchange's band of fair value
//     (shops.ts SHOP_BAND), quantities 1…def.maxQty;
//   · buying spends at most SPEND_CAP of the COIN it has this turn
//     (free + whatever its cancels release);
//   · shop lines go through setShop's clamp later as well;
//   · notes and lines are short plain text.
// There's no action that mints, burns or moves COIN except trading.

import type { AgentAction, AgentDecision, AgentObs } from './contract';

import { bandOf } from '../exchange/engine/shops';

export const MAX_ACTIONS = 12;
export const SPEND_CAP = 0.6;
const TEXT_MAX = 140;

export const cleanText = (t: unknown, max = TEXT_MAX) =>
  String(t ?? '')
    .replace(/[\u0000-\u001f<>\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export interface Guarded {
  actions: AgentAction[];
  say: string | null;
  /** What was dropped or changed, for the ledger / tests. */
  dropped: string[];
}

export function guard(o: AgentObs, d: AgentDecision): Guarded {
  const dropped: string[] = [];
  const out: AgentAction[] = [];
  const mine = new Map(o.orders.map(x => [x.id, x]));
  const goods = new Set(o.def.goods);
  // COIN this turn: free + released by cancels in this decision
  let release = 0;
  for (const a of d.actions ?? []) {
    if (a?.t !== 'cancel') continue;
    const x = mine.get(String(a.id));
    if (x !== undefined && x.side === 'buy') release += x.left * x.price;
  }
  let spend = Math.floor((o.coin + release) * SPEND_CAP);
  const cancelled = new Set<string>();
  let shopSeen = false;
  for (const a of (d.actions ?? []).slice(0, 64)) {
    if (out.length >= MAX_ACTIONS) {
      dropped.push('too many actions');
      break;
    }
    if (a === null || typeof a !== 'object') continue;
    if (a.t === 'cancel') {
      const id = String(a.id);
      if (!mine.has(id) || cancelled.has(id)) {
        dropped.push(`cancel ${id}: not theirs`);
        continue;
      }
      cancelled.add(id);
      out.push({ t: 'cancel', id });
    } else if (a.t === 'place') {
      if (!goods.has(a.good)) {
        dropped.push(`place ${String(a.good)}: not their good`);
        continue;
      }
      if (a.side !== 'buy' && a.side !== 'sell') continue;
      const { lo, hi } = bandOf(a.good, o.now);
      const price = Math.min(hi, Math.max(lo, Math.round(Number(a.price))));
      let qty = Math.min(o.def.maxQty, Math.floor(Number(a.qty)));
      if (!Number.isFinite(price) || !(qty > 0)) {
        dropped.push(`place ${a.good}: bad qty/price`);
        continue;
      }
      if (price !== Math.round(Number(a.price))) dropped.push(`place ${a.good}: price clamped`);
      if (a.side === 'buy') {
        qty = Math.min(qty, Math.floor(spend / price));
        if (qty < 1) {
          dropped.push(`place ${a.good}: over the spend cap`);
          continue;
        }
        spend -= qty * price;
      }
      out.push({
        t: 'place',
        good: a.good,
        side: a.side,
        qty,
        price,
        ...(a.ioc === true ? { ioc: true } : {}),
      });
    } else if (a.t === 'shop') {
      if (shopSeen) continue;
      shopSeen = true;
      const lines: typeof a.lines = {};
      for (const [g, l] of Object.entries(a.lines ?? {})) {
        if (!goods.has(g as never) || l === undefined || l === null) continue;
        const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
        lines[g as keyof typeof lines] = {
          bid: num(l.bid),
          ask: num(l.ask),
          max: Math.min(o.def.maxQty, Math.max(1, Math.floor(Number(l.max) || 1))),
        };
      }
      out.push({ t: 'shop', lines });
    } else if (a.t === 'note') {
      const text = cleanText(a.text);
      if (text) out.push({ t: 'note', text });
    }
  }
  const say = d.say ? cleanText(d.say, 100) || null : null;
  return { actions: out, say, dropped };
}
