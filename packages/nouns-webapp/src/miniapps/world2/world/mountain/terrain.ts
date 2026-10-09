// ── Endless mountain: the analytic terrain function ─────────────────────
//
// Pure and deterministic from MOUNTAIN.seed, so every client (and the
// collision code, and the chunk mesher) agrees on the exact same surface.
// The city is the summit; everything outside its square ring falls away:
//
//   de = distance from the city square
//   height = base(de)              constant radial gradient (eases in at the wall)
//          + hills                 layered value noise, faded in below the wall
//          + trench                tracks run in a shallow cut (off-track is higher)
//          + rollers + banking     along / across each dirt track
//          + landing hills         carved after every launch ramp
//          (+ alley ramps)         the alleys ramp from the street onto the slope
//
// Gradients stay ≲ 0.8, so the analytic heightfield doubles as the collision
// surface (sphere-traced in raycastTerrain, bound TERRAIN_LIPSCHITZ).

import {
  ALLEYS,
  ALLEY_O0,
  MOUNTAIN,
  RAMP_O0,
  RAMP_O1,
  edgeDistance,
  smoothstep,
  vnoise,
  worldToAlley,
} from './config';
import { INFLUENCE, tracks, type NearestTrack } from './tracks';

export { ALLEYS, MOUNTAIN, hashInts, smoothstep, edgeDistance } from './config';

/** Upper bound on |∇height| — the sphere-tracing step size relies on it. */
export const TERRAIN_LIPSCHITZ = 1.4;

const SEED = MOUNTAIN.seed;

/** Height of the radial gradient at distance de from the city (eases in from flat). */
function baseHeight(de: number): number {
  if (de <= 0) return MOUNTAIN.topY;
  const L = MOUNTAIN.slopeEase;
  return MOUNTAIN.topY - MOUNTAIN.slope * (de - L * (1 - Math.exp(-de / L)));
}

/** Rolling hills, fBm in [-1, 1]. */
function hills(x: number, z: number): number {
  return (
    vnoise(x / 110, z / 110, SEED + 11) * 0.62 +
    vnoise(x / 47, z / 47, SEED + 23) * 0.28 +
    vnoise(x / 19, z / 19, SEED + 37) * 0.1
  );
}

const ss01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Landing hills after the ramps of the nearest track (≤ 0, then recovers to 0). */
function landing(nt: NearestTrack): number {
  const t = nt.track;
  if (t === null) return 0;
  const [k0, k1] = tracks.rampRange(t, nt.s);
  let y = 0;
  for (let k = k0; k <= k1; k++) {
    const r = tracks.rampAt(t, k);
    if (r === null) continue;
    const sp = nt.s - r.s;
    if (sp <= 0) continue;
    const sp2 = r.spec;
    y += -sp2.drop * ss01(sp / sp2.land) + sp2.drop * ss01((sp - sp2.land) / sp2.recover);
  }
  return y;
}

const _nt: NearestTrack = { track: null, d: 0, side: 0, s: 0, k: 0, weight: 0 };
const _l = { a: 0, o: 0 };

export interface TerrainSample {
  /** Surface height. */
  y: number;
  /** 0 = grass … 1 = dirt track (smooth blend across the shoulder). */
  track: number;
  /** 0..1 inside an alley corridor ramp (concrete). */
  alley: number;
  /** Signed distance from the nearest track centre line (m, + = right). */
  side: number;
  /** Unsigned (effective) distance to the nearest track, ≤ INFLUENCE. */
  dist: number;
}

/** Full sample (height + surface blend). */
export function sampleTerrain(x: number, z: number, out: TerrainSample): TerrainSample {
  const de = edgeDistance(x, z);
  let y = baseHeight(de);
  let track = 0;
  let side = 1e9;
  let dist = INFLUENCE;
  if (de > 0) {
    const nt = tracks.nearest(x, z, _nt);
    const d = nt.d;
    const f = smoothstep(8, 140, de);
    const half = MOUNTAIN.trackHalf;
    const hillMask = smoothstep(half, half + 40, d);
    const trench = 3.5 * smoothstep(0, 60, d);
    // Along/across-track features blend over every track in reach (a plain
    // "nearest track" would jump where two tracks' zones meet)
    let rollers = 0;
    let rw = 0;
    let bank = 0;
    let bw = 0;
    let land = 0;
    for (let q = 0; q < tracks.nearCount; q++) {
      const e = tracks.near[q];
      const nr = 1 - smoothstep(28, 72, e.d);
      rollers += nr * (0.8 * Math.sin(e.s / 61 + 1.3) + 0.3 * Math.sin(e.s / 33 + 4.1));
      rw += nr;
      const wb = 1 - smoothstep(half, half + MOUNTAIN.trackShoulder, e.d);
      bank += wb * Math.max(-0.1, Math.min(0.1, -e.k * 28)) * e.side;
      bw += wb;
      // (ramps are only placed where no other track passes near their
      // landing hill — see tracks.rampAt — so these never cross a line)
      // and, belt and braces, fade where another line is clearly nearer
      const wl = (1 - smoothstep(12, 90, e.d)) * (1 - smoothstep(10, 70, e.d - d));
      if (wl > 0) land += landing(e) * wl;
    }
    rollers /= Math.max(1, rw);
    bank /= Math.max(1, bw);
    y += f * (hills(x, z) * 7 * hillMask + trench + rollers + bank + land);
    track = smoothstep(half + 2, half - 0.5, d) * smoothstep(4, 12, de);
    side = nt.side;
    dist = d;
  }
  // Alley ramps: from the street (y = 0) down onto the mountain
  let alley = 0;
  for (const al of ALLEYS) {
    const l = worldToAlley(al, x, z, _l);
    if (l.o < ALLEY_O0 - 6 || l.o > RAMP_O1) continue;
    const half = al.width / 2;
    const cw = 1 - smoothstep(half + 3.5, half + 6, Math.abs(l.a - al.a));
    if (cw <= 0) continue;
    const k =
      l.o <= RAMP_O0 ? 1 : 0.5 + 0.5 * Math.cos(((l.o - RAMP_O0) / (RAMP_O1 - RAMP_O0)) * Math.PI);
    y += cw * -MOUNTAIN.topY * k;
    alley = Math.max(alley, cw * smoothstep(RAMP_O1, RAMP_O1 - 6, l.o));
  }
  out.y = y;
  out.track = track * (1 - alley);
  out.alley = alley;
  out.side = side;
  out.dist = dist;
  return out;
}

