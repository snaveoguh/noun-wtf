// ── Noun World run proofs: check a record against the ride that set it ──
//
// A top speed, jump height or hang time only counts with the trace of the
// ride it came from: samples of [t, x, y, z, speed, state] (state 0 ground,
// 1 air, 2 grind, 3 manual), every ~0.4 s on the ground and every frame in
// the air, from the last respawn / getting on the board (bails included:
// they only lose energy).
//
// Riding can only *lose* energy to friction and drag. The only sources are:
//   gravity        losing height (½v² + g·y is the budget)
//   pushing        below push speed
//   popping        one ollie's worth per take-off
//   the streak     the mountain's +0.35 m/s² per minute ridden
// so a trace must never gain more than those allow, its positions must move
// at its own speeds, ground samples must sit near the mountain's surface,
// and every air segment must fall at the game's gravity. Faking all of that
// at once means simulating the game's physics, not editing a number.
//
// Keep PHYS in step with skate/Player.ts (DEFAULT_TUNING + STREAK_ACCEL).

import { MOUNTAIN, edgeDistance } from '../../src/miniapps/world2/world/mountain/config';

export const PHYS = {
  g: 12.5,
  streak: 0.35, // m/s² per minute of unbroken mountain riding
  pop: 4.3,
  pushAccel: 5.2,
  pushMax: 8.6,
} as const;

export const STRIDE = 6;
const AIR = 1;

export interface RunCheck {
  ok: boolean;
  reason?: string;
  /** Fastest sample (m/s). */
  maxV: number;
  /** Clean (ballistic) air segments: hang time (s), height above take-off (m). */
  airs: { s: number; m: number }[];
}

/** Terrain height of the mountain's radial gradient (terrain.ts baseHeight). */
function baseHeight(de: number): number {
  if (de <= 0) return MOUNTAIN.topY;
  const L = MOUNTAIN.slopeEase;
  return MOUNTAIN.topY - MOUNTAIN.slope * (de - L * (1 - Math.exp(-de / L)));
}
// Everything terrain.ts adds on top (hills, trench, rollers, terraces cut
// for the mega ramps / Noun Jersey) stays inside this band of the gradient.
// Only ground samples are held to it from above: at 600 km/h a kicker
// throws you hundreds of metres over the slope, and air is already pinned
// down by the energy budget (height costs speed) and the gravity fit.
const BAND_BELOW = 70;
const BAND_ABOVE = 55;

const fail = (reason: string): RunCheck => ({ ok: false, reason, maxV: 0, airs: [] });

export function decodeTrace(b64: string): Float32Array | null {
  try {
    const bin = atob(b64);
    if (bin.length % (4 * STRIDE) !== 0) return null;
    const buf = new ArrayBuffer(bin.length);
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Float32Array(buf);
  } catch {
    return null;
  }
}

/**
 * `strict` (drop claims, where a teleport would steal something) holds every
 * sample to the motion and terrain checks. Records (the default) only reject
 * what a cheat looks like: speed out of nowhere (the energy budget), starting
 * fast, sinking into the ground. Speed records come from the speed values,
 * and those are pinned by energy, so motion quirks (bumps, crashes, rescues,
 * phone frame hitches) never void a real ride.
 */
export function verifyRun(s: Float32Array, opts: { strict?: boolean } = {}): RunCheck {
  const strict = opts.strict === true;
  const n = s.length / STRIDE;
  if (!Number.isInteger(n) || n < 2) return fail('too short');
  if (n > 60_000) return fail('too long');
  for (let i = 0; i < s.length; i++) if (!Number.isFinite(s[i])) return fail('bad number');
  if (s[4] > (strict ? 25 : 40)) return fail('starts at speed');

  const g = PHYS.g;
  // A speed only counts toward the record where the positions around it
  // back it up (see the motion check below)
  const backed = new Uint8Array(n);
  let excess = 0;
  let keGain = 0;
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE;
    const [t, x, y, z, v, st] = [s[o], s[o + 1], s[o + 2], s[o + 3], s[o + 4], s[o + 5]];
    if (v < 0 || v > 600) return fail('impossible speed');
    // Near the surface: the mountain only (the city has its own, capped speed)
    const de = edgeDistance(x, z);
    if (de > 150) {
      const b = baseHeight(de);
      if (y < b - (strict ? BAND_BELOW : 2 * BAND_BELOW)) return fail('below the mountain');
      if (strict && st !== AIR && y > b + BAND_ABOVE) return fail('above the mountain');
    }
    if (i === 0) continue;
    const p = o - STRIDE;
    const dt = t - s[p];
    if (!(dt > 0 && dt <= (strict ? 1.05 : 10))) return fail('bad timing');
    const v0 = s[p + 4];
    const d = Math.hypot(x - s[p + 1], y - s[p + 2], z - s[p + 3]);
    const vavg = (v0 + v) / 2;
    // Positions move at the trace's own speeds (a fast, straight interval
    // covers its speed × time; turns and frame jitter shave a little)
    if (strict && d > vavg * dt * 1.3 + 1.5) return fail('moves faster than its speed');
    // ...and the other way: on the ground a speed with no matching motion
    // isn't credited (a crash stops you dead a frame before the speed drops,
    // so this can't fail the ride; a faked spike still fails on energy).
    // Air is held by the gravity fit and the energy budget instead.
    if (!strict || st === AIR || s[p + 5] === AIR || d >= vavg * dt * 0.7 - 1.5) {
      backed[i - 1] = 1;
      backed[i] = 1;
    }
    // Energy
    const e0 = 0.5 * v0 * v0 + g * s[p + 2];
    const e1 = 0.5 * v * v + g * y;
    let allow = PHYS.streak * (t / 60) * d;
    if (Math.min(v0, v) < PHYS.pushMax + 0.5) allow += PHYS.pushAccel * d;
    if (st === AIR && s[p + 5] !== AIR) allow += 0.5 * PHYS.pop * PHYS.pop * 1.3;
    const over = e1 - e0 - allow;
    if (over > 0) excess += over;
    const dk = 0.5 * (v * v - v0 * v0);
    if (dk > 0) keGain += dk;
  }
  // Honest rides show a few tens of J/kg of sampling noise in total (frame
  // timing, ground snapping); a speed hack shows hundreds to thousands
  // (records get a wide margin: phones' frame hitches are noisier, and a real
  // speed hack still shows thousands)
  const budget = strict ? 60 + 0.002 * keGain : 250 + 0.02 * keGain;
  if (excess > budget) return fail('gains energy from nowhere');

  // Air: hang time + height of every segment that falls at the game's gravity
  const airs: { s: number; m: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (s[i * STRIDE + 5] !== AIR) continue;
    let j = i;
    while (j + 1 < n && s[(j + 1) * STRIDE + 5] === AIR) j++;
    const seg = airSegment(s, i, j, n);
    if (seg !== null) airs.push(seg);
    i = j;
  }
  let maxV = s[4];
  for (let i = 0; i < n; i++) if (backed[i] === 1) maxV = Math.max(maxV, s[i * STRIDE + 4]);
  return { ok: true, maxV, airs };
}

