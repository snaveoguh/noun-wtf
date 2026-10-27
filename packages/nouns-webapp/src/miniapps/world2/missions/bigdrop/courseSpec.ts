// ── The Big Drop's SSX course: the layout, in track terms (pure) ─────────
//
// The first ~5 km of the track (track distance s = peak z) is a designed,
// timed course instead of an open plunge: a start gate under the summit
// pad, seven sections and a finish arch. Past the finish the line opens
// back up into the endless random track (track.ts), and the whole
// mountain round it stays free-ride.
//
//   DROP-IN    wide groomed run-in, a boost pad, a first rail, whoops
//   S-CURVES   tight banked berms left-right, rock arches over the line
//   BIG AIR    big kickers with long hang time
//   ICE CAVE   an ice tunnel over the gully, its exit kicks you out, then
//              the halfpipe gully
//   THE SPLIT  the line forks round a ridge: the SAFE line sweeps wide
//              over a banked turn and whoops; the SHORTCUT runs straight
//              through a rock tunnel and over a crevasse gap jump
//   RAIL YARD  rails, a log and a fence to grind, boost pads
//   FINAL DROP one last kicker over the finish
//
// ── Built for its speed ──
//
// The open mountain has no top speed (500 km/h in a minute); a course you
// can thread, rail and fly needs one. On the course's snow the board is
// governed to courseCap(s): 94 km/h off the start up to ~195 km/h at the
// bottom, ×1.45 while boosting. trackSpeed.ts integrates the same cap, so
// every kicker (track.ts designKicker) is cut for the speed you actually
// carry there, and landings match take-offs.
//
// Everything here is in track terms: a distance s, and a lateral offset
// (m, + toward +x) from a line: 'main' (the track's own centre line) or
// 'branch' (the shortcut, centerX(s) − courseBulge(s)). No three.js, and no
// import of track.ts (track.ts imports this).

import type { SectionKind } from './contract';

import { smoothstep } from '../../world/mountain/config';

import { PEAK } from './terrainPeak';

export const COURSE = {
  /** The start gate (s): the clock starts as you pass under it. */
  start: 40,
  /** The finish arch (s). */
  finish: 4980,
  /** The last course section ends here; the random track takes over. */
  end: 5100,
  /** The governor: design speed at the top and the bottom (m/s) … */
  v0: 26,
  v1: 54,
  /** … easing between these track distances. */
  rampFrom: 100,
  rampTo: 2400,
  /** How far past the lanes' edges the course snow (and its governor) reaches (m). */
  reach: 160,
} as const;

/** One designed section of the course (in order, from the summit pad). */
export interface CourseSection {
  name: string;
  kind: SectionKind;
  /** Where it ends (s). */
  s1: number;
  /** Lane width override (m). */
  width?: number;
  /** How much of the gentle cruise weave it keeps (overrides the kind's). */
  weave?: number;
  /** Slalom weave: amplitude and wavelength (m). */
  amp?: number;
  wave?: number;
}

export const COURSE_SECTIONS: readonly CourseSection[] = [
  { name: 'DROP-IN', kind: 'cruise', s1: 420, width: 56, weave: 0.4 },
  { name: 'S-CURVES', kind: 'slalom', s1: 1150, width: 38, amp: 28, wave: 240 },
  { name: 'BIG AIR', kind: 'jumps', s1: 2250, width: 46 },
  { name: 'ICE CAVE', kind: 'gully', s1: 3000 },
  { name: 'THE SPLIT', kind: 'cruise', s1: 3800, width: 40, weave: 0 },
  { name: 'RAIL YARD', kind: 'slalom', s1: 4300, width: 46, amp: 16, wave: 420 },
  { name: 'FINAL DROP', kind: 'jumps', s1: COURSE.end, width: 50 },
];

