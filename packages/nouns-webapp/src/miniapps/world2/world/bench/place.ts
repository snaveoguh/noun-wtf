// ── Where the mural bench goes (pure: the world is asked through a probe) ──
//
// The bench sits on the plaza pavement across the ring road from the GIF
// mural (world/MuralBillboard.ts), facing it squarely. It's placed from
// the mural's own wall quad, never from hardcoded coordinates: candidates
// run out along the mural's normal and sideways along the wall, nearest
// the ideal first, and the first one that passes every check wins:
//   - the bench, its sitters' feet and the space round it are one flat
//     surface at pavement height (no road, no kerb, no step),
//   - nothing solid stands in or near it (lamp posts, planters, trees),
//   - the cinematic shot's camera (shot.ts) is in clear air, and its rays
//     to the mural's corners, centre and a dense grid over it are clear
//     (collision and the render-only palms / trees / lamps), except where what's in the way stands
//     on the far pavement (NEAR_WALL: its's lamp post is in
//     front of the picture from anywhere on the plaza, so no bench spot
//     could dodge it). A lamp post on this side across the picture fails.
// Only the level's static collision is asked (the same on every client),
// so every client puts the bench, and its seats, in the same place.

import type { CollisionWorld } from '../../physics/Collision';

import * as THREE from 'three';

import { benchShot } from './shot';

export type V3 = [number, number, number];

/** The mural's wall rectangle in world space (MuralBillboard's quad, plain numbers). */
export interface MuralWall {
  /** On the wall, under the mural's centre, at y = 0. */
  origin: V3;
  /** Along the wall (unit, horizontal). */
  right: V3;
  /** Out of the wall (unit, horizontal). */
  normal: V3;
  width: number;
  bottom: number;
  top: number;
}

export interface BenchSite {
  /** Centre of the bench on the ground. */
  x: number;
  y: number;
  z: number;
  /** Facing (the sitters look along (sin yaw, cos yaw)): at the mural. */
  yaw: number;
  /** Distance from the wall (m) and sideways offset from the mural's centre (m). */
  dist: number;
  offset: number;
  /** The screen's centre (the shot looks at it). */
  look: V3;
  /** The screen's half width / half height (m), for framing (its envelope: see FRAME_PAD). */
  halfW: number;
  halfH: number;
}

/** Bench dimensions (m). Local frame: x along the bench, z forward (to the mural), y up. */
export const BENCH = {
  length: 2.4,
  seatH: 0.46,
  seatDepth: 0.46,
  /** Back rail: behind the seat, its top. */
  backZ: -0.27,
  backTop: 0.98,
  /** Seat spots along x (0: the pipe head's). */
  seats: [-0.8, 0, 0.8] as const,
  /** Where a sitter stands before / after (in front of the seat). */
  standZ: 0.78,
} as const;

/** Things this close to the wall (m) stand on the far pavement (canopies over the kerb included): in front of the mural from anywhere, not held against a spot. */
export const NEAR_WALL = 9;

/**
 * The billboard's screen can grow past the decal (a tall clip reaches up to
 * the wall's top, MuralBillboard / billboardFit) and has a 0.38 m frame round
 * it: the shot frames this envelope, not the bare decal (m: sides, below, above).
 */
export const FRAME_PAD = { side: 0.4, below: 0.4, above: 0.85 } as const;

/** Ideal distance from the wall (m): the pavement's middle across the road. */
const IDEAL_DIST = 21;

export interface BenchProbe {
  /** Height of the first surface straight down from high over (x, z), or null. */
  ground(x: number, z: number): number | null;
  /** Is a vertical capsule (radius r, from y0 to y1) at (x, z) free of geometry? */
  clear(x: number, z: number, r: number, y0: number, y1: number): boolean;
  /** The first thing between a and b, or null when the line is clear. */
  hit(a: V3, b: V3): V3 | null;
}

/** Bench-local (x, z) → world (x, z). */
export function toWorld(site: { x: number; z: number; yaw: number }, lx: number, lz: number) {
  const c = Math.cos(site.yaw);
  const s = Math.sin(site.yaw);
  return { x: site.x + lx * c + lz * s, z: site.z - lx * s + lz * c };
}

