// ── Noun Trade: town market pricing (pure, deterministic) ────────────────
//
// No three.js, no DOM, no clock: every function takes `now` (ms) or a
// duration. Shared by the server ledger (netlify/functions/world-trade.ts)
// and the client's offline mode, so both price a trade identically.
//
// The model, per town and good:
//   target  = the stock the town settles at: deep where it's made
//             (TARGET_MAKES), shallow where it's wanted (TARGET / bias).
//   mid(s)  = base · bias · (target / s)^ELASTICITY, clamped to
//             [CLAMP_LO, CLAMP_HI] × base · bias. More stock → cheaper.
//   Each unit is priced at the stock *after* it moves (the trader always
//   takes the worse side), plus a half-spread:
//     buy one  : s → s − 1, pays  ceil (mid(s − 1) · (1 + h))
//     sell one : s → s + 1, gets  floor(mid(s + 1) · (1 − h))
//   so a round trip in one town always loses, and a big order walks the
//   price against itself (flooding a town kills its margin).
//   Stock drifts back to target with a half-life of HALF_LIFE_S:
//     s(t) = target + (s₀ − target) · 2^(−t / HALF_LIFE_S)

import type { GoodId, Quote, TownId } from './contract';

import { GOOD_IDS, GOODS } from './goods';
import { TOWN_IDS, TOWN_SPECS } from './towns';

export const ELASTICITY = 0.7;
/** Stock a town settles at for a good it makes. */
export const TARGET_MAKES = 240;
/** Stock a town settles at for a good it neither makes nor craves (÷ bias). */
export const TARGET = 120;
export const TARGET_MIN = 30;
/** Half-spread: makers quote tighter. */
export const HALF_SPREAD = 0.06;
export const HALF_SPREAD_MAKES = 0.04;
/** Mid price stays within this band around base · bias. */
export const CLAMP_LO = 0.15;
export const CLAMP_HI = 6;
/** A town won't take stock past this multiple of its target. */
export const STOCK_CAP = 8;
/** Mean reversion half-life (s). */
export const HALF_LIFE_S = 3600;

/** One town's live book: stock per good, as of `at` (ms). */
export interface TownMarket {
  stock: Record<GoodId, number>;
  at: number;
}
export type Markets = Record<TownId, TownMarket>;

export const biasOf = (town: TownId, good: GoodId) => TOWN_SPECS[town].market.bias[good] ?? 1;
export const makes = (town: TownId, good: GoodId) => TOWN_SPECS[town].market.makes.includes(good);

/** The stock a town drifts back to for a good. */
export function targetStock(town: TownId, good: GoodId): number {
  if (makes(town, good)) return TARGET_MAKES;
  return Math.max(TARGET_MIN, Math.round(TARGET / biasOf(town, good)));
}

export const stockCap = (town: TownId, good: GoodId) => targetStock(town, good) * STOCK_CAP;

/** Mid price (COIN, unrounded) at a stock level. */
export function midPrice(town: TownId, good: GoodId, stock: number): number {
  const ref = GOODS[good].base * biasOf(town, good);
  const raw = ref * Math.pow(targetStock(town, good) / Math.max(stock, 0.5), ELASTICITY);
  return Math.min(ref * CLAMP_HI, Math.max(ref * CLAMP_LO, raw));
}

const halfSpread = (town: TownId, good: GoodId) =>
  makes(town, good) ? HALF_SPREAD_MAKES : HALF_SPREAD;

/** Price of the next unit bought at this stock (never below 2: always above any bid of 1). */
export function unitAsk(town: TownId, good: GoodId, stock: number): number {
  return Math.max(2, Math.ceil(midPrice(town, good, stock - 1) * (1 + halfSpread(town, good))));
}

/** Price paid for the next unit sold at this stock (never below 1). */
export function unitBid(town: TownId, good: GoodId, stock: number): number {
  return Math.max(1, Math.floor(midPrice(town, good, stock + 1) * (1 - halfSpread(town, good))));
}

/** Stock relaxed toward target over `dtMs`. */
export function relax(town: TownId, good: GoodId, stock: number, dtMs: number): number {
  if (!(dtMs > 0)) return stock;
  const t = targetStock(town, good);
  return t + (stock - t) * Math.pow(2, -dtMs / 1000 / HALF_LIFE_S);
}

/** A fresh market at target stock. */
export function freshMarket(town: TownId, now: number): TownMarket {
  const stock = {} as Record<GoodId, number>;
  for (const g of GOOD_IDS) stock[g] = targetStock(town, g);
  return { stock, at: now };
}

export function freshMarkets(now: number): Markets {
  // Every town in the table (a store written before a town existed gets it
  // fresh through normalizeMarkets)
  return Object.fromEntries(TOWN_IDS.map(t => [t, freshMarket(t, now)])) as Markets;
}

/** The market brought up to `now` (a copy; time never runs backwards). */
export function marketAt(town: TownId, m: TownMarket, now: number): TownMarket {
  const dt = Math.max(0, now - m.at);
  const stock = {} as Record<GoodId, number>;
  for (const g of GOOD_IDS) {
    const s = m.stock[g];
    stock[g] = relax(town, g, Number.isFinite(s) ? s : targetStock(town, g), dt);
  }
  return { stock, at: Math.max(m.at, now) };
}

/** Repair whatever a store held into a full, valid Markets (bad rows reset). */
export function normalizeMarkets(raw: unknown, now: number): Markets {
  const out = freshMarkets(now);
  if (raw === null || typeof raw !== 'object') return out;
  const r = raw as Partial<Record<TownId, Partial<TownMarket>>>;
  for (const town of Object.keys(out) as TownId[]) {
    const m = r[town];
    if (m === undefined || m === null || typeof m !== 'object') continue;
    const at = Number(m.at);
    if (!Number.isFinite(at)) continue;
    const stock = out[town].stock;
    for (const g of GOOD_IDS) {
      const s = Number(m.stock?.[g]);
      if (Number.isFinite(s) && s >= 0 && s <= stockCap(town, g)) stock[g] = s;
    }
    out[town] = { stock, at: Math.min(at, now) };
  }
  return out;
}

/** The live quote at a stock level. */
export function quoteAt(town: TownId, good: GoodId, stock: number): Quote {
  return {
    town,
    good,
    ask: stock >= 1 ? unitAsk(town, good, stock) : 0,
    bid: stock + 1 <= stockCap(town, good) ? unitBid(town, good, stock) : 0,
    stock: Math.floor(stock),
  };
}

export function townQuotes(town: TownId, m: TownMarket, now: number): Quote[] {
  const live = marketAt(town, m, now);
  return GOOD_IDS.map(g => quoteAt(town, g, live.stock[g]));
}

/** Total cost of buying `qty` units starting at `stock` (null: not enough stock). */
export function buyCost(town: TownId, good: GoodId, stock: number, qty: number): number | null {
  if (qty > Math.floor(stock + 1e-9)) return null;
  let cost = 0;
  for (let i = 0; i < qty; i++) cost += unitAsk(town, good, stock - i);
  return cost;
}

/** Total proceeds of selling `qty` units starting at `stock` (null: the town is full). */
export function sellProceeds(
  town: TownId,
  good: GoodId,
  stock: number,
  qty: number,
): number | null {
  if (stock + qty > stockCap(town, good)) return null;
  let got = 0;
  for (let i = 0; i < qty; i++) got += unitBid(town, good, stock + i);
  return got;
}