/** Name of the course section at `s` ('' off the course). */
export function courseSectionName(s: number): string {
  if (s < PEAK.pad || s > COURSE.end) return '';
  for (const c of COURSE_SECTIONS) if (s <= c.s1) return c.name;
  return '';
}

/** The governor's speed at `s` (m/s), Infinity off the course. */
export function courseCap(s: number): number {
  if (s > COURSE.end) return Infinity;
  return COURSE.v0 + (COURSE.v1 - COURSE.v0) * smoothstep(COURSE.rampFrom, COURSE.rampTo, s);
}

// ── The split ───────────────────────────────────────────────────────────

/**
 * THE SPLIT: between s0 and s1 the main (SAFE) line bulges `bulge` m out to
 * `side` and back (sin², so it leaves and rejoins tangentially), while the
 * SHORTCUT runs on along the unbulged line, `half` m either side.
 */
export const BRANCH = {
  s0: 3110,
  s1: 3790,
  bulge: 110,
  side: 1 as -1 | 1,
  half: 12,
  /** The gap jump: its kicker's foot (s), lip size (m) and the crevasse after the lip. */
  kickerS: 3420,
  kickerSize: 7,
  gapFrom: 10,
  gapLen: 100,
  gapDepth: 20,
} as const;

/** How far the main line is pushed out of its own path at `s` (m, signed). */
export function courseBulge(s: number): number {
  if (s <= BRANCH.s0 || s >= BRANCH.s1) return 0;
  const u = (s - BRANCH.s0) / (BRANCH.s1 - BRANCH.s0);
  const k = Math.sin(Math.PI * u);
  return BRANCH.side * BRANCH.bulge * k * k;
}

/** d(courseBulge)/ds. */
export function courseBulgeSlope(s: number): number {
  if (s <= BRANCH.s0 || s >= BRANCH.s1) return 0;
  const L = BRANCH.s1 - BRANCH.s0;
  const u = (s - BRANCH.s0) / L;
  return ((BRANCH.side * BRANCH.bulge * Math.PI) / L) * Math.sin(2 * Math.PI * u);
}

/** Whether the shortcut exists at `s`. */
export function onBranch(s: number): boolean {
  return s > BRANCH.s0 && s < BRANCH.s1;
}

// ── Features (track terms) ──────────────────────────────────────────────

export type CourseLine = 'main' | 'branch';

/** Whoops: rollers across the lane. */
export interface Roller {
  s0: number;
  s1: number;
  /** Crest height (m) and spacing (m of s). */
  amp: number;
  wave: number;
  line: CourseLine;
}

/** A tunnel over the line: an ice tube under a snow drift, or a rock bore. */
export interface Cave {
  id: string;
  look: 'ice' | 'rock';
  line: CourseLine;
  s0: number;
  s1: number;
  /** Half span (m from the line) where the walls spring from the snow. */
  R: number;
  /** Inner height of the roof over the springs (m). */
  H: number;
  /** The drift / rock round it reaches this far past the springs (m). */
  mound: number;
  /** Carve a trough under it (the gully already is one). */
  trough: boolean;
}

export interface RailSpec {
  id: string;
  look: 'rail' | 'log' | 'fence';
  line: CourseLine;
  s0: number;
  s1: number;
  /** Lateral offset (m) and height over the snow (m). */
  lat: number;
  h: number;
}

export interface BoostPad {
  id: string;
  s: number;
  lat: number;
  line: CourseLine;
}

/** A rock arch over the line (legs outside the lane). */
export interface RockArch {
  id: string;
  s: number;
}

export interface Checkpoint {
  s: number;
  name: string;
}

export const ROLLERS: readonly Roller[] = [
  { s0: 250, s1: 390, amp: 1.8, wave: 34, line: 'main' },
  { s0: 3200, s1: 3330, amp: 2.0, wave: 40, line: 'main' },
  { s0: 4215, s1: 4320, amp: 1.6, wave: 36, line: 'main' },
];

