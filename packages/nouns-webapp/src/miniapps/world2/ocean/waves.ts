// ── The wave field: one function, on the CPU here and on the GPU (GLSL) ──
//
// Everything is in coast coords (coast.ts): d = metres into the sea (the
// shore normal), a = metres along the coast from the beach centre, plus the
// local world offset (lx, lz) from the town origin for the chop. The GPU's
// OceanSurface evaluates WAVES_GLSL below at every grid vertex; boards,
// swimmers and buoys use seaSample(), the same maths, so they float on the
// surface you see. Change one, change the other (waves.test.ts pins a few
// numbers; the GLSL is a line-for-line copy).
//
// The swell (one long train, coming in at an angle so it peels):
//   phase   φ = K(d) − kA·a + ω·t, crests at φ ≡ 0 (mod 2π), moving in.
//           K(d) = ∫k: k eases from kD (deep, ~126 m) to kS near the shore
//           (~45 m); kA (the along-coast wavenumber) is conserved, so the
//           crests swing round toward the beach (Snell) but stay oblique:
//           the break line is crossed progressively along the crest and the
//           wave peels down the line (+a) at ~c / sin β ≈ 9–10 m/s.
//   sets    every crest carries its own size, set(φ) (groups of 8 waves).
//   shoal   Green's law H ∝ depth^-¼, then saturates at γ·depth: inside the
//           break line the wave is broken (a bore), down to the swash.
//   shape   Gerstner: the vertex moves −Dh·sin φ along d (sharper crests,
//           flatter troughs), Dh·k up to 0.85 as it steepens to break.
// The chop: three small sines in world space (no horizontal motion).
// broken: is the crest above / behind this point breaking? (the lip, the
//   whitewater). foam: where the foam is (crest, bore, trails).

import { seabedDepth, SEABED } from './coast';

export const SWELL = {
  /** Period (s). */
  T: 9,
  /** Wavenumber near the shore / in the deep, and the e-folding distance between. */
  kS: 0.14,
  kD: 0.05,
  lam: 200,
  /** Along-coast wavenumber (the angle the swell comes in at). */
  kA: 0.065,
  /** Offshore height (crest to trough, m) of an average wave. */
  H0: 1.9,
  /** Breaking: H > γ·depth. */
  gamma: 0.78,
  /** Swash: the smallest height the surface keeps at the waterline. */
  swash: 0.35,
  swashL: 12,
} as const;

export const OMEGA = (2 * Math.PI) / SWELL.T;

/** [amplitude m, wavenumber x, wavenumber z, ω] of the chop. */
export const CHOP: readonly (readonly [number, number, number, number])[] = [
  [0.07, 0.62, 0.31, (2 * Math.PI * 137) / 360],
  [0.045, -0.38, 0.95, (2 * Math.PI * 178) / 360],
  [0.03, 1.55, -0.9, (2 * Math.PI * 246) / 360],
] as const;

/**
 * The sea clock wraps every SEA_WRAP s (float32 on the GPU stays precise):
 * a whole number of swell periods, set groups (8 waves) and chop cycles, so
 * the wrap is seamless.
 */
export const SEA_WRAP = 360;

const TAU = Math.PI * 2;

/** Integral of k from the shore out to d. */
export function phaseK(d: number): number {
  const { kS, kD, lam } = SWELL;
  return kD * d - (kD - kS) * lam * (1 - Math.exp(-d / lam));
}

/** Local wavenumber at d. */
export function waveK(d: number): number {
  const { kS, kD, lam } = SWELL;
  return kD + (kS - kD) * Math.exp(-d / lam);
}

/** A crest's size (× H0), from its phase: groups of 8, the biggest ~1.25. */
export function setSize(phi: number): number {
  const s = 0.5 + 0.5 * Math.sin(phi / 8 + 0.7);
  return 0.62 + 0.63 * s * s * s;
}

export interface Swell {
  phi: number;
  /** Amplitude (m, half the height). */
  A: number;
  k: number;
  /** Horizontal Gerstner reach (m). */
  Dh: number;
  /** Shoaled height / γ·depth (> 1: breaking). */
  ratio: number;
  depth: number;
}

