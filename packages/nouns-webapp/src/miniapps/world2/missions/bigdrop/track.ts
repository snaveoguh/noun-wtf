// ── The Big Drop's race track: centre line, sections and features (pure) ──
//
// One deterministic track from the summit pad straight down the +Z fall
// line, all the way to the snowfield. Its distance `s` is simply peak z (the
// line weaves in x but always heads downhill). It's cut into sections
// (cruise, slalom, jumps, loop, gully) of 1.2–2.6 km, each with its own
// features: kickers, loops, berms, gates over the line, km markers. The
// terrain (peakTerrain.ts) carves the line into the snow; the scenery, the
// NPC riders and the loops all read it from here. No three.js.

import type { Feature, Section, SectionKind, TrackPoint } from './contract';

import { hashInts, smoothstep, vnoise } from '../../world/mountain/config';
import { PEAK } from '../peakTerrain';

export const TRACK = {
  /** Where the line leaves the summit pad (peak z). */
  start: PEAK.pad,
  /** Where it ends: the snowfield at the bottom. */
  end: PEAK.pad + PEAK.drop / PEAK.grade,
  /** Slalom weave: amplitude (m) and wavelength (m). */
  slalomAmp: 46,
  slalomWave: 260,
  /** Everywhere else: a gentle weave. */
  cruiseAmp: 22,
  cruiseWave: 700,
  /** Slow wander of the whole line (m). */
  wander: 180,
  /** Envelope ramps at section ends (m). */
  ramp: 160,
  /** A km marker every this far (m). */
  markerEvery: 1000,
} as const;

const SEED = 0x7472;
const WIDTH: Record<SectionKind, number> = {
  cruise: 70,
  slalom: 34,
  jumps: 42,
  loop: 30,
  gully: 36,
};
const KINDS: SectionKind[] = ['cruise', 'slalom', 'jumps', 'loop', 'gully'];

/** Uniform [0, 1) from integers. */
function rand(a: number, b: number): number {
  return Math.min(0.999999, hashInts(a, b, SEED));
}

function buildSections(): Section[] {
  const out: Section[] = [];
  let s: number = TRACK.start;
  let i = 0;
  // A clean run off the summit, then the first jump line
  const opening: SectionKind[] = ['cruise', 'jumps', 'slalom', 'loop'];
  let prev: SectionKind | null = null;
  while (s < TRACK.end) {
    let kind: SectionKind;
    if (i < opening.length) kind = opening[i]!;
    else {
      // Any kind but the last one
      const pick = Math.floor(rand(i, 1) * (KINDS.length - 1));
      const others = KINDS.filter(k => k !== prev);
      kind = others[pick]!;
    }
    const len = i === 0 ? 700 : 1200 + Math.floor(rand(i, 2) * 1400);
    const s1 = Math.min(TRACK.end, s + len);
    out.push({ kind, s0: s, s1, seed: Math.floor(rand(i, 3) * 4294967296) });
    prev = kind;
    s = s1;
    i++;
  }
  return out;
}

/** Every section, summit to snowfield, in order. */
export const SECTIONS: readonly Section[] = buildSections();

/** Index of the section containing `s` (clamped to the first / last). */
export function sectionIndexAt(s: number): number {
  let lo = 0;
  let hi = SECTIONS.length - 1;
  if (s <= SECTIONS[0]!.s0) return 0;
  if (s >= SECTIONS[hi]!.s1) return hi;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (SECTIONS[m]!.s0 <= s) lo = m;
    else hi = m - 1;
  }
  return lo;
}

/** The section containing `s` (clamped to the first / last). */
export function sectionAt(s: number): Section {
  return SECTIONS[sectionIndexAt(s)]!;
}

/** 0..1: how much of section kind `k` shapes the line at `s` (ramped at the ends). */
function envelope(s: number, k: SectionKind): number {
  const i = sectionIndexAt(s);
  const sec = SECTIONS[i]!;
  const r = TRACK.ramp;
  if (sec.kind === k)
    return smoothstep(sec.s0 - r, sec.s0 + r, s) * (1 - smoothstep(sec.s1 - r, sec.s1 + r, s));
  // Bleed in from a neighbour across the boundary
  const prev = SECTIONS[i - 1];
  const next = SECTIONS[i + 1];
  let v = 0;
  if (prev?.kind === k) v = Math.max(v, 1 - smoothstep(prev.s1 - r, prev.s1 + r, s));
  if (next?.kind === k) v = Math.max(v, smoothstep(next.s0 - r, next.s0 + r, s));
  return v;
}

