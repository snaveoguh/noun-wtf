// ── Where the Big Drop's trees and rocks go (pure, deterministic) ───────
//
// The slopes are cut into chunks along the track (track distance s = peak
// z). Each chunk's trees come from its index alone, so a chunk rebuilt
// later (riding back up, a respawn) is identical. Near the line: tree lines
// along both lane edges with gaps, dense clusters off-piste, dead trees and
// rocks scattered between. Farther out ("far" chunks): big sparse forest
// patches over the whole visible mountainside. Nothing ever lands on the
// groomed lane or in the clear zone round a feature (gates, kickers and
// their landings, loops, berms, km markers). Fewer of everything on phones.
// No three.js: the forest system reads the height and builds the meshes.

import type { Quality } from '../../../render/Graphics';
import type { Feature } from '../contract';

import { smoothstep, vnoise } from '../../../world/mountain/config';
import { courseClearLat } from '../courseSpec';
import { centerX, featuresIn, nearestTrack, TRACK, widthAt } from '../track';

export const FOREST = {
  /** Track length of one near chunk (m). */
  chunk: 400,
  /** Keep chunks this far behind the rider (m). */
  behind: 300,
  /** Stream this far ahead (m). */
  ahead: { low: 1600, medium: 2400, high: 2800 } as Record<Quality, number>,
  /** Lateral reach of the near forest either side of the line (m). */
  reach: { low: 380, medium: 520, high: 650 } as Record<Quality, number>,
  /** Share of the full tree count. */
  density: { low: 0.4, medium: 0.7, high: 1 } as Record<Quality, number>,
  /** Nothing within this of the groomed lane's edge (m). */
  margin: 5,
  /** Trees this close to the lane's edge get trunk colliders (m). */
  colliderReach: 32,
  /** Colliders live for chunks overlapping [s − behind, s + ahead] (m). */
  colliderBehind: 150,
  colliderAhead: 500,
  /** Far patches: chunk length, how far ahead / behind, lateral reach. */
  farChunk: 1500,
  farAhead: { low: 4500, medium: 6000, high: 6500 } as Record<Quality, number>,
  farBehind: 800,
  farReach: 4500,
  /** No trees round the summit pad (m from the summit). */
  padClear: 70,
} as const;

export const Kind = { Pine: 0, SnowyPine: 1, Dead: 2, Rock: 3 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];
export const KIND_COUNT = 4;

export interface Placed {
  kind: Kind;
  /** Peak coordinates. */
  x: number;
  z: number;
  scale: number;
  /** Yaw (radians). */
  rot: number;
  /** Close enough to the line to need a collider. */
  solid: boolean;
}

/** mulberry32: a small seeded stream of [0, 1). */
export function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Chunk index range [first, last] to keep round track distance `s`. */
export function chunkWindow(
  s: number,
  len: number,
  behind: number,
  ahead: number,
  out: { first: number; last: number },
): { first: number; last: number } {
  const lastChunk = Math.floor(TRACK.end / len);
  out.first = Math.max(0, Math.floor((s - behind) / len));
  out.last = Math.min(lastChunk, Math.floor((s + ahead) / len));
  return out;
}

/** Lateral clearance (m from the centre line) a feature needs over [s0, s1]. */
export function featureClear(f: Feature, halfW: number): { s0: number; s1: number; lat: number } {
  switch (f.kind) {
    // The kicker, the long flight (riders fly hundreds of metres) and the landing
    case 'kicker':
      return { s0: f.s - 40, s1: f.s + f.len + 520, lat: halfW + 38 };
    case 'loop':
      return { s0: f.s - 70, s1: f.s + f.len + 140, lat: halfW + f.size * 0.6 + 20 };
    case 'berm':
      return { s0: f.s - 15, s1: f.s + f.len + 15, lat: halfW + 26 };
    case 'gate':
      return { s0: f.s - 20, s1: f.s + f.len + 20, lat: Math.max(halfW, f.size / 2) + 16 };
    default:
      return { s0: f.s - 12, s1: f.s + f.len + 12, lat: halfW + 14 };
  }
}

