// ── Endless mountain: the analytic terrain function ─────────────────────
//
// Pure and deterministic from MOUNTAIN.seed, so every client (and the
// collision code, and the chunk mesher) agrees on the exact same surface.
// The city is the summit; everything outside its square ring falls away:
//
//   de = distance from the city square
//   height = base(de)              constant radial gradient (eases in at the wall)
//          + hills                 layered value noise, faded in below the wall
//          + trench                tracks run in a shallow cut (off-track is higher)
//          + rollers + banking     along / across each dirt track
//          + landing hills         carved after every launch ramp
//          (+ alley ramps)         the alleys ramp from the street onto the slope
//          (+ mega ramp terraces)  a level pad cut into the slope at every
//                                  mega ramp site (see the section at the end)
//
// Gradients stay ≲ 0.8, so the analytic heightfield doubles as the collision
// surface (sphere-traced in raycastTerrain, bound TERRAIN_LIPSCHITZ).

import {
  ALLEYS,
  ALLEY_O0,
  MOUNTAIN,
  RAMP_O0,
  RAMP_O1,
  edgeDistance,
  smoothstep,
  vnoise,
  worldToAlley,
} from './config';
import { INFLUENCE, MEGA_SITE, tracks, type MegaSite, type NearestTrack } from './tracks';

export { ALLEYS, MOUNTAIN, hashInts, smoothstep, edgeDistance } from './config';

/** Upper bound on |∇height| — the sphere-tracing step size relies on it. */
export const TERRAIN_LIPSCHITZ = 1.4;

const SEED = MOUNTAIN.seed;

/** Height of the radial gradient at distance de from the city (eases in from flat). */
function baseHeight(de: number): number {
  if (de <= 0) return MOUNTAIN.topY;
  const L = MOUNTAIN.slopeEase;
  return MOUNTAIN.topY - MOUNTAIN.slope * (de - L * (1 - Math.exp(-de / L)));
}

/** Rolling hills, fBm in [-1, 1]. */
function hills(x: number, z: number): number {
  return (
    vnoise(x / 110, z / 110, SEED + 11) * 0.62 +
    vnoise(x / 47, z / 47, SEED + 23) * 0.28 +
    vnoise(x / 19, z / 19, SEED + 37) * 0.1
  );
}

const ss01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Landing hills after the ramps of the nearest track (≤ 0, then recovers to 0). */
function landing(nt: NearestTrack): number {
  const t = nt.track;
  if (t === null) return 0;
  const [k0, k1] = tracks.rampRange(t, nt.s);
  let y = 0;
  for (let k = k0; k <= k1; k++) {
    const r = tracks.rampAt(t, k);
    if (r === null) continue;
    const sp = nt.s - r.s;
    if (sp <= 0) continue;
    const sp2 = r.spec;
    y += -sp2.drop * ss01(sp / sp2.land) + sp2.drop * ss01((sp - sp2.land) / sp2.recover);
  }
  return y;
}

const _nt: NearestTrack = { track: null, d: 0, side: 0, s: 0, k: 0, weight: 0 };
const _l = { a: 0, o: 0 };

export interface TerrainSample {
  /** Surface height. */
  y: number;
  /** 0 = grass … 1 = dirt track (smooth blend across the shoulder). */
  track: number;
  /** 0..1 inside an alley corridor ramp (concrete). */
  alley: number;
  /** Signed distance from the nearest track centre line (m, + = right). */
  side: number;
  /** Unsigned (effective) distance to the nearest track, ≤ INFLUENCE. */
  dist: number;
}

/** Full sample (height + surface blend). */
export function sampleTerrain(x: number, z: number, out: TerrainSample): TerrainSample {
  sampleBase(x, z, out);
  // tracks.near still holds this point's lines (sampleBase's last query)
  if (out.dist < INFLUENCE) applyMegaPads(x, z, out);
  return out;
}

