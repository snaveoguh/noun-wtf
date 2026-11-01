// ── Shopkeeper: stock from the Exchange, prices from stock and demand ────
//
// Per good it keeps a target stock (p.target). Its shop's prices:
//   ask = fair × (1 + markup + 0.2·scarcity + 0.1·demand)   (sells dear when short)
//   bid = fair × (1 − markup − 0.1 + 0.12·scarcity)         (buys back, only when short)
// where scarcity = 1 − held/target (clamped −1…1) and demand = recent
// sales / target (0…1). Prices move at most STEP a turn, so a burst of
// buying can't spike them, and guard.ts / setShop keep them within the
// exchange's band of fair value. Out of stock → no ask; overstocked
// (≥ 1.5 × target) → no bid.
// Restocking: under p.restock × target it buys on the book: lifts the ask
// when it's within 8% of fair (IOC), else rests one bid a bit under fair.
// Over 2 × target it rests one sell on the book. Old orders are pulled.

import type { GoodId, ShopLine } from '../../exchange/engine/types';
import type { AgentAction, AgentObs, AgentDecision } from '../contract';

import { GOOD_INFO } from '../../exchange/engine/goods';

import { clamp, held, ordersOn, stale, stepToward } from './util';

export const STEP = 0.1;
const ORDER_AGE = 30 * 60_000;

export function shopPrices(
  fair: number,
  have: number,
  target: number,
  demand: number,
  markup: number,
): { bid: number | null; ask: number | null } {
  const scarcity = clamp(1 - have / target, -1, 1);
  const dem = clamp(demand / target, 0, 1);
  const ask = have > 0 ? fair * (1 + markup + 0.2 * scarcity + 0.1 * dem) : null;
  const bid = have < target * 1.5 ? fair * (1 - markup - 0.1 + 0.12 * scarcity) : null;
  return { bid, ask };
}

export function shopkeeper(o: AgentObs): AgentDecision {
  const { def } = o;
  const target = def.p.target ?? 10;
  const markup = def.p.markup ?? 0.12;
  const actions: AgentAction[] = [];
  const lines: Partial<Record<GoodId, ShopLine>> = {};
  let budget = Math.floor(o.coin * (def.p.budget ?? 0.35));
  let low: GoodId | null = null;

  for (const x of o.orders) if (stale(o, x, ORDER_AGE)) actions.push({ t: 'cancel', id: x.id });

  for (const g of def.goods) {
    const m = o.market[g];
    if (m === undefined) continue;
    const have = held(o, g);
    const free = o.goods[g] ?? 0;
    // What this turn's IOC restock should add (priced in now, so a fresh
    // restock is on the board straight away; the engine still only sells
    // what's really in stock)
    let incoming = 0;

    const resting = ordersOn(o, g).filter(x => !stale(o, x, ORDER_AGE));
    if (have < target * (def.p.restock ?? 0.6)) {
      low ??= g;
      const need = Math.min(def.maxQty, target - have);
      if (m.ask !== null && m.ask <= m.fair * 1.08) {
        const qty = Math.min(need, Math.floor(budget / m.ask));
        if (qty > 0) {
          actions.push({ t: 'place', good: g, side: 'buy', qty, price: m.ask, ioc: true });
          budget -= qty * m.ask;
          incoming = qty;
        }
      } else if (!resting.some(x => x.side === 'buy')) {
        const px = Math.max(1, Math.round(m.fair * 0.96));
        const qty = Math.min(need, Math.floor(budget / px));
        if (qty > 0) {
          actions.push({ t: 'place', good: g, side: 'buy', qty, price: px });
          budget -= qty * px;
        }
      }
    } else if (free > target * 2 && !resting.some(x => x.side === 'sell')) {
      const qty = Math.min(def.maxQty, Math.floor(free - target * 1.5));
      const px = Math.round(Math.max(m.fair * 1.03, (m.bid ?? 0) + 1));
      if (qty > 0) actions.push({ t: 'place', good: g, side: 'sell', qty, price: px });
    }

    const raw = shopPrices(m.fair, have + incoming, target, o.demand[g] ?? 0, markup);
    const prev = o.quotes[g];
    const ask = raw.ask === null ? null : Math.round(stepToward(prev?.ask, raw.ask, STEP));
    const bid = raw.bid === null ? null : Math.round(stepToward(prev?.bid, raw.bid, STEP));
    if (ask !== null || bid !== null) lines[g] = { bid, ask, max: def.maxQty };
  }
  actions.push({ t: 'shop', lines });

  let say: string | null = null;
  if (o.turn % 3 === 0) {
    const g = low ?? def.goods[o.turn % def.goods.length]!;
    const l = lines[g];
    say =
      low !== null
        ? `Low on ${GOOD_INFO[g].name.toLowerCase()}, restocking.`
        : l?.ask != null
          ? `${GOOD_INFO[g].icon} ${GOOD_INFO[g].name} ${l.ask} at ${def.shop ?? def.name}.`
          : null;
  }
  return { actions, say };
}
