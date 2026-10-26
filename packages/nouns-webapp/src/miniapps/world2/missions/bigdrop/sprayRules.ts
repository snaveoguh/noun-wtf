// ── The Big Drop's snow spray and speed effects: the rules (pure) ───────
//
// How much snow a board throws (a rooster tail off the edge when carving,
// powersliding or braking, far more in powder, a burst on landing, a fine
// mist at speed), when the wind streaks show, and when the rider goes
// through the sound barrier. spray.ts draws it.

import type { SnowSurface } from './surface';

/** The speed of sound (m/s): 1,235 km/h. */
export const SPRAY_MACH = 343;

/** How much more (or less) a surface sprays than groomed snow. */
export function spraySurfaceMult(s: SnowSurface): number {
  switch (s) {
    case 'powder':
      return 2.6;
    case 'groomed':
      return 1;
    case 'ice':
      return 0.3;
    default:
      return 0;
  }
}

export interface SprayInput {
  /** m/s. */
  speed: number;
  /** How hard it's carving, 0..1 (the rider's lean, an NPC's lateral pull). */
  carve: number;
  /** Powerslide / brake, 0..1. */
  slide: number;
  surface: SnowSurface;
  /** On the snow (no spray in the air). */
  grounded: boolean;
}

/** 0..1: how hard the edge is biting (drives the size and throw of the tail). */
export function sprayIntensity(i: SprayInput): number {
  if (!i.grounded || i.speed < 2.5) return 0;
  const c = Math.min(1, Math.max(0, i.carve));
  const s = Math.min(1, Math.max(0, i.slide));
  // A light carve doesn't spray; a hard one or any slide throws a curtain
  const edge = Math.max(Math.pow(Math.max(0, (c - 0.2) / 0.8), 1.4), s);
  // Builds over the first ~12 m/s
  return edge * Math.min(1, (i.speed - 2.5) / 12);
}

/** Particles per second off the board edge. */
export function sprayCarveRate(i: SprayInput): number {
  const k = sprayIntensity(i);
  if (k <= 0.02) return 0;
  return Math.min(1100, k * (120 + i.speed * 2.2) * spraySurfaceMult(i.surface));
}

/** Fine powder mist off the board at speed (particles per second). */
export function sprayMistRate(speed: number, surface: SnowSurface, grounded: boolean): number {
  if (!grounded || speed < 30) return 0;
  const m = surface === 'powder' ? 2 : surface === 'groomed' ? 0.6 : 0.2;
  return Math.min(1, (speed - 30) / 140) * 70 * m;
}

/** Particles in a landing burst: scaled by how hard it hit (m/s into the snow). */
export function sprayLandCount(impact: number, surface: SnowSurface): number {
  if (impact < 1.2) return 0;
  const m = spraySurfaceMult(surface);
  return Math.round(Math.min(320, Math.max(12, impact * 14)) * Math.max(0.3, m * 0.75));
}

/** 0..1: how much the wind streaks show (from ~500 km/h, full by ~1,000). */
export function sprayWindAmount(speed: number): number {
  const k = (speed - 140) / 140;
  return k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
}

/** 0..1: the vapour cone round the sound barrier (peaks right at Mach 1, 2, …). */
export function sprayVapour(speed: number): number {
  const m = speed / SPRAY_MACH;
  if (m < 0.9) return 0;
  const d = Math.abs(m - Math.round(m));
  return Math.max(0, 1 - d / 0.06);
}

/**
 * Sound-barrier booms: returns the Mach number just broken (1, 2, …) or 0.
 * `armed` holds the next Mach number that will boom; it re-arms once you
 * drop 6% under a barrier, so hovering at Mach 1 doesn't boom every frame.
 */
export function sprayBoom(speed: number, armed: { next: number }): number {
  const m = speed / SPRAY_MACH;
  // Slowed back down: re-arm the barrier below
  while (armed.next > 1 && m < armed.next - 1 - 0.06) armed.next--;
  if (m >= armed.next) {
    const hit = armed.next;
    armed.next = Math.floor(m) + 1;
    return hit;
  }
  return 0;
}

/** A per-emitter accumulator: whole particles to emit this frame from a rate. */
export function sprayTake(acc: { a: number }, rate: number, dt: number, max = 64): number {
  acc.a += rate * dt;
  const n = Math.floor(acc.a);
  acc.a -= n;
  return Math.min(max, n);
}
