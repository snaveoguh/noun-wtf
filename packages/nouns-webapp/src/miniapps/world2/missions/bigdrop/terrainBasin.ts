// ── The Big Drop's basin: the snowfield at the bottom (pure) ────────────
//
// Past the end of the race line the cone eases out onto the snowfield, 1,000
// km down. Without this it was a flat white plane. Now, after a powder
// runout that bleeds off the ~13,000 km/h you arrive with (basinBrake;
// peak.ts applies it), the snowfield rolls: long valleys and swells, a
// network of canyons to drop into and pump out of, and kickers scattered
// all over it (a jittered grid, each one facing out from the summit, the
// way you arrive). The kickers use the track's lip-tip profile
// (track.ts kickerProfile), so the board really leaves the lip instead of
// rolling over a smooth crest. Everything is a function of radial distance
// from the summit, so the basin is the same whichever way you came down.

import { hash2, smoothstep, vnoise } from '../../world/mountain/config';

import { PEAK } from './terrainPeak';
import { CARVE, kickerProfile, type KickerShape } from './track';

export const BASIN = {
  /** Where the slope has eased out onto the snowfield (m out from the pad's edge). */
  start: PEAK.drop / PEAK.grade + PEAK.ease,
  /** The relief grows in from start + `rampFrom` to start + `rampTo` (m). */
  rampFrom: 2_000,
  rampTo: 14_000,
  /** Kickers appear once the relief is at least this far in (0..1). */
  kickFrom: 0.55,
  /** Kicker grid cell (m); about `kickOdds` of the cells have one. */
  cell: 420,
  kickOdds: 0.62,
  /** Runout: speed above `cruise` (m/s) decays with time constant `tau` (s). */
  cruise: 70,
  tau: 2.6,
  /** The runout starts this far before `start` (m), where the slope eases. */
  brakeFrom: -1_500,
} as const;

const SEED = 0x62617369;

/** How far the basin's relief is in at `s` m out from the pad (0..1). */
export function basinWeight(s: number): number {
  return smoothstep(BASIN.start + BASIN.rampFrom, BASIN.start + BASIN.rampTo, s);
}

/** True `s` m out from the pad's edge is on (or into) the basin's runout. */
export function inBasin(s: number): boolean {
  return s > BASIN.start + BASIN.brakeFrom;
}

/**
 * The runout brake: deep powder pulls anything over BASIN.cruise down
 * toward it (excess speed halves every ~1.8 s), so 3,700 m/s on arrival is
 * a cruise ~10 km later. Below cruise it leaves the speed alone.
 */
export function basinBrake(speed: number, s: number, dt: number): number {
  if (!inBasin(s) || speed <= BASIN.cruise) return speed;
  // Eases in over the first km so the arrival isn't a wall
  const k = smoothstep(BASIN.start + BASIN.brakeFrom, BASIN.start + BASIN.brakeFrom + 1_000, s);
  return BASIN.cruise + (speed - BASIN.cruise) * Math.exp((-k * dt) / BASIN.tau);
}

/** Canyons: 0 on the open snowfield, 1 on a canyon floor. */
function canyon(x: number, z: number): number {
  const n = vnoise(x / 4200, z / 4200, SEED + 4);
  const t = 1 - Math.abs(n);
  return t * t * t * t * t * t;
}

/** The rolling snowfield without kickers (m, relative to the flat), full strength. */
export function basinRolling(x: number, z: number): number {
  const swell =
    110 * vnoise(x / 2400, z / 2400, SEED + 1) +
    45 * vnoise(x / 800, z / 800, SEED + 2) +
    12 * vnoise(x / 260, z / 260, SEED + 3);
  return swell - 170 * canyon(x, z);
}

// ── Kickers ─────────────────────────────────────────────────────────────

/** A basin kicker: centre, facing (unit, the way you ride at it), shape. */
export interface BasinKicker {
  x: number;
  z: number;
  dx: number;
  dz: number;
  shape: KickerShape;
}

const DEG = Math.PI / 180;

/** A kicker on the flat: lip `h` m high, leaving at `alpha` (rad). */
export function flatKicker(h: number, alpha: number): KickerShape {
  const p = Math.tan(alpha);
  const pt = Math.tan(alpha + CARVE.tipAngle);
  const tip = CARVE.tipLen;
  const lt = h / p;
  const ls = Math.max(tip + 2, (h - pt * tip) / p - lt / 2 + tip);
  const hh = p * (lt / 2 + ls - tip) + pt * tip;
  const pb1 = Math.tan(CARVE.backAngle);
  const lb1 = CARVE.backLen;
  // A long landing ramp down the back
  const pb2 = Math.tan(12 * DEG);
  const lb2 = Math.max(0, (hh - pb1 * lb1) / pb2);
  const lip = lt + ls;
  const halfW = 18 + 2.2 * hh;
  // Flight on the flat at the basin's cruise: T = 2 v sin(alpha) / g
  const v = BASIN.cruise;
  const g = 5;
  const hang = (2 * v * Math.sin(alpha)) / g;
  return {
    s: 0,
    lt,
    ls,
    tip,
    pt,
    lb1,
    lb2,
    p,
    pb1,
    pb2,
    h: hh,
    lip,
    end: lip + lb1 + lb2,
    halfW,
    shoulder: Math.max(20, 2.5 * hh),
    alpha,
    beta: CARVE.backAngle,
    speed: v,
    hang,
    landAt: lip + v * Math.cos(alpha) * hang,
  };
}

