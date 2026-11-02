// ── The ocean off Puerto Noun: coastline, seabed, terrain hook (pure) ─────
//
// The world is an endless cone (the city is the summit), so a level sea
// can't just fill the low ground: everything ~25 km out would drown. The
// ocean is a bounded basin cut into the slope on Puerto Noun's far side,
// beyond its lagoon, in the town's own frame (towns/site.ts: u down the
// main line, v' across, + = the beach side):
//
//                         v'
//      uphill arm          ↑          downhill arm
//   (curves away slowly)   │    (curves away fast: the main line
//          ╲               │     swings to this side further down)
//           ╲   OPEN SEA   │              ╱
//            ╲             │            ╱
//   ───────────╲───────────┼──────────╱──────── shore v' = COAST.shore
//       lagoon + town      │   (u = 0 … Lf, the beach)
//
// - The shore is a curve v'_s(u): straight in front of the town, bending
//   out into parabolic arms past either end of it (coves far along them),
//   and a far ring COAST.far from the beach closes the basin.
// - dIn (shoreDist) is the signed distance into the sea (≈ exact: Lipschitz
//   ~1), the one coordinate the seabed, the waves and the GPU all use.
// - Seabed: a gentle surf-zone slope (waves break ~100–140 m out) then
//   down to the deep.
// - Land near the shore is clamped into a band: never under the sea (a dune
//   berm where the slope falls away, downhill), never steeper than ~0.85
//   (the uphill shore rises into hills); further out it's untouched.
//
// Dirt lines that cross the basin go under (they end on a beach); the main
// line and every town stay well clear (ocean.test.ts checks it).

import { smoothstep } from '../world/mountain/config';
import { townCoords, townFrame, townFrameNow, type TownFrame } from '../towns/site';

export const COAST = {
  /** v' of the shoreline in front of the town (the lagoon's rim ends at 118). */
  shore: 132,
  /** Sea level under the town's pad (m). */
  seaDown: 1.6,
  /** Downhill arm: from u = dnU the shore bends out as dnK·(u − dnU)². */
  dnU: 260,
  dnK: 0.0025,
  /** Uphill arm: from u = upU, upK·(upU − u)². */
  upU: -150,
  upK: 0.0007,
  /** Coves along the arms, faded in this far (|u − beach|) from the beach. */
  cove0: 500,
  cove1: 900,
  /** The far ring closing the basin (m from the beach centre). */
  far: 3200,
  /** Land out to this far from the shore is clamped into the shore band (m). */
  reach: 1200,
} as const;

export const SEABED = {
  /** Surf zone: depth = slope · d out to surfEnd (3.1 m there). */
  slope: 0.022,
  surfEnd: 140,
  /** Then down to `deep` by deepEnd. */
  deep: 28,
  deepEnd: 900,
} as const;

/** The land band near the shore (height over the sea, t = metres inland). */
export const BAND = {
  hi1: 0.06,
  hi2: 0.0035,
  hiMax: 0.85,
  /** Never under the sea: rises 0.04/m to a berm `loTop` over the sea, flat to loFlat, then falls. */
  lo1: 0.04,
  loTop: 1.6,
  loFlat: 40,
  loFall: 0.7,
} as const;

