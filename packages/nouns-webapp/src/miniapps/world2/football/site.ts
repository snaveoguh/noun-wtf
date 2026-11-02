// ── Noun Football: where the stadium stands (pure, no three.js) ─────────
//
// NOUN STADIUM stands on its own terrace 3 km down the −Z side of the
// mountain, straight below the plaza's south face. No main line leaves the
// city that way (the alleys go +Z, +X and −X) and no branch wanders within
// ~2.5 km of it (grown to 9 km and searched; site.test.ts checks every line
// stays out of reach), so nothing the tracks shape is touched: no line, no
// launch ramp, no mega ramp, town, landmark, Noun Jersey or the Noggle Bowl.
// The −X side (the golf course) and +X far out (Puerto Noun's surf) are
// left alone.
//
// Frame: the pitch's centre spot at (SITE.x, P, SITE.z), its length (pitch
// +z) along world +X (yaw π/2), so the long axis runs ACROSS the slope and
// the level pad cuts the least: pitch −x is uphill (world +z, the city side:
// the main stand, the players' tunnel and the main entrance face it).
//
// The pad: a rounded rectangle in pitch space, the stadium's outer wall
// (STADIUM.halfX / halfZ) plus its apron, level at P, blended into the
// natural slope over M m with a smoothstep of the distance from the
// rectangle (|∇distance| ≤ 1, so |∇weight| ≤ 1.5 / M). P is the mean of the
// natural surface over the pad, so it cuts as much as it fills (~±20 m at
// the uphill / downhill edges, on a 0.14 slope).
//
// Run proofs (netlify/lib/runProof.ts) hold ground samples to 70 m below /
// 55 m above the radial gradient: the pad is within ~25 m of it everywhere
// and the tallest thing you can stand on (the upper tiers' back rows, 31 m)
// stays inside the band even on the downhill side (site.test.ts). Riding
// down onto the pad the surface only goes down or stays level (above P the
// blend cuts, below P it fills), so there's no free energy either.

import type { StadiumFrame } from './contract';

import { edgeDistance, smoothstep } from '../world/mountain/config';

import { STADIUM, worldToPitch } from './contract';

export const SITE = {
  /** Centre spot (world x, z): 3 km straight down the −Z side. */
  x: 0,
  z: -3000,
  /** Pitch +z runs along world +X. */
  yaw: Math.PI / 2,
  /** Blend from the level pad to the natural slope (m). */
  M: 90,
  /** Corner radius of the pad's rounded rectangle (m). */
  R: 26,
  /** Dressing keeps out of the pad and this far into the blend (m). */
  keepOut: 24,
} as const;

/** Level pad half extents, pitch-local (x across, z along). */
export const PAD = {
  halfX: STADIUM.halfX + STADIUM.apron,
  halfZ: STADIUM.halfZ + STADIUM.apron,
} as const;

/** Natural surface (no terraces), registered by terrain.ts (avoids an import cycle). */
let natural: ((x: number, z: number) => number) | null = null;

export function setStadiumNatural(fn: (x: number, z: number) => number) {
  natural = fn;
  level = null;
}

let level: number | null = null;

/** World AABB of everything the terrace touches (pad + blend), for cheap rejects. */
const REACH = Math.hypot(PAD.halfX, PAD.halfZ) + SITE.M + 1;
const X0 = SITE.x - REACH;
const X1 = SITE.x + REACH;
const Z0 = SITE.z - REACH;
const Z1 = SITE.z + REACH;

const _p = { x: 0, z: 0 };
const FRAME0: StadiumFrame = { x: SITE.x, y: 0, z: SITE.z, yaw: SITE.yaw };

/**
 * Pad level: the natural surface averaged over the pad (a 13 × 13 grid in
 * pitch space). Pure: the same on every client.
 */
export function padLevel(): number {
  if (level !== null) return level;
  const nat = natural;
  if (nat === null) throw new Error('stadium: natural surface not registered (import terrain.ts)');
  const c = Math.cos(SITE.yaw);
  const s = Math.sin(SITE.yaw);
  const N = 13;
  let sum = 0;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const px = -PAD.halfX + (2 * PAD.halfX * i) / (N - 1);
      const pz = -PAD.halfZ + (2 * PAD.halfZ * j) / (N - 1);
      sum += nat(SITE.x + px * c + pz * s, SITE.z - px * s + pz * c);
    }
  level = sum / (N * N);
  return level;
}

