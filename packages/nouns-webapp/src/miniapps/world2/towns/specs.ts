// ── Noun Trade towns: names, styles, market biases (pure data) ───────────
//
// Shared with the trade/ economy (it reads `TOWNS[id].market`), so no DOM
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

import type { GoodId, TownId, TownSpec } from '../trade/contract';

import { TOWN_SITES } from '../world/mountain/tracks';

const siteAt = (town: TownId) => TOWN_SITES.find(t => t.town === town)!;

export const TOWNS: Record<TownId, TownSpec> = {
  city: {
    id: 'city',
    name: 'The Plaza',
    style: 'city',
    // The summit: no line, no distance
    track: 0,
    s: 0,
    market: {
      bias: { FISH: 1.25, WATER: 0.8, PIZZA: 0.75, NOGGLES: 0.8, DRIP: 1.1 },
      makes: ['PIZZA', 'NOGGLES'],
    },
  },
  jersey: {
    id: 'jersey',
    name: 'Noun Jersey',
    style: 'suburb',
    // The +Z DOWNHILL main, ~19 km out (tracks.ts SPOT_SITE; the exact s is fixed as the line grows)
    track: 1,
    s: 21000,
    market: {
      bias: { FRIES: 1.35, ICECREAM: 1.3, NOGGLES: 1.2, DRIP: 0.75, PIZZA: 0.85, FISH: 1.3 },
      makes: ['DRIP', 'PIZZA'],
    },
  },
  cowboy: {
    id: 'cowboy',
    name: 'Dry Gulch',
    style: 'cowboy',
    track: siteAt('cowboy').track,
    s: siteAt('cowboy').at,
    market: {
      bias: { ICECREAM: 1.9, WATER: 2.1, FISH: 1.45, DRIP: 1.15, FRIES: 0.7, NOGGLES: 0.85 },
      makes: ['FRIES', 'NOGGLES'],
    },
  },
  beach: {
    id: 'beach',
    name: 'Puerto Noun',
    style: 'beach',
    track: siteAt('beach').track,
    s: siteAt('beach').at,
    market: {
      bias: { DRIP: 2.4, ICECREAM: 1.35, NOGGLES: 1.3, FISH: 0.45, WATER: 0.9, PIZZA: 1.15 },
      makes: ['FISH', 'WATER'],
    },
  },
};

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
