// Shared bits for the rule policies (pure).

import type { GoodId } from '../../exchange/engine/types';
import type { AgentObs, OwnOrder } from '../contract';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Free + escrowed units of a good. */
export const held = (o: AgentObs, g: GoodId) => (o.goods[g] ?? 0) + (o.lockGoods[g] ?? 0);

export const ordersOn = (o: AgentObs, g: GoodId, side?: 'buy' | 'sell'): OwnOrder[] =>
  o.orders.filter(x => x.good === g && (side === undefined || x.side === side));

/** Move toward `want` by at most `step` (a fraction of prev) per turn. */
export function stepToward(prev: number | null | undefined, want: number, step: number) {
  if (prev === null || prev === undefined || !(prev > 0)) return want;
  return clamp(want, prev * (1 - step), prev * (1 + step));
}

/** Stale or way off fair: an order worth pulling. */
export function stale(o: AgentObs, x: OwnOrder, maxAgeMs: number, band = 0.15) {
  const fair = o.market[x.good]?.fair ?? x.price;
  return o.now - x.at > maxAgeMs || Math.abs(x.price / fair - 1) > band;
}
