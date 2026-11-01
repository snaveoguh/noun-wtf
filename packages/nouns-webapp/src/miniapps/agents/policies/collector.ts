// ── Collector: hoards a few goods, never overpays ───────────────────────
//
// Wants p.want of each of its goods. Under that, it lifts the ask when it's
// at least 2% under fair (IOC), else keeps one resting bid at
// fair × (1 − patience). Its shop only buys (at fair × 0.92, a few at a
// time), and offers spares over the goal at fair × 1.35. Short of COIN with
// spares, it sells one into a decent bid.

import type { GoodId, ShopLine } from '../../exchange/engine/types';
import type { AgentAction, AgentDecision, AgentObs } from '../contract';

import { GOOD_INFO } from '../../exchange/engine/goods';

import { held, ordersOn, stale } from './util';

const ORDER_AGE = 20 * 60_000;

export function collector(o: AgentObs): AgentDecision {
  const { def } = o;
  const want = def.p.want ?? 6;
  const patience = def.p.patience ?? 0.08;
  let budget = Math.floor(o.coin * (def.p.budget ?? 0.4));
  const actions: AgentAction[] = [];
  const lines: Partial<Record<GoodId, ShopLine>> = {};
  for (const x of o.orders)
    if (stale(o, x, ORDER_AGE, 0.2)) actions.push({ t: 'cancel', id: x.id });
  let hunting: GoodId | null = null;
  for (const g of def.goods) {
    const m = o.market[g];
    if (m === undefined) continue;
    const have = held(o, g);
    const free = o.goods[g] ?? 0;
    const spare = Math.max(0, free - want);
    lines[g] = {
      bid: have < want ? Math.round(m.fair * 0.92) : null,
      ask: spare > 0 ? Math.round(m.fair * 1.35) : null,
      max: Math.max(1, Math.min(def.maxQty, have < want ? want - have : spare)),
    };
    if (have < want) {
      hunting ??= g;
      const need = Math.min(def.maxQty, want - have);
      if (m.ask !== null && m.ask <= m.fair * 0.98) {
        const qty = Math.min(need, Math.floor(budget / m.ask));
        if (qty > 0) {
          actions.push({ t: 'place', good: g, side: 'buy', qty, price: m.ask, ioc: true });
          budget -= qty * m.ask;
        }
      } else if (!ordersOn(o, g, 'buy').some(x => !stale(o, x, ORDER_AGE, 0.2))) {
        const px = Math.max(1, Math.round(m.fair * (1 - patience)));
        const qty = Math.min(need, Math.floor(budget / px));
        if (qty > 0) {
          actions.push({ t: 'place', good: g, side: 'buy', qty, price: px });
          budget -= qty * px;
        }
      }
    } else if (o.coin < 50 && spare > 0 && m.bid !== null && m.bid >= m.fair * 0.9) {
      actions.push({ t: 'place', good: g, side: 'sell', qty: 1, price: m.bid, ioc: true });
    }
  }
  actions.push({ t: 'shop', lines });
  const g = hunting ?? def.goods[o.turn % def.goods.length]!;
  return {
    actions,
    say:
      o.turn % 3 === 0
        ? `${held(o, g)}/${want} ${GOOD_INFO[g].name.toLowerCase()}. ${hunting ? 'Hunting.' : 'Content.'}`
        : null,
  };
}
