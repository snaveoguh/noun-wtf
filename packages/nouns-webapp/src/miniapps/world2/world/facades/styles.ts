// ── Facade styles: which architecture each building gets (pure, tested) ──
//
// Every plaza building is dressed in one of six styles. The pick is seeded
// by the building's footprint key (so it's the same on every load and every
// client), leans on the building's size (towers go modern or deco, two-
// storey blocks go shopfront or brownstone, deep wide blocks go loft), and
// never repeats a style across a shared wall, so a street reads as a row of
// different buildings rather than one long terrace.

import { hash32, mulberry32 } from '../../interiors/rng';
import { sharedWall, type Footprint, type Rect } from '../../interiors/doors';

export type FacadeStyle = 'tenement' | 'modern' | 'deco' | 'brownstone' | 'loft' | 'shopfront';

export const STYLES: readonly FacadeStyle[] = [
  'tenement',
  'modern',
  'deco',
  'brownstone',
  'loft',
  'shopfront',
];

/** Storey height of the plaza's buildings (their string courses sit every 3.4 m). */
export const STOREY = 3.4;

export interface StyleInfo {
  /** Nominal window bay width (m): walls are divided into bays near this. */
  bay: number;
  /** Fire escapes go on this style's street wall when there's room. */
  fireEscape: boolean;
  /** Rooftop water tower chance. */
  waterTower: number;
}

export const STYLE_INFO: Record<FacadeStyle, StyleInfo> = {
  tenement: { bay: 2.6, fireEscape: true, waterTower: 0.6 },
  modern: { bay: 1.7, fireEscape: false, waterTower: 0 },
  deco: { bay: 2.3, fireEscape: false, waterTower: 0 },
  brownstone: { bay: 2.8, fireEscape: false, waterTower: 0.2 },
  loft: { bay: 3.8, fireEscape: true, waterTower: 1 },
  shopfront: { bay: 3.0, fireEscape: false, waterTower: 0 },
};

/** How much a style suits a building of this many storeys and footprint area (m²). */
export function styleWeight(style: FacadeStyle, storeys: number, area: number): number {
  switch (style) {
    case 'tenement':
      return storeys >= 3 && storeys <= 5 ? 3 : 1;
    case 'modern':
      return storeys >= 4 ? 3 : storeys === 3 ? 1 : 0.3;
    case 'deco':
      return storeys >= 4 ? 2.5 : 0.4;
    case 'brownstone':
      return storeys <= 4 ? 2.5 : 0.5;
    case 'loft':
      return area >= 200 && storeys >= 3 ? 2.5 : 0.6;
    case 'shopfront':
      return storeys <= 2 ? 4 : storeys === 3 ? 1 : 0.2;
  }
}

export interface StyleAssignment {
  style: FacadeStyle;
  /** 0..1 per-building variation (tint, which details). */
  variant: number;
  /** Seed for everything else about this building's facade. */
  seed: number;
}

/** Storeys of a building whose roof is `height` m up. */
export function storeysOf(height: number): number {
  return Math.max(1, Math.round(height / STOREY));
}

/** Buildings that share a wall (or a corner) with `fp`. */
function neighboursOf(fp: Rect, all: readonly Rect[]): number[] {
  const out: number[] = [];
  all.forEach((o, i) => {
    if (o === fp) return;
    const touch =
      sharedWall(fp, o) > 0.3 ||
      (Math.min(fp.maxX, o.maxX) - Math.max(fp.minX, o.minX) > -0.2 &&
        Math.min(fp.maxZ, o.maxZ) - Math.max(fp.minZ, o.minZ) > -0.2);
    if (touch) out.push(i);
  });
  return out;
}

/**
 * A style for every footprint (keyed by `fp.key`). Deterministic: the order
 * of `fps` doesn't matter. Buildings that touch never share a style.
 */
export function assignStyles(fps: readonly Footprint[]): Map<string, StyleAssignment> {
  const order = fps
    .map((fp, i) => ({ fp, i }))
    .sort((a, b) => (a.fp.key < b.fp.key ? -1 : a.fp.key > b.fp.key ? 1 : 0));
  const nbrs = fps.map(fp => neighboursOf(fp, fps));
  const chosen = new Map<number, FacadeStyle>();
  const out = new Map<string, StyleAssignment>();
  for (const { fp, i } of order) {
    const seed = hash32(`facade:${fp.key}`);
    const rnd = mulberry32(seed);
    const storeys = storeysOf(fp.height);
    const area = (fp.maxX - fp.minX) * (fp.maxZ - fp.minZ);
    const taken = new Set<FacadeStyle>();
    for (const j of nbrs[i]!) {
      const s = chosen.get(j);
      if (s !== undefined) taken.add(s);
    }
    // Seeded weighted pick among the styles no neighbour has yet
    let pool = STYLES.filter(s => !taken.has(s));
    if (pool.length === 0) pool = [...STYLES];
    const ws = pool.map(s => styleWeight(s, storeys, area) * (0.35 + rnd()));
    let best = 0;
    for (let k = 1; k < pool.length; k++) if (ws[k]! > ws[best]!) best = k;
    const style = pool[best]!;
    chosen.set(i, style);
    out.set(fp.key, { style, variant: rnd(), seed });
  }
  return out;
}

/** Pairs of touching buildings (for tests and debugging). */
export function touchingPairs(fps: readonly Footprint[]): [string, string][] {
  const out: [string, string][] = [];
  fps.forEach((fp, i) => {
    for (const j of neighboursOf(fp, fps)) if (j > i) out.push([fp.key, fps[j]!.key]);
  });
  return out;
}