/** The swell's parameters at the rest position d0 (before the Gerstner shift). */
export function swellAt(d0: number, a: number, t: number, out: Swell): Swell {
  const d = d0 > 0 ? d0 : 0;
  const phi = phaseK(d) - SWELL.kA * a + OMEGA * t;
  const depth = Math.max(0.05, seabedDepth(d));
  const k = waveK(d);
  const Hoff = SWELL.H0 * setSize(phi);
  const shoal = Math.min(1.6, Math.max(1, Math.pow(20 / Math.max(depth, 0.3), 0.25)));
  const Hsh = Hoff * shoal;
  const ratio = Hsh / (SWELL.gamma * depth);
  // Smooth min(Hsh, γ·depth): saturates inside the break line
  let H = Hsh / Math.pow(1 + ratio * ratio * ratio * ratio, 0.25);
  H = Math.max(H, SWELL.swash * Math.exp(-d / SWELL.swashL));
  const A = H / 2;
  const sk = Math.min(0.85, 2 * k * A + 0.55 * smooth(0.6, 1, ratio));
  out.phi = phi;
  out.A = A;
  out.k = k;
  out.Dh = sk / k;
  out.ratio = ratio;
  out.depth = depth;
  return out;
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Phase mod 2π in [0, 2π). */
export const wrap = (phi: number) => phi - TAU * Math.floor(phi / TAU);

/**
 * Is the crest over this point breaking (0..1)? `d0` is the rest d, `phi`
 * its phase: on the front face the crest is seaward (at d0 + Δφ/k), on the
 * back face shoreward.
 */
export function brokenAt(d0: number, a: number, t: number, phi: number, k: number, tmp: Swell) {
  const pm = wrap(phi);
  const dc = pm > Math.PI ? d0 + (TAU - pm) / k : d0 - pm / k;
  const s = swellAt(dc, a, t, tmp);
  return smooth(0.92, 1.06, s.ratio);
}

/** Foam (0..1) from broken + where on the wave: the crest, the bore in front, trails behind. */
export function foamAt(broken: number, phi: number, d0: number): number {
  const pm = wrap(phi);
  // front of the crest (pm → 2π) is the bore; behind it (pm small) the trail
  const front = pm > Math.PI ? Math.exp(-(TAU - pm) * 1.6) : 0;
  const trail = pm <= Math.PI ? Math.exp(-pm * 2.2) * 0.6 : 0;
  const crest = Math.exp(-Math.min(pm, TAU - pm) * 3);
  const shore = Math.exp(-Math.max(0, d0) / 5) * 0.7;
  return Math.min(1, broken * Math.max(front, trail, crest) + shore);
}

export interface SeaSample {
  /** Surface height (world y). */
  y: number;
  /** Rest coast distance under this point (m into the sea). */
  d0: number;
  a: number;
  phi: number;
  A: number;
  k: number;
  /** Phase speed toward the shore (m/s). */
  c: number;
  depth: number;
  ratio: number;
  broken: number;
  foam: number;
  /** Orbital water speed toward the shore (m/s, + = in). */
  flow: number;
}

const _sw: Swell = { phi: 0, A: 0, k: 0, Dh: 0, ratio: 0, depth: 0 };
const _tmp: Swell = { phi: 0, A: 0, k: 0, Dh: 0, ratio: 0, depth: 0 };

/** Chop height at local world offset (lx, lz). */
export function chopAt(lx: number, lz: number, t: number): number {
  let y = 0;
  for (let i = 0; i < CHOP.length; i++) {
    const c = CHOP[i];
    y += c[0] * Math.sin(c[1] * lx + c[2] * lz - c[3] * t + i * 1.7);
  }
  return y;
}

/**
 * The surface at a world point whose coast distance is d (a along the
 * coast; lx, lz = offset from the town origin), sea level `sea`. Inverts
 * the Gerstner shift (Newton on d0) so the height is under (x, z) itself.
 */
export function seaSample(
  sea: number,
  d: number,
  a: number,
  lx: number,
  lz: number,
  t: number,
  out: SeaSample,
): SeaSample {
  let d0 = d;
  for (let i = 0; i < 5; i++) {
    const s = swellAt(d0, a, t, _sw);
    const f = d0 - s.Dh * Math.sin(s.phi) - d;
    const fp = 1 - s.Dh * s.k * Math.cos(s.phi);
    d0 -= f / Math.max(0.12, fp);
  }
  const s = swellAt(d0, a, t, _sw);
  const eta = s.A * Math.cos(s.phi);
  out.y = sea + eta + chopAt(lx, lz, t);
  out.d0 = d0;
  out.a = a;
  out.phi = s.phi;
  out.A = s.A;
  out.k = s.k;
  out.c = OMEGA / s.k;
  out.depth = Math.max(0, seabedDepth(d0 > 0 ? d0 : 0) + eta);
  out.ratio = s.ratio;
  out.broken = d0 > 0 ? brokenAt(d0, a, t, s.phi, s.k, _tmp) : 0;
  out.foam = foamAt(out.broken, s.phi, d0);
  // Shallow-water orbital velocity u = c·η/h (toward the shore at the crest),
  // plus the broken bore's push
  const h = Math.max(0.6, seabedDepth(Math.max(0, d0)));
  // (inside the break line the bore carries water in: little backwash)
  const orb = Math.max(-3, Math.min(4, (out.c * eta) / h));
  out.flow = (orb < 0 ? orb * (1 - 0.7 * out.broken) : orb) + out.broken * 1.2 * out.foam;
  return out;
}

// ── GLSL (OceanSurface): the same maths ──

const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

export const WAVES_GLSL = /* glsl */ `
const float W_TAU = 6.28318530718;
const float W_OMEGA = ${f(OMEGA)};
float w_smooth(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float w_bed(float d) {
  if (d <= 0.0) return 0.0;
  if (d < ${f(SEABED.surfEnd)}) return ${f(SEABED.slope)} * d;
  float d0 = ${f(SEABED.slope * SEABED.surfEnd)};
  return d0 + (${f(SEABED.deep)} - d0) * w_smooth(${f(SEABED.surfEnd)}, ${f(SEABED.deepEnd)}, d);
}
float w_K(float d) { return ${f(SWELL.kD)} * d - ${f(SWELL.kD - SWELL.kS)} * ${f(SWELL.lam)} * (1.0 - exp(-d / ${f(SWELL.lam)})); }
float w_k(float d) { return ${f(SWELL.kD)} + ${f(SWELL.kS - SWELL.kD)} * exp(-d / ${f(SWELL.lam)}); }
float w_set(float phi) { float s = 0.5 + 0.5 * sin(phi / 8.0 + 0.7); return 0.62 + 0.63 * s * s * s; }
// x: phi, y: A, z: Dh, w: ratio; k out
vec4 w_swell(float d0, float a, float t, out float k) {
  float d = max(d0, 0.0);
  float phi = w_K(d) - ${f(SWELL.kA)} * a + W_OMEGA * t;
  float depth = max(0.05, w_bed(d));
  k = w_k(d);
  float Hoff = ${f(SWELL.H0)} * w_set(phi);
  float shoal = min(1.6, max(1.0, pow(20.0 / max(depth, 0.3), 0.25)));
  float Hsh = Hoff * shoal;
  float ratio = Hsh / (${f(SWELL.gamma)} * depth);
  float r2 = ratio * ratio;
  float H = Hsh / pow(1.0 + r2 * r2, 0.25);
  H = max(H, ${f(SWELL.swash)} * exp(-d / ${f(SWELL.swashL)}));
  float A = H * 0.5;
  float sk = min(0.85, 2.0 * k * A + 0.55 * w_smooth(0.6, 1.0, ratio));
  return vec4(phi, A, sk / k, ratio);
}
float w_wrap(float phi) { return phi - W_TAU * floor(phi / W_TAU); }
float w_broken(float d0, float a, float t, float phi, float k) {
  float pm = w_wrap(phi);
  float dc = pm > 3.14159265 ? d0 + (W_TAU - pm) / k : d0 - pm / k;
  float kk;
  vec4 s = w_swell(dc, a, t, kk);
  return w_smooth(0.92, 1.06, s.w);
}
float w_foam(float broken, float phi, float d0) {
  float pm = w_wrap(phi);
  float front = pm > 3.14159265 ? exp(-(W_TAU - pm) * 1.6) : 0.0;
  float trail = pm <= 3.14159265 ? exp(-pm * 2.2) * 0.6 : 0.0;
  float crest = exp(-min(pm, W_TAU - pm) * 3.0);
  float shore = exp(-max(0.0, d0) / 5.0) * 0.7;
  return min(1.0, broken * max(max(front, trail), crest) + shore);
}
float w_chop(vec2 l, float t) {
  float y = 0.0;
  ${CHOP.map(
    (c, i) =>
      `y += ${f(c[0])} * sin(${f(c[1])} * l.x + ${f(c[2])} * l.y - ${f(c[3])} * t + ${f(i * 1.7)});`,
  ).join('\n  ')}
  return y;
}
`;
