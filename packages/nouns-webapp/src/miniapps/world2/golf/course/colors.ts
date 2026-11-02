// ── Noun Golf: the colour of the ground, per lie (pure) ─────────────────
//
// One function for every surface that draws the course, so they meet
// without a seam:
//   - the view's overlay meshes (golf/view/overlays.ts): fairways, greens,
//     tees, bunkers, pads, paths and the OVERLAY_FRINGE m of rough round
//     each one;
//   - the mountain mesh under and between them (MountainStream's golf
//     hook): rough, deep rough and the OB ground, blended back into the
//     mountain's own grass over the last CORE_BLEND m inside the boundary.
//
// Colours are linear RGB (what three's vertex colours hold once a hex is
// read through ColorManagement), from sRGB hex here so they're easy to
// tune by eye.

import type { Lie } from '../contract';

import { vnoise } from '../../world/mountain/config';

import { BOUNDS, SITE, toCourse } from './site';
import { golfCourse, type GroundSample } from './surface';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

function lin(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

/** sRGB hex → linear RGB (matches THREE.Color.setHex with colour management on). */
export function hexLinear(hex: number): Rgb {
  return { r: lin(((hex >> 16) & 255) / 255), g: lin(((hex >> 8) & 255) / 255), b: lin((hex & 255) / 255) };
}

/** The palette (sRGB hex), bright like the rest of the game. */
export const LIE_HEX = {
  fairway: 0x74d24c,
  fairway2: 0x5fbd40,
  green: 0x8be35e,
  green2: 0x80d955,
  fringe: 0x6cc84a,
  tee: 0x78d550,
  rough: 0x4ea53b,
  deep: 0x3f9134,
  sand: 0xf1dfa4,
  path: 0xb8b2a6,
  water: 0x2f6f8f,
  ob: 0x5cc04a,
} as const;

const PAL: Record<keyof typeof LIE_HEX, Rgb> = Object.fromEntries(
  Object.entries(LIE_HEX).map(([k, v]) => [k, hexLinear(v)]),
) as Record<keyof typeof LIE_HEX, Rgb>;

const SEED = 0x60c0;

/**
 * The ground colour at (x, z) for a lie (+ the fairway's mowing stripe), in
 * linear RGB. Grass gets a little world-space variation; sand and paths a
 * touch of grain.
 */
export function lieColour(lie: Lie, stripe: number, x: number, z: number, out: Rgb): Rgb {
  let c: Rgb;
  let vary = 0.07;
  switch (lie) {
    case 'fairway':
      c = stripe === 1 ? PAL.fairway2 : PAL.fairway;
      vary = 0.04;
      break;
    case 'green':
      // A faint cross-mown check on the putting surface
      c = (Math.floor(x / 3) + Math.floor(z / 3)) & 1 ? PAL.green2 : PAL.green;
      vary = 0.02;
      break;
    case 'fringe':
      c = PAL.fringe;
      vary = 0.03;
      break;
    case 'tee':
      c = PAL.tee;
      vary = 0.03;
      break;
    case 'rough':
      c = PAL.rough;
      break;
    case 'deep':
      c = PAL.deep;
      vary = 0.1;
      break;
    case 'sand':
      c = PAL.sand;
      vary = 0.03;
      break;
    case 'path':
      c = PAL.path;
      vary = 0.04;
      break;
    case 'water':
      c = PAL.water;
      vary = 0.02;
      break;
    default:
      c = PAL.ob;
      vary = 0.1;
  }
  const n = vnoise(x / 17, z / 17, SEED) * 0.7 + vnoise(x / 4.5, z / 4.5, SEED + 1) * 0.3;
  const k = 1 + vary * n;
  out.r = c.r * k;
  out.g = c.g * k;
  out.b = c.b * k;
  return out;
}

/** The mountain's own colours fade in over this many metres inside the OB line. */
export const CORE_BLEND = 28;

const _uv = { u: 0, v: 0 };

/**
 * How much of the course's colour the mountain mesh takes at (x, z): 1 well
 * inside the boundary, easing to 0 at the OB line (and 0 outside it).
 */
export function coreWeight(x: number, z: number): number {
  toCourse(x, z, _uv);
  const inside = Math.min(_uv.u - SITE.U0, SITE.U1 - _uv.u, _uv.v - SITE.V0, SITE.V1 - _uv.v);
  if (inside <= 0) return 0;
  if (inside >= CORE_BLEND) return 1;
  const t = inside / CORE_BLEND;
  return t * t * (3 - 2 * t);
}

/** Does a world AABB touch the course's terraced area? (the cheap reject) */
export function overlapsCourse(x0: number, z0: number, x1: number, z1: number): boolean {
  return x1 >= BOUNDS.x0 && x0 <= BOUNDS.x1 && z1 >= BOUNDS.z0 && z0 <= BOUNDS.z1;
}

const _g: GroundSample = { lie: 'deep', stripe: 0, hole: 0 };

/**
 * The course's ground colour at (x, z) into `out`, and how much of it to
 * use over the mountain's own (coreWeight; 0 = leave the mountain alone).
 */
export function courseGroundColour(x: number, z: number, out: Rgb): number {
  const w = coreWeight(x, z);
  if (w <= 0) return 0;
  const g = golfCourse().ground(x, z, _g);
  lieColour(g.lie, g.stripe, x, z, out);
  return w;
}
