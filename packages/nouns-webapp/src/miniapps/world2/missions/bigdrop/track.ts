// ── The Big Drop's race track: centre line, sections and features (pure) ──
//
// One deterministic track from the summit pad straight down the +Z fall
// line, all the way to the snowfield. Its distance `s` is simply peak z (the
// line weaves in x but always heads downhill). It's cut into sections
// (cruise, slalom, jumps, loop, gully), each with its own features: kickers,
// loops, berms, gates over the line, km markers. The terrain
// (terrainCarve.ts, through peakTerrain.ts) carves the line into the snow;
// the scenery, the NPC riders and the loops all read it from here. No
// three.js.
//
// ── Built for the speeds ──
//
// A clean run is at 500 km/h within a minute and 2,000 km/h later
// (trackSpeed.ts), so the track is designed in seconds rather than metres:
// below the first couple of km everything (section lengths, the weaves'
// wavelengths and amplitudes, ramps, berms, lane widths) is drawn bigger by
// trackScale(s), 1 at the top up to 5 deep down. Kickers are designed for
// the speed a rider arrives at (kickerShape): a lip angle that gives 6–14 s
// of hang time and a landing back on the 49° fall line, which is the best
// landing there is (the flight is symmetric about the slope, so you come
// down at a shallower angle than you left).
//
// ── Fast path ──
//
// peakHeight asks about the line ~25k times a frame. lineAt(s) reads a
// cached table (2 m samples in 1 km chunks: Hermite-interpolated centre
// line, width, section weights and the features nearby) instead of
// re-deriving the analytic line; nearestTrack uses it too.

import type { Feature, Section, SectionKind, TrackPoint } from './contract';

import { hashInts, smoothstep, vnoise } from '../../world/mountain/config';

import { coneHeight, PEAK } from './terrainPeak';
import {
  expectedSpeed,
  G_ALONG,
  G_NORMAL,
  scaledDistance,
  SLOPE_ANGLE,
  trackScale,
} from './trackSpeed';

export const TRACK = {
  /** Where the line leaves the summit pad (peak z). */
  start: PEAK.pad,
  /** Where it ends: the snowfield at the bottom. */
  end: PEAK.pad + PEAK.drop / PEAK.grade,
  /** Slalom weave: amplitude (m) and wavelength (m), at scale 1. */
  slalomAmp: 40,
  slalomWave: 300,
  /** Everywhere else: a gentle weave (scale 1). */
  cruiseAmp: 22,
  cruiseWave: 700,
  /** Slow wander of the whole line (m). */
  wander: 180,
  /** Envelope ramps at section ends (m, scale 1). */
  ramp: 160,
  /** A km marker every this far (m). */
  markerEvery: 1000,
} as const;

/** The shapes the terrain carves (m). */
export const CARVE = {
  /** The groomed lane sits this far below the snow either side. */
  sink: 0.6,
  /** Soft shoulder from the lane edge out to untouched snow. */
  shoulder: 16,
  /** …and the mountain's moguls and ridges fade back in over this far. */
  detailFade: 50,
  /**
   * Gully: floor depth, lip-to-line half-width, and the walls' steepest
   * cross-slope where the line runs straight down the fall line (they're
   * drawn wider where it angles across it, so wall + fall line stays ground).
   */
  gullyDepth: 9,
  gullyHalf: 24,
  gullyWallSlope: 0.9,
  /** Powder pillows off the lane: height and the band they fill. */
  pillow: 1.1,
  /** Nothing reaches further than this past the lane edge. */
  reach: 170,
  /** Loop pads: lead-in / lead-out (× scale) and the least half-width. */
  padLead: 60,
  padHalf: 16,
  /**
   * Kickers' lips (see KickerShape): the last `tipLen` m kick up `tipAngle`
   * steeper than the ramp, then the snow drops away at `backAngle` past the
   * fall line for `backLen` m. The board only leaves a surface whose normal
   * turns > 21.6° from its own at once, and it reads normals over ±0.5 m,
   * so a plain 25° edge smears out and the board rolls over it.
   */
  tipLen: 1.2,
  tipAngle: (14 * Math.PI) / 180,
  backAngle: (24 * Math.PI) / 180,
  backLen: 1.0,
} as const;

/** |x| past which nothing of the track reaches (the line stays well inside). */
export const X_BAND = 720;

