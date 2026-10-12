// ── The Noggle Bowl: a huge concrete bowl ~42 km down the −X line ────────
//
// The second secret spot (site: tracks.ts → BOWL_SITE; build: NoggleBowlPark.ts).
// Pure + deterministic like terrain.ts (no three.js here). Built for speed:
// unlike Noun Jersey there's no speed governor anywhere in it.
//
// Frame: exactly Noun Jersey's (nounJersey.ts): u along the reserved, dead
// straight line from the top of a level pad, v' across it, "into the bowl".
// The pad is a terrace cut into the slope (level at P, the natural height
// of the line at the pad's downhill end), holding the line and the bowl.
//
// The bowl is a stadium (two half-circles joined by straights) along u:
//
//     b = u − Ub (along the axis), a = v' − Vc (across), d = inward distance
//     from the rim. Shallow end uphill (Hs deep, a 45° bank you roll into),
//     deep end downhill (Hd deep, vert walls + coping), the straights blend
//     from bank to vert along their length.
//
// Two surfaces, one design:
//   D  the design surface: what you ride (bank, transitions, vert, deck)
//   T  the terrain (what terrain.ts returns): equal to D wherever D is a
//      gentle heightfield; under the vert walls + deck, where D is steeper
//      than the terrain's Lipschitz bound, it tucks under them (≤ D, slope
//      ≤ 1.2) and NoggleBowlPark.ts adds the rest of D as a mesh. The floor,
//      the transitions up to ~50°, the bank, the roll-in and the whole
//      approach are analytic terrain: perfectly smooth at any speed; the
//      mesh joins it tangentially at its lower edge.
//
// The roll-in: a paved slip road peels off the line ~480 m upstream and
// becomes a raised ramp (an earth embankment, steepening to 45°) that runs
// radially into the shallow end's bank, so the bank and the roll-in are a
// single smooth surface along its centre.

import { MOUNTAIN, edgeDistance, smoothstep } from './config';
import { BOWL_SITE, tracks, type SpotSite } from './tracks';

export const BOWL = {
  /** Stadium: half-circle radius, half length of the straights. */
  Rr: 60,
  A: 60,
  /** Wall height (rim above the floor): shallow end, deep end. Vert section at the top. */
  Hs: 32,
  Hd: 44,
  Hv: 3,
  /** Shallow-end bank: slope, and the radius of its transition to the floor. */
  sBank: 1,
  Rb: 30,
  /** Along the straights the walls go from bank to vert over this (m). */
  Lb: 60,
  /** Terrain under the vert walls: max slope, and its smooth-min into the deck. */
  sUnder: 1.2,
  kDeck: 4,
  /** Concrete deck around the rim (the terrain under it dips below the walls). */
  deckW: 19,
  /** Lane edge → deck, deck → pad edge. */
  gapLine: 10,
  padClear: 12,
  /** Pad: reach beyond the lane on the near side; blend widths. */
  vNear: MOUNTAIN.trackHalf + 4,
  M_UP: 130,
  M_DN: 60,
  M_LAT: 75,
  maxExtra: 40,
  /** Roll-in: path from the line (uM) to the bowl's axis (reached by rim − 40). */
  uM: -480,
  /** The roll-in proper starts where its path is this far off the line. */
  vStart: 62,
  half: 11,
  bankW: 45,
} as const;

const B = BOWL;
/** Bowl axis (v') and the uphill rim apex (u). */
const VC = MOUNTAIN.trackHalf + B.gapLine + B.deckW + B.Rr;
const U_RIM = B.padClear + B.deckW;
/** Centre of the shallow end's half circle, of the whole bowl. */
const U_UP = U_RIM + B.Rr;
const U_B = U_UP + B.A;
/** Minimum pad length (to past the deep end's deck). */
const L_MIN = U_B + B.A + B.Rr + B.deckW + B.padClear;
const V_MAX = VC + B.Rr + B.deckW + B.padClear;
const U_E = U_RIM - 40;

