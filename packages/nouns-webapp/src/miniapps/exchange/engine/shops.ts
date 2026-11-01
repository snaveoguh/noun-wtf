// ── Grand Exchange: agent shops (pure) ───────────────────────────────────
//
// An agent (src/miniapps/agents) is an ordinary account on the exchange
// whose owner id starts with 'agent:'. It trades on the book through the
// same `place` / `cancel` as a rider. On top of that it may run a shop: a
// posted price per good ("I sell FISH at 8, I buy it at 5, up to 6 a go").
//
// A player buys from (or sells to) a shop with an ordinary direct deal
// (deals.ts `offer`) to the agent's id at the posted price. `shopTakes`
// answers it, like `botTakes` does for bots: it only checks the posted
// quote and the agent's FREE balances; the deal then settles exactly like
// any other deal (the seller pays the fee to the treasury, it goes on the
// tape). Nothing is minted, nothing is escrowed.
//
// Quotes are written by the agents' tick (agents/run.ts) through `setShop`,
// which refuses anything outside SHOP_BAND of fair value; a shop whose
// quotes are older than SHOP_TTL_MS is closed (fair value drifts, and a
// stale quote would be free money).

import type { Account, ExchangeState, GoodId, Shop, ShopLine, Side } from './types';

import { MAX_PRICE } from './book';
import { fairValue, isGood } from './goods';

export const isAgent = (owner: string) => owner.startsWith('agent:');
export const AGENT_ID_RE = /^agent:[\da-z-]{1,24}$/;

/** A posted price never strays further than this from fair value. */
export const SHOP_BAND = 0.5;
/** Quotes this old close the shop until the agent posts again. */
export const SHOP_TTL_MS = 2 * 3_600_000;
/** Most units in one shop sale / buy-back. */
export const SHOP_MAX_QTY = 25;

/** Is the shop open (posted recently)? */
export const shopOpen = (sh: Shop | undefined, now: number): sh is Shop =>
  sh !== undefined && now - sh.at < SHOP_TTL_MS;

export function bandOf(good: GoodId, now: number): { lo: number; hi: number } {
  const fair = fairValue(good, now);
  return {
    lo: Math.max(1, Math.floor(fair * (1 - SHOP_BAND))),
    hi: Math.min(MAX_PRICE, Math.ceil(fair * (1 + SHOP_BAND))),
  };
}

/**
 * Post a shop's quotes. Lines are clamped into the band, a bid is always
 * under its ask, and `max` is 1…SHOP_MAX_QTY. Returns the shop as stored.
 */
export function setShop(
  s: ExchangeState,
  agent: string,
  lines: Partial<Record<GoodId, ShopLine>>,
  now: number,
): Shop {
  if (!AGENT_ID_RE.test(agent)) throw new Error(`not an agent id: ${agent}`);
  const out: Partial<Record<GoodId, ShopLine>> = {};
  for (const g of Object.keys(lines)) {
    if (!isGood(g)) continue;
    const l = lines[g]!;
    const { lo, hi } = bandOf(g, now);
    const clamp = (v: number | null) =>
      v === null || !Number.isFinite(v) ? null : Math.min(hi, Math.max(lo, Math.round(v)));
    let bid = clamp(l.bid);
    const ask = clamp(l.ask);
    if (bid !== null && ask !== null && bid >= ask) bid = ask - 1 >= lo ? ask - 1 : null;
    const max = Math.min(SHOP_MAX_QTY, Math.max(1, Math.floor(Number(l.max) || 1)));
    if (bid === null && ask === null) continue;
    out[g] = { bid, ask, max };
  }
  s.shops ??= {};
  const sh: Shop = { at: now, lines: out };
  s.shops[agent] = sh;
  return sh;
}

/**
 * Does the shop take this deal? `agentSide` is what the agent would do. It
 * sells at its ask or more, buys at its bid or less, never more than the
 * line's max, and only from free balances.
 */
export function shopTakes(
  s: ExchangeState,
  agent: string,
  agentSide: Side,
  good: GoodId,
  qty: number,
  price: number,
  now: number,
): { ok: boolean; reason?: string } {
  const sh = s.shops?.[agent];
  if (!shopOpen(sh, now)) return { ok: false, reason: 'that shop is shut' };
  const l = sh.lines[good];
  if (l === undefined) return { ok: false, reason: `they don't deal in ${good}` };
  if (qty > l.max) return { ok: false, reason: `${l.max} at most a go` };
  const a = s.accounts[agent] as Account | undefined;
  if (agentSide === 'sell') {
    if (l.ask === null) return { ok: false, reason: `they aren't selling ${good}` };
    if (price < l.ask) return { ok: false, reason: `the price is ${l.ask}` };
    if (a === undefined || (a.goods[good] ?? 0) < qty)
      return { ok: false, reason: `only ${a?.goods[good] ?? 0} ${good} in stock` };
  } else {
    if (l.bid === null) return { ok: false, reason: `they aren't buying ${good}` };
    if (price > l.bid) return { ok: false, reason: `they pay ${l.bid}` };
    if (a === undefined || a.coin < qty * price)
      return { ok: false, reason: "they can't afford it right now" };
  }
  return { ok: true };
}