/** Centre line x at track distance `s` (peak coordinates). */
export function centerX(s: number): number {
  // Pinned to x = 0 at the pad, then free
  const free = smoothstep(TRACK.start, TRACK.start + 400, s);
  const wander = TRACK.wander * vnoise(s / 2400, 0.5, SEED + 7);
  const slalom =
    envelope(s, 'slalom') * TRACK.slalomAmp * Math.sin((2 * Math.PI * s) / TRACK.slalomWave);
  const cruise =
    (1 - envelope(s, 'slalom')) * TRACK.cruiseAmp * Math.sin((2 * Math.PI * s) / TRACK.cruiseWave);
  return free * (wander + slalom + cruise);
}

/** Groomed lane width at `s` (m), blended across section ends. */
export function widthAt(s: number): number {
  let w = 0;
  let sum = 0;
  for (const k of KINDS) {
    const e = envelope(s, k);
    w += e * WIDTH[k];
    sum += e;
  }
  return sum > 1e-6 ? w / sum : WIDTH[sectionAt(s).kind];
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
 * weave stays gentle (it does: its slope is under 1.4).
 */
export function nearestTrack(
  x: number,
  z: number,
  out: { s: number; lateral: number; dist: number },
): { s: number; lateral: number; dist: number } {
  const s = Math.min(TRACK.end, Math.max(TRACK.start, z));
  const cx = centerX(s);
  const dx = (centerX(s + 1) - centerX(s - 1)) / 2;
  const lat = (x - cx) / Math.hypot(dx, 1);
  out.s = s;
  out.lateral = lat;
  out.dist = Math.abs(lat);
  return out;
}

const featureCache = new Map<number, Feature[]>();

/** The features of one section (cached). */
export function sectionFeatures(index: number): Feature[] {
  const hit = featureCache.get(index);
  if (hit !== undefined) return hit;
  const sec = SECTIONS[index]!;
  const out: Feature[] = [];
  const len = sec.s1 - sec.s0;
  // A gate over the line where every section starts
  out.push({
    id: `g${index}`,
    kind: 'gate',
    s: sec.s0 + 30,
    len: 6,
    size: WIDTH[sec.kind],
    side: 1,
  });
  if (sec.kind === 'jumps') {
    const n = len > 2000 ? 4 : 3;
    for (let k = 0; k < n; k++) {
      const s = sec.s0 + 260 + ((len - 520) * (k + 0.5)) / n;
      out.push({
        id: `k${index}.${k}`,
        kind: 'kicker',
        s,
        len: 45,
        size: 6 + Math.floor(rand(index, 10 + k) * 5),
        side: 1,
      });
    }
  } else if (sec.kind === 'loop') {
    out.push({
      id: `l${index}`,
      kind: 'loop',
      s: sec.s0 + len * 0.5,
      len: 80,
      size: 22 + Math.floor(rand(index, 20) * 9),
      side: 1,
    });
  } else if (sec.kind === 'slalom') {
    // A berm on the outside of every turn of the weave
    const w = TRACK.slalomWave;
    for (let k = Math.ceil((sec.s0 + 200) / (w / 2)); (k * w) / 2 < sec.s1 - 200; k++) {
      const apex = (k * w) / 2 + w / 4;
      out.push({
        id: `b${index}.${k}`,
        kind: 'berm',
        s: apex - 40,
        len: 80,
        size: 4,
        // Apex of sin at +x bends the line back toward −x: berm on the +x side
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
  for (let i = first; i < SECTIONS.length && SECTIONS[i]!.s0 <= s1; i++)
    for (const f of sectionFeatures(i)) if (f.s + f.len >= s0 && f.s <= s1) out.push(f);
  for (let k = Math.ceil(s0 / TRACK.markerEvery); k * TRACK.markerEvery <= s1; k++)
    if (k > 0)
      out.push({ id: `m${k}`, kind: 'marker', s: k * TRACK.markerEvery, len: 1, size: k, side: 1 });
  return out;
}
