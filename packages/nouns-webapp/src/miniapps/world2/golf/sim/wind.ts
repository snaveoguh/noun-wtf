// ── Wind per hole ───────────────────────────────────────────────────────
//
// One steady wind per hole from the round's seed: any direction, speed up
// to WIND_MAX m/s at strength 1 (at 10 m; physics.ts thins it near the
// ground). Strength 0 is calm.

import type { Wind } from '../contract';

import { hashInts, mulberry32 } from './rng';

export const WIND_MAX = 10;

export function windFor(seed: number, holeIx: number, strength: number): Wind {
  const s = Math.max(0, Math.min(1, strength));
  if (s === 0) return { x: 0, z: 0 };
  const r = mulberry32(hashInts(seed, holeIx, 0x77696e64));
  const dir = r() * Math.PI * 2;
  // Mostly moderate, now and then a proper blow
  const u = r();
  const speed = s * WIND_MAX * (0.25 + 0.75 * u * u);
  return { x: Math.sin(dir) * speed, z: Math.cos(dir) * speed };
}

/** Wind speed (m/s) and the yaw it blows toward. */
export function windInfo(w: Wind): { speed: number; toward: number } {
  return { speed: Math.hypot(w.x, w.z), toward: Math.atan2(w.x, w.z) };
}