/** World (x, z) → bench-local (x, z). */
export function toLocal(site: { x: number; z: number; yaw: number }, wx: number, wz: number) {
  const dx = wx - site.x;
  const dz = wz - site.z;
  const c = Math.cos(site.yaw);
  const s = Math.sin(site.yaw);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

/** The site for a candidate (dist out from the wall, offset along it). */
export function siteAt(wall: MuralWall, dist: number, offset: number, y: number): BenchSite {
  const [ox, , oz] = wall.origin;
  const [rx, , rz] = wall.right;
  const [nx, , nz] = wall.normal;
  return {
    x: ox + rx * offset + nx * dist,
    y,
    z: oz + rz * offset + nz * dist,
    // Facing the wall: along −normal
    yaw: Math.atan2(-nx, -nz),
    dist,
    offset,
    look: [ox, (wall.bottom - FRAME_PAD.below + wall.top + FRAME_PAD.above) / 2, oz],
    halfW: wall.width / 2 + FRAME_PAD.side,
    halfH: (wall.top + FRAME_PAD.above - wall.bottom + FRAME_PAD.below) / 2,
  };
}

/** Candidates, best first: near the ideal distance and the mural's centre line. */
export function candidates(): { dist: number; offset: number }[] {
  const out: { dist: number; offset: number; score: number }[] = [];
  for (let d = 12; d <= 32; d += 0.25)
    for (let u = -5; u <= 5; u += 0.25)
      out.push({ dist: d, offset: u, score: Math.abs(d - IDEAL_DIST) * 0.6 + Math.abs(u) });
  out.sort((a, b) => a.score - b.score);
  return out.map(({ dist, offset }) => ({ dist, offset }));
}

/** The flat pad the bench needs (local x, z samples): the bench, feet in front, room behind. */
function padSamples(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const half = BENCH.length / 2 + 0.45;
  for (let x = -half; x <= half + 1e-6; x += half / 4)
    for (const z of [-0.85, -0.45, 0, 0.45, 0.9, 1.25]) out.push({ x, z });
  return out;
}

/** The mural's four corners and centre (world), just in front of the screen. */
export function muralKeyPoints(wall: MuralWall, standoff = 1.1): V3[] {
  const [ox, , oz] = wall.origin;
  const [rx, , rz] = wall.right;
  const [nx, , nz] = wall.normal;
  const at = (u: number, y: number): V3 => [
    ox + rx * u + nx * standoff,
    y,
    oz + rz * u + nz * standoff,
  ];
  const w = wall.width / 2 - 0.05;
  return [
    at(-w, wall.bottom + 0.05),
    at(w, wall.bottom + 0.05),
    at(-w, wall.top - 0.05),
    at(w, wall.top - 0.05),
    at(0, (wall.bottom + wall.top) / 2),
  ];
}

/** Distance (m) of a point from the mural's wall plane. */
export function fromWall(wall: MuralWall, p: V3): number {
  const [ox, , oz] = wall.origin;
  const [nx, , nz] = wall.normal;
  return (p[0] - ox) * nx + (p[2] - oz) * nz;
}

/** Points over the mural the shot must see (world), a hand's breadth in front of the screen. */
export function muralTargets(wall: MuralWall, cols = 120, rows = 7, standoff = 1.1): V3[] {
  const [ox, , oz] = wall.origin;
  const [rx, , rz] = wall.right;
  const [nx, , nz] = wall.normal;
  const out: V3[] = [];
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const u = (i / (cols - 1) - 0.5) * wall.width * 0.98;
      const y = wall.bottom + 0.05 + (j / (rows - 1)) * (wall.top - wall.bottom - 0.1);
      out.push([ox + rx * u + nx * standoff, y, oz + rz * u + nz * standoff]);
    }
  return out;
}

export interface PlaceResult {
  site: BenchSite;
  /** Candidates tried before this one. */
  tried: number;
}

