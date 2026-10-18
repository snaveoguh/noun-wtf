// ── Noun Trade: the towns' markets (one shared table) ────────────────────
//
// TOWN_SPECS is the single source of truth for where each trading town sits
// (main line + along-track distance, see world/mountain/tracks.ts) and what
// its market wants. The towns/ part places them in the world from this
// table; the economy and the server ledger price and police trades with it.
//
// Main lines: 1 = +Z DOWNHILL (Noun Jersey ≈ 19 km out), 2 = +X MOUNTAIN
// (Dry Gulch then Puerto Noun further down the same line; their sites are
// TOWN_SITES in world/mountain/tracks.ts, kept equal by towns.test.ts).
// The city is the hub: s = 0, every line starts there.
//
// Biases: > 1 the town pays more than the reference price (it wants it),
// < 1 it's cheap there. `makes` = produced locally: deep stock, cheap.

import type { TownId, TownSpec } from './contract';

export const TOWN_SPECS: Record<TownId, TownSpec> = {
  city: {
    id: 'city',
    name: 'The Plaza',
    style: 'city',
    track: 0,
    s: 0,
    market: {
      // The van depot: ice cream and pizza are made here
      bias: { ICECREAM: 0.75, PIZZA: 0.8, NOGGLES: 0.85, FRIES: 1, FISH: 1.3, DRIP: 1.1, WATER: 1 },
      makes: ['ICECREAM', 'PIZZA', 'NOGGLES'],
    },
  },
  jersey: {
    id: 'jersey',
    name: 'Noun Jersey',
    style: 'suburb',
    track: 1,
    s: 21_656,
    market: {
      // Suburbs: malls (drip), fryers; hungry for pizza and ice cream
      bias: {
        FRIES: 0.7,
        DRIP: 0.8,
        ICECREAM: 1.25,
        PIZZA: 1.3,
        NOGGLES: 1.1,
        FISH: 1.2,
        WATER: 1,
      },
      makes: ['FRIES', 'DRIP'],
    },
  },
  cowboy: {
    id: 'cowboy',
    name: 'Dry Gulch',
    style: 'cowboy',
    track: 2,
    s: 11_400,
    market: {
      // Hot and dry: ice cream and water sell high, fish is a luxury
      bias: { ICECREAM: 2.3, WATER: 3.5, FISH: 1.6, NOGGLES: 1.4, PIZZA: 1.2, FRIES: 0.8, DRIP: 1 },
      makes: ['FRIES'],
    },
  },
  beach: {
    id: 'beach',
    name: 'Puerto Noun',
    style: 'beach',
    track: 2,
    s: 28_800,
    market: {
      // Fish is cheap off the boats; drip and shades fetch a fortune
      bias: {
        FISH: 0.4,
        DRIP: 2.8,
        NOGGLES: 1.6,
        ICECREAM: 1.7,
        WATER: 1.4,
        PIZZA: 1.1,
        FRIES: 1.1,
      },
      makes: ['FISH'],
    },
  },
};

export const TOWN_IDS: TownId[] = ['city', 'jersey', 'cowboy', 'beach'];

export const isTown = (v: unknown): v is TownId =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(TOWN_SPECS, v);

/**
 * Shortest road distance (m) between two towns: along one line if they share
 * it, else back up to the city and out the other line (the lines only meet
 * there).
 */
export function travelMetres(a: TownId, b: TownId): number {
  if (a === b) return 0;
  const A = TOWN_SPECS[a];
  const B = TOWN_SPECS[b];
  if (A.track !== 0 && A.track === B.track) return Math.abs(A.s - B.s);
  return Math.abs(A.s) + Math.abs(B.s);
}