/** The surface without the mega ramp terraces. */
function sampleBase(x: number, z: number, out: TerrainSample): TerrainSample {
  const de = edgeDistance(x, z);
  let y = baseHeight(de);
  let track = 0;
  let side = 1e9;
  let dist = INFLUENCE;
  if (de > 0) {
    const nt = tracks.nearest(x, z, _nt);
    const d = nt.d;
    const f = smoothstep(8, 140, de);
    const half = MOUNTAIN.trackHalf;
    const hillMask = smoothstep(half, half + 40, d);
    const trench = 3.5 * smoothstep(0, 60, d);
    // Along/across-track features blend over every track in reach (a plain
    // "nearest track" would jump where two tracks' zones meet)
    let rollers = 0;
    let rw = 0;
    let bank = 0;
    let bw = 0;
    let land = 0;
    for (let q = 0; q < tracks.nearCount; q++) {
      const e = tracks.near[q];
      const nr = 1 - smoothstep(28, 72, e.d);
      rollers += nr * (0.8 * Math.sin(e.s / 61 + 1.3) + 0.3 * Math.sin(e.s / 33 + 4.1));
      rw += nr;
      const wb = 1 - smoothstep(half, half + MOUNTAIN.trackShoulder, e.d);
      bank += wb * Math.max(-0.1, Math.min(0.1, -e.k * 28)) * e.side;
      bw += wb;
      // (ramps are only placed where no other track passes near their
      // landing hill — see tracks.rampAt — so these never cross a line)
      // and, belt and braces, fade where another line is clearly nearer
      const wl = (1 - smoothstep(12, 90, e.d)) * (1 - smoothstep(10, 70, e.d - d));
      if (wl > 0) land += landing(e) * wl;
    }
    rollers /= Math.max(1, rw);
    bank /= Math.max(1, bw);
    y += f * (hills(x, z) * 7 * hillMask + trench + rollers + bank + land);
    track = smoothstep(half + 2, half - 0.5, d) * smoothstep(4, 12, de);
    side = nt.side;
    dist = d;
  }
  // Alley ramps: from the street (y = 0) down onto the mountain
  let alley = 0;
  for (const al of ALLEYS) {
    const l = worldToAlley(al, x, z, _l);
    if (l.o < ALLEY_O0 - 6 || l.o > RAMP_O1) continue;
    const half = al.width / 2;
    const cw = 1 - smoothstep(half + 3.5, half + 6, Math.abs(l.a - al.a));
    if (cw <= 0) continue;
    const k =
      l.o <= RAMP_O0 ? 1 : 0.5 + 0.5 * Math.cos(((l.o - RAMP_O0) / (RAMP_O1 - RAMP_O0)) * Math.PI);
    y += cw * -MOUNTAIN.topY * k;
    alley = Math.max(alley, cw * smoothstep(RAMP_O1, RAMP_O1 - 6, l.o));
  }
  out.y = y;
  out.track = track * (1 - alley);
  out.alley = alley;
  out.side = side;
  out.dist = dist;
  return out;
}

const _s: TerrainSample = { y: 0, track: 0, alley: 0, side: 0, dist: 0 };

/** Terrain height at (x, z). */
export function terrainHeight(x: number, z: number): number {
  return sampleTerrain(x, z, _s).y;
}

/** Inside an alley corridor (between its walls, past the facade line)? */
export function inAlley(x: number, z: number, margin = 0.05): boolean {
  for (const al of ALLEYS) {
    const l = worldToAlley(al, x, z, _l);
    if (l.o >= ALLEY_O0 && Math.abs(l.a - al.a) <= al.width / 2 + margin) return true;
  }
  return false;
}

/**
 * Where the terrain is a real, collidable surface: everything outside the
 * city square plus the alley corridors. Inside the city it doesn't exist
 * (the baked level owns the ground there).
 */
export function terrainInDomain(x: number, z: number): boolean {
  if (Math.max(Math.abs(x), Math.abs(z)) >= MOUNTAIN.wallZ) return true;
  return inAlley(x, z);
}

/**
 * Height used for the *rendered* mesh: the real surface outside the ring
 * and along the alleys (just under the sidewalk at their mouths), sunk out
 * of sight everywhere under the city.
 */
