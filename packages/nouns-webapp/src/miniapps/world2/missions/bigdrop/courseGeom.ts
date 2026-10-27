// ── The Big Drop's SSX course: where things sit, and the caves' shape (pure) ──
//
// Turns the course's track-terms layout (courseSpec.ts) into peak
// coordinates: points on the main line or THE SPLIT's shortcut, rail
// polylines riding the snow, boost-pad footprints, and the caves' cross
// sections. No three.js: the props system (courseProps.ts) builds meshes
// and colliders from these arrays, and the tests check them.

import type { Cave, CourseLine, RailSpec } from './courseSpec';

import { peakHeight } from '../peakTerrain';

import { BRANCH, courseBulge, courseBulgeSlope, onBranch } from './courseSpec';
import { centerX, widthAt } from './track';

/** A point of a line at track distance s: the centre, its heading and its lateral unit vector. */
export interface LineFrame {
  /** Centre line (peak x, z). */
  x: number;
  z: number;
  /** Unit heading in xz (downhill along the line). */
  dirX: number;
  dirZ: number;
  /** Unit lateral (+ toward +x) in xz. */
  sideX: number;
  sideZ: number;
  /** Lane half width (m). */
  half: number;
}

/** The frame of `line` at track distance `s`. */
export function lineFrame(line: CourseLine, s: number, out: LineFrame): LineFrame {
  const branch = line === 'branch' && onBranch(s);
  const b = branch ? courseBulge(s) : 0;
  const db = branch ? courseBulgeSlope(s) : 0;
  const x = centerX(s) - b;
  const dx = (centerX(s + 0.5) - centerX(s - 0.5)) / 1 - db;
  const l = Math.hypot(dx, 1);
  out.x = x;
  out.z = s;
  out.dirX = dx / l;
  out.dirZ = 1 / l;
  out.sideX = 1 / l;
  out.sideZ = -dx / l;
  out.half = branch ? BRANCH.half : widthAt(s) / 2;
  return out;
}

/** Peak (x, z) of the point `lat` m off `line` at s, and the snow height there. */
export function linePoint(
  line: CourseLine,
  s: number,
  lat: number,
  out: { x: number; y: number; z: number },
  f: LineFrame = _f,
): { x: number; y: number; z: number } {
  lineFrame(line, s, f);
  out.x = f.x + f.sideX * lat;
  out.z = f.z + f.sideZ * lat;
  out.y = peakHeight(out.x, out.z);
  return out;
}

const _f: LineFrame = { x: 0, z: 0, dirX: 0, dirZ: 1, sideX: 1, sideZ: 0, half: 0 };
const _p = { x: 0, y: 0, z: 0 };

/** A rail's polyline (peak coordinates, flat [x, y, z, …]): `h` m over the snow every `step` m. */
export function railPoints(r: RailSpec, step = 3): number[] {
  const out: number[] = [];
  const n = Math.max(2, Math.ceil((r.s1 - r.s0) / step) + 1);
  for (let i = 0; i < n; i++) {
    const s = r.s0 + ((r.s1 - r.s0) * i) / (n - 1);
    linePoint(r.line, s, r.lat, _p);
    out.push(_p.x, _p.y + r.h, _p.z);
  }
  return out;
}

// ── Caves ───────────────────────────────────────────────────────────────

/** Points across the inner arch, and how far the outer shell sits off it (m). */
export const CAVE_SEG = 14;
export const CAVE_SHELL = 2.2;
/** The walls run this far down into the snow at the springs (no gap at the foot). */
export const CAVE_FOOT = 3;
/** The drift / rock thickens over this far in from each portal (m). */
export const CAVE_TAPER = 40;

/**
 * One cross section of a cave at track distance `s`, in peak coordinates:
 * `inner` and `outer` are flat [x, y, z, …] arrays of the same length
 * (CAVE_SEG + 3 points each: the buried foot on the +lat side, the arch
 * over, the buried foot on the −lat side), so ring k of one section joins
 * ring k of the next. The outer shell is the inner arch pushed out by
 * CAVE_SHELL plus the drift: thicker over the roof and spread out over the
 * snow either side, growing in from the portals.
 */
export function caveSection(
  cv: Cave,
  s: number,
  inner: number[],
  outer: number[],
): { inner: number[]; outer: number[] } {
  inner.length = 0;
  outer.length = 0;
  const f = lineFrame(cv.line, s, _cf);
  const R = cv.R;
  const yR = peakHeight(f.x + f.sideX * R, f.z + f.sideZ * R);
  const yL = peakHeight(f.x - f.sideX * R, f.z - f.sideZ * R);
  const taper = Math.min(1, (s - cv.s0) / CAVE_TAPER, (cv.s1 - s) / CAVE_TAPER);
  const t = Math.max(0, taper);
  const push = (arr: number[], lat: number, y: number) =>
    arr.push(f.x + f.sideX * lat, y, f.z + f.sideZ * lat);
  // The foot (+lat side)
  push(inner, R, yR - CAVE_FOOT);
  const spread = cv.mound * t;
  push(
    outer,
    R + CAVE_SHELL + spread,
    peakHeight(
      f.x + f.sideX * (R + CAVE_SHELL + spread),
      f.z + f.sideZ * (R + CAVE_SHELL + spread),
    ) - CAVE_FOOT,
  );
  for (let k = 0; k <= CAVE_SEG; k++) {
    const th = (Math.PI * k) / CAVE_SEG;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    const base = yR + (yL - yR) * (0.5 - 0.5 * c);
    push(inner, R * c, base + cv.H * sn);
    // The shell: out along the arch's normal, a drift over the roof, and
    // spread wide and low near the springs
    const roof = cv.look === 'ice' ? 4 : 2;
    const lat = (R + CAVE_SHELL) * c + Math.sign(c) * spread * (1 - sn) * (1 - sn);
    push(outer, lat, base + (cv.H + CAVE_SHELL + roof * t) * sn + CAVE_SHELL * (1 - sn) * 0.5);
  }
  push(inner, -R, yL - CAVE_FOOT);
  push(
    outer,
    -(R + CAVE_SHELL + spread),
    peakHeight(
      f.x - f.sideX * (R + CAVE_SHELL + spread),
      f.z - f.sideZ * (R + CAVE_SHELL + spread),
    ) - CAVE_FOOT,
  );
  return { inner, outer };
}

const _cf: LineFrame = { x: 0, z: 0, dirX: 0, dirZ: 1, sideX: 1, sideZ: 0, half: 0 };

/** Ring spacing along a cave (m of s). */
export const CAVE_RING = 4;

/** Whether a rider at peak (x, y, z) is inside cave `cv` (under its roof, between its walls). */
export function insideCave(cv: Cave, x: number, y: number, z: number): boolean {
  if (z < cv.s0 || z > cv.s1) return false;
  const f = lineFrame(cv.line, z, _cf);
  const lat = (x - f.x) * f.sideX + (z - f.z) * f.sideZ;
  if (Math.abs(lat) > cv.R) return false;
  return y < peakHeight(f.x, f.z) + cv.H + 30;
}