const _n = { s: 0, lateral: 0, dist: 0 };

/**
 * Is (x, z) clear for a tree or rock of radius `r`? Off the lane (plus the
 * margin) and out of every feature's clear zone. `feats` = the features near
 * this point's track distance (featuresIn over a padded range).
 */
export function clearAt(x: number, z: number, r: number, feats: readonly Feature[]): boolean {
  if (Math.hypot(x, z) < FOREST.padClear) return false;
  const n = nearestTrack(x, z, _n);
  const halfW = widthAt(n.s) / 2;
  if (n.dist < halfW + FOREST.margin + r) return false;
  // The SSX course's shortcut, caves and arches
  if (n.dist < courseClearLat(n.s) + r) return false;
  for (const f of feats) {
    const c = featureClear(f, halfW);
    if (n.s >= c.s0 && n.s <= c.s1 && n.dist < c.lat + r) return false;
  }
  return true;
}

/** Features whose clear zones can reach into [s0, s1]. */
export function featuresNear(s0: number, s1: number): Feature[] {
  return featuresIn(s0 - 700, s1 + 100);
}

/**
 * The line sampled every few metres over a stretch: centre x, the lateral
 * scale (1/|heading| in x), lane half-width and the clear distance (lane +
 * margin, widened round features). Placement asks it instead of the track
 * (O(1) per candidate instead of ~10 µs); linear interpolation is good to a
 * few cm, well inside the margin.
 */
export class LineTable {
  readonly s0: number;
  readonly step: number;
  readonly cx: Float64Array;
  readonly inv: Float64Array;
  readonly halfW: Float64Array;
  readonly clear: Float64Array;

  private readonly feats: Feature[];
  private filled = 0;

  /** Call fill() (all at once or in slices) before using it. */
  constructor(s0: number, s1: number, step = 4) {
    this.s0 = s0;
    this.step = step;
    const n = Math.ceil((s1 - s0) / step) + 3;
    this.cx = new Float64Array(n);
    this.inv = new Float64Array(n);
    this.halfW = new Float64Array(n);
    this.clear = new Float64Array(n);
    this.feats = featuresNear(s0, s1);
  }

  get done(): boolean {
    return this.filled > this.cx.length;
  }

  /** Sample up to `count` more points; the last call works out the headings. */
  fill(count = Infinity): this {
    const n = this.cx.length;
    const step = this.step;
    const end = Math.min(n, this.filled + count);
    for (let i = this.filled; i < end; i++) {
      const s = this.sAt(i);
      this.cx[i] = centerX(s);
      const hw = widthAt(s) / 2;
      this.halfW[i] = hw;
      let c = Math.max(hw + FOREST.margin, courseClearLat(s));
      for (const f of this.feats) {
        const z = featureClear(f, hw);
        // Pad by a step either side: the samples bracket the zone's ends
        if (s >= z.s0 - step && s <= z.s1 + step && z.lat > c) c = z.lat;
      }
      this.clear[i] = c;
    }
    this.filled = end;
    if (end === n && this.filled === n) {
      for (let i = 0; i < n; i++) {
        const lo = Math.max(0, i - 1);
        const hi = Math.min(n - 1, i + 1);
        this.inv[i] = 1 / Math.hypot((this.cx[hi]! - this.cx[lo]!) / ((hi - lo) * step), 1);
      }
      this.filled = n + 1;
    }
    return this;
  }

  /** Track distance of sample i (clamped onto the track like nearestTrack). */
  private sAt(i: number): number {
    return Math.min(TRACK.end, Math.max(TRACK.start, this.s0 + (i - 1) * this.step));
  }

  private at(arr: Float64Array, z: number): number {
    const s = Math.min(TRACK.end, Math.max(TRACK.start, z));
    const f = (s - this.s0) / this.step + 1;
    const i = Math.max(0, Math.min(arr.length - 2, Math.floor(f)));
    const t = Math.min(1, Math.max(0, f - i));
    return arr[i]! + (arr[i + 1]! - arr[i]!) * t;
  }