const SEED = 0x7472;
const WIDTH: Record<SectionKind, number> = {
  cruise: 70,
  slalom: 34,
  jumps: 42,
  loop: 30,
  // Lip to lip
  gully: 2 * CARVE.gullyHalf,
};
/** How much of the cruise weave each kind keeps (slalom has its own). */
const WEAVE: Record<SectionKind, number> = {
  cruise: 1,
  slalom: 0,
  jumps: 0.25,
  loop: 0.5,
  gully: 0.35,
};
const KINDS: SectionKind[] = ['cruise', 'slalom', 'jumps', 'loop', 'gully'];

/** A section with what the track derives from it. */
interface TrackSection extends Section {
  /** trackScale at its start. */
  scale: number;
  /** Ramp half-length at its start boundary (m). */
  r0: number;
  /** …and at its end boundary. */
  r1: number;
}

/** Uniform [0, 1) from integers. */
function rand(a: number, b: number): number {
  return Math.min(0.999999, hashInts(a, b, SEED));
}

function buildSections(): TrackSection[] {
  const out: TrackSection[] = [];
  let s: number = TRACK.start;
  let i = 0;
  // A clean run off the summit, then the first jump line
  const opening: SectionKind[] = ['cruise', 'jumps', 'slalom', 'loop'];
  let prev: SectionKind | null = null;
  let deck: SectionKind[] = [];
  while (s < TRACK.end - 1) {
    let kind: SectionKind;
    if (i < opening.length) kind = opening[i]!;
    else {
      // Then rounds of six, shuffled: every kind, jump lines twice, never
      // the same kind twice running
      if (deck.length === 0) {
        for (let tries = 0; ; tries++) {
          deck = [...KINDS, 'jumps'];
          for (let k = deck.length - 1; k > 0; k--) {
            const j = Math.floor(rand(i * 31 + tries, 40 + k) * (k + 1));
            [deck[k], deck[j]] = [deck[j]!, deck[k]!];
          }
          let ok = deck[0] !== prev;
          for (let k = 1; k < deck.length; k++) ok &&= deck[k] !== deck[k - 1];
          if (ok || tries > 50) break;
        }
      }
      kind = deck.shift()!;
    }
    const scale = trackScale(s);
    // Jump lines run longer: the airs eat the distance
    const base = (1200 + Math.floor(rand(i, 2) * 1400)) * (kind === 'jumps' ? 2.2 : 1);
    const len = i === 0 ? 700 : base * scale;
    let s1 = Math.min(TRACK.end, s + len);
    // Never leave a scrap at the bottom
    if (TRACK.end - s1 < 600 * scale) s1 = TRACK.end;
    out.push({
      kind,
      s0: s,
      s1,
      seed: Math.floor(rand(i, 3) * 4294967296),
      scale,
      r0: TRACK.ramp,
      r1: TRACK.ramp,
    });
    prev = kind;
    s = s1;
    i++;
  }
  // Ramps at each boundary scale with the section after it, but never take
  // more than 40% of either side
  for (let k = 1; k < out.length; k++) {
    const a = out[k - 1]!;
    const b = out[k]!;
    const r = Math.min(TRACK.ramp * b.scale, 0.4 * (a.s1 - a.s0), 0.4 * (b.s1 - b.s0));
    a.r1 = r;
    b.r0 = r;
  }
  return out;
}

const SEC: TrackSection[] = buildSections();

/** Every section, summit to snowfield, in order. */
export const SECTIONS: readonly Section[] = SEC;

/** Index of the section containing `s` (clamped to the first / last). */
export function sectionIndexAt(s: number): number {
  let lo = 0;
  let hi = SEC.length - 1;
  if (s <= SEC[0]!.s0) return 0;
  if (s >= SEC[hi]!.s1) return hi;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (SEC[m]!.s0 <= s) lo = m;
    else hi = m - 1;
  }
  return lo;
}

/** The section containing `s` (clamped to the first / last). */
export function sectionAt(s: number): Section {
  return SEC[sectionIndexAt(s)]!;
}

/** trackScale of the section containing `s` (constant along a section). */
export function sectionScale(s: number): number {
  return SEC[sectionIndexAt(s)]!.scale;
}