/** Least-squares free fall over samples i..j: y = a + b·t − ½g·t² (t from i). */
function fitFall(s: Float32Array, i: number, j: number) {
  let st = 0;
  let sw = 0;
  let stt = 0;
  let stw = 0;
  const m = j - i + 1;
  const t0 = s[i * STRIDE];
  for (let k = i; k <= j; k++) {
    const t = s[k * STRIDE] - t0;
    const w = s[k * STRIDE + 2] + 0.5 * PHYS.g * t * t;
    st += t;
    sw += w;
    stt += t * t;
    stw += t * w;
  }
  const den = m * stt - st * st;
  if (den <= 1e-9) return null;
  const b = (m * stw - st * sw) / den;
  const a = (sw - b * st) / m;
  let worst = 0;
  for (let k = i; k <= j; k++) {
    const t = s[k * STRIDE] - t0;
    worst = Math.max(worst, Math.abs(s[k * STRIDE + 2] + 0.5 * PHYS.g * t * t - (a + b * t)));
  }
  return { worst, vy0: b, vy1: b - PHYS.g * (s[j * STRIDE] - t0) };
}

const FIT_TOL = 0.35;
/**
 * A bump (tree, ledge, wall) can only slow a fall or stop a rise, never kick
 * you up: the fits' noise is all the upward change allowed, summed over the
 * whole air, so lots of small kicks can't add up to a hover.
 */
const BUMP_UP_TOL = 1.5;
/** Samples a bump may take without fitting either arc (the frame or two of the hit). */
const BUMP_MAX_S = 0.25;

/**
 * Samples i..j are airborne; null unless they fall at the game's gravity. A
 * long air can clip something on the way (a tree, a ledge, a bowl wall):
 * it's then several clean arcs joined at bumps, and counts as long as no
 * bump sends you upward faster than you were going (an energy-free bump
 * can't), so hovering or re-launching mid-air still fails.
 */
function airSegment(s: Float32Array, i: number, j: number, n: number) {
  if (j - i < 2) return null;
  // Greedy: grow each arc while it still fits a free fall
  let k = i;
  let prevVy: number | null = null;
  let kicked = 0;
  let arcs = 0;
  while (k < j) {
    let end = Math.min(k + 2, j);
    const first = fitFall(s, k, end);
    if (first === null) return null;
    let best = first;
    if (best.worst > FIT_TOL) {
      // Not even three samples fit: a bump right here. Skip it if it's brief.
      if (s[(k + 1) * STRIDE] - s[k * STRIDE] > BUMP_MAX_S) return null;
      k++;
      continue;
    }
    while (end < j) {
      const f = fitFall(s, k, end + 1);
      if (f === null || f.worst > FIT_TOL) break;
      end++;
      best = f;
    }
    if (prevVy !== null) {
      kicked += Math.max(0, best.vy0 - Math.max(prevVy, 0));
      if (kicked > BUMP_UP_TOL) return null;
    }
    prevVy = best.vy1;
    arcs++;
    if (end >= j) break;
    k = end;
  }
  if (arcs === 0) return null;
  let top = -Infinity;
  for (let q = i; q <= j; q++) top = Math.max(top, s[q * STRIDE + 2]);
  const t0 = s[i * STRIDE];
  const t1 = j + 1 < n ? s[(j + 1) * STRIDE] : s[j * STRIDE];
  return { s: t1 - t0, m: top - s[i * STRIDE + 2] };
}
