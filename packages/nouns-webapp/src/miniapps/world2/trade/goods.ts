// ── Noun Trade: the goods table ──────────────────────────────────────────
//
// Every good is token-shaped: a stable uppercase symbol and integer units
// (0 decimals). `base` is the reference price in COIN, `bulk` the cargo
// slots one unit takes, `spoil` the fraction lost per minute in the van.

import type { GoodId, GoodSpec } from './contract';

export const GOODS: Record<GoodId, GoodSpec> = {
  ICECREAM: {
    id: 'ICECREAM',
    symbol: 'ICECREAM',
    name: 'Ice cream',
    base: 12,
    bulk: 1,
    spoil: 0.02,
  },
  FRIES: { id: 'FRIES', symbol: 'FRIES', name: 'Fries', base: 6, bulk: 1, spoil: 0 },
  FISH: { id: 'FISH', symbol: 'FISH', name: 'Fish', base: 10, bulk: 2, spoil: 0 },
  DRIP: { id: 'DRIP', symbol: 'DRIP', name: 'Drip', base: 40, bulk: 1, spoil: 0 },
  NOGGLES: { id: 'NOGGLES', symbol: 'NOGGLES', name: 'Noggles', base: 28, bulk: 1, spoil: 0 },
  PIZZA: { id: 'PIZZA', symbol: 'PIZZA', name: 'Pizza', base: 14, bulk: 2, spoil: 0 },
  WATER: { id: 'WATER', symbol: 'WATER', name: 'Water', base: 4, bulk: 2, spoil: 0 },
};

/** Display / iteration order. */
export const GOOD_IDS: GoodId[] = [
  'ICECREAM',
  'WATER',
  'FISH',
  'DRIP',
  'NOGGLES',
  'PIZZA',
  'FRIES',
];

/** Small glyph per good for the HUD. */
export const GOOD_ICON: Record<GoodId, string> = {
  ICECREAM: '🍦',
  FRIES: '🍟',
  FISH: '🐟',
  DRIP: '🧢',
  NOGGLES: '⌐◨-◨',
  PIZZA: '🍕',
  WATER: '💧',
};

export const isGood = (v: unknown): v is GoodId =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(GOODS, v);