export interface BowlFrame {
  site: SpotSite;
  ox: number;
  oz: number;
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  yaw: number;
  /** +1: bowl on the r side (left of travel riding down), −1: the other side. */
  side: number;
  /** Pad level and the pad's downhill end (u). */
  P: number;
  Lf: number;
  /** Roll-in: start (along its centre, distance from the shallow end's centre), height, slope, shape. */
  rho1: number;
  h1: number;
  s0: number;
  q: number;
  /** World AABB of everything the bowl touches (cheap reject). */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Natural surface (no terraces), registered by terrain.ts (avoids an import cycle). */
let natural: ((x: number, z: number) => number) | null = null;

export function setBowlNatural(fn: (x: number, z: number) => number) {
  natural = fn;
}

const _pp = { x: 0, z: 0, h: 0, k: 0 };
let resolved: BowlFrame | null = null;

/** The resolved frame, or null while the site isn't fixed yet (see njFrame). */
export function bowlFrame(): BowlFrame | null {
  if (resolved !== null) return resolved;
  const t = tracks.tracks.find(q => q.id === BOWL_SITE.track);
  const site = t?.bowls[0];
  if (site === undefined) return null;
  return resolve(site);
}

/** The frame, growing the line as far as needed (spawn, decorator). */
export function bowlFrameNow(): BowlFrame | null {
  const site = tracks.bowl();
  return site === null ? null : resolve(site);
}

/** Path of the roll-in's centre (v' at u): off the line, onto the bowl's axis. */
export function chuteV(u: number): number {
  return VC * smoothstep(B.uM, U_E, u);
}

function resolve(site: SpotSite): BowlFrame {
  if (site.frame !== null) return site.frame as BowlFrame;
  const nat = natural!;
  const o = tracks.pointAt(site.track, site.s, _pp);
  const ox = o.x;
  const oz = o.z;
  const yaw = o.h;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = fz;
  const rz = -fx;
  const pref = (site.track.id * 5 + 1) % 2 === 0 ? 1 : -1;
  let side = pref;
  if (otherLineNear(site, ox, oz, fx, fz, pref)) {
    if (!otherLineNear(site, ox, oz, fx, fz, -pref)) side = -pref;
    else console.warn('[world2] noggle bowl: lines on both sides, keeping', pref);
  }
  const at = (u: number, vp: number) =>
    nat(ox + fx * u + rx * vp * side, oz + fz * u + rz * vp * side);
  let Lf: number = L_MIN;
  let P = at(Lf, 0);
  for (let u = Lf + 5; u <= Lf + B.M_DN && Lf < L_MIN + B.maxExtra; u += 5) {
    const n = at(u, 0);
    if (n > P) {
      Lf = Math.min(L_MIN + B.maxExtra, u);
      P = at(Lf, 0);
    }
  }
  // Roll-in start: where its path is vStart off the line (bisect the smoothstep)
  let lo: number = B.uM;
  let hi: number = U_E;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (chuteV(m) < B.vStart) lo = m;
    else hi = m;
  }
  const u1 = (lo + hi) / 2;
  const rho1 = Math.hypot(U_UP - u1, VC - B.vStart);
  // The natural surface there (outside the pad's cut: u1 < −M_UP) and its
  // slope along the path, so the roll-in leaves it tangentially
  const h1 = at(u1, B.vStart);
  const du = 8;
  const h1b = at(u1 + du, chuteV(u1 + du));
  const dRho = rho1 - Math.hypot(U_UP - u1 - du, VC - chuteV(u1 + du));
  const L = rho1 - B.Rr;
  const avg = (h1 - P) / L;
  let s0 = Math.max(0.02, (h1 - h1b) / Math.max(1, dRho));
  s0 = Math.min(s0, avg * 0.8);
  // Slope from s0 (top) to sBank (rim): s0 + (sBank − s0)·t^(q−1), q fixed by the drop
  const q = Math.max(1.5, (B.sBank - s0) / Math.max(1e-3, avg - s0));
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const u of [B.uM - 60, Lf + B.M_DN])
    for (const vp of [-B.vNear - B.M_LAT, V_MAX + B.M_LAT]) {
      const x = ox + fx * u + rx * vp * side;
      const z = oz + fz * u + rz * vp * side;
      x0 = Math.min(x0, x);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      z1 = Math.max(z1, z);
    }
  const f: BowlFrame = {
    site,
    ox,
    oz,
    fx,
    fz,
    rx,
    rz,
    yaw,
    side,
    P,
    Lf,
    rho1,
    h1,
    s0,
    q,
    x0: x0 - 1,
    z0: z0 - 1,
    x1: x1 + 1,
    z1: z1 + 1,
  };
  site.frame = f;
  resolved = f;
  return f;
}

/**
 * Another dirt line within reach of this side's pad + roll-in (see
 * nounJersey.ts)? Out at 42 km the branches criss-cross the mains, so only
 * what the bowl reshapes counts: the pad on the bowl side of the lane, and
 * the roll-in's cut / embankment along its path.
 */