const _s: TerrainSample = { y: 0, track: 0, alley: 0, side: 0, dist: 0 };

/** Terrain height at (x, z). */
export function terrainHeight(x: number, z: number): number {
  return sampleTerrain(x, z, _s).y;
}

/** Inside an alley corridor (between its walls, past the facade line)? */
export function inAlley(x: number, z: number, margin = 0.05): boolean {
  for (const al of ALLEYS) {
    const l = worldToAlley(al, x, z, _l);
    if (l.o >= ALLEY_O0 && Math.abs(l.a - al.a) <= al.width / 2 + margin) return true;
  }
  return false;
}

/**
 * Where the terrain is a real, collidable surface: everything outside the
 * city square plus the alley corridors. Inside the city it doesn't exist
 * (the baked level owns the ground there).
 */
export function terrainInDomain(x: number, z: number): boolean {
  if (Math.max(Math.abs(x), Math.abs(z)) >= MOUNTAIN.wallZ) return true;
  return inAlley(x, z);
}

/**
 * Height used for the *rendered* mesh: the real surface outside the ring
 * and along the alleys (just under the sidewalk at their mouths), sunk out
 * of sight everywhere under the city.
 */
export function meshHeight(x: number, z: number, out: TerrainSample): TerrainSample {
  sampleTerrain(x, z, out);
  if (Math.max(Math.abs(x), Math.abs(z)) >= MOUNTAIN.wallZ - 2) return out;
  for (const al of ALLEYS) {
    const l = worldToAlley(al, x, z, _l);
    if (Math.abs(l.a - al.a) > al.width / 2 + 6 || l.o < ALLEY_O0 - 5) continue;
    if (l.o < ALLEY_O0) out.y = -0.06;
    return out;
  }
  out.y = MOUNTAIN.topY - 10;
  return out;
}

/** Surface type for friction / HUD: 'track' (dirt), 'grass', 'alley' or null. */
export function terrainSurface(x: number, z: number): 'track' | 'grass' | 'alley' | null {
  if (!terrainInDomain(x, z)) return null;
  const s = sampleTerrain(x, z, _s);
  if (s.alley > 0.5) return 'alley';
  return s.track > 0.35 ? 'track' : 'grass';
}

/** Cheap colour-variation noise in [-1, 1] (for vertex tints). */
export function tintNoise(x: number, z: number): number {
  return vnoise(x / 23, z / 23, SEED + 51) * 0.7 + vnoise(x / 6.5, z / 6.5, SEED + 53) * 0.3;
}

/** Upward unit normal of the terrain at (x, z) (central differences). */
export function terrainNormal(x: number, z: number, out: { x: number; y: number; z: number }) {
  const e = 0.2;
  const dx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
  const dz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
  const l = Math.sqrt(dx * dx + 1 + dz * dz);
  out.x = -dx / l;
  out.y = 1 / l;
  out.z = -dz / l;
  return out;
}

/**
 * Sphere-traced ray vs the analytic heightfield. `dir` must be unit length.
 * Returns the hit distance, or -1. A ray that starts underground and points
 * down reports a hit at 0 (callers then snap back up to the surface).
 */
export function raycastTerrain(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  far: number,
): number {
  // Quick reject: the whole segment is inside the city (the square is convex)
  const ex = ox + dx * far;
  const ez = oz + dz * far;
  const lim = ALLEY_O0 - 0.5;
  if (Math.max(Math.abs(ox), Math.abs(oz)) < lim && Math.max(Math.abs(ex), Math.abs(ez)) < lim)
    return -1;
  const h = Math.hypot(dx, dz);
  const rate = TERRAIN_LIPSCHITZ * h + Math.max(0, -dy);
  let t = 0;
  let px = ox;
  let pz = oz;
  let gap = oy - terrainHeight(ox, oz);
  if (gap < 0) {
    if (dy < -0.2 && terrainInDomain(ox, oz)) return 0;
    return -1;
  }
  let prevT = 0;
  for (let i = 0; i < 128; i++) {
    if (gap < 0.002) {
      if (!terrainInDomain(px, pz)) return -1;
      return t;
    }
    prevT = t;
    const step = rate > 1e-6 ? Math.max(0.015, (gap / rate) * 0.95) : far + 1;
    t += step;
    if (t > far) t = far;
    px = ox + dx * t;
    pz = oz + dz * t;
    gap = oy + dy * t - terrainHeight(px, pz);
    if (gap < 0) {
      // Bisect between the last point above and this one below
      let a = prevT;
      let b = t;
      for (let k = 0; k < 10; k++) {
        const m = (a + b) * 0.5;
        const g = oy + dy * m - terrainHeight(ox + dx * m, oz + dz * m);
        if (g > 0) a = m;
        else b = m;
      }
      const tt = (a + b) * 0.5;
      if (!terrainInDomain(ox + dx * tt, oz + dz * tt)) return -1;
      return tt;
    }
    if (t >= far) return -1;
  }
  return -1;
}
