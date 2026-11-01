// ── 3D Grand Exchange: the trade panel's logic (pure) ───────────────────
//
// Click (tap) someone on the floor and offer them a trade. Who you clicked
// decides where the offer goes (all of it the existing world-exchange
// function, in-game COIN only):
//   player / rider  → a direct deal to their public tag (engine/deals.ts);
//                     they accept or decline from their own screen
//   bot             → a direct deal the bot answers at once
//   simulated trader→ there is no account behind them, so it's a limit
//                     order on the real book at that price (said so)

import type { ClientAction } from '../../exchange/client';
import type { GoodId, Side, Ticker, YouView } from '../../exchange/engine/types';

import { MAX_DEAL_QTY } from '../../exchange/engine/deals';
import { GOOD_INFO } from '../../exchange/engine/goods';

export type TradeTarget =
  | { kind: 'peer'; key: string; name: string; tag: string; seedKey: string }
  | { kind: 'rider'; key: string; name: string; tag: string }
  | { kind: 'bot'; key: string; name: string; bot: string }
  /** An agent (src/miniapps/agents): its shop board opens instead of the form. */
  | { kind: 'agent'; key: string; name: string; agent: string }
  | { kind: 'sim'; key: string; name: string; good: GoodId };

export interface TradeForm {
  /** What YOU do: buy from them or sell to them. */
  side: Side;
  good: GoodId;
  qty: number;
  price: number;
}

/** A sensible opening price: the touch you'd trade against, else the last, else fair. */
export function defaultPrice(side: Side, t: Ticker | undefined, good: GoodId): number {
  const p =
    side === 'buy'
      ? (t?.ask ?? t?.last ?? t?.fair ?? GOOD_INFO[good].base)
      : (t?.bid ?? t?.last ?? t?.fair ?? GOOD_INFO[good].base);
  return Math.max(1, Math.round(p));
}

/** The form a target opens with. Selling what you hold, if you hold their pit's good. */
export function openForm(
  target: TradeTarget,
  tickers: readonly Ticker[],
  you: YouView | null,
  good: GoodId,
): TradeForm {
  const g = target.kind === 'sim' ? target.good : good;
  const side: Side = (you?.goods[g] ?? 0) > 0 ? 'sell' : 'buy';
  return {
    side,
    good: g,
    qty: 1,
    price: defaultPrice(
      side,
      tickers.find(t => t.good === g),
      g,
    ),
  };
}

/** Why the form can't be sent (null = it can). Funds are checked again by the server. */
export function formProblem(f: TradeForm, you: YouView | null): string | null {
  if (!Number.isInteger(f.qty) || f.qty < 1 || f.qty > MAX_DEAL_QTY) return `qty 1–${MAX_DEAL_QTY}`;
  if (!Number.isInteger(f.price) || f.price < 1) return 'price must be a whole COIN, 1 or more';
  if (you === null) return null;
  if (f.side === 'buy' && you.coin < f.qty * f.price) return `you have ${you.coin} COIN`;
  if (f.side === 'sell' && (you.goods[f.good] ?? 0) < f.qty)
    return `you have ${you.goods[f.good] ?? 0} ${f.good}`;
  return null;
}

/** The exchange action for this form and target. */
export function formAction(target: TradeTarget, f: TradeForm): ClientAction {
  if (target.kind === 'sim')
    return { t: 'order', side: f.side, good: f.good, qty: f.qty, price: f.price, kind: 'limit' };
  const to =
    target.kind === 'bot' ? target.bot : target.kind === 'agent' ? target.agent : target.tag;
  return { t: 'offer', to, side: f.side, good: f.good, qty: f.qty, price: f.price };
}

/** One line on what sending does, for the panel. */
export function formNote(target: TradeTarget): string {
  switch (target.kind) {
    case 'peer':
    case 'rider':
      return 'A direct offer: they get it on their screen and can accept for 90 s.';
    case 'bot':
      return 'Bots answer at once, if the price is right for them.';
    case 'agent':
      return 'Agents answer at once, at their posted shop prices.';
    case 'sim':
    default:
      return 'A simulated trader: your order goes on the real order book at this price.';
  }
}

/** "SELL 3 FISH @ 12 = 36 COIN" */
export function formSummary(f: TradeForm): string {
  return `${f.side === 'buy' ? 'BUY' : 'SELL'} ${f.qty} ${f.good} @ ${f.price} = ${f.qty * f.price} COIN`;
}