/** The ocean's frame: Puerto Noun's town frame plus the sea level. */
export interface CoastFrame {
  town: TownFrame;
  ox: number;
  oz: number;
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  side: number;
  /** Sea level (world y). */
  sea: number;
  /** Beach centre along the line (u). */
  uB: number;
  /** World AABB of everything the basin touches. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

let cached: CoastFrame | null = null;

function make(f: TownFrame): CoastFrame {
  const uB = f.Lf / 2;
  const R = COAST.far + COAST.reach + 10;
  // Beach centre (world) ± the far ring + reach
  const v = COAST.shore * f.side;
  const cx = f.ox + f.fx * uB + f.rx * v;
  const cz = f.oz + f.fz * uB + f.rz * v;
  cached = {
    town: f,
    ox: f.ox,
    oz: f.oz,
    fx: f.fx,
    fz: f.fz,
    rx: f.rx,
    rz: f.rz,
    side: f.side,
    sea: f.P - COAST.seaDown,
    uB,
    x0: cx - R,
    z0: cz - R,
    x1: cx + R,
    z1: cz + R,
  };
  return cached;
}

/** The frame, or null while Puerto Noun's site isn't fixed yet (never grows the network). */
export function coastFrame(): CoastFrame | null {
  if (cached !== null) return cached;
  const f = townFrame('beach');
  return f === null ? null : make(f);
}

/** The frame, growing the line as far as needed (spawns, tests). */
export function coastFrameNow(): CoastFrame | null {
  if (cached !== null) return cached;
  const f = townFrameNow('beach');
  return f === null ? null : make(f);
}

/** Cove wiggle along the arms (m of v'), and its slope. */
function cove(u: number, uB: number): [number, number] {
  const w = smoothstep(COAST.cove0, COAST.cove1, Math.abs(u - uB));
  if (w <= 0) return [0, 0];
  const a = u / 160 + 1;
  const b = u / 63 + 2;
  return [
    w * (35 * Math.sin(a) + 20 * Math.sin(b)),
    w * ((35 / 160) * Math.cos(a) + (20 / 63) * Math.cos(b)),
  ];
}

/** Shoreline v'_s(u) and its slope dv'_s/du. */
export function shoreLine(u: number, uB: number, out: [number, number] = [0, 0]) {
  let v: number = COAST.shore;
  let dv = 0;
  if (u > COAST.dnU) {
    const e = u - COAST.dnU;
    v += COAST.dnK * e * e;
    dv += 2 * COAST.dnK * e;
  } else if (u < COAST.upU) {
    const e = COAST.upU - u;
    v += COAST.upK * e * e;
    dv -= 2 * COAST.upK * e;
  }
  const [cv, cd] = cove(u, uB);
  out[0] = v + cv;
  out[1] = dv + cd;
  return out;
}

const _sl: [number, number] = [0, 0];

/** Signed distance into the sea (m; < 0 on land) at town coords (u, v'). */
export function shoreDistUV(u: number, vp: number, uB: number): number {
  shoreLine(u, uB, _sl);
  const dPar = (vp - _sl[0]) / Math.sqrt(1 + _sl[1] * _sl[1]);
  const dCirc = COAST.far - Math.hypot(u - uB, vp - COAST.shore);
  return Math.min(dPar, dCirc);
}

export interface CoastPoint {
  /** Distance into the sea (m, < 0 inland). */
  d: number;
  /** Along the coast (m from the beach centre, + = down the line). */
  a: number;
  u: number;
  vp: number;
}

/** World → coast coords (reused object). */
export function coastAt(c: CoastFrame, x: number, z: number, out: CoastPoint): CoastPoint {
  const tc = townCoords(c.town, x, z);
  out.u = tc.u;
  out.vp = tc.vp;
  out.a = tc.u - c.uB;
  out.d = shoreDistUV(tc.u, tc.vp, c.uB);
  return out;
}

/** Shoreward unit direction at a world point (−∇d, horizontal), into `out`. */
export function shoreward(c: CoastFrame, x: number, z: number, out: { x: number; z: number }) {
  const e = 0.75;
  const tc = townCoords(c.town, x, z);
  const u = tc.u;
  const vp = tc.vp;
  const du = (shoreDistUV(u + e, vp, c.uB) - shoreDistUV(u - e, vp, c.uB)) / (2 * e);
  const dv = (shoreDistUV(u, vp + e, c.uB) - shoreDistUV(u, vp - e, c.uB)) / (2 * e);
  // town (u, v') gradient → world: ∂/∂x = du·fx + dv·rx·side …
  let gx = du * c.fx + dv * c.rx * c.side;
  let gz = du * c.fz + dv * c.rz * c.side;
  const l = Math.hypot(gx, gz) || 1;
  gx /= l;
  gz /= l;
  out.x = -gx;
  out.z = -gz;
  return out;
}

/** Water depth of the seabed at distance d into the sea (m). */
export function seabedDepth(d: number): number {
  if (d <= 0) return 0;
  if (d < SEABED.surfEnd) return SEABED.slope * d;
  const d0 = SEABED.slope * SEABED.surfEnd;
  return d0 + (SEABED.deep - d0) * smoothstep(SEABED.surfEnd, SEABED.deepEnd, d);
}

/** The shore band's upper bound, t metres inland (height over the sea). */
export function bandHi(t: number): number {
  const tc = (BAND.hiMax - BAND.hi1) / (2 * BAND.hi2);
  if (t <= tc) return BAND.hi1 * t + BAND.hi2 * t * t;
  return BAND.hi1 * tc + BAND.hi2 * tc * tc + BAND.hiMax * (t - tc);
}

/** …and its lower bound (a berm: never under the sea near the water). */
export function bandLo(t: number): number {
  const tr = BAND.loTop / BAND.lo1;
  if (t <= tr) return BAND.lo1 * t;
  if (t <= BAND.loFlat) return BAND.loTop;
  return BAND.loTop - BAND.loFall * (t - BAND.loFlat);
}

const _cp: CoastPoint = { d: 0, a: 0, u: 0, vp: 0 };

/**
 * terrain.ts → sampleTerrain: carve the basin (last, after the town pads).
 * Under the sea the seabed replaces everything; near the shore the land is
 * clamped into the band.
 */
export function applyOcean(
  x: number,
  z: number,
  out: { y: number; track: number; sand?: number },
): void {
  const c = coastFrame();
  if (c === null || x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) return;
  const d = coastAt(c, x, z, _cp).d;
  if (d >= 0) {
    out.y = c.sea - seabedDepth(d);
    out.track = 0;
    out.sand = 1;
    return;
  }
  const t = -d;
  if (t > COAST.reach) return;
  const rel = out.y - c.sea;
  const lo = bandLo(t);
  const hi = bandHi(t);
  const r = rel < lo ? lo : rel > hi ? hi : rel;
  out.y = c.sea + r;
  // Sand: the beach and the dunes (low ground near the water)
  if (t < 160) {
    const s = (1 - smoothstep(2.5, 7, r)) * (1 - smoothstep(110, 160, t));
    // (a dirt line keeps its dirt down to the water)
    if (s > 0) out.sand = Math.max(out.sand ?? 0, s * (1 - out.track));
  }
}

/** Under the sea or on the beach (keep the trees, rocks, drops off it). */
export function oceanBlocked(x: number, z: number, margin = 30): boolean {
  const c = coastFrame();
  if (c === null || x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) return false;
  return coastAt(c, x, z, _cp).d > -margin;
}

/** Sea level, or null when the ocean isn't placed yet. */
export function seaLevel(): number | null {
  return coastFrame()?.sea ?? null;
}

/** Test hook: forget the cached frame. */
export function resetCoast() {
  cached = null;
}