/** 0..1: how much section `i` shapes the line at `s` (ramped at its ends; sums to 1). */
function envSec(i: number, s: number): number {
  const c = SEC[i]!;
  const a = i === 0 ? 1 : smoothstep(c.s0 - c.r0, c.s0 + c.r0, s);
  const b = i === SEC.length - 1 ? 1 : 1 - smoothstep(c.s1 - c.r1, c.s1 + c.r1, s);
  return a * b;
}

/** 0..1: how much section kind `k` shapes the line at `s`. */
function envelope(s: number, k: SectionKind): number {
  const i = sectionIndexAt(s);
  let v = 0;
  for (let j = Math.max(0, i - 1); j <= Math.min(SEC.length - 1, i + 1); j++)
    if (SEC[j]!.kind === k) v += envSec(j, s);
  return Math.min(1, v);
}

/** The line before loop pads straighten it. */
function rawCenter(s: number): number {
  const free = smoothstep(TRACK.start, TRACK.start + 400, s);
  if (free <= 0) return 0;
  const D = scaledDistance(s);
  const wander = TRACK.wander * vnoise(D / 2400, 0.5, SEED + 7);
  const i = sectionIndexAt(s);
  let weave = 0;
  for (let j = Math.max(0, i - 1); j <= Math.min(SEC.length - 1, i + 1); j++) {
    const e = envSec(j, s);
    if (e <= 0) continue;
    const c = SEC[j]!;
    if (c.kind === 'slalom')
      weave +=
        e *
        TRACK.slalomAmp *
        c.scale *
        Math.sin((2 * Math.PI * (s - c.s0)) / (TRACK.slalomWave * c.scale));
    else
      weave +=
        e *
        WEAVE[c.kind] *
        TRACK.cruiseAmp *
        c.scale *
        Math.sin((2 * Math.PI * D) / TRACK.cruiseWave);
  }
  return free * (wander + weave);
}

/**
 * Where the line is pulled dead straight: over each loop's pad, and over
 * each kicker from its run-in to the end of its back face (so the ramp is
 * square to the line and a rider who doesn't steer stays on it).
 */
interface Chord {
  a: number;
  b: number;
  xa: number;
  xb: number;
  /** Fully straight between s and e, eased in from a and out to b. */
  s: number;
  e: number;
}
const chords = new Map<number, Chord[]>();

function chordsOf(i: number): Chord[] {
  const hit = chords.get(i);
  if (hit !== undefined) return hit;
  const c = SEC[i]!;
  const out: Chord[] = [];
  const add = (a: number, s: number, e: number, b: number) =>
    out.push({ a, b, xa: rawCenter(a), xb: rawCenter(b), s, e });
  if (c.kind === 'loop') {
    const f = loopFeatureOf(i);
    const lead = 120 * c.scale;
    add(f.s - lead, f.s, f.s + f.len, f.s + f.len + lead);
  } else if (c.kind === 'jumps') {
    for (const f of sectionFeatures(i))
      if (f.kind === 'kicker')
        add(f.s - 260 * c.scale, f.s - 60 * c.scale, f.s + f.len, f.s + f.len + 150 * c.scale);
  }
  chords.set(i, out);
  return out;
}

/** Centre line x at track distance `s` (peak coordinates). */
export function centerX(s: number): number {
  const raw = rawCenter(s);
  const list = chordsOf(sectionIndexAt(s));
  for (let k = 0; k < list.length; k++) {
    const ch = list[k]!;
    if (s <= ch.a || s >= ch.b) continue;
    // Dead straight, eased in and out
    const w = smoothstep(ch.a, ch.s, s) * (1 - smoothstep(ch.e, ch.b, s));
    const chord = ch.xa + ((ch.xb - ch.xa) * (s - ch.a)) / (ch.b - ch.a);
    return raw + (chord - raw) * w;
  }
  return raw;
}

function widthOf(c: TrackSection): number {
  return c.kind === 'gully' ? WIDTH.gully : WIDTH[c.kind] * Math.min(1.8, Math.sqrt(c.scale));
}

/** Groomed lane width at `s` (m), blended across section ends. */
export function widthAt(s: number): number {
  const i = sectionIndexAt(s);
  let w = 0;
  let sum = 0;
  for (let j = Math.max(0, i - 1); j <= Math.min(SEC.length - 1, i + 1); j++) {
    const e = envSec(j, s);
    w += e * widthOf(SEC[j]!);
    sum += e;
  }
  return sum > 1e-6 ? w / sum : widthOf(SEC[i]!);
}

