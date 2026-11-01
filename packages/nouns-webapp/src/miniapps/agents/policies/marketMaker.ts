// ── Market maker: two-sided quotes on the book, leaning to stay flat ─────
//
// Every turn it pulls its quotes and puts up fresh ones per good:
//   mid  = book mid when both sides are within 10% of fair, else fair
//          (half and half with fair, so a thin book can't drag it away);
//   skew = −(held − target) / target × p.skew (long → cheaper, short → dearer);
//   bid  = mid × (1 − half + skew), ask = mid × (1 + half + skew).
// Sizes are p.size, capped by what it can pay / deliver. Its shop shows the
// same prices (players can deal with it by hand at its quote).

import type { GoodId, ShopLine } from '../../exchange/engine/types';
import type { AgentAction, AgentDecision, AgentObs } from '../contract';

import { clamp, held } from './util';

export function makerQuote(
  fair: number,
  bookBid: number | null,
  bookAsk: number | null,
  have: number,
  target: number,
  half: number,
  skewK: number,
): { bid: number; ask: number } {
  let mid = fair;
  if (
    bookBid !== null &&
    bookAsk !== null &&
    bookBid < bookAsk &&
    Math.abs(bookBid / fair - 1) < 0.1 &&
    Math.abs(bookAsk / fair - 1) < 0.1
  )
    mid = (fair + (bookBid + bookAsk) / 2) / 2;
  const skew = clamp(-(have - target) / Math.max(1, target), -1, 1) * skewK;
  let bid = Math.floor(mid * (1 - half + skew));
  let ask = Math.ceil(mid * (1 + half + skew));
  bid = Math.max(1, bid);
  if (ask <= bid) ask = bid + 1;
  return { bid, ask };
}

export function marketMaker(o: AgentObs): AgentDecision {
  const { def } = o;
  const actions: AgentAction[] = o.orders.map(x => ({ t: 'cancel', id: x.id }) as AgentAction);
  // What the cancels free up
  let budget = Math.floor((o.coin + o.lockCoin) * (def.p.budget ?? 0.3));
  const lines: Partial<Record<GoodId, ShopLine>> = {};
  const size = def.p.size ?? 4;
  const target = def.p.target ?? 6;
  for (const g of def.goods) {
    const m = o.market[g];
    if (m === undefined) continue;
    const have = held(o, g);
    const q = makerQuote(
      m.fair,
      m.bid,
      m.ask,
      have,
      target,
      def.p.half ?? 0.04,
      def.p.skew ?? 0.06,
    );
    const bq = Math.min(size, def.maxQty, Math.floor(budget / q.bid));
    if (bq > 0) {
      actions.push({ t: 'place', good: g, side: 'buy', qty: bq, price: q.bid });
      budget -= bq * q.bid;
    }
    const aq = Math.min(size, def.maxQty, have);
    if (aq > 0) actions.push({ t: 'place', good: g, side: 'sell', qty: aq, price: q.ask });
    lines[g] = { bid: q.bid, ask: q.ask, max: Math.max(1, Math.min(size, def.maxQty)) };
  }
  actions.push({ t: 'shop', lines });
  const g = def.goods[o.turn % def.goods.length]!;
  const l = lines[g];
  return {
    actions,
    say: o.turn % 4 === 0 && l ? `${g} ${l.bid} / ${l.ask}, both ways.` : null,
  };
}