function otherLineNear(
  site: SpotSite,
  ox: number,
  oz: number,
  fx: number,
  fz: number,
  side: number,
): boolean {
  const clear = 30;
  const u0 = B.uM - 20;
  const u1 = L_MIN + B.maxExtra + B.M_DN + clear;
  const va = -MOUNTAIN.trackHalf;
  const vb = V_MAX + B.M_LAT + clear;
  const reach = (u: number) => (u >= -B.M_UP - clear ? vb : chuteV(u) + B.half + B.bankW + clear);
  let far = 0;
  for (const u of [u0, u1])
    for (const vp of [va, vb])
      far = Math.max(far, edgeDistance(ox + fx * u + fz * vp * side, oz + fz * u - fx * vp * side));
  tracks.ensure(far);
  for (const t of tracks.tracks) {
    if (t === site.track) continue;
    for (let i = 0; i < t.xs.length; i++) {
      const dx = t.xs[i] - ox;
      const dz = t.zs[i] - oz;
      const u = dx * fx + dz * fz;
      const vp = (dx * fz - dz * fx) * side;
      if (u > u0 && u < u1 && vp > va && vp < reach(u)) return true;
    }
  }
  return false;
}

// ── Profiles (heights relative to P, d = inward distance from the rim) ──

const ALPHA = Math.atan(B.sBank);
const COS_A = Math.cos(ALPHA);
const SIN_A = Math.sin(ALPHA);
const S_UNDER = B.sUnder / Math.sqrt(1 + B.sUnder * B.sUnder);

/** Wall height at axis position bc (shallow → deep). */
export function wallH(bc: number): number {
  return B.Hs + (B.Hd - B.Hs) * smoothstep(-B.A, B.A, bc);
}

/** How vert the wall is at axis position bc (0 = the shallow end's bank). */
export function vertness(bc: number): number {
  return smoothstep(-B.A, -B.A + B.Lb, bc);
}

/** Shallow-end bank: straight 45° from the rim, then a circular transition to the floor. */
function bankProfile(d: number, H: number): number {
  if (d <= 0) return 0;
  const d1 = (H - B.Rb * (1 - COS_A)) / B.sBank;
  if (d <= d1) return -B.sBank * d;
  const d2 = d1 + B.Rb * SIN_A;
  if (d >= d2) return -H;
  const e = d2 - d;
  return -H + B.Rb - Math.sqrt(B.Rb * B.Rb - e * e);
}

/** Vert wall: a quarter circle (radius H − Hv) up to the vert section; deck outside (d ≤ 0). */
function vertProfile(d: number, H: number): number {
  if (d <= 0) return 0;
  const Rt = H - B.Hv;
  if (d >= Rt) return -H;
  const e = Rt - d;
  return -H + Rt - Math.sqrt(Rt * Rt - e * e);
}

/** Lower edge of the steep part of a vert wall (where its slope reaches sUnder). */
export function steepEdge(H: number): number {
  return (H - B.Hv) * (1 - S_UNDER);
}

function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

/** The terrain under a vert wall: = vertProfile below its steep edge, a sUnder slope above, into the deck. */
function vertUnder(d: number, H: number): number {
  const ds = steepEdge(H);
  if (d >= ds) return vertProfile(d, H);
  const lin = vertProfile(ds, H) + B.sUnder * (ds - d);
  return smin(lin, 0, B.kDeck);
}

/** Roll-in surface height (above P) at distance rho from the shallow end's centre. */
function chuteH(f: BowlFrame, rho: number): number {
  if (rho <= B.Rr) return bankProfile(B.Rr - rho, B.Hs);
  const L = f.rho1 - B.Rr;
  const top = f.h1 - f.P;
  if (rho >= f.rho1) return top + f.s0 * (rho - f.rho1);
  const t = (f.rho1 - rho) / L;
  return top - L * (f.s0 * t + ((B.sBank - f.s0) * Math.pow(t, f.q)) / f.q);
}

// ── Frame coordinates ───────────────────────────────────────────────────

export interface BowlCoords {
  u: number;
  vp: number;
}

const _c: BowlCoords = { u: 0, vp: 0 };

export function bowlCoords(f: BowlFrame, x: number, z: number): BowlCoords {
  const dx = x - f.ox;
  const dz = z - f.oz;
  _c.u = dx * f.fx + dz * f.fz;
  _c.vp = (dx * f.rx + dz * f.rz) * f.side;
  return _c;
}

/** Frame coords (u along the line, v' into the bowl side) → world x, z. */
export function bowlToWorld(f: BowlFrame, u: number, vp: number, out: { x: number; z: number }) {
  const v = vp * f.side;
  out.x = f.ox + f.fx * u + f.rx * v;
  out.z = f.oz + f.fz * u + f.rz * v;
  return out;
}