  centre(z: number): number {
    return this.at(this.cx, z);
  }

  /** Distance from the centre line (m). */
  dist(x: number, z: number): number {
    return Math.abs(x - this.at(this.cx, z)) * this.at(this.inv, z);
  }

  /** Clear for something of radius r? (Same rule as clearAt.) */
  isClear(x: number, z: number, r: number): boolean {
    if (Math.hypot(x, z) < FOREST.padClear) return false;
    return this.dist(x, z) >= this.at(this.clear, z) + r;
  }

  halfWidth(z: number): number {
    return this.at(this.halfW, z);
  }
}

/** How wooded the slope is at track distance s: bare and wind-blasted near the summit. */
export function woodedAt(s: number): number {
  return 0.3 + 0.7 * smoothstep(400, 4000, s);
}

/** Share of snow-laden pines: most near the top, fewer lower down. */
export function snowyShareAt(s: number): number {
  return 0.3 + 0.45 * (1 - smoothstep(2000, 120_000, s));
}

const SEED = 0x7e3e;

/**
 * Every tree and rock of near chunk `index` (track distance [index·chunk,
 * (index+1)·chunk)), deterministic. `out` is cleared first.
 */
export function placeChunk(index: number, quality: Quality, out: Placed[]): Placed[] {
  const g = placeChunkSteps(index, quality, out);
  while (g.next().done !== true);
  return out;
}

/**
 * placeChunk in slices: yields every few dozen candidates, so a streamer
 * can spread one chunk over frames. Same result.
 */
export function* placeChunkSteps(
  index: number,
  quality: Quality,
  out: Placed[],
): Generator<void, Placed[]> {
  out.length = 0;
  const L = FOREST.chunk;
  const s0 = index * L;
  const s1 = s0 + L;
  if (s1 < TRACK.start || s0 > TRACK.end) return out;
  // Clusters reach ~75 m past the chunk's ends
  const line = new LineTable(s0 - 80, s1 + 80);
  while (!line.done) {
    line.fill(24);
    yield;
  }
  let work = 0;
  const rand = rng(Math.imul(index + 1, 0x9e3779b1) ^ SEED);
  const dens = FOREST.density[quality];
  const reach = FOREST.reach[quality];
  const wood = woodedAt((s0 + s1) / 2);
  const snowy = snowyShareAt((s0 + s1) / 2);
  const solidW = FOREST.colliderReach;
  const push = (kind: Kind, s: number, lat: number, scale: number) => {
    // Track frame → peak coordinates (lateral measured in x; clearAt checks
    // the true distance to the line)
    const r = kind === Kind.Rock ? scale * 1.6 : scale * 0.9;
    const x = line.centre(s) + lat;
    const z = s;
    if (!line.isClear(x, z, r)) return;
    const solid = line.dist(x, z) < line.halfWidth(z) + solidW;
    out.push({ kind, x, z, scale, rot: rand() * Math.PI * 2, solid });
  };
  const pick = (r: number): Kind => (r < snowy ? Kind.SnowyPine : Kind.Pine);

  // Tree lines along both lane edges, with gaps (a slow noise along s)
  const step = 7 / Math.sqrt(dens);
  for (let side = -1; side <= 1; side += 2)
    for (let s = s0 + rand() * step; s < s1; s += step * (0.7 + rand() * 0.6)) {
      const gap = vnoise(s / 260, side * 3.1, SEED + 1);
      if (gap < -0.25 || rand() > 0.55 + 0.4 * wood) continue;
      const lat = side * (line.halfWidth(s) + FOREST.margin + 2 + Math.pow(rand(), 1.5) * 24);
      push(pick(rand()), s, lat, 0.75 + rand() * 0.6);
      if (++work % 48 === 0) yield;
    }
  // Clusters off-piste
  const clusters = Math.round((4 + 5 * wood) * (0.4 + 0.6 * dens));
  for (let k = 0; k < clusters; k++) {
    const side = rand() < 0.5 ? -1 : 1;
    const cs = s0 + rand() * L;
    const cl = side * (line.halfWidth(cs) + 40 + Math.pow(rand(), 0.8) * (reach - 60));
    const radius = 22 + rand() * 50;
    const count = Math.round((10 + rand() * 22) * dens * (0.5 + 0.5 * wood));
    for (let t = 0; t < count; t++) {
      const a = rand() * Math.PI * 2;
      const d = radius * Math.sqrt(rand());
      const r = rand();
      const kind = r < 0.06 ? Kind.Dead : r < 0.12 ? Kind.Rock : pick(rand());
      // Bigger in the middle of a stand
      const big = 1 - (d / radius) * 0.4;
      push(kind, cs + Math.sin(a) * d, cl + Math.cos(a) * d, (0.7 + rand() * 0.9) * big);
      if (++work % 48 === 0) yield;
    }
  }
  // Scatter: dead trees and rocks between the stands, a few lone pines
  const scatter = Math.round(36 * dens);
  for (let k = 0; k < scatter; k++) {
    const side = rand() < 0.5 ? -1 : 1;
    const s = s0 + rand() * L;
    const lat = side * (line.halfWidth(s) + FOREST.margin + 1 + rand() * reach);
    const r = rand();
    const kind = r < 0.4 ? Kind.Rock : r < 0.65 ? Kind.Dead : pick(rand());
    push(kind, s, lat, kind === Kind.Rock ? 0.5 + rand() * 1.6 : 0.6 + rand() * 0.8);
    if (++work % 48 === 0) yield;
  }
  return out;
}