/** Distance (m) outside the pad's rounded rectangle, ≤ 0 on it. Pitch-local. */
export function padDistance(px: number, pz: number): number {
  const R = SITE.R;
  const qx = Math.abs(px) - (PAD.halfX - R);
  const qz = Math.abs(pz) - (PAD.halfZ - R);
  const ox = Math.max(qx, 0);
  const oz = Math.max(qz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(qx, qz), 0) - R;
}

/** Terrace weight at world (x, z): 1 on the level pad … 0 on the natural slope. */
export function padWeight(x: number, z: number): number {
  if (x < X0 || x > X1 || z < Z0 || z > Z1) return 0;
  const l = worldToPitch(FRAME0, x, z, _p);
  const d = padDistance(l.x, l.z);
  return d <= 0 ? 1 : 1 - smoothstep(0, SITE.M, d);
}

/** terrain.ts → sampleTerrain: level the pad (after the other terraces). */
export function applyStadiumPad(x: number, z: number, out: { y: number; track: number }) {
  if (x < X0 || x > X1 || z < Z0 || z > Z1) return;
  const w = padWeight(x, z);
  if (w <= 0) return;
  out.y += w * (padLevel() - out.y);
  // Grass under the stadium (no line comes near; belt and braces)
  out.track *= 1 - w;
}

/** Keep-out for the mountain dressing (trees, rocks, ponds, houses): pad + the top of the blend. */
export function stadiumBlocked(x: number, z: number): boolean {
  if (x < X0 || x > X1 || z < Z0 || z > Z1) return false;
  const l = worldToPitch(FRAME0, x, z, _p);
  return padDistance(l.x, l.z) < SITE.keepOut;
}

/** The pitch's placement in the world: centre spot on the pitch surface. */
export function stadiumFrame(): StadiumFrame {
  return { x: SITE.x, y: padLevel(), z: SITE.z, yaw: SITE.yaw };
}

/** Map pin (world x, z). */
export function stadiumMapPoint(): { x: number; z: number } {
  return { x: SITE.x, z: SITE.z };
}

/** Inside the stadium's outer wall (pitch-local box), grown by `margin` m. */
export function inStadium(x: number, z: number, margin = 0): boolean {
  if (x < X0 || x > X1 || z < Z0 || z > Z1) return false;
  const l = worldToPitch(FRAME0, x, z, _p);
  return Math.abs(l.x) <= STADIUM.halfX + margin && Math.abs(l.z) <= STADIUM.halfZ + margin;
}

/** World yaw (three.js: forward = (sin, cos)) of a pitch-space direction. */
export function pitchYaw(dpx: number, dpz: number): number {
  const c = Math.cos(SITE.yaw);
  const s = Math.sin(SITE.yaw);
  return Math.atan2(dpx * c + dpz * s, -dpx * s + dpz * c);
}

/** Pitch-local x of the main entrance (outside the facade, on the halfway line). */
export const ENTRANCE_PX = -(STADIUM.halfX + 9);

/**
 * `?spot=stadium` / the dev handle: outside the main entrance on the
 * halfway line, facing in (down the players' tunnel to the pitch).
 */
export function stadiumSpawn(): { x: number; y: number; z: number; yaw: number } {
  const c = Math.cos(SITE.yaw);
  const s = Math.sin(SITE.yaw);
  return {
    x: SITE.x + ENTRANCE_PX * c,
    y: padLevel() + 0.05,
    z: SITE.z - ENTRANCE_PX * s,
    yaw: pitchYaw(1, 0),
  };
}

/** Distance from the plaza's centre to the centre spot (m, for the map label). */
export const STADIUM_KM = Math.round(Math.hypot(SITE.x, SITE.z) / 100) / 10;

/** Distance from the city square to the stadium centre (m). */
export const STADIUM_EDGE = edgeDistance(SITE.x, SITE.z);