/** Bowl coords (b along the axis, downhill; a across) → world. */
export function bowlAxisToWorld(f: BowlFrame, b: number, a: number, out: { x: number; z: number }) {
  return bowlToWorld(f, b + U_B, a + VC, out);
}

/** World yaw of a direction given in frame coords (du along the line, dv' across). */
export function bowlYaw(f: BowlFrame, du: number, dvp: number): number {
  const x = f.fx * du + f.rx * f.side * dvp;
  const z = f.fz * du + f.rz * f.side * dvp;
  return Math.atan2(x, z);
}

/** Pad blend weight (0 = natural … 1 = level pad). */
function padWeight(f: BowlFrame, u: number, vp: number): number {
  const wu = smoothstep(-B.M_UP, 0, u) * (1 - smoothstep(f.Lf, f.Lf + B.M_DN, u));
  if (wu <= 0) return 0;
  const wv =
    smoothstep(-B.vNear - B.M_LAT, -B.vNear, vp) * (1 - smoothstep(V_MAX, V_MAX + B.M_LAT, vp));
  return wu * wv;
}

/** Roll-in weight at frame coords (and its path offset), 0 outside it. */
function chuteWeight(u: number, vp: number, rho: number, rho1: number): number {
  if (u > U_UP) return 0;
  const e = Math.abs(vp - chuteV(u));
  if (e >= B.half + B.bankW) return 0;
  const wl = 1 - smoothstep(B.half, B.half + B.bankW, e);
  const wa = smoothstep(rho1 + 10, rho1 - 50, rho);
  return wl * wa;
}

export interface BowlSample {
  /** Terrain height (T) and the ridden design surface (D ≥ T). */
  t: number;
  d: number;
  /** Concrete weight (0..1). */
  paved: number;
  /** Inside the rim (+ deck) of the bowl itself. */
  inBowl: boolean;
}

const _bs: BowlSample = { t: 0, d: 0, paved: 0, inBowl: false };

/**
 * The bowl's surfaces at frame coords, given the height the rest of the
 * terrain has there (`y`, before the pad). `rim`: the point is on the rim
 * line itself (the mesh's vert section): 'foot' / 'top' of the vert.
 */
export function bowlSurface(
  f: BowlFrame,
  u: number,
  vp: number,
  y: number,
  rim: 'foot' | 'top' | null = null,
): BowlSample {
  const w = padWeight(f, u, vp);
  let t = y + w * (f.P - y);
  let d = t;
  let paved = 0;
  let inBowl = false;
  const b = u - U_B;
  const a = vp - VC;
  const bc = b < -B.A ? -B.A : b > B.A ? B.A : b;
  const r = Math.hypot(a, b - bc);
  const di = rim !== null ? 0 : B.Rr - r;
  if (di > -B.deckW) {
    inBowl = true;
    const H = wallH(bc);
    const wv = vertness(bc);
    const bank = bankProfile(di, H);
    const vd = rim === 'foot' ? -B.Hv : vertProfile(di, H);
    d = f.P + bank + wv * (vd - bank);
    t = f.P + bank + wv * (vertUnder(di, H) - bank);
    paved = 1;
  }
  // The roll-in (raised ramp / cut) along its path
  const ru = U_UP - u;
  const rv = VC - vp;
  const rho = Math.sqrt(ru * ru + rv * rv);
  const wc = chuteWeight(u, vp, rho, f.rho1);
  if (wc > 0) {
    const h = f.P + chuteH(f, rho);
    t += wc * (h - t);
    d += wc * (h - d);
    paved = Math.max(paved, smoothstep(0.3, 0.7, wc));
  }
  if (u > B.uM && u < U_UP) {
    // Paved from where it leaves the line, all the way down
    const e = Math.abs(vp - chuteV(u));
    paved = Math.max(paved, 1 - smoothstep(B.half - 2, B.half, e));
  }
  _bs.t = t;
  _bs.d = d;
  _bs.paved = paved;
  _bs.inBowl = inBowl;
  return _bs;
}

/** terrain.ts → sampleTerrain: the pad, bowl and roll-in (after the other terraces). */
export function applyBowl(x: number, z: number, out: { y: number; alley: number; track: number }) {
  const f = bowlFrame();
  if (f === null || x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) return;
  const c = bowlCoords(f, x, z);
  if (c.u < B.uM - 60 || c.u > f.Lf + B.M_DN) return;
  if (c.vp < -B.vNear - B.M_LAT || c.vp > V_MAX + B.M_LAT) return;
  const s = bowlSurface(f, c.u, c.vp, out.y);
  out.y = s.t;
  // Concrete (rides + looks like the alleys), but the dirt lane stays dirt
  if (s.paved > 0) out.alley = Math.max(out.alley, s.paved * (1 - out.track));
}