export function meshHeight(x: number, z: number, out: TerrainSample): TerrainSample {
  sampleTerrain(x, z, out);
  if (Math.max(Math.abs(x), Math.abs(z)) >= MOUNTAIN.wallZ - 2) return out;
  for (const al of ALLEYS) {
    const l = worldToAlley(al, x, z, _l);
    if (Math.abs(l.a - al.a) > al.width / 2 + 6 || l.o < ALLEY_O0 - 5) continue;
    if (l.o < ALLEY_O0) out.y = -0.06;
    return out;
  }
  out.y = MOUNTAIN.topY - 10;
  return out;
}

/** Surface type for friction / HUD: 'track' (dirt), 'grass', 'alley' or null. */
export function terrainSurface(x: number, z: number): 'track' | 'grass' | 'alley' | null {
  if (!terrainInDomain(x, z)) return null;
  const s = sampleTerrain(x, z, _s);
  // The mega ramp (+ its bridge) rides like the dirt line, not like grass
  if (s.track <= 0.35 && s.alley <= 0.5 && megaAt(x, z, 0.5) !== null) return 'track';
  if (s.alley > 0.5) return 'alley';
  return s.track > 0.35 ? 'track' : 'grass';
}

/** Cheap colour-variation noise in [-1, 1] (for vertex tints). */
export function tintNoise(x: number, z: number): number {
  return vnoise(x / 23, z / 23, SEED + 51) * 0.7 + vnoise(x / 6.5, z / 6.5, SEED + 53) * 0.3;
}