/** The bench's place, or null if nowhere in reach passes. */
export function placeBench(wall: MuralWall, probe: BenchProbe): PlaceResult | null {
  const pad = padSamples();
  const targets = muralTargets(wall);
  const keys = muralKeyPoints(wall);
  const list = candidates();
  for (let i = 0; i < list.length; i++) {
    const { dist, offset } = list[i]!;
    const at = siteAt(wall, dist, offset, 0);
    // One flat surface, at pavement height or above (never the road)
    const y0 = probe.ground(at.x, at.z);
    if (y0 === null || y0 < -0.05 || y0 > 1.5) continue;
    let flat = true;
    for (const s of pad) {
      const w = toWorld(at, s.x, s.z);
      const y = probe.ground(w.x, w.z);
      if (y === null || Math.abs(y - y0) > 0.03) {
        flat = false;
        break;
      }
    }
    if (!flat) continue;
    const site = { ...at, y: y0 };
    // Nothing solid in or round it (0.7 m clear of the bench's line)
    let free = true;
    for (let x = -BENCH.length / 2; x <= BENCH.length / 2 + 1e-6; x += 0.4) {
      for (const z of [-0.2, 0.5]) {
        const w = toWorld(site, x, z);
        if (!probe.clear(w.x, w.z, 0.7, y0 + 0.75, y0 + 3)) {
          free = false;
          break;
        }
      }
      if (!free) break;
    }
    if (!free) continue;
    // The shot: its camera in clear air, the whole mural in plain sight
    let seen = true;
    for (const t of [0, 1e3]) {
      const cam = benchShot(site, t, 16 / 9).pos;
      if (!probe.clear(cam[0], cam[2], 0.35, cam[1] - 0.3, cam[1] + 0.3)) {
        seen = false;
        break;
      }
      for (const tg of [...keys, ...targets]) {
        const h = probe.hit(cam, tg);
        if (h !== null && fromWall(wall, h) > NEAR_WALL) {
          seen = false;
          break;
        }
      }
      if (!seen) break;
    }
    if (!seen) continue;
    return { site, tried: i };
  }
  return null;
}

/** The mural's wall from MuralBillboard's quad (plain numbers). */
export function wallOf(q: {
  origin: THREE.Vector3;
  right: THREE.Vector3;
  normal: THREE.Vector3;
  rect: { width: number; bottom: number; top: number };
}): MuralWall {
  return {
    origin: [q.origin.x, q.origin.y, q.origin.z],
    right: [q.right.x, q.right.y, q.right.z],
    normal: [q.normal.x, q.normal.y, q.normal.z],
    width: q.rect.width,
    bottom: q.rect.bottom,
    top: q.rect.top,
  };
}

/** Render-only dressing that can stand in the shot's way (by material name). */
export const DRESSING_MATERIAL = /^(palm_|tree_|lamp_)/i;

/** The level's render-only dressing meshes (palms, trees, lamp heads) under `root`. */
export function dressingMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse(o => {
    const m = o as THREE.Mesh & { isInstancedMesh?: boolean };
    if (m.isMesh !== true || m.isInstancedMesh === true) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.some(x => DRESSING_MATERIAL.test(x.name))) out.push(m);
  });
  return out;
}

const _o = new THREE.Vector3();
const _d = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Vector3();
const _c = new THREE.Vector3();

/**
 * The probe on a CollisionWorld's static level only (`world.bvh`): the
 * streamed / moving colliders (cars, the van) differ between clients and
 * from minute to minute. `sightMeshes` (the level's render-only props and
 * foliage) count for sight lines too.
 */
export function probeOf(world: CollisionWorld, sightMeshes: THREE.Mesh[] = []): BenchProbe {
  const Ctor = world.constructor as new () => CollisionWorld;
  const statics = new Ctor();
  statics.bvh = world.bvh;
  statics.geometry = world.geometry;
  // Render-only dressing (palms, tree canopies, lamp heads) blocks the view too
  const dressing = new Ctor();
  if (sightMeshes.length > 0) dressing.build(sightMeshes);
  return {
    ground(x, z) {
      _o.set(x, 40, z);
      const h = statics.raycast(_o, _d, 80);
      return h === null ? null : h.point.y;
    },
    clear(x, z, r, y0, y1) {
      _s.set(x, y0, z);
      _e.set(x, Math.max(y0, y1), z);
      return statics.capsulePushout(_s, _e, r, undefined, _c).lengthSq() < 1e-8;
    },
    hit(a, b) {
      _a.set(...a);
      _b.set(...b).sub(_a);
      const len = _b.length();
      if (len < 1e-4) return null;
      const h = statics.raycast(_a, _b, len);
      const d = dressing.bvh !== null ? dressing.raycast(_a, _b, len) : null;
      const first = h === null ? d : d === null || h.distance < d.distance ? h : d;
      return first === null ? null : [first.point.x, first.point.y, first.point.z];
    },
  };
}