export const CAVES: readonly Cave[] = [
  // Over the gully once it's fully cut (its ends ramp over 160 m)
  {
    id: 'icecave',
    look: 'ice',
    line: 'main',
    s0: 2430,
    s1: 2570,
    R: 27,
    // (tall: the camera rides well back and up behind you)
    H: 24,
    mound: 26,
    trough: false,
  },
  // The shortcut's rock bore
  {
    id: 'bore',
    look: 'rock',
    line: 'branch',
    s0: 3280,
    s1: 3370,
    R: 15,
    H: 10,
    mound: 12,
    trough: true,
  },
];

/** The ice cave's exit kicker (a main-line kicker in the gully). */
export const CAVE_KICKER = { s: 2578, size: 5 } as const;

export const RAILS: readonly RailSpec[] = [
  { id: 'r-intro', look: 'rail', line: 'main', s0: 150, s1: 235, lat: 13, h: 1.1 },
  { id: 'r-split', look: 'log', line: 'main', s0: 3420, s1: 3520, lat: 8, h: 0.9 },
  // (past where a boosted air off the shortcut's gap comes down)
  { id: 'r-yard1', look: 'rail', line: 'main', s0: 3930, s1: 4050, lat: -9, h: 1.1 },
  { id: 'r-yard2', look: 'log', line: 'main', s0: 3950, s1: 4050, lat: 10, h: 0.9 },
  { id: 'r-yard3', look: 'rail', line: 'main', s0: 4080, s1: 4195, lat: 0, h: 1.2 },
  { id: 'r-yard4', look: 'fence', line: 'main', s0: 4100, s1: 4200, lat: -14, h: 1.0 },
];

export const BOOSTS: readonly BoostPad[] = [
  { id: 'b0', s: 115, lat: 0, line: 'main' },
  { id: 'b1', s: 640, lat: 0, line: 'main' },
  { id: 'b2', s: 1010, lat: 0, line: 'main' },
  { id: 'b3', s: 2385, lat: 0, line: 'main' },
  { id: 'b4', s: 3240, lat: 0, line: 'branch' },
  { id: 'b5', s: 3392, lat: 0, line: 'branch' },
  { id: 'b6', s: 3560, lat: 0, line: 'main' },
  { id: 'b7', s: 3820, lat: 0, line: 'main' },
  { id: 'b8', s: 4066, lat: 0, line: 'main' },
  { id: 'b9', s: 4330, lat: 0, line: 'main' },
];

export const ARCHES: readonly RockArch[] = [
  { id: 'a1', s: 560 },
  { id: 'a2', s: 920 },
];

export const CHECKPOINTS: readonly Checkpoint[] = [
  { s: 1150, name: 'CP 1' },
  { s: 2250, name: 'CP 2' },
  { s: 3000, name: 'CP 3' },
  { s: 3800, name: 'CP 4' },
];

/** Boost pad footprint: half width (m) and length (m of s). */
export const PAD = { half: 4, len: 9 } as const;

/** The trough a cave cuts under itself (depth, m) when `trough` is set. */
export const CAVE_TROUGH = 5;

/**
 * Extra lateral clearance (m from the main line) the course needs at `s`,
 * on top of the lane's: trees and rocks (scenery/placement.ts) stay out.
 * 0 where the plain lane rules are enough.
 */
export function courseClearLat(s: number): number {
  let c = 0;
  if (s > BRANCH.s0 - 40 && s < BRANCH.s1 + 40) c = Math.abs(courseBulge(s)) + BRANCH.half + 30;
  for (const cv of CAVES)
    if (s > cv.s0 - 60 && s < cv.s1 + 60) {
      const off = cv.line === 'branch' ? Math.abs(courseBulge((cv.s0 + cv.s1) / 2)) : 0;
      c = Math.max(c, off + cv.R + cv.mound + 12);
    }
  for (const a of ARCHES) if (Math.abs(s - a.s) < 30) c = Math.max(c, 60);
  return c;
}
