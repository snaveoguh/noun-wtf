// ── The Big Drop's sky over 1,000 km: depth → light, colour, weather (pure) ──
//
// The descent is a day in one ride: a snowstorm on the summit that tears
// open onto a deep high-altitude blue within the first km, a low gold sun
// for the first tens of km, sunset by ~200 km, then dusk with the first
// stars and aurora, and an aurora night on the long run out. Everything the
// atmosphere paints (sky dome, fog, lights, clouds, the ranges' haze) is a
// blend of the keyframes below at the rider's depth.

import * as THREE from 'three';

export interface JourneyKey {
  /** Metres below the summit. */
  depth: number;
  /** Sun elevation and azimuth (degrees; azimuth from +Z toward +X). */
  sunEl: number;
  sunAz: number;
  zenith: number;
  mid: number;
  horizon: number;
  /** Fog and the below-horizon haze (the far terrain fades into this). */
  haze: number;
  /** The warm band along the horizon on the sun's side. */
  band: number;
  bandK: number;
  sun: number;
  /** Sun light intensity (× what the dimension came in with). */
  sunK: number;
  hemiSky: number;
  hemiGround: number;
  hemiK: number;
  /** Cloud-sea colours: sunlit tops, shaded sides. */
  cloudLit: number;
  cloudShade: number;
  /** 0..1: aurora curtains, stars. */
  aurora: number;
  stars: number;
}

/** Summit to snowfield. Depths must increase. */
export const JOURNEY: readonly JourneyKey[] = [
  {
    depth: 0,
    sunEl: 15,
    sunAz: 28,
    zenith: 0x1a49a6,
    mid: 0x4a8ae0,
    horizon: 0xcfe3f7,
    haze: 0xd9e8f7,
    band: 0xffe2bd,
    bandK: 0.25,
    sun: 0xfff1dc,
    sunK: 1.15,
    hemiSky: 0xcfe2ff,
    hemiGround: 0xeef3ff,
    hemiK: 1.3,
    cloudLit: 0xffffff,
    cloudShade: 0xb6c8e6,
    aurora: 0,
    stars: 0,
  },
  {
    depth: 30_000,
    sunEl: 12,
    sunAz: 26,
    zenith: 0x1b4aa8,
    mid: 0x5592e2,
    horizon: 0xe3e6ee,
    haze: 0xe2e6ee,
    band: 0xffd6a6,
    bandK: 0.45,
    sun: 0xffe6c4,
    sunK: 1.15,
    hemiSky: 0xd2e0ff,
    hemiGround: 0xf3efe9,
    hemiK: 1.3,
    cloudLit: 0xfff8ee,
    cloudShade: 0xb2bfdc,
    aurora: 0,
    stars: 0,
  },
  {
    depth: 90_000,
    sunEl: 7,
    sunAz: 22,
    zenith: 0x24509f,
    mid: 0x7a9fd8,
    horizon: 0xf6cf9e,
    haze: 0xeed8c4,
    band: 0xffb070,
    bandK: 0.75,
    sun: 0xffd29a,
    sunK: 1.1,
    hemiSky: 0xdcd6f2,
    hemiGround: 0xf6e3d0,
    hemiK: 1.25,
    cloudLit: 0xffe8c8,
    cloudShade: 0xa8a6cc,
    aurora: 0,
    stars: 0,
  },
  {
    depth: 220_000,
    sunEl: 2.5,
    sunAz: 18,
    zenith: 0x34418f,
    mid: 0xa978b4,
    horizon: 0xff9466,
    haze: 0xe4b2a6,
    band: 0xff6a5a,
    bandK: 1,
    sun: 0xff9c5a,
    sunK: 0.95,
    hemiSky: 0xd0b8e6,
    hemiGround: 0xf2d0c6,
    hemiK: 1.2,
    cloudLit: 0xffc4a0,
    cloudShade: 0x8f80b8,
    aurora: 0,
    stars: 0.05,
  },
  {
    depth: 420_000,
    sunEl: -2,
    sunAz: 14,
    zenith: 0x161a52,
    mid: 0x4e3a86,
    horizon: 0xd8708c,
    haze: 0x9a7ea8,
    band: 0xff5a8a,
    bandK: 0.8,
    sun: 0xff8a86,
    sunK: 0.7,
    hemiSky: 0xa9a2e0,
    hemiGround: 0xd8c4e0,
    hemiK: 1.15,
    cloudLit: 0xe0a0c0,
    cloudShade: 0x5a5490,
    aurora: 0.55,
    stars: 0.5,
  },
  {
    depth: 700_000,
    sunEl: -8,
    sunAz: 10,
    zenith: 0x060a2a,
    mid: 0x13245a,
    horizon: 0x3a5290,
    haze: 0x46538a,
    band: 0x6a5aff,
    bandK: 0.35,
    sun: 0xa9c0ff,
    sunK: 0.55,
    hemiSky: 0x8ea6f0,
    hemiGround: 0xb8c6f0,
    hemiK: 1.15,
    cloudLit: 0x8ea0d8,
    cloudShade: 0x2c3666,
    aurora: 1,
    stars: 1,
  },
  {
    depth: 1_000_000,
    sunEl: -9,
    sunAz: 8,
    zenith: 0x050828,
    mid: 0x112254,
    horizon: 0x34508c,
    haze: 0x42508a,
    band: 0x5a6aff,
    bandK: 0.3,
    sun: 0xa9c0ff,
    sunK: 0.55,
    hemiSky: 0x8ea6f0,
    hemiGround: 0xb8c6f0,
    hemiK: 1.15,
    cloudLit: 0x8ea0d8,
    cloudShade: 0x2c3666,
    aurora: 1,
    stars: 1,
  },
];