/** The centre line at `s`. */
export function trackAt(
  s: number,
  out: TrackPoint,
  height?: (x: number, z: number) => number,
): TrackPoint {
  const x = centerX(s);
  const dx = (centerX(s + 1) - centerX(s - 1)) / 2;
  const l = Math.hypot(dx, 1);
  out.x = x;
  out.z = s;
  out.y = height !== undefined ? height(x, s) : 0;
  out.dirX = dx / l;
  out.dirZ = 1 / l;
  out.width = widthAt(s);
  out.section = sectionAt(s).kind;
  return out;
}

/**
 * Nearest point of the track to (x, z), peak coordinates: its distance `s`,
 * the signed lateral offset (+ = toward +x), and |lateral|. Good while the
 * weave stays gentle (it does: its slope is under 1.4). Cheap (the table).
 */
export function nearestTrack(
  x: number,
  z: number,
  out: { s: number; lateral: number; dist: number },
): { s: number; lateral: number; dist: number } {
  const s = Math.min(TRACK.end, Math.max(TRACK.start, z));
  lineAt(s, _ln);
  const lat = (x - _ln.cx) / Math.sqrt(1 + _ln.dcx * _ln.dcx);
  out.s = s;
  out.lateral = lat;
  out.dist = Math.abs(lat);
  return out;
}

// ── Kickers ─────────────────────────────────────────────────────────────

/**
 * One kicker, in track distance u = z − s from its start (heights are
 * metres above the bare cone, slopes are dh/dz relative to the cone's):
 *
 *   [0, lt)        transition: the slope bends up from the cone's to the lip's
 *   [lt, lip−tip)  straight ramp at `alpha` above the fall line
 *   [lip−tip, lip) the tip: 1.2 m kicking up 14° more
 *   lip            `h` m up: the snow breaks over by ~40°, so the board
 *                  leaves it at any speed (Player: a normal that turns
 *                  > 21.6° away from the board at once launches it; it reads
 *                  normals over ±0.5 m, which a gentler edge smears out)
 *   [lip, +lb1)    a 1 m steep back face, `beta` (24°) steeper than the cone
 *   [.., end)      a long landing back face 2° steeper than the cone
 *
 * terrainCarve.test.ts rides the ramp with the board's own ground-follow
 * rules and flies the air: it takes off at ~alpha at 0.5–1.3× the design
 * speed and lands clean on a downslope.
 *
 * The air lands back on the fall line itself.
 */
export interface KickerShape {
  /** Track distance (peak z) of the ramp's foot. */
  s: number;
  lt: number;
  /** Straight ramp, including the tip. */
  ls: number;
  /** The tip: its length (m of z) and relative slope. */
  tip: number;
  pt: number;
  lb1: number;
  lb2: number;
  /** Relative slopes (dh/dz) of the ramp, the steep and the landing back faces. */
  p: number;
  pb1: number;
  pb2: number;
  /** Lip height above the bare cone (m). */
  h: number;
  /** u of the lip, and of the end of the back face. */
  lip: number;
  end: number;
  /** Full-height half width, and the shoulder it fades over (m). */
  halfW: number;
  shoulder: number;
  /** Lip angle above the fall line, and the back face's below it (rad). */
  alpha: number;
  beta: number;
  /** What it's built for: arrival speed (m/s), hang time (s), landing z. */
  speed: number;
  hang: number;
  landAt: number;
}

const DEG = Math.PI / 180;
const kickers = new Map<string, KickerShape>();

/** Height (m above the cone) of a kicker at u = z − shape.s, 0 off it. */
export function kickerProfile(k: KickerShape, u: number): number {
  if (u <= 0 || u >= k.end) return 0;
  if (u < k.lt) return (k.p * u * u) / (2 * k.lt);
  const tip0 = k.lip - k.tip;
  if (u < tip0) return k.p * (k.lt / 2 + (u - k.lt));
  if (u < k.lip) return k.p * (k.lt / 2 + (tip0 - k.lt)) + k.pt * (u - tip0);
  const b = u - k.lip;
  if (b < k.lb1) return k.h - k.pb1 * b;
  return Math.max(0, k.h - k.pb1 * k.lb1 - k.pb2 * (b - k.lb1));
}

