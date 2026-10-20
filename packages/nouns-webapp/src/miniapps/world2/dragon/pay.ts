// ── Buying a dragon: the one place the dragon touches the economy ────────
//
// The dragon is bought like a van upgrade (trade/upgrades.ts 'dragon',
// 2500 coin) through the trade client's public `act()`, so the server
// ledger holds the coin and the ownership (it travels with your rider
// id, like every upgrade). Kept in this one file so it's easy to rewire
// if the ledger changes shape.

import type { TradeApi, TownId } from '../trade/contract';

import { UPGRADES } from '../trade/upgrades';

export const DRAGON_COST = UPGRADES.dragon.cost;

function tradeOf(game: object): TradeApi | null {
  return (game as { trade?: TradeApi | null }).trade ?? null;
}

/** Does this rider own a dragon? */
export function dragonOwned(game: object): boolean {
  return tradeOf(game)?.state?.upgrades.includes('dragon') === true;
}

/** Coin on hand (null while the economy hasn't loaded). */
export function coinOf(game: object): number | null {
  return tradeOf(game)?.state?.coin ?? null;
}

/** Buy one at the Dragon Roost (town: where you're standing). */
export async function buyDragon(
  game: object,
  town: TownId,
): Promise<{ ok: boolean; reason?: string }> {
  const t = tradeOf(game);
  if (t === null) return { ok: false, reason: 'the market is closed' };
  const r = await t.act({ t: 'upgrade', town, up: 'dragon' });
  return { ok: r.ok, reason: r.reason };
}