/** Kickers by grid cell (they're asked for per terrain vertex: build each once). */
const cells = new Map<number, BasinKicker | null>();

/** The kicker in grid cell (i, j), or null (deterministic; shared, don't modify). */
export function basinKickerIn(i: number, j: number): BasinKicker | null {
  const key = i * 131072 + j;
  const hit = cells.get(key);
  if (hit !== undefined) return hit;
  if (cells.size > 8192) cells.clear();
  const k = buildKicker(i, j);
  cells.set(key, k);
  return k;
}

function buildKicker(i: number, j: number): BasinKicker | null {
  if (hash2(i, j, SEED + 10) > BASIN.kickOdds) return null;
  const C = BASIN.cell;
  const x = (i + 0.2 + 0.6 * hash2(i, j, SEED + 11)) * C;
  const z = (j + 0.2 + 0.6 * hash2(i, j, SEED + 12)) * C;
  const s = Math.hypot(x, z) - PEAK.pad;
  if (basinWeight(s) < BASIN.kickFrom) return null;
  // Never in a canyon: its walls are steep enough already
  if (canyon(x, z) > 0.12) return null;
  // Facing out from the summit, give or take 20°
  const a = Math.atan2(x, z) + (hash2(i, j, SEED + 13) - 0.5) * 40 * DEG;
  const u = hash2(i, j, SEED + 14);
  // Mostly 4–11 m, a quarter 11–16 m, the odd 20 m+ monster
  const h = u < 0.05 ? 20 + 80 * u : u < 0.3 ? 11 + 5 * hash2(i, j, SEED + 15) : 4 + 7 * u;
  const alpha = (15 + 9 * hash2(i, j, SEED + 16)) * DEG;
  return { x, z, dx: Math.sin(a), dz: Math.cos(a), shape: flatKicker(h, alpha) };
}

/** Height (m) a kicker adds at (x, z), relative to the ground under it. */
export function kickerHeightAt(k: BasinKicker, x: number, z: number): number {
  const ox = x - k.x;
  const oz = z - k.z;
  const sh = k.shape;
  // Ramp foot `lip` m before the centre, so the lip sits on it
  const u = ox * k.dx + oz * k.dz + sh.lip;
  if (u <= 0 || u >= sh.end) return 0;
  const v = Math.abs(ox * k.dz - oz * k.dx);
  if (v >= sh.halfW + sh.shoulder) return 0;
  const side = v <= sh.halfW ? 1 : 1 - smoothstep(0, sh.shoulder, v - sh.halfW);
  return kickerProfile(sh, u) * side;
}

/** Sum of the kickers around (x, z) (m). */
function kickers(x: number, z: number): number {
  const C = BASIN.cell;
  const ci = Math.floor(x / C);
  const cj = Math.floor(z / C);
  let h = 0;
  for (let j = cj - 1; j <= cj + 1; j++)
    for (let i = ci - 1; i <= ci + 1; i++) {
      const k = basinKickerIn(i, j);
      if (k !== null) h = Math.max(h, kickerHeightAt(k, x, z));
    }
  return h;
}

/** Kickers whose centre is within `r` m of (x, z) (fresh objects; for scenery, not per frame). */
export function basinKickersNear(x: number, z: number, r: number): BasinKicker[] {
  const C = BASIN.cell;
  const out: BasinKicker[] = [];
  for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++)
    for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) {
      const k = basinKickerIn(i, j);
      if (k !== null && Math.hypot(k.x - x, k.z - z) <= r) out.push(k);
    }
  return out;
}

/**
 * Paint for the snow at (x, z) on a kicker: 0 off them, up to 1 on the ramp
 * (icy blue, deepening toward the lip), 2 on the red dye line across the lip.
 */
export function basinKickerPaint(x: number, z: number): number {
  const C = BASIN.cell;
  const ci = Math.floor(x / C);
  const cj = Math.floor(z / C);
  let best = 0;
  for (let j = cj - 1; j <= cj + 1; j++)
    for (let i = ci - 1; i <= ci + 1; i++) {
      const k = basinKickerIn(i, j);
      if (k === null) continue;
      const sh = k.shape;
      const ox = x - k.x;
      const oz = z - k.z;
      const u = ox * k.dx + oz * k.dz + sh.lip;
      if (u <= 0 || u >= sh.lip + 2) continue;
      if (Math.abs(ox * k.dz - oz * k.dx) > sh.halfW) continue;
      if (u > sh.lip - 2.5) return 2;
      best = Math.max(best, u / sh.lip);
    }
  return best;
}

/**
 * The basin's relief at (x, z), `s` m out from the pad's edge: 0 up the
 * mountain, the rolling snowfield and its kickers once out on the flat.
 */
export function basinRelief(x: number, z: number, s: number): number {
  const w = basinWeight(s);
  if (w <= 0) return 0;
  return w * basinRolling(x, z) + kickers(x, z);
}
