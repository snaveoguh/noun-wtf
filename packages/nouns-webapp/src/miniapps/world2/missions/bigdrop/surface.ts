// ── The Big Drop's snow colours (the terrain grid asks per vertex) ──────
//
// peak.ts builds the terrain mesh and calls snowColor for every vertex it
// rebuilds (~20k a frame at speed: keep it cheap, no allocation). x, z are
// peak coordinates; ny is the surface normal's y (1 = flat).
//
// The race line reads at any speed: a groomed lane (creamier, corduroy close
// up), blue race-dye lines down both edges (they widen with distance so the
// coarse far grid still catches them), a red dye line across every kicker
// lip, bright white powder either side, cool blue in the shade and on the
// steep faces.

import type { LineSample } from './track';

import * as THREE from 'three';

import { smoothstep } from '../../world/mountain/config';

import { CARVE, kickerShape, lineAt, TRACK, X_BAND } from './track';

const SNOW_LIT = new THREE.Color(0xf7fbff);
const SNOW_SHADE = new THREE.Color(0xd6e2f0);
const ROCK = new THREE.Color(0x8d97a6);
const POWDER = new THREE.Color(0xffffff);
const GROOMED = new THREE.Color(0xeef1f6);
const ICE = new THREE.Color(0xa8c8ec);
const DYE_BLUE = new THREE.Color(0x1f5fd6);
const DYE_RED = new THREE.Color(0xf3322c);

const ln: LineSample = { cx: 0, dcx: 0, w: 0, gully: 0, cruise: 0, feats: [] };

/** Where the camera is (peak x, z): stripes and dye lines size themselves to the grid there. */
const viewer = { x: NaN, z: NaN };

/** Tell the colours where the camera is (peak coordinates); the track dressing does, per frame. */
export function setSnowViewer(x: number, z: number) {
  viewer.x = x;
  viewer.z = z;
}

export function snowColor(x: number, z: number, ny: number, out: THREE.Color): THREE.Color {
  // Fresh snow on the gentler bits, bluer on the steep
  out.copy(SNOW_SHADE).lerp(SNOW_LIT, Math.min(1, Math.max(0, (ny - 0.6) / 0.25)));
  const onTrack = x < X_BAND && x > -X_BAND && z > TRACK.start && z < TRACK.end;
  if (!onTrack) {
    // Rock where it's steepest
    if (ny < 0.62) out.lerp(ROCK, Math.min(1, (0.62 - ny) / 0.05) * 0.6);
    return out;
  }
  lineAt(z, ln);
  const lat = (x - ln.cx) / Math.sqrt(1 + ln.dcx * ln.dcx);
  const a = lat < 0 ? -lat : lat;
  const half = ln.w * 0.5;
  // Steep faces on the track (kicker backs, gully walls) are ice, not rock
  if (ny < 0.62) out.lerp(ICE, Math.min(1, (0.62 - ny) / 0.08) * 0.8);
  if (a > half + CARVE.shoulder + 30) {
    // Powder: the whitest snow on the mountain
    return out.lerp(POWDER, 0.55 * smoothstep(0.55, 0.8, ny));
  }
  // The grid's vertex spacing near here (peak.ts: 1.5 m at the camera,
  // growing ~9% a ring): marks narrower than it would alias or vanish
  const vd = viewer.x === viewer.x ? Math.hypot(x - viewer.x, z - viewer.z) : 0;
  const spacing = 1.5 + 0.09 * vd;
  if (a < half) {
    out.lerp(GROOMED, 0.5);
    // Corduroy along the line, only where the grid can draw it
    if (spacing < 2.4) {
      const stripe = Math.cos((2 * Math.PI * lat) / 4.5);
      const k = 1 - 0.045 * stripe * (1 - spacing / 2.4);
      out.r *= k;
      out.g *= k;
      out.b *= k * 0.995;
    }
  } else out.lerp(POWDER, 0.4 * smoothstep(half, half + CARVE.shoulder + 30, a));
  // Blue dye down both edges
  if (vd < 4000) {
    const lw = Math.max(0.9, 0.55 * spacing);
    const d = a > half ? a - half : half - a;
    if (d < 2 * lw)
      out.lerp(DYE_BLUE, 0.85 * (1 - smoothstep(lw, 2 * lw, d)) * (1 - smoothstep(2000, 4000, vd)));
  }
  // Red dye across every kicker lip
  const feats = ln.feats;
  for (let i = 0; i < feats.length; i++) {
    const f = feats[i]!;
    if (f.kind !== 'kicker') continue;
    const u = z - f.s;
    if (u < 0 || u > f.len) continue;
    const k = kickerShape(f)!;
    const lw = Math.max(1.2, 0.55 * spacing);
    const d = Math.abs(u - (k.lip - lw));
    if (d < lw * 1.5 && a < k.halfW)
      out.lerp(DYE_RED, 0.9 * (1 - smoothstep(lw * 0.6, lw * 1.5, d)));
  }
  return out;
}

/** What the board is on (snow spray, sound and NPCs read it). */
export type SnowSurface = 'groomed' | 'powder' | 'ice' | 'off';

/**
 * Surface at (x, z), peak coordinates: 'groomed' on the lane, 'ice' on the
 * kicker ramps' last stretch up to the lip, 'powder' everywhere else.
 * Cheap: called per frame per rider.
 */
export function surfaceAt(x: number, z: number): SnowSurface {
  if (x > X_BAND || x < -X_BAND || z < TRACK.start || z > TRACK.end) return 'powder';
  lineAt(z, ln);
  const lat = (x - ln.cx) / Math.sqrt(1 + ln.dcx * ln.dcx);
  const a = lat < 0 ? -lat : lat;
  if (a >= ln.w / 2) return 'powder';
  const feats = ln.feats;
  for (let i = 0; i < feats.length; i++) {
    const f = feats[i]!;
    if (f.kind !== 'kicker') continue;
    const u = z - f.s;
    if (u < 0 || u > f.len) continue;
    const k = kickerShape(f)!;
    if (u >= k.lt && u <= k.lip && a < k.halfW) return 'ice';
  }
  return 'groomed';
}
