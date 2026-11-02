// ── Noun Trade: the towns' markets (one shared table) ────────────────────
//
// TOWN_SPECS is the single source of truth for where each trading town sits
// (main line + along-track distance, see world/mountain/tracks.ts) and what
// its market wants. The towns/ part places them in the world from this
// table; the economy and the server ledger price and police trades with it.
//
// Main lines: 1 = +Z DOWNHILL (Noun Jersey ≈ 19 km out, Shroom Hollow past
// it), 2 = +X MOUNTAIN (Dry Gulch, Puerto Noun, Noggle City, Neon Nouns),
// 3 = −X GO DOWN (Crater Lil, past the Noggle Bowl). The grown towns' sites
// are TOWN_SITES in world/mountain/tracks.ts, kept equal by specs.test.ts.
// The city is the hub: s = 0, every line starts there.
//
// The road trip's side towns (Powder Peak, Loon Lake, Diesel Flats) sit
// BESIDE a main line, joined to it by a short spur (towns/road/places.ts
// SIDE_TOWNS, kept equal by road/places.test.ts): `s` is the spur
// junction, so the travel check measures the ride to the turn-off.
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
  noggle: {
    id: 'noggle',
    name: 'Noggle City',
    style: 'noggle',
    track: 2,
    s: 33_250,
    market: {
      // Built inside the giant noggles: lens works make shades by the crate;
      // landlocked, so fish and anything cold fetch a premium
      bias: {
        NOGGLES: 0.45,
        DRIP: 0.85,
        FISH: 1.55,
        ICECREAM: 1.45,
        WATER: 1.3,
        PIZZA: 1.1,
        FRIES: 1,
      },
      makes: ['NOGGLES'],
    },
  },
  shroom: {
    id: 'shroom',
    name: 'Shroom Hollow',
    style: 'shroom',
    track: 1,
    s: 27_500,
    market: {
      // Forest folk: spring water and mushroom pizza are local; they crave
      // shades, drip and anything fried
      bias: {
        WATER: 0.5,
        PIZZA: 0.6,
        DRIP: 1.8,
        NOGGLES: 1.7,
        FRIES: 1.55,
        ICECREAM: 1.2,
        FISH: 1.1,
      },
      makes: ['WATER', 'PIZZA'],
    },
  },
  neon: {
    id: 'neon',
    name: 'Neon Nouns',
    style: 'neon',
    track: 2,
    s: 40_250,
    market: {
      // The city that never sleeps: drip is made here, and the night crowd
      // pays double for pizza and fries
      bias: {
        DRIP: 0.5,
        PIZZA: 2.0,
        FRIES: 1.9,
        ICECREAM: 1.6,
        NOGGLES: 1.4,
        WATER: 1.2,
        FISH: 1.3,
      },
      makes: ['DRIP'],
    },
  },
  crater: {
    id: 'crater',
    name: 'Crater Lil',
    style: 'crater',
    track: 3,
    s: 53_650,
    market: {
      // Out past the Bowl in a meteor crater: meteor-glass lenses are cheap,
      // water and anything cold are worth a fortune
      bias: {
        NOGGLES: 0.6,
        WATER: 3.8,
        ICECREAM: 2.6,
        FISH: 2.1,
        DRIP: 1.3,
        PIZZA: 1.4,
        FRIES: 1.2,
      },
      makes: ['NOGGLES'],
    },
  },
  peak: {
    id: 'peak',
    name: 'Powder Peak',
    style: 'ski',
    track: 2,
    s: 3_600,
    market: {
      // The ski village up high: meltwater is free and nobody wants ice
      // cream in the snow; après-ski fries, pizza and goggles sell high
      bias: {
        WATER: 0.55,
        ICECREAM: 0.85,
        NOGGLES: 1.9,
        FRIES: 1.8,
        PIZZA: 1.6,
        DRIP: 1.4,
        FISH: 1.1,
      },
      makes: ['WATER'],
    },
  },
  pines: {
    id: 'pines',
    name: 'Loon Lake',
    style: 'lake',
    track: 1,
    s: 14_600,
    market: {
      // Fish straight off the docks, spring water; everything else comes a
      // long way through the pines
      bias: {
        FISH: 0.45,
        WATER: 0.75,
        PIZZA: 1.55,
        ICECREAM: 1.45,
        FRIES: 1.3,
        DRIP: 1.35,
        NOGGLES: 1.2,
      },
      makes: ['FISH'],
    },
  },
  diesel: {
    id: 'diesel',
    name: 'Diesel Flats',
    style: 'truckstop',
    track: 3,
    s: 20_500,
    market: {
      // The truck stop's grill: fries and pizza come cheap; out in the
      // desert water and anything cold are worth a lot, shades too
      bias: {
        FRIES: 0.6,
        PIZZA: 0.75,
        WATER: 2.6,
        ICECREAM: 2.1,
        FISH: 1.6,
        NOGGLES: 1.5,
        DRIP: 1.2,
      },
      makes: ['FRIES', 'PIZZA'],
    },
  },
};

export const TOWN_IDS: TownId[] = [
  'city',
  'jersey',
  'cowboy',
  'beach',
  'noggle',
  'neon',
  'shroom',
  'crater',
  'peak',
  'pines',
  'diesel',
];

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
