// ── The optional LLM policy: prompt in, guarded actions out (pure) ──────
//
// Off by default. The scheduled tick only uses it when AGENT_LLM=1 and
// ANTHROPIC_API_KEY are set, only for agents marked `llm: true`, at most
// once per LLM_EVERY_MS per agent and LLM_PER_RUN agents per run. The model
// sees the same AgentObs a rule policy sees and answers with JSON actions;
// parseDecision turns that into an AgentDecision (anything malformed is
// dropped), and it then goes through guard.ts and the exchange engine like
// any other decision: an LLM can't do anything a rule policy can't.
// Any error or refusal → that agent falls back to its rule policy.
// The network call itself lives in netlify/lib/agentLlm.ts; tests never
// make one.

import type { AgentAction, AgentDecision, AgentObs } from './contract';
import type { GoodId } from '../exchange/engine/types';

import { isGood } from '../exchange/engine/goods';

export const LLM_EVERY_MS = 60 * 60_000;
export const LLM_PER_RUN = 2;

export const LLM_SYSTEM = `You are an economic agent in Noun World, a game city. You trade an in-game currency, COIN, and goods on the Grand Exchange order book and through your shop. COIN is play money with no cash value.
Each turn you get your state as JSON. Reply with JSON only, no prose, in this shape:
{"actions":[...],"say":"one short in-character line or null","note":"why, in under 20 words"}
Actions:
{"t":"place","good":"FISH","side":"buy"|"sell","qty":3,"price":7,"ioc":true|false}
{"t":"cancel","id":"o123"}
{"t":"shop","lines":{"FISH":{"bid":5,"ask":9,"max":4}}}   (bid = you buy from players at, ask = you sell to players at; null to stop)
Rules: only your goods; whole numbers; prices stay within 50% of fair or get clamped; you can't spend more than 60% of your COIN a turn; at most 12 actions. Be sensible: keep stock, keep a margin, don't churn.`;

const r1 = (v: number) => Math.round(v * 10) / 10;

/** The turn as the model sees it (compact JSON). */
export function llmPrompt(o: AgentObs): string {
  const market: Record<string, unknown> = {};
  for (const g of o.def.goods) {
    const m = o.market[g];
    if (m)
      market[g] = {
        fair: r1(m.fair),
        bookBid: m.bid,
        bookAsk: m.ask,
        last: m.last,
        held: (o.goods[g] ?? 0) + (o.lockGoods[g] ?? 0),
        free: o.goods[g] ?? 0,
        recentSales: o.demand[g] ?? 0,
        yourQuote: o.quotes[g] ?? null,
      };
  }
  return JSON.stringify({
    you: { name: o.def.name, role: o.def.role, goal: o.def.goal, shop: o.def.shop ?? null },
    coin: o.coin,
    coinInOrders: o.lockCoin,
    market,
    openOrders: o.orders.map(x => ({
      id: x.id,
      good: x.good,
      side: x.side,
      price: x.price,
      left: x.left,
    })),
    recentNotes: o.notes.slice(-4).map(n => n.text),
  });
}

/** The model's reply → a decision (malformed parts are dropped; null = unusable). */
export function parseDecision(text: string): AgentDecision | null {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const actions: AgentAction[] = [];
  for (const x of Array.isArray(r.actions) ? r.actions.slice(0, 32) : []) {
    if (x === null || typeof x !== 'object') continue;
    const v = x as Record<string, unknown>;
    if (v.t === 'place' && isGood(v.good) && (v.side === 'buy' || v.side === 'sell'))
      actions.push({
        t: 'place',
        good: v.good,
        side: v.side,
        qty: Number(v.qty),
        price: Number(v.price),
        ...(v.ioc === true ? { ioc: true } : {}),
      });
    else if (v.t === 'cancel' && typeof v.id === 'string') actions.push({ t: 'cancel', id: v.id });
    else if (v.t === 'shop' && v.lines !== null && typeof v.lines === 'object') {
      const lines: Extract<AgentAction, { t: 'shop' }>['lines'] = {};
      for (const [g, l] of Object.entries(v.lines as Record<string, unknown>)) {
        if (!isGood(g) || l === null || typeof l !== 'object') continue;
        const q = l as Record<string, unknown>;
        const n = (z: unknown) => (z === null || z === undefined ? null : Number(z));
        lines[g as GoodId] = { bid: n(q.bid), ask: n(q.ask), max: Number(q.max) || 1 };
      }
      actions.push({ t: 'shop', lines });
    }
  }
  if (typeof r.note === 'string' && r.note.trim()) actions.push({ t: 'note', text: r.note });
  return { actions, say: typeof r.say === 'string' ? r.say : null };
}

/** Which agents get an LLM turn this run. */
export function llmDue(
  candidates: { id: string; llm?: boolean; llmAt?: number; due: boolean }[],
  now: number,
): string[] {
  return candidates
    .filter(c => c.llm === true && c.due && now - (c.llmAt ?? -Infinity) >= LLM_EVERY_MS)
    .sort((x, y) => (x.llmAt ?? 0) - (y.llmAt ?? 0))
    .slice(0, LLM_PER_RUN)
    .map(c => c.id);
}