/** Design a kicker starting at `s` for the speed a rider gets there. */
function designKicker(s: number, size: number, rnd: number, laneHalf: number): KickerShape {
  const v = expectedSpeed(s);
  const sc = trackScale(s);
  const G = PEAK.grade;
  const th = SLOPE_ANGLE;
  // Hang time: 6 s up top to 14 s at speed, ±15% per kicker
  const hang = Math.min(14, Math.max(6, 6 + 0.016 * v)) * (0.85 + 0.3 * rnd);
  // Flight relative to the slope: T = 2 v sin(alpha) / g_normal
  const alpha = Math.min(
    22 * DEG,
    Math.max(1.5 * DEG, Math.asin(Math.min(1, (hang * G_NORMAL) / (2 * v)))),
  );
  const beta = CARVE.backAngle;
  const p = G - Math.tan(th - alpha);
  const pb1 = Math.tan(th + beta) - G;
  const pb2 = Math.tan(th + 2 * DEG) - G;
  const want = size * (1 + 0.25 * (sc - 1));
  // Long enough for the board to settle onto the ramp's angle (its up lags
  // the surface by ~45 ms) before the lip
  const lt = Math.max(want / p, v * 0.25, 12);
  const ls = Math.max(lt / 2, v * 0.12, 6);
  const tip = CARVE.tipLen;
  const pt = G - Math.tan(th - alpha - CARVE.tipAngle);
  const h = p * (lt / 2 + ls - tip) + pt * tip;
  const lb1 = Math.min(CARVE.backLen, h / pb1);
  const lb2 = Math.max(0, (h - pb1 * lb1) / pb2);
  const lip = lt + ls;
  const end = lip + lb1 + lb2;
  const T = (2 * v * Math.sin(alpha)) / G_NORMAL;
  const D = v * Math.cos(alpha) * T + 0.5 * G_ALONG * T * T;
  return {
    s,
    lt,
    ls,
    tip,
    pt,
    lb1,
    lb2,
    p,
    pb1,
    pb2,
    h,
    lip,
    end,
    halfW: Math.max(10, laneHalf - 3),
    shoulder: Math.max(12, 3 * h),
    alpha,
    beta,
    speed: v,
    hang: T,
    landAt: s + lip + D * Math.cos(th),
  };
}

/** The shape of a kicker feature (undefined for anything else). */
export function kickerShape(f: Feature): KickerShape | undefined {
  if (f.kind !== 'kicker') return undefined;
  const hit = kickers.get(f.id);
  if (hit !== undefined) return hit;
  // Built with its section's features
  sectionFeatures(sectionIndexAt(f.s));
  return kickers.get(f.id);
}

// ── Loop pads ───────────────────────────────────────────────────────────

/**
 * A loop's pad: the ground under a 'loop' feature, from its `s` to
 * `s + len`. It's an exact plane: dead straight along the line (the line is
 * pulled straight over it) and level ACROSS it, no moguls, no ridges. It
 * keeps the fall line's grade along its length (a level pad on a 49° slope
 * would need a 90 m cliff at one end), so build the loop tangent to it:
 * entry at (x0, y0, z0), exit at (x1, y1, z1), `dir` the unit vector
 * between them, `up` its normal (in the vertical plane through the line).
 * Ground height on the pad at track distance z is y0 + (z − z0) · grade,
 * anywhere within `half` m of the line. All peak coordinates.
 */
export interface LoopBase {
  s0: number;
  s1: number;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  /** Unit vector along the pad, downhill. */
  dirX: number;
  dirY: number;
  dirZ: number;
  /** Unit normal of the pad (perpendicular to dir, no sideways tilt). */
  upX: number;
  upY: number;
  upZ: number;
  /** Height change per m of z along the pad (negative: it drops). */
  grade: number;
  /** Flat half-width either side of the line (m). */
  half: number;
  /** Lead-in / lead-out blending the pad into the lane either end (m of z). */
  lead: number;
}

const pads = new Map<string, LoopBase>();