/** The summit storm: 1 on the pad, gone by ~1.4 km down. */
export function stormAt(depth: number): number {
  return 1 - smooth(250, 1400, depth);
}

/** Snowfall round the camera: the storm's, with a light tail of drifting flakes. */
export function snowfallAt(depth: number): number {
  return Math.max(stormAt(depth), 0.18 * (1 - smooth(1400, 6000, depth)));
}

/**
 * Fog density (FogExp2): thick in the storm, then light enough that the
 * near slope stays crisp and the terrain's 7 km edge is ~all haze.
 */
export function fogDensityAt(depth: number, edge = 6200): number {
  // exp2 fog reaches 95% at (density · d)² = 3: past `edge`, and ~99.5% by
  // the camera's 8 km far plane, so the terrain's clip never shows
  const clear = Math.sqrt(3) / edge;
  const s = stormAt(depth);
  return clear + (0.0035 - clear) * s * s;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Index i and blend t such that depth sits between JOURNEY[i] and JOURNEY[i + 1]. */
export function journeySpan(depth: number): { i: number; t: number } {
  const last = JOURNEY.length - 1;
  if (depth <= JOURNEY[0]!.depth) return { i: 0, t: 0 };
  if (depth >= JOURNEY[last]!.depth) return { i: last - 1, t: 1 };
  let i = 0;
  while (JOURNEY[i + 1]!.depth < depth) i++;
  const a = JOURNEY[i]!.depth;
  const b = JOURNEY[i + 1]!.depth;
  return { i, t: smooth(0, 1, (depth - a) / (b - a)) };
}

/** The blended sky state the atmosphere writes into its uniforms and lights. */
export class SkyState {
  sunEl = 0;
  sunAz = 0;
  zenith = new THREE.Color();
  mid = new THREE.Color();
  horizon = new THREE.Color();
  haze = new THREE.Color();
  band = new THREE.Color();
  bandK = 0;
  sun = new THREE.Color();
  sunK = 1;
  hemiSky = new THREE.Color();
  hemiGround = new THREE.Color();
  hemiK = 1;
  cloudLit = new THREE.Color();
  cloudShade = new THREE.Color();
  aurora = 0;
  stars = 0;
  storm = 0;
  /** Unit vector toward the sun (sky dome). */
  toSun = new THREE.Vector3();
  /** Unit vector the sunlight travels along (never from below ~6°: the snow stays lit). */
  lightDir = new THREE.Vector3();
}

const COLOR_KEYS = [
  'zenith',
  'mid',
  'horizon',
  'haze',
  'band',
  'sun',
  'hemiSky',
  'hemiGround',
  'cloudLit',
  'cloudShade',
] as const;

// Keyframe colours, decoded once (sRGB hex → working colour space)
const KEY_COLORS = JOURNEY.map(k => {
  const o = {} as Record<(typeof COLOR_KEYS)[number], THREE.Color>;
  for (const c of COLOR_KEYS) o[c] = new THREE.Color(k[c]);
  return o;
});

const STORM_SKY = new THREE.Color(0xdfe6ee);
const STORM_HAZE = new THREE.Color(0xe4eaf1);

/** Blend the journey at `depth` into `out` (no allocation). */
export function skyAt(depth: number, out: SkyState): SkyState {
  const { i, t } = journeySpan(depth);
  const a = JOURNEY[i]!;
  const b = JOURNEY[i + 1]!;
  const ca = KEY_COLORS[i]!;
  const cb = KEY_COLORS[i + 1]!;
  const L = (x: number, y: number) => x + (y - x) * t;
  out.sunEl = L(a.sunEl, b.sunEl);
  out.sunAz = L(a.sunAz, b.sunAz);
  out.bandK = L(a.bandK, b.bandK);
  out.sunK = L(a.sunK, b.sunK);
  out.hemiK = L(a.hemiK, b.hemiK);
  out.aurora = L(a.aurora, b.aurora);
  out.stars = L(a.stars, b.stars);
  for (const c of COLOR_KEYS) out[c].lerpColors(ca[c], cb[c], t);
  // The storm whites everything out
  const s = stormAt(depth);
  out.storm = s;
  if (s > 0) {
    out.zenith.lerp(STORM_SKY, s);
    out.mid.lerp(STORM_SKY, s);
    out.horizon.lerp(STORM_SKY, s);
    out.haze.lerp(STORM_HAZE, s);
    out.cloudLit.lerp(STORM_HAZE, s);
    out.cloudShade.lerp(STORM_HAZE, s);
  }
  const el = THREE.MathUtils.degToRad(out.sunEl);
  const az = THREE.MathUtils.degToRad(out.sunAz);
  out.toSun.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  const lel = THREE.MathUtils.degToRad(Math.max(6, out.sunEl));
  out.lightDir
    .set(Math.cos(lel) * Math.sin(az), Math.sin(lel), Math.cos(lel) * Math.cos(az))
    .negate();
  return out;
}
