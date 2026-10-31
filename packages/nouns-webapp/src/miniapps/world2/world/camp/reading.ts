// ── The opening shot's last beat: the rider flicks through MEME VALUE ────
//
// One continuous shot: the fly-in comes through the window straight at the
// open book in the rider's hands, circles round it and up into their eyes
// (first person: a Noun's head is up to ~1.8 m of cube, so no
// over-the-shoulder angle gets past it). They flick through five random
// spreads (new ones every load), the camera pulls back out of their head to
// the whole rider, still reading, and then they chuck it. The rider is
// hidden only while the camera's inside their head (CampSystem). Everything
// here is numbers (pure, tested): the plan, where the book and the camera
// sit relative to the rider, and the toss.

import type { V3 } from './intro';

/** Seconds per spread (a page turn takes FLIP_SECONDS of it). */
export const SPREAD_SECONDS = 0.62;
export const FLIP_SECONDS = 0.34;
export const SPREADS = 5;
/** A beat on the first spread; a beat on the last; the pull back out to the whole rider; the book in the air; the hand-off. */
const SETTLE = 0.9;
const LINGER = 0.55;
const PULL = 1.9;
const TOSS = 0.95;
const SETTLE_OUT = 0.35;

/** Book pages: 252, square; spreads open on an even left page. */
const FIRST = 4;
const LAST = 250;

export interface ReadingPlan {
  /** Left page of each spread shown, in order. */
  spreads: number[];
  /** When (s, from the start of the read) each turn begins. */
  flips: number[];
  /** The camera starts pulling back out of the head… */
  pullAt: number;
  /** …and has the whole rider in shot (the game camera's pose), still reading. */
  pullEnd: number;
  /** Then they chuck it. */
  tossAt: number;
  landAt: number;
  endAt: number;
}

/** Five different random spreads and the timeline. `rnd` in [0, 1). */
export function readingPlan(rnd: () => number): ReadingPlan {
  const pool: number[] = [];
  for (let p = FIRST; p <= LAST; p += 2) pool.push(p);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const spreads = pool.slice(0, SPREADS);
  const flips = spreads.slice(1).map((_, i) => SETTLE + i * SPREAD_SECONDS);
  const pullAt = SETTLE + (SPREADS - 1) * SPREAD_SECONDS + LINGER;
  const pullEnd = pullAt + PULL;
  const tossAt = pullEnd + 0.15;
  const landAt = tossAt + TOSS;
  return { spreads, flips, pullAt, pullEnd, tossAt, landAt, endAt: landAt + SETTLE_OUT };
}

/** Rider frame (facing yaw, +z forward, +x the rider's left) → world. */
export function riderToWorld(pos: V3, yaw: number, x: number, y: number, z: number): V3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [pos[0] + x * c + z * s, pos[1] + y, pos[2] - x * s + z * c];
}

/**
 * Where the open book is held (rider frame): held up in front of the face
 * in both hands, so from the eyes the book is in front of the arms (held
 * low, every arm reaching it crossed the pages).
 */
export const BOOK_AT: V3 = [0, 1.12, 0.5];
/** Its tilt back toward the reader's eyes (rad about the rider's x): the pages face the eyes. */
export const BOOK_TILT = 1.07;
/** First person: where the eyes are (rider frame), looking down at the pages. */
export const EYES: V3 = [0, 1.38, 0.02];

/**
 * The fly-in's last stretch (rider frame, before the eyes): in from the
 * front at book height straight at the book, then round its side and up
 * into the reader's view. A big head hangs right over the book, so the
 * camera goes into it face first (the face fills the frame, then the
 * rider's hidden while the camera's inside: no pop); a small one it skirts.
 */
export const APPROACH: V3[] = [
  [0, 1.05, 2.6],
  [0.05, 1.08, 1.35],
  [0.42, 1.24, 0.72],
  [0.3, 1.36, 0.24],
];

/** The reading shot (world): from the rider's eyes, onto the book in their hands. */
export function readingShot(pos: V3, yaw: number): { cam: V3; look: V3; book: V3; approach: V3[] } {
  return {
    approach: APPROACH.map(p => riderToWorld(pos, yaw, ...p)),
    cam: riderToWorld(pos, yaw, ...EYES),
    look: riderToWorld(pos, yaw, BOOK_AT[0], BOOK_AT[1] - 0.02, BOOK_AT[2] + 0.03),
    book: BOOK_AT,
  };
}

/**
 * The toss (rider frame, seconds since it left the hands): out to the
 * rider's right and forward, tumbling, down onto the floor (y = 0), where
 * it lies flat. Returns the book's position and how far through its
 * tumble it is (0…1, 1 = lying still).
 */
export function tossAt(t: number, from: V3 = BOOK_AT): { at: V3; spin: number; landed: boolean } {
  const g = 9.8;
  const v: V3 = [-1.5, 2.2, 1.35];
  const p0 = from;
  // Lands when y reaches 0.02 (the floorboards)
  const a = 0.5 * g;
  const b = -v[1];
  const c = 0.02 - p0[1];
  const tLand = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  const tt = Math.min(t, tLand);
  return {
    at: [p0[0] + v[0] * tt, Math.max(0.02, p0[1] + v[1] * tt - a * tt * tt), p0[2] + v[2] * tt],
    spin: Math.min(1, tt / tLand),
    landed: t >= tLand,
  };
}
