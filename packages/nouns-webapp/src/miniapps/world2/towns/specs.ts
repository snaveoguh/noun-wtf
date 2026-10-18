// ── Noun Trade towns: names, styles, market biases (pure data) ───────────
//
// Names and markets come from the trade/ economy's TOWN_SPECS; no DOM
// and no three.js in here. Bias > 1 = the town pays more (demand), < 1 =
// it sells cheap (supply); `makes` are the goods it produces.
//
//   city    the plaza (summit). Pizza + noggles shops, the Grand Exchange.
//   jersey  Noun Jersey, the suburb 19 km down the +Z line. Board shop drip,
//           Slice Pizza; skaters want fries and ice cream.
//   cowboy  Dry Gulch, ~10 km down the +X line. Hot and dry: ICE CREAM and
//           WATER pay well (ice cream melts fast out here); fries are cheap.
//   beach   Puerto Noun, ~25 km down the +X line (the real icecreamvan.eth
//           parks in Puerto Viejo, Costa Rica). Fish is cheap, DRIP pays a
//           fortune, everyone wants something cold.

import type { GoodId, TownId } from '../trade/contract';

import { TOWN_SPECS } from '../trade/towns';

/** One table for the whole game: trade/towns.ts (prices, the server's travel check). */
export const TOWNS = TOWN_SPECS;

export const TOWN_IDS = Object.keys(TOWNS) as TownId[];

/** HUD names for goods (+ an icon each). */
export const GOOD_LABEL: Record<GoodId, { name: string; icon: string }> = {
  ICECREAM: { name: 'ICE CREAM', icon: '🍦' },
  FRIES: { name: 'FRIES', icon: '🍟' },
  FISH: { name: 'FISH', icon: '🐟' },
  DRIP: { name: 'DRIP', icon: '👕' },
  NOGGLES: { name: 'NOGGLES', icon: '⌐◨-◨' },
  PIZZA: { name: 'PIZZA', icon: '🍕' },
  WATER: { name: 'WATER', icon: '💧' },
};

/** Goods a town pays well for (bias ≥ 1.3), most wanted first: the arrival banner's "↑" list. */
export function hotGoods(town: TownId): GoodId[] {
  const b = TOWNS[town].market.bias;
  return (Object.keys(b) as GoodId[])
    .filter(g => (b[g] ?? 1) >= 1.3)
    .sort((x, y) => (b[y] ?? 1) - (b[x] ?? 1));
}
