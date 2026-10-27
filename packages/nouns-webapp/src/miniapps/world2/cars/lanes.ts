// ── The plaza's ring road: lanes, kerbside spots, traffic plan (pure) ─────
//
// The baked plaza (public/world2/level/plaza.glb) has a square ring road
// between the plaza kerb (|x| or |z| = 58) and the buildings' kerb (70),
// its surface at y = −0.15. Traffic keeps right:
//   outer lane  (65.4 out)  turns left at every corner, the buildings on its right;
//   inner lane  (61.8 out)  the other way round, the plaza on its right.
// A lane is a rounded square: four straights joined by quarter circles.
// The parked spots are where the level's own boxy cars stood (plaza.glb
// Props: car_* / tire materials); Traffic hides those and parks the fleet
// there instead, so the baked kerbside shadows still sit under a car.

import type { CarId } from './specs';

export const ROAD_Y = -0.15;
/** Kerb lines of the ring road (half-sizes, m). */
export const ROAD_IN = 58;
export const ROAD_OUT = 70;

export interface Lane {
  /** Half-size of the square (m) and corner radius. */
  R: number;
  r: number;
  /** +1: turns left at the corners (outer lane); −1: the reverse loop. */
  dir: 1 | -1;
}

export const LANES: readonly Lane[] = [
  { R: 65.4, r: 5, dir: 1 },
  { R: 61.8, r: 5, dir: -1 },
];

export interface LanePoint {
  x: number;
  z: number;
  /** Heading (rad, 0 = +Z, the game's yaw). */
  yaw: number;
}

/** Length of one lap of a lane (m). */
export function laneLength(l: Lane): number {
  const L = l.R - l.r;
  return 8 * L + 2 * Math.PI * l.r;
}

/**
 * Where on the lane `s` metres along it is (any s; it wraps). s = 0 is the
 * middle of the south side (z = +R).
 */
export function lanePoint(l: Lane, s: number, out: LanePoint): LanePoint {
  const P = laneLength(l);
  const L = l.R - l.r;
  const U = P / 4;
  let sp = ((s % P) + P) % P;
  if (l.dir === -1) sp = P - sp;
  const u = (sp + L) % P;
  const k = Math.min(3, Math.floor(u / U));
  const t = u - k * U;
  let x: number;
  let z: number;
  let yaw: number;
  if (t < 2 * L) {
    x = -L + t;
    z = l.R;
    yaw = Math.PI / 2;
  } else {
    const th = (t - 2 * L) / l.r;
    x = L + l.r * Math.sin(th);
    z = L + l.r * Math.cos(th);
    yaw = Math.PI / 2 + th;
  }
  // Side k: the south side's frame turned k quarter turns (yaw + k·90°)
  const a = (k * Math.PI) / 2;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  out.x = x * c + z * sn;
  out.z = z * c - x * sn;
  out.yaw = wrapAngle(yaw + a + (l.dir === -1 ? Math.PI : 0));
  return out;
}

/** Nearest point's arclength on a lane (coarse search + refine). */
export function nearestS(l: Lane, x: number, z: number): { s: number; d: number } {
  const P = laneLength(l);
  const p: LanePoint = { x: 0, z: 0, yaw: 0 };
  let best = 0;
  let bestD = Infinity;
  for (let s = 0; s < P; s += 1) {
    lanePoint(l, s, p);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  for (let s = best - 1; s <= best + 1; s += 0.05) {
    lanePoint(l, s, p);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return { s: ((best % P) + P) % P, d: bestD };
}

/** The level's ten kerbside spots (the baked cars' centres). */
export const PARK_SPOTS: readonly [number, number][] = [
  [-45.0, 68.8],
  [-31.3, 68.8],
  [36.0, 68.8],
  [-47.0, -68.8],
  [-27.5, -68.8],
  [20.9, -68.8],
  [51.7, -68.8],
  [-68.8, -15.7],
  [59.1, -15.8],
  [68.8, -48.3],
];

export interface ParkSpot {
  x: number;
  z: number;
  yaw: number;
}

/** A spot facing the way traffic flows in the lane beside it. */
export function parkSpot(i: number): ParkSpot {
  const [x, z] = PARK_SPOTS[i];
  let lane = LANES[0];
  let best = Infinity;
  for (const l of LANES) {
    const d = Math.abs(Math.max(Math.abs(x), Math.abs(z)) - l.R);
    if (d < best) {
      best = d;
      lane = l;
    }
  }
  const p: LanePoint = { x: 0, z: 0, yaw: 0 };
  lanePoint(lane, nearestS(lane, x, z).s, p);
  return { x, z, yaw: p.yaw };
}

export interface ParkedPlan {
  kind: 'parked';
  car: CarId;
  paint: number;
  spot: number;
}

export interface CruisePlan {
  kind: 'cruise';
  car: CarId;
  paint: number;
  lane: number;
  s: number;
  /** Cruising speed (m/s): slow, so you can walk up and take it. */
  speed: number;
}

export type TrafficPlan = ParkedPlan | CruisePlan;

/** Cars that cruise (the monster truck stays parked: it'd flatten the plaza). */
const CRUISERS: readonly CarId[] = [
  'bubble',
  'dip',
  'cavallino',
  'kaido',
  'bruiser',
  'roadstar',
  'toro',
];

/**
 * Who parks where and who cruises. Every car in `fleet` gets a kerbside
 * spot first (so the whole fleet is always there to try), then `cruisers`
 * cars loop the two lanes, spread out. Deterministic for a seed.
 */
export function planTraffic(
  fleet: readonly CarId[],
  opts: { seed: number; cruisers: number; paints: (id: CarId) => number },
): TrafficPlan[] {
  const rand = mulberry(opts.seed);
  const spots = PARK_SPOTS.map((_, i) => i);
  shuffle(spots, rand);
  const out: TrafficPlan[] = [];
  const cars = [...fleet];
  shuffle(cars, rand);
  for (let i = 0; i < cars.length && i < spots.length; i++)
    out.push({ kind: 'parked', car: cars[i], paint: 0, spot: spots[i] });
  const pool = CRUISERS.filter(c => fleet.includes(c));
  shuffle(pool, rand);
  const n = Math.min(opts.cruisers, pool.length);
  for (let i = 0; i < n; i++) {
    const lane = i % LANES.length;
    const perLane = Math.ceil(n / LANES.length);
    const slot = Math.floor(i / LANES.length);
    const P = laneLength(LANES[lane]);
    const car = pool[i];
    out.push({
      kind: 'cruise',
      car,
      paint: 1 + Math.floor(rand() * Math.max(1, opts.paints(car) - 1)),
      lane,
      s: (P * (slot + 0.5 * lane + rand() * 0.3)) / perLane,
      speed: 5.5 + rand() * 2.5,
    });
  }
  return out;
}

/** Following: full speed with room, easing off inside 12 m, stopped inside 5.5 m. */
export function followSpeed(base: number, gap: number): number {
  if (gap <= 5.5) return 0;
  if (gap >= 12) return base;
  return (base * (gap - 5.5)) / 6.5;
}

/**
 * Gap (m) along the lane from a car at `s` to the nearest thing ahead of it
 * (`others` are arclengths on the same lane); Infinity if none.
 */
export function gapAhead(s: number, others: readonly number[], P: number): number {
  let best = Infinity;
  for (const o of others) {
    let d = o - s;
    d = ((d % P) + P) % P;
    if (d > 0.01 && d < best) best = d;
  }
  return best;
}

export function wrapAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(a: T[], rand: () => number) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}