/** The pad under a 'loop' feature (peak coordinates). */
export function loopBase(f: Feature): LoopBase {
  const hit = pads.get(f.id);
  if (hit !== undefined) return hit;
  const z0 = f.s;
  const z1 = f.s + f.len;
  const x0 = centerX(z0);
  const x1 = centerX(z1);
  const y0 = coneHeight(x0, z0) - CARVE.sink;
  const y1 = coneHeight(x1, z1) - CARVE.sink;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const l = Math.hypot(dx, dy, dz);
  const dirX = dx / l;
  const dirY = dy / l;
  const dirZ = dz / l;
  // up = side × dir, side = horizontal perpendicular to the line
  const sl = Math.hypot(dx, dz);
  const sx = dz / sl;
  const sz = -dx / sl;
  let upX = -sz * dirY;
  let upY = sz * dirX - sx * dirZ;
  let upZ = sx * dirY;
  if (upY < 0) {
    upX = -upX;
    upY = -upY;
    upZ = -upZ;
  }
  const scale = sectionScale(f.s);
  const b: LoopBase = {
    s0: z0,
    s1: z1,
    x0,
    y0,
    z0,
    x1,
    y1,
    z1,
    dirX,
    dirY,
    dirZ,
    upX,
    upY,
    upZ,
    grade: dy / dz,
    half: Math.max(CARVE.padHalf, widthAt(f.s + f.len / 2) / 2),
    lead: CARVE.padLead * scale,
  };
  pads.set(f.id, b);
  return b;
}

// ── Features ────────────────────────────────────────────────────────────

const featureCache = new Map<number, Feature[]>();

function loopFeatureOf(index: number): Feature {
  const sec = SEC[index]!;
  const len = sec.s1 - sec.s0;
  return {
    id: `l${index}`,
    kind: 'loop',
    s: sec.s0 + len * 0.5,
    len: 80,
    size: 22 + Math.floor(rand(index, 20) * 9),
    side: 1,
  };
}

/** The features of one section (cached). */
export function sectionFeatures(index: number): Feature[] {
  const hit = featureCache.get(index);
  if (hit !== undefined) return hit;
  const sec = SEC[index]!;
  const out: Feature[] = [];
  // A gate over the line where every section starts
  out.push({
    id: `g${index}`,
    kind: 'gate',
    s: sec.s0 + 30,
    len: 6,
    size: widthAt(sec.s0 + 30),
    side: 1,
  });
  if (sec.kind === 'jumps') {
    // One after another: each one's foot a run-in past where the last lands
    let s = sec.s0 + sec.r0 + 150 * sec.scale;
    for (let k = 0; k < 6; k++) {
      const size = 6 + Math.floor(rand(index, 10 + k) * 5);
      const shape = designKicker(s, size, rand(index, 30 + k), widthAt(s) / 2);
      // Even 30% faster than it's built for, the air comes down on
      // this section's own fall line (flights grow with the speed squared)
      const far = s + shape.lip + 1.75 * (shape.landAt - s - shape.lip);
      if (k > 0 && far > sec.s1 - sec.r1) break;
      const f: Feature = {
        id: `k${index}.${k}`,
        kind: 'kicker',
        s,
        len: shape.end,
        size: Math.round(shape.h * 10) / 10,
        side: 1,
      };
      kickers.set(f.id, shape);
      out.push(f);
      const vLand = shape.speed * Math.cos(shape.alpha) + G_ALONG * shape.hang;
      s = Math.max(shape.landAt, s + shape.end) + Math.max(200, vLand);
    }
  } else if (sec.kind === 'loop') {
    out.push(loopFeatureOf(index));
  } else if (sec.kind === 'slalom') {
    // A berm on the outside of every turn of the weave
    const w = TRACK.slalomWave * sec.scale;
    for (let k = 0; ; k++) {
      const apex = sec.s0 + (k / 2 + 1 / 4) * w;
      if (apex > sec.s1 - sec.r1 - 60 * sec.scale) break;
      if (apex < sec.s0 + sec.r0 + 60 * sec.scale) continue;
      const len = 80 * sec.scale;
      out.push({
        id: `b${index}.${k}`,
        kind: 'berm',
        s: apex - len / 2,
        len,
        size: Math.round(3.5 + sec.scale),
        // x = A·sin(2π(s − s0)/w): at this apex sin = (−1)^k, and the line
        // bends back the other way, so the outside of the turn is that side
        side: k % 2 === 0 ? 1 : -1,
      });
    }
  }
  featureCache.set(index, out);
  return out;
}

