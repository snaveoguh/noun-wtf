// ── Endless mountain: shared constants + seeded noise (no three.js) ─────
//
// The city is the summit. Its square ring of buildings ends at |x|, |z| =
// WALL; outside that the world falls away forever in every direction.

export const MOUNTAIN = {
  /** Fixed seed: all clients build the same mountain. */
  seed: 0x6e6f756e,
  /** Outer face of the ring of buildings (square, |x| or |z|). */
  wallZ: 94,
  /** Terrain height at the foot of the city wall (the plaza floor is 0). */
  topY: -2.5,
  /** Radial downhill gradient (rise over run), away from the city. */
  slope: 0.14,
  /** Distance over which the gradient eases in below the wall (m). */
  slopeEase: 40,
  /** Dirt track: flat half-width, then the shoulder blends into grass. */
  trackHalf: 6.5,
  trackShoulder: 9,
  /** Outside the ring the soft clamp stops applying once past this. */
  minZ: 95.6,
} as const;

/**
 * Alleys cut through the ring. Each lives in its own frame: `angle` turns
 * the outward direction from +Z (0 = +Z side, +π/2 = +X side, −π/2 = −X
 * side); `a` is the across-the-side coordinate, `o` the outward one.
 */
export interface AlleyDef {
  angle: number;
  /** Corridor centre (local a) and clear width between the walls. */
  a: number;
  width: number;
  /** Local a-range of the baked building block removed for it. */
  cut: [number, number];
  /** Roof height of the removed block (the new alley walls match it). */
  roof: number;
  label: string;
  tint: number;
}

export const ALLEYS: AlleyDef[] = [
  // +Z side, straight out from the fountain across the street crossing
  { angle: 0, a: -0.4, width: 9, cut: [-7.8, 7.0], roof: 11.1, label: 'DOWNHILL', tint: 0xf0b8a4 },
  // +X side, world z ≈ −24 (between the street lamps, clear of the lawn)
  {
    angle: Math.PI / 2,
    a: 24,
    width: 8,
    cut: [18.9, 31.6],
    roof: 11.1,
    label: 'MOUNTAIN',
    tint: 0x9fd8cf,
  },
  // −X side, world z ≈ +24
  {
    angle: -Math.PI / 2,
    a: 24,
    width: 8,
    cut: [14.5, 33.2],
    roof: 11.1,
    label: 'GO DOWN',
    tint: 0xf3c25b,
  },
];

/** Facade line of the ring (plaza side) where the alleys start. */
export const ALLEY_O0 = 76;
export const RAMP_O0 = 79;
export const RAMP_O1 = 104;

/** Local alley frame → world. */
export function alleyToWorld(al: AlleyDef, a: number, o: number, out: { x: number; z: number }) {
  const c = Math.cos(al.angle);
  const s = Math.sin(al.angle);
  out.x = a * c + o * s;
  out.z = -a * s + o * c;
  return out;
}

/** World → local alley frame. */
export function worldToAlley(al: AlleyDef, x: number, z: number, out: { a: number; o: number }) {
  const c = Math.cos(al.angle);
  const s = Math.sin(al.angle);
  out.a = x * c - z * s;
  out.o = x * s + z * c;
  return out;
}

/** Distance from (x, z) to the city square (0 inside). */
export function edgeDistance(x: number, z: number): number {
  const w = MOUNTAIN.wallZ;
  const dx = Math.max(0, Math.abs(x) - w);
  const dz = Math.max(0, Math.abs(z) - w);
  return Math.sqrt(dx * dx + dz * dz);
}

/** Outward (downhill) unit direction at (x, z); radial inside the square. */
export function outward(x: number, z: number, out: { x: number; z: number }) {
  const w = MOUNTAIN.wallZ;
  let dx = Math.abs(x) > w ? x - Math.sign(x) * w : 0;
  let dz = Math.abs(z) > w ? z - Math.sign(z) * w : 0;
  if (dx === 0 && dz === 0) {
    dx = x;
    dz = z;
  }
  const l = Math.hypot(dx, dz) || 1;
  out.x = dx / l;
  out.z = dz / l;
  return out;
}

// ── Seeded hashing + value noise (no Math.random anywhere) ──

export function hash2(x: number, y: number, seed: number): number {
  let h =
    (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Deterministic [0, 1) hash of two integers + a salt. */
export function hashInts(a: number, b: number, salt: number): number {
  return hash2(a, b, (MOUNTAIN.seed + Math.imul(salt, 2654435761)) | 0);
}

const q5 = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth 2D value noise in [-1, 1]. */
export function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = q5(x - xi);
  const yf = q5(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf) * 2 - 1;
}

/** Smooth 1D value noise in [-1, 1]. */
export function vnoise1(x: number, seed: number): number {
  const xi = Math.floor(x);
  const t = q5(x - xi);
  const a = hash2(xi, 0, seed);
  const b = hash2(xi + 1, 0, seed);
  return (a + (b - a) * t) * 2 - 1;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
