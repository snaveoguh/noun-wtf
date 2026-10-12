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
import {
  BOWL_AIR_ABOVE,
  inBowlFootprint,
} from '../../src/miniapps/world2/world/mountain/noggleBowl';

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
// for the mega ramps / Noun Jersey) stays inside this band of the gradient
const BAND_BELOW = 70;
const BAND_ABOVE = 55;
const AIR_ABOVE = 260;

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

export function verifyRun(s: Float32Array): RunCheck {
  const n = s.length / STRIDE;
  if (!Number.isInteger(n) || n < 2) return fail('too short');
  if (n > 60_000) return fail('too long');
  for (let i = 0; i < s.length; i++) if (!Number.isFinite(s[i])) return fail('bad number');
  if (s[4] > 25) return fail('starts at speed');

  const g = PHYS.g;
  let maxV = 0;
  let excess = 0;
  let keGain = 0;
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE;
    const [t, x, y, z, v, st] = [s[o], s[o + 1], s[o + 2], s[o + 3], s[o + 4], s[o + 5]];
    if (v < 0 || v > 600) return fail('impossible speed');
    if (v > maxV) maxV = v;
    // Near the surface: the mountain only (the city has its own, capped speed)
    const de = edgeDistance(x, z);
    if (de > 150) {
      const b = baseHeight(de);
      if (y < b - BAND_BELOW) return fail('below the mountain');
      // The Noggle Bowl's vert walls (~42 km out) send riders straight up
      // as high as their speed takes them (the energy check still holds)
      const top = st === AIR ? AIR_ABOVE : BAND_ABOVE;
      if (y > b + top && !(st === AIR && y <= b + BOWL_AIR_ABOVE && inBowlFootprint(x, z)))
        return fail('above the mountain');
    }
    if (i === 0) continue;
    const p = o - STRIDE;
    const dt = t - s[p];
    if (!(dt > 0 && dt <= 1.05)) return fail('bad timing');
    const v0 = s[p + 4];
    const d = Math.hypot(x - s[p + 1], y - s[p + 2], z - s[p + 3]);
    const vavg = (v0 + v) / 2;
    // Positions move at the trace's own speeds (a fast, straight interval
    // covers its speed × time; turns and frame jitter shave a little)
    if (d > vavg * dt * 1.3 + 1.5) return fail('moves faster than its speed');
    if (st !== AIR && s[p + 5] !== AIR && d < vavg * dt * 0.7 - 1.5)
      return fail('speed without moving');
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
  if (excess > 60 + 0.002 * keGain) return fail('gains energy from nowhere');

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
  return { ok: true, maxV, airs };
}

/** Samples i..j are airborne; null unless they're a clean parabola. */
function airSegment(s: Float32Array, i: number, j: number, n: number) {
  if (j - i < 2) return null;
  // y + ½g·t² is a straight line in t for a free fall
  let st = 0;
  let sw = 0;
  let stt = 0;
  let stw = 0;
  const m = j - i + 1;
  for (let k = i; k <= j; k++) {
    const t = s[k * STRIDE] - s[i * STRIDE];
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
  let top = -Infinity;
  for (let k = i; k <= j; k++) {
    const t = s[k * STRIDE] - s[i * STRIDE];
    const y = s[k * STRIDE + 2];
    worst = Math.max(worst, Math.abs(y + 0.5 * PHYS.g * t * t - (a + b * t)));
    top = Math.max(top, y);
  }
  if (worst > 0.35) return null;
  const t0 = s[i * STRIDE];
  const t1 = j + 1 < n ? s[(j + 1) * STRIDE] : s[j * STRIDE];
  return { s: t1 - t0, m: top - s[i * STRIDE + 2] };
}