/** Every feature overlapping [s0, s1] (track distance), plus the km markers. */
export function featuresIn(s0: number, s1: number): Feature[] {
  const out: Feature[] = [];
  const first = sectionIndexAt(s0);
  for (let i = first; i < SEC.length && SEC[i]!.s0 <= s1; i++)
    for (const f of sectionFeatures(i)) if (f.s + f.len >= s0 && f.s <= s1) out.push(f);
  for (let k = Math.ceil(s0 / TRACK.markerEvery); k * TRACK.markerEvery <= s1; k++)
    if (k > 0)
      out.push({ id: `m${k}`, kind: 'marker', s: k * TRACK.markerEvery, len: 1, size: k, side: 1 });
  return out;
}

// ── The table (fast path) ───────────────────────────────────────────────

/** What lineAt reads off the table at one track distance. */
export interface LineSample {
  /** Centre line x and its slope dx/ds. */
  cx: number;
  dcx: number;
  /** Lane width (m). */
  w: number;
  /** 0..1 weights of the gully and cruise sections. */
  gully: number;
  cruise: number;
  /** Kickers, berms and loops near this distance (shared, don't mutate). */
  feats: readonly Feature[];
}

const CHUNK = 1024;
const SP = 2;
const NS = CHUNK / SP + 1;
const STRIDE = 5;
const MAX_CHUNKS = 48;
/** How far before / after a chunk a feature may still touch it (loop leads). */
const FEAT_MARGIN = 400;

interface Chunk {
  data: Float64Array;
  feats: Feature[];
}
const chunks = new Map<number, Chunk>();
let lastKey = NaN;
let lastChunk: Chunk | null = null;
const _ln: LineSample = { cx: 0, dcx: 0, w: 0, gully: 0, cruise: 0, feats: [] };

function buildChunk(key: number): Chunk {
  const data = new Float64Array(NS * STRIDE);
  const s0 = key * CHUNK;
  for (let j = 0; j < NS; j++) {
    const s = s0 + j * SP;
    const o = j * STRIDE;
    data[o] = centerX(s);
    data[o + 1] = (centerX(s + 0.25) - centerX(s - 0.25)) / 0.5;
    data[o + 2] = widthAt(s);
    data[o + 3] = envelope(s, 'gully');
    data[o + 4] = envelope(s, 'cruise');
  }
  const feats = featuresIn(s0 - FEAT_MARGIN, s0 + CHUNK + FEAT_MARGIN).filter(
    f => f.kind === 'kicker' || f.kind === 'berm' || f.kind === 'loop',
  );
  return { data, feats };
}

function chunkFor(key: number): Chunk {
  if (key === lastKey && lastChunk !== null) return lastChunk;
  let c = chunks.get(key);
  if (c === undefined) {
    c = buildChunk(key);
    chunks.set(key, c);
    if (chunks.size > MAX_CHUNKS) {
      const oldest = chunks.keys().next().value as number;
      chunks.delete(oldest);
    }
  }
  lastKey = key;
  lastChunk = c;
  return c;
}

/** The line at track distance `s` off the cached table (cheap; fills `out`). */
export function lineAt(s: number, out: LineSample): LineSample {
  const key = Math.floor(s / CHUNK);
  const c = chunkFor(key);
  const f = (s - key * CHUNK) / SP;
  const j = Math.min(NS - 2, Math.max(0, Math.floor(f)));
  const t = f - j;
  const d = c.data;
  const o = j * STRIDE;
  const p0 = d[o]!;
  const p1 = d[o + STRIDE]!;
  const m0 = d[o + 1]! * SP;
  const m1 = d[o + 1 + STRIDE]! * SP;
  const t2 = t * t;
  const t3 = t2 * t;
  out.cx =
    (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1;
  out.dcx =
    ((6 * t2 - 6 * t) * p0 +
      (3 * t2 - 4 * t + 1) * m0 +
      (-6 * t2 + 6 * t) * p1 +
      (3 * t2 - 2 * t) * m1) /
    SP;
  out.w = d[o + 2]! + (d[o + 2 + STRIDE]! - d[o + 2]!) * t;
  out.gully = d[o + 3]! + (d[o + 3 + STRIDE]! - d[o + 3]!) * t;
  out.cruise = d[o + 4]! + (d[o + 4 + STRIDE]! - d[o + 4]!) * t;
  out.feats = c.feats;
  return out;
}