/** The bowl's design surface (what you ride) at world x, z, or null outside it. */
export function bowlDesignAt(x: number, z: number): BowlSample | null {
  const f = bowlFrame();
  if (f === null || x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) return null;
  const c = bowlCoords(f, x, z);
  const n = natural!(x, z);
  return bowlSurface(f, c.u, c.vp, n);
}

/** Inside the bowl itself (rim + `margin`)? */
export function inBowl(x: number, z: number, margin = 0): boolean {
  const f = bowlFrame();
  if (f === null || x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) return false;
  const c = bowlCoords(f, x, z);
  const b = c.u - U_B;
  const bc = b < -B.A ? -B.A : b > B.A ? B.A : b;
  return Math.hypot(c.vp - VC, b - bc) <= B.Rr + margin;
}

/** Keep-out for the mountain dressing: the pad, bowl and roll-in, with a margin. */
export function bowlBlocked(x: number, z: number): boolean {
  const f = bowlFrame();
  if (f === null || x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) return false;
  const c = bowlCoords(f, x, z);
  if (c.u >= -8 && c.u <= f.Lf + 8 && c.vp >= -B.vNear && c.vp <= V_MAX + 8) return true;
  if (c.u < B.uM || c.u > U_UP) return false;
  return Math.abs(c.vp - chuteV(c.u)) < B.half + B.bankW + 6;
}

/** Bowl geometry for the decorator / map (frame coords). */
export const BOWL_GEO = { VC, U_RIM, U_UP, U_B, V_MAX, U_E } as const;

/** Rough footprint centre of the bowl in world coords (frame needed). */
export function bowlCentre(f: BowlFrame, out: { x: number; z: number }) {
  return bowlToWorld(f, U_B, VC, out);
}

let mapPt: { x: number; z: number } | null | undefined;

/**
 * Map marker: the bowl's centre once the frame is resolved, before that
 * the line beside it (only grows the −X line, never the whole network).
 */
export function bowlMapPoint(): { x: number; z: number } | null {
  if (resolved !== null) return bowlCentre(resolved, { x: 0, z: 0 });
  if (mapPt === undefined) {
    const site = tracks.bowl();
    mapPt =
      site === null ? null : tracks.pointAt(site.track, site.s + U_B, { x: 0, z: 0, h: 0, k: 0 });
  }
  return mapPt;
}

/** `?spot=bowl` spawn: at the top of the roll-in, facing down it. */
export function bowlSpawn(): { x: number; y: number; z: number; yaw: number } | null {
  const f = bowlFrameNow();
  if (f === null) return null;
  const u = -230;
  const p = bowlToWorld(f, u, chuteV(u), { x: 0, z: 0 });
  const dv = chuteV(u + 2) - chuteV(u - 2);
  const y = bowlSurface(f, u, chuteV(u), natural!(p.x, p.z)).t;
  return { x: p.x, y: y + 0.05, z: p.z, yaw: bowlYaw(f, 4, dv) };
}

/**
 * runProof.ts: the bowl's footprint without resolving the frame (no
 * terrain samples, no network growth beyond the −X line itself): the pad,
 * bowl and roll-in rectangle, on both sides of the line. The ground there
 * stays inside the verifier's band (floor ≈ 58 m under the base gradient
 * at worst), but straight-up airs off the vert go as high as the speed
 * carried in allows (still bounded by the energy check), so air may go up
 * to this far above the base gradient.
 */
export const BOWL_AIR_ABOVE = 3000;

let fp: { ox: number; oz: number; fx: number; fz: number } | null | undefined;

export function inBowlFootprint(x: number, z: number): boolean {
  if (Math.abs(edgeDistance(x, z) - 42400) > 3000) return false;
  if (fp === undefined) {
    const site = tracks.bowl();
    if (site === null) fp = null;
    else {
      const o = tracks.pointAt(site.track, site.s, { x: 0, z: 0, h: 0, k: 0 });
      fp = { ox: o.x, oz: o.z, fx: Math.sin(o.h), fz: Math.cos(o.h) };
    }
  }
  if (fp === null) return false;
  const dx = x - fp.ox;
  const dz = z - fp.oz;
  const u = dx * fp.fx + dz * fp.fz;
  const v = Math.abs(dx * fp.fz - dz * fp.fx);
  return u > B.uM - 60 && u < L_MIN + B.maxExtra + B.M_DN && v < V_MAX + B.M_LAT;
}