/** Upward unit normal of the terrain at (x, z) (central differences). */
export function terrainNormal(x: number, z: number, out: { x: number; y: number; z: number }) {
  const e = 0.2;
  const dx = (terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
  const dz = (terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
  const l = Math.sqrt(dx * dx + 1 + dz * dz);
  out.x = -dx / l;
  out.y = 1 / l;
  out.z = -dz / l;
  return out;
}

/**
 * Sphere-traced ray vs the analytic heightfield. `dir` must be unit length.
 * Returns the hit distance, or -1. A ray that starts underground and points
 * down reports a hit at 0 (callers then snap back up to the surface).
 */
export function raycastTerrain(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  far: number,
): number {
  // Quick reject: the whole segment is inside the city (the square is convex)
  const ex = ox + dx * far;
  const ez = oz + dz * far;
  const lim = ALLEY_O0 - 0.5;
  if (Math.max(Math.abs(ox), Math.abs(oz)) < lim && Math.max(Math.abs(ex), Math.abs(ez)) < lim)
    return -1;
  const h = Math.hypot(dx, dz);
  const rate = TERRAIN_LIPSCHITZ * h + Math.max(0, -dy);
  let t = 0;
  let px = ox;
  let pz = oz;
  let gap = oy - terrainHeight(ox, oz);
  if (gap < 0) {
    if (dy < -0.2 && terrainInDomain(ox, oz)) return 0;
    return -1;
  }
  let prevT = 0;
  for (let i = 0; i < 128; i++) {
    if (gap < 0.002) {
      if (!terrainInDomain(px, pz)) return -1;
      return t;
    }
    prevT = t;
    const step = rate > 1e-6 ? Math.max(0.015, (gap / rate) * 0.95) : far + 1;
    t += step;
    if (t > far) t = far;
    px = ox + dx * t;
    pz = oz + dz * t;
    gap = oy + dy * t - terrainHeight(px, pz);
    if (gap < 0) {
      // Bisect between the last point above and this one below
      let a = prevT;
      let b = t;
      for (let k = 0; k < 10; k++) {
        const m = (a + b) * 0.5;
        const g = oy + dy * m - terrainHeight(ox + dx * m, oz + dz * m);
        if (g > 0) a = m;
        else b = m;
      }
      const tt = (a + b) * 0.5;
      if (!terrainInDomain(ox + dx * tt, oz + dz * tt)) return -1;
      return tt;
    }
    if (t >= far) return -1;
  }
  return -1;
}

// ── Mega ramp terraces ──────────────────────────────────────────────────
//
// Every mega ramp site (tracks.ts → MegaSite) cuts a level terrace into the
// slope: a rectangle in the site's frame (u along the dead-straight track
// from the back of the drop-in deck, v across it, + = right), holding both
// the track and the ramp beside it, blended into the natural surface over
// M_UP / M_DN / M_LAT metres with smoothsteps.
//
// The pad level P is the natural height of the track centre at the pad's
// downhill end (u = Lf), so along the track the natural surface is ≥ P on
// the uphill side and ≤ P on the downhill side. With h = N + w·(P − N) and
// w varying only in u along the track, dh/ds = (1 − w)·N' + w'·(P − N) ≤ 0
// everywhere: the line stays downhill (level on the pad) — a steep descent
// into the cut, the level terrace beside the ramp, then the slope again.
//
// The drop-in deck stands 25 m above P. Behind it a level bridge runs back
// uphill along the ramp's centreline until it meets the cut hillside: that
// is the way up (veer off the line before the cut and roll onto it).

/** Mega ramp dimensions the terrace needs (local frame of world/MegaRamp.ts). */
export const MEGA_PAD = {
  /** Drop-in deck height, deck length to the crest, half width. */
  topY: 25,
  crestZ: 3.5,
  halfW: 5,
  /** Back of the drop-in (0) → far end of the quarter-pipe deck. */
  rampLen: 115,
  /** Level floor behind the deck (scaffold feet) and past the QP. */
  backPad: 4,
  frontPad: 12,
  /** Longest pad (on gentle stretches the cut needs a longer terrace). */
  maxLen: 230,
  /** Blend widths: uphill cut wall, downhill lip, sides. */
  M_UP: 60,
  M_DN: 50,
  M_LAT: 55,
  /** Clearance beside the track / beyond the ramp. */
  trackClear: 4,
  rampClear: 6,
  /** Longest level bridge; past it the bridge slopes down to meet the hill. */
  maxBridge: 150,
  maxRampDown: 40,
  rampDownGrade: 0.25,
} as const;

export interface MegaFrame {
  site: MegaSite;
  /** Track centre at u = 0, forward + right unit vectors, heading. */
  ox: number;
  oz: number;
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  yaw: number;
  /** Pad level and the pad's downhill end (u). */
  P: number;
  Lf: number;
  /** Ramp centreline (v) and the flat pad's lateral range. */
  cv: number;
  vmin: number;
  vmax: number;
  /** Bridge: level from u = 0 back to uLevel, then sloping down to uFoot. */
  uLevel: number;
  uFoot: number;
  /**
   * Another dirt line passes too close (a branch curling back, a
   * neighbouring main): no terrace, no ramp — the line just stays straight.
   */
  dead: boolean;
}

const _rs: TerrainSample = { y: 0, track: 0, alley: 0, side: 0, dist: 0 };
const _pp = { x: 0, z: 0, h: 0, k: 0 };

/** Placement of a mega ramp site (resolved once, deterministic). */
export function megaFrame(site: MegaSite): MegaFrame {
  if (site.frame !== null) return site.frame as MegaFrame;
  const D = MEGA_PAD;
  const o = tracks.pointAt(site.track, site.s, _pp);
  const ox = o.x;
  const oz = o.z;
  const yaw = o.h;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = fz;
  const rz = -fx;
  const dead = otherLineNear(site, ox, oz, fx, fz);
  // Natural height anywhere in the frame (the track is the line v = 0)
  const nat = (u: number, v: number) =>
    sampleBase(ox + fx * u + rx * v, oz + fz * u + rz * v, _rs).y;
  // Pad end: long enough that the cut at the back is about as deep as the
  // drop-in is tall (so the bridge meets the hillside), then nudged on
  // until the line beyond it never rises back above the pad level
  const top = nat(-D.backPad - D.M_UP - 20, 0);
  let Lf = D.rampLen + D.frontPad;
  while (!dead && top - nat(Lf, 0) < D.topY && Lf < D.maxLen) Lf += 10;
  let P = nat(Lf, 0);
  for (let u = Lf + 5; !dead && u <= Lf + D.M_DN && Lf < D.maxLen; u += 5) {
    const n = nat(u, 0);
    if (n > P) {
      Lf = u;
      P = n;
    }
  }
  const cv = site.side * MEGA_SITE.off;
  const near = -(MOUNTAIN.trackHalf + D.trackClear);
  const far = MEGA_SITE.off + D.halfW + D.rampClear;
  const f: MegaFrame = {
    site,
    ox,
    oz,
    fx,
    fz,
    rx,
    rz,
    yaw,
    P,
    Lf,
    cv,
    vmin: site.side > 0 ? near : -far,
    vmax: site.side > 0 ? far : -near,
    uLevel: 0,
    uFoot: 0,
    dead,
  };
  site.frame = f;
  if (dead) return f;
  // Bridge: walk back up the ramp's centreline until the (cut) hillside
  // reaches the drop-in deck
  const deck = P + D.topY;
  const h = (u: number) => {
    const n = nat(u, cv);
    return n + padWeight(f, u, cv) * (P - n);
  };
  let u = -D.backPad;
  while (u > -D.maxBridge && h(u) < deck) u -= 1;
  if (h(u) >= deck) {
    let a = u;
    let b = u + 1;
    for (let i = 0; i < 12; i++) {
      const m = (a + b) / 2;
      if (h(m) >= deck) a = m;
      else b = m;
    }
    f.uLevel = f.uFoot = b;
  } else {
    // Gentle stretch: the bridge's last part slopes down to the hill
    f.uLevel = u;
    let q = u;
    while (q > u - D.maxRampDown && h(q) < deck - (u - q) * D.rampDownGrade) q -= 1;
    f.uFoot = q;
  }
  site.frame = f;
  return f;
}

/**
 * Does any other track come within reach of the site's terrace? Checked on
 * the fully grown network up to the terrace's distance from the city (every
 * line only ever moves away from the city, so that set of points doesn't
 * depend on what has been streamed so far): deterministic on every client.
 */
function otherLineNear(site: MegaSite, ox: number, oz: number, fx: number, fz: number): boolean {
  const D = MEGA_PAD;
  const clear = 40;
  const u0 = -MEGA_SITE.pre - D.M_UP - clear;
  const u1 = D.maxLen + D.M_DN + clear;
  const vr = MEGA_SITE.off + D.halfW + D.rampClear + D.M_LAT + clear;
  let far = 0;
  for (const u of [u0, u1])
    for (const v of [-vr, vr])
      far = Math.max(far, edgeDistance(ox + fx * u + fz * v, oz + fz * u - fx * v));
  tracks.ensure(far);
  for (const t of tracks.tracks) {
    if (t === site.track) continue;
    for (let i = 0; i < t.xs.length; i++) {
      const dx = t.xs[i] - ox;
      const dz = t.zs[i] - oz;
      const u = dx * fx + dz * fz;
      const v = dx * fz - dz * fx;
      if (u > u0 && u < u1 && Math.abs(v) < vr) return true;
    }
  }
  return false;
}

/** Terrace blend weight (0 = natural … 1 = level pad) at frame coords. */
function padWeight(f: MegaFrame, u: number, v: number): number {
  if (f.dead) return 0;
  const D = MEGA_PAD;
  const wu =
    smoothstep(-D.backPad - D.M_UP, -D.backPad, u) * (1 - smoothstep(f.Lf, f.Lf + D.M_DN, u));
  if (wu <= 0) return 0;
  const wv =
    smoothstep(f.vmin - D.M_LAT, f.vmin, v) * (1 - smoothstep(f.vmax, f.vmax + D.M_LAT, v));
  return wu * wv;
}

// Candidate sites near the last tracks.nearest() point. Static: resolving a
// frame (megaFrame → sampleBase) re-queries the network and clobbers
// tracks.near, but never touches this list.
const _cand: MegaSite[] = [];

function megaCandidates(): number {
  let n = 0;
  for (let q = 0; q < tracks.nearCount; q++) {
    const e = tracks.near[q];
    const t = e.track;
    if (t === null || t.megas.length === 0) continue;
    for (const m of t.megas) {
      if (e.s < m.s - MEGA_SITE.pre - 10 || e.s > m.s + MEGA_SITE.post + 10) continue;
      if (n < 8) _cand[n++] = m;
    }
  }
  return n;
}

function applyMegaPads(x: number, z: number, out: TerrainSample) {
  const n = megaCandidates();
  for (let i = 0; i < n; i++) {
    const f = megaFrame(_cand[i]);
    const dx = x - f.ox;
    const dz = z - f.oz;
    const w = padWeight(f, dx * f.fx + dz * f.fz, dx * f.rx + dz * f.rz);
    if (w <= 0) continue;
    out.y += w * (f.P - out.y);
    // Packed-dirt floor on the terrace itself
    out.track = Math.max(out.track, smoothstep(0.9, 1, w));
  }
}

export interface MegaHit {
  frame: MegaFrame;
  /** Ramp-local coordinates (x across, z along, from the back of the drop-in deck). */
  lx: number;
  lz: number;
}

const _hit: MegaHit = { frame: null as unknown as MegaFrame, lx: 0, lz: 0 };
const _mnt: NearestTrack = { track: null, d: 0, side: 0, s: 0, k: 0, weight: 0 };

/** Visit the mega frames near (x, z) with frame coords; stop when `fn` returns true. */
function eachMega(
  x: number,
  z: number,
  fn: (f: MegaFrame, u: number, v: number) => boolean,
): boolean {
  if (edgeDistance(x, z) <= 0) return false;
  tracks.nearest(x, z, _mnt);
  const n = megaCandidates();
  for (let i = 0; i < n; i++) {
    const f = megaFrame(_cand[i]);
    if (f.dead) continue;
    const dx = x - f.ox;
    const dz = z - f.oz;
    if (fn(f, dx * f.fx + dz * f.fz, dx * f.rx + dz * f.rz)) return true;
  }
  return false;
}

/**
 * The mega ramp (incl. its bridge) whose footprint contains (x, z), grown by
 * `margin` m, or null. The returned object is reused.
 */
export function megaAt(x: number, z: number, margin: number): MegaHit | null {
  const found = eachMega(x, z, (f, u, v) => {
    const lx = v - f.cv;
    if (Math.abs(lx) > MEGA_PAD.halfW + margin) return false;
    if (u < f.uFoot - margin || u > MEGA_PAD.rampLen + margin) return false;
    _hit.frame = f;
    _hit.lx = lx;
    _hit.lz = u;
    return true;
  });
  return found ? _hit : null;
}

/** Keep-out for the dressing (plants, water, rocks): terrace floor + bridge, with a margin. */
export function megaBlocked(x: number, z: number): boolean {
  return eachMega(
    x,
    z,
    (f, u, v) => u >= f.uFoot - 12 && u <= f.Lf + 10 && v >= f.vmin - 10 && v <= f.vmax + 10,
  );
}

/**
 * Speed governor for a rider at (x, y, z) on a mega ramp (m/s; Infinity =
 * none). The ramp was built for the city: 17 m/s top speed, ~14.2 m/s at the
 * kicker lip, which its 13 m gap and landing are tuned for. The mountain has
 * no top speed (plus lighter friction, drag relief and a streak push), so
 * wherever this is finite Player rides with the city's physics, and:
 *   • bridge + drop-in deck: a braking curve down to `deckSpeed` at the
 *     deck (at most `brake` m/s² — arrive at any speed, drop in calm);
 *   • from the crest on (roll-in, kicker, landing, run-out, QP): the city's
 *     17 m/s cap, so the gap and landing play exactly as they do in town.
 * Never applies on the terrace floor around the ramp.
 */
export const MEGA_GOVERNOR = { deckSpeed: 6, brake: 14, rampCap: 17 } as const;

export function megaSpeedLimit(x: number, y: number, z: number): number {
  const h = megaAt(x, z, 0.4);
  if (h === null) return Infinity;
  if (y - h.frame.P < 0.2) return Infinity;
  const G = MEGA_GOVERNOR;
  if (h.lz >= MEGA_PAD.crestZ) return G.rampCap;
  return Math.sqrt(G.deckSpeed * G.deckSpeed + 2 * G.brake * Math.max(0, -h.lz));
}

/** R respawn spot on a site's drop-in deck (world position + yaw). */
export function megaSpawn(site: MegaSite): { x: number; y: number; z: number; yaw: number } {
  const f = megaFrame(site);
  const along = MEGA_PAD.crestZ * 0.45;
  return {
    x: f.ox + f.rx * f.cv + f.fx * along,
    y: f.P + MEGA_PAD.topY,
    z: f.oz + f.rz * f.cv + f.fz * along,
    yaw: f.yaw,
  };
}