/**
 * Far forest patches of far chunk `index` (track distance [index·farChunk,
 * …)): big stands across the whole mountainside beyond the near forest.
 * Pines only (they're specks at this range).
 */
export function placeFarChunk(index: number, quality: Quality, out: Placed[]): Placed[] {
  const g = placeFarChunkSteps(index, quality, out);
  while (g.next().done !== true);
  return out;
}

/** placeFarChunk in slices (same result). */
export function* placeFarChunkSteps(
  index: number,
  quality: Quality,
  out: Placed[],
): Generator<void, Placed[]> {
  out.length = 0;
  const L = FOREST.farChunk;
  const s0 = index * L;
  if (s0 + L < TRACK.start || s0 > TRACK.end) return out;
  const rand = rng(Math.imul(index + 7, 0x85ebca6b) ^ (SEED + 9));
  const dens = FOREST.density[quality];
  const near = FOREST.reach[quality];
  const wood = woodedAt(s0 + L / 2);
  const snowy = snowyShareAt(s0 + L / 2);
  const stands = Math.round((6 + 10 * wood) * (0.4 + 0.6 * dens));
  for (let k = 0; k < stands; k++) {
    const side = rand() < 0.5 ? -1 : 1;
    const cs = s0 + rand() * L;
    const cl = side * (near + 80 + rand() * (FOREST.farReach - near));
    const rx = 60 + rand() * 180;
    const rz = 60 + rand() * 260;
    const count = Math.round((14 + rand() * 30) * dens);
    const cx = centerX(cs) + cl;
    for (let t = 0; t < count; t++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand());
      const x = cx + Math.cos(a) * d * rx;
      const z = cs + Math.sin(a) * d * rz;
      // Never back toward the near forest's band (or the lane)
      if (Math.abs(x - centerX(Math.max(TRACK.start, z))) < near + 20) continue;
      if (Math.hypot(x, z) < FOREST.padClear) continue;
      out.push({
        kind: rand() < snowy ? Kind.SnowyPine : Kind.Pine,
        x,
        z,
        scale: 1 + rand() * 1.2,
        rot: rand() * Math.PI * 2,
        solid: false,
      });
    }
    yield;
  }
  return out;
}
