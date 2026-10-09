// ── Mountain dressing: terrain adapter interface + seeded hashing/noise ──
//
// Nothing here depends on the mountain's own modules: the dressing only ever
// sees the terrain through `TerrainQuery`, so it can run against the real
// endless mountain or a small standalone test heightfield (DressingDemo).

import type * as THREE from 'three';

/** Everything the dressing needs to know about the ground. World XZ in metres. */
export interface TerrainQuery {
  /** Surface height (the collision surface; the rendered mesh approximates it). */
  height(x: number, z: number): number;
  /** Upward unit normal. */
  normal(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  /** Distance (m) to the nearest dirt-track centre line (large when far away). */
  trackDist(x: number, z: number): number;
  /** Optional mask: true where nothing may be placed (city, alley ramps…). */
  blocked?(x: number, z: number): boolean;
}

/** Deterministic [0, 1) hash of three integers + a seed. */
export function hash3i(a: number, b: number, c: number, seed: number): number {
  let h =
    (Math.imul(a | 0, 374761393) +
      Math.imul(b | 0, 668265263) +
      Math.imul(c | 0, 2246822519) +
      Math.imul(seed | 0, 1442695041)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

const q5 = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth 2D value noise in [-1, 1]. */
export function vnoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = q5(x - xi);
  const zf = q5(z - zi);
  const a = hash3i(xi, zi, 0, seed);
  const b = hash3i(xi + 1, zi, 0, seed);
  const c = hash3i(xi, zi + 1, 0, seed);
  const d = hash3i(xi + 1, zi + 1, 0, seed);
  return (a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf) * 2 - 1;
}

/** Two-octave value noise in roughly [-1, 1] (feature size ≈ `scale` m). */
export function fbm(x: number, z: number, scale: number, seed: number): number {
  return (
    vnoise(x / scale, z / scale, seed) * 0.7 +
    vnoise((x / scale) * 2.3 + 5.1, (z / scale) * 2.3 - 3.7, seed + 1) * 0.3
  );
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** mulberry32 stream (per chunk / per feature). */
export class Rand {
  private s: number;
  constructor(seed: number) {
    this.s = (seed | 0) ^ 0x2c1b3c6d;
    for (let i = 0; i < 3; i++) this.next();
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
}
