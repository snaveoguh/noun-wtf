// ── Goods + town prices, as the exchange sees them ──────────────────────
//
// INTEGRATION POINT. The trade/ economy (netlify/functions/world-trade.ts,
// src/miniapps/world2/trade/) owns the real goods table and live town
// markets (stock-driven quotes). The exchange is built standalone first, so
// it carries its own small model here: a reference price per good and a
// deterministic town quote that drifts with time (no RNG, no I/O). When the
// economy lands, swap `townQuote` for an adapter over its quotes (the
// `TownFeed` interface below is the seam) and the bots' fair value follows.

import type { GoodId, Quote, TownId } from '../../world2/trade/contract';

import { hashNoise } from './rng';

export const GOODS: readonly GoodId[] = [
  'ICECREAM',
  'FRIES',
  'FISH',
  'DRIP',
  'NOGGLES',
  'PIZZA',
  'WATER',
];

export const GOOD_INFO: Record<GoodId, { name: string; icon: string; base: number }> = {
  ICECREAM: { name: 'Ice cream', icon: '🍦', base: 12 },
  FRIES: { name: 'Fries', icon: '🍟', base: 8 },
  FISH: { name: 'Fish', icon: '🐟', base: 6 },
  DRIP: { name: 'Drip', icon: '🧢', base: 40 },
  NOGGLES: { name: 'Noggles', icon: '⌐◨-◨', base: 60 },
  PIZZA: { name: 'Pizza', icon: '🍕', base: 15 },
  WATER: { name: 'Water', icon: '💧', base: 4 },
};

export const isGood = (g: unknown): g is GoodId =>
  typeof g === 'string' && (GOODS as readonly string[]).includes(g);

export const TOWNS: readonly TownId[] = ['city', 'jersey', 'cowboy', 'beach'];

export const TOWN_INFO: Record<TownId, { name: string; bias: Partial<Record<GoodId, number>> }> = {
  city: { name: 'The City', bias: { DRIP: 1.2, NOGGLES: 1.15, PIZZA: 0.8, FISH: 1.15 } },
  jersey: { name: 'Noun Jersey', bias: { FRIES: 0.7, PIZZA: 1.2, ICECREAM: 1.1 } },
  cowboy: { name: 'Dry Gulch', bias: { WATER: 1.7, ICECREAM: 1.35, NOGGLES: 0.85, FISH: 1.3 } },
  beach: { name: 'Pebble Beach', bias: { FISH: 0.6, ICECREAM: 1.25, WATER: 0.8, DRIP: 0.9 } },
};

/** Town half-spread: you buy at mid*(1+S), sell at mid*(1-S). */
export const TOWN_SPREAD = 0.06;

const HOUR = 3_600_000;
const goodIx = (g: GoodId) => GOODS.indexOf(g);
const townIx = (t: TownId) => TOWNS.indexOf(t);

/** Smooth hourly noise in [-1, 1] (linear between hourly hash points). */
function drift(now: number, a: number, b: number) {
  const h = now / HOUR;
  const i = Math.floor(h);
  const f = h - i;
  return hashNoise(i, a, b) * (1 - f) + hashNoise(i + 1, a, b) * f;
}

/** A town's mid price for a good at `now` (COIN, fractional). */
export function townMid(town: TownId, good: GoodId, now: number): number {
  const g = goodIx(good);
  const t = townIx(town);
  const base = GOOD_INFO[good].base * (TOWN_INFO[town].bias[good] ?? 1);
  // A slow cycle per good (towns out of phase) plus hourly news
  const period = (5 + g) * HOUR;
  const cycle = Math.sin((2 * Math.PI * now) / period + t * 1.7 + g);
  return base * (1 + 0.12 * cycle + 0.08 * drift(now, g, t));
}

/** A town's quote (integer COIN): buy at ask, sell at bid. */
export function townQuote(town: TownId, good: GoodId, now: number): Quote {
  const mid = townMid(town, good, now);
  const ask = Math.max(1, Math.ceil(mid * (1 + TOWN_SPREAD)));
  const bid = Math.max(1, Math.min(ask - 1, Math.floor(mid * (1 - TOWN_SPREAD))));
  return { town, good, ask, bid, stock: 0 };
}

/** Fair value: the average of the town mids. */
export function fairValue(good: GoodId, now: number): number {
  let s = 0;
  for (const t of TOWNS) s += townMid(t, good, now);
  return s / TOWNS.length;
}

/** The seam the economy will implement (live quotes instead of the model). */
export interface TownFeed {
  quote(town: TownId, good: GoodId, now: number): Quote;
}

export const modelTownFeed: TownFeed = { quote: townQuote };
