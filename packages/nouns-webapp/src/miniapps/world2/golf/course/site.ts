// ── Noun Golf: where NOUN LINKS sits on the mountain (pure) ─────────────
//
// The mountain falls away from the city square at a 14 % gradient, and its
// height contours are circles round the square's corners out on the
// diagonals. NOUN LINKS sits in the (−X, +Z) quadrant, round the city's
// corner K = (−94, 94), between the GO DOWN (−X) and DOWNHILL (+Z) lines:
// over 1 km from either line at every point (course.test.ts checks it
// against the real network), clear of every town, mega ramp, landmark,
// Noun Jersey and the Noggle Bowl.
//
// Course frame: polar round K. ρ = distance from K (= the terrain's own
// edgeDistance here), φ = angle from −X towards +Z.
//
//   u = RHO_C · (φ − PHI_0)   along the contour (level ground), 0 … 3000
//   v = ρ − RHO_C             outward (downhill), −350 … 350
//
// Along u the natural ground is level; across v it falls 14 %. The course
// replaces it with its own gentle surface (4.5 % across v plus slow rolls),
// cut into the slope on the uphill side and built up on the downhill side,
// and blended back into the mountain over BLEND m beyond the core.

import { MOUNTAIN, smoothstep, vnoise } from '../../world/mountain/config';

export const SITE = {
  /** The city square's corner the course wraps round. */
  kx: -MOUNTAIN.wallZ,
  kz: MOUNTAIN.wallZ,
  /** Centre radius, start angle. */
  RHO_C: 3000,
  PHI_0: 0.3,
  /** Core: u and v ranges (the OB line sits on its edge). */
  U0: -60,
  U1: 3060,
  V0: -350,
  V1: 350,
  /** Blend back into the mountain beyond the core (m). */
  BLEND: 170,
  /** Across-slope of the course surface (fall per m of v). */
  SLOPE: 0.045,
} as const;

const SEED = MOUNTAIN.seed + 0x601f;

/** The mountain's radial gradient at distance de (copy of terrain.ts baseHeight). */
export function mountainBase(de: number): number {
  if (de <= 0) return MOUNTAIN.topY;
  const L = MOUNTAIN.slopeEase;
  return MOUNTAIN.topY - MOUNTAIN.slope * (de - L * (1 - Math.exp(-de / L)));
}

/** Course datum: the mountain's level at RHO_C plus its typical off-line lift. */
export const DATUM = mountainBase(SITE.RHO_C) + 3.5;

export function toWorld(u: number, v: number, out: { x: number; z: number }) {
  const phi = SITE.PHI_0 + u / SITE.RHO_C;
  const rho = SITE.RHO_C + v;
  out.x = SITE.kx - rho * Math.cos(phi);
  out.z = SITE.kz + rho * Math.sin(phi);
  return out;
}

export function toCourse(x: number, z: number, out: { u: number; v: number }) {
  const dx = x - SITE.kx;
  const dz = z - SITE.kz;
  const rho = Math.sqrt(dx * dx + dz * dz);
  const phi = Math.atan2(dz, -dx);
  out.u = (phi - SITE.PHI_0) * SITE.RHO_C;
  out.v = rho - SITE.RHO_C;
  return out;
}

/** World heading of +u (along the contour) at u. */
export function uYaw(u: number): number {
  const phi = SITE.PHI_0 + u / SITE.RHO_C;
  // d/dφ of (−cos φ, sin φ) = (sin φ, cos φ)
  return Math.atan2(Math.sin(phi), Math.cos(phi));
}

/** World heading of +v (outward, downhill) at u. */
export function vYaw(u: number): number {
  const phi = SITE.PHI_0 + u / SITE.RHO_C;
  return Math.atan2(-Math.cos(phi), Math.sin(phi));
}

/** World AABB of the terraced area (core + blend), computed once. */
export const BOUNDS = (() => {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  const p = { x: 0, z: 0 };
  const B = SITE.BLEND + 2;
  for (let i = 0; i <= 40; i++) {
    const u = SITE.U0 - B + ((SITE.U1 - SITE.U0 + 2 * B) * i) / 40;
    for (const v of [SITE.V0 - B, SITE.V1 + B]) {
      toWorld(u, v, p);
      x0 = Math.min(x0, p.x);
      z0 = Math.min(z0, p.z);
      x1 = Math.max(x1, p.x);
      z1 = Math.max(z1, p.z);
    }
  }
  return { x0, z0, x1, z1 };
})();

export const CORE = (() => {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  const p = { x: 0, z: 0 };
  for (let i = 0; i <= 40; i++) {
    const u = SITE.U0 + ((SITE.U1 - SITE.U0) * i) / 40;
    for (const v of [SITE.V0, SITE.V1]) {
      toWorld(u, v, p);
      x0 = Math.min(x0, p.x);
      z0 = Math.min(z0, p.z);
      x1 = Math.max(x1, p.x);
      z1 = Math.max(z1, p.z);
    }
  }
  return { x0, z0, x1, z1 };
})();

export function inBounds(x: number, z: number, margin = 0): boolean {
  return (
    x >= BOUNDS.x0 - margin &&
    x <= BOUNDS.x1 + margin &&
    z >= BOUNDS.z0 - margin &&
    z <= BOUNDS.z1 + margin
  );
}

/** Outside the core's u / v range by this much (m, 0 inside). */
export function outsideCore(u: number, v: number): number {
  const du = Math.max(SITE.U0 - u, 0, u - SITE.U1);
  const dv = Math.max(SITE.V0 - v, 0, v - SITE.V1);
  return Math.sqrt(du * du + dv * dv);
}

/** 1 inside the core, easing to 0 at BLEND beyond it. */
export function blendWeight(u: number, v: number): number {
  return 1 - smoothstep(0, SITE.BLEND, outsideCore(u, v));
}

/**
 * The course's own ground before any hole is cut into it: the datum, the
 * gentle fall across v and slow rolls (world-space noise).
 */
export function courseBase(x: number, z: number, v: number): number {
  return (
    DATUM -
    SITE.SLOPE * v +
    4.2 * vnoise(x / 260, z / 260, SEED + 1) +
    1.3 * vnoise(x / 88, z / 88, SEED + 2) +
    0.28 * vnoise(x / 31, z / 31, SEED + 3)
  );
}
