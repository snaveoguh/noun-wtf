// ── The plaza city's buildings, from the baked collision ─────────────────
//
// The plaza GLB merges every block into one mesh (COL_Buildings), so the
// buildings are found from its roofs: each connected patch of upward,
// level triangles above street height is one block's roof, and its bounds
// are the block's footprint (a parapet ring and the roof inside it give
// the same rectangle, so they're merged). Long terraces are split into
// shop-sized buildings. The alley blocks (COL_AlleyBlock, plain boxes
// built by world/mountain/Alleys.ts) are added from their bounds.
//
// Then doors.ts picks each one's street-facing wall: the ring faces the
// fountain. A probe through the collision world (when given) makes sure
// the approach is open ground you can walk to.

import type { BuildingDoor } from './contract';

import * as THREE from 'three';

import {
  planDoors,
  reachable,
  rectKey,
  splitLong,
  type DoorPlan,
  type Footprint,
  type Rect,
} from './doors';

/** Roofs lower than this are street furniture, not buildings. */
const MIN_ROOF = 3;
const LEVEL = 1e-3;

interface Tri {
  y: number;
  xs: [number, number, number];
  zs: [number, number, number];
}

/** World-space upward level triangles of a mesh above `minY`. */
function roofTris(mesh: THREE.Mesh, minY: number): Tri[] {
  const geo = mesh.geometry;
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (pos === undefined) return [];
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld;
  const idx = geo.index;
  const n = idx !== null ? idx.count / 3 : pos.count / 3;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const out: Tri[] = [];
  for (let t = 0; t < n; t++) {
    const i0 = idx !== null ? idx.getX(t * 3) : t * 3;
    const i1 = idx !== null ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx !== null ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(m);
    b.fromBufferAttribute(pos, i1).applyMatrix4(m);
    c.fromBufferAttribute(pos, i2).applyMatrix4(m);
    if (Math.abs(a.y - b.y) > LEVEL || Math.abs(a.y - c.y) > LEVEL || a.y < minY) continue;
    // Any winding: a level triangle with real area
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    if (Math.abs(e1.x * e2.z - e1.z * e2.x) < 1e-4) continue;
    out.push({ y: a.y, xs: [a.x, b.x, c.x], zs: [a.z, b.z, c.z] });
  }
  return out;
}

/** Connected patches of level triangles (sharing a vertex, same height) → their bounds. */
export function roofRects(tris: Tri[]): (Rect & { top: number })[] {
  const parent = tris.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const seen = new Map<string, number>();
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const key = `${Math.round(t.y * 20)}:${Math.round(t.xs[k] * 20)}:${Math.round(t.zs[k] * 20)}`;
      const j = seen.get(key);
      if (j === undefined) seen.set(key, i);
      else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, Rect & { top: number }>();
  tris.forEach((t, i) => {
    const r = find(i);
    const g = groups.get(r) ?? {
      minX: Infinity,
      maxX: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity,
      top: t.y,
    };
    for (let k = 0; k < 3; k++) {
      g.minX = Math.min(g.minX, t.xs[k]);
      g.maxX = Math.max(g.maxX, t.xs[k]);
      g.minZ = Math.min(g.minZ, t.zs[k]);
      g.maxZ = Math.max(g.maxZ, t.zs[k]);
    }
    g.top = Math.max(g.top, t.y);
    groups.set(r, g);
  });
  return [...groups.values()];
}

/** Merge rects that are the same block (equal within 0.3 m), drop ones inside another. */
export function mergeRects<T extends Rect & { top: number }>(rs: T[]): T[] {
  const same = (a: Rect, b: Rect) =>
    Math.abs(a.minX - b.minX) < 0.3 &&
    Math.abs(a.maxX - b.maxX) < 0.3 &&
    Math.abs(a.minZ - b.minZ) < 0.3 &&
    Math.abs(a.maxZ - b.maxZ) < 0.3;
  const inside = (a: Rect, b: Rect) =>
    a.minX >= b.minX - 0.05 &&
    a.maxX <= b.maxX + 0.05 &&
    a.minZ >= b.minZ - 0.05 &&
    a.maxZ <= b.maxZ + 0.05;
  const out: T[] = [];
  // Biggest first, so smaller roofs (rooftop units, a tower's top) fold into their block
  const sorted = [...rs].sort(
    (a, b) => (b.maxX - b.minX) * (b.maxZ - b.minZ) - (a.maxX - a.minX) * (a.maxZ - a.minZ),
  );
  for (const r of sorted) {
    const hit = out.find(o => same(o, r) || inside(r, o));
    if (hit !== undefined) {
      hit.top = Math.max(hit.top, r.top);
      continue;
    }
    out.push({ ...r });
  }
  return out;
}

/** Every block's roof rectangle (and height) in a COL_Buildings-style mesh. */
export function blockRoofs(mesh: THREE.Mesh): (Rect & { top: number })[] {
  return mergeRects(roofRects(roofTris(mesh, MIN_ROOF))).filter(
    r => r.maxX - r.minX > 2.5 && r.maxZ - r.minZ > 2.5,
  );
}

/** Footprints of the plaza's buildings from its collision meshes. */
export function plazaFootprints(meshes: readonly THREE.Mesh[]): Footprint[] {
  const tris: Tri[] = [];
  const boxes: Footprint[] = [];
  for (const m of meshes) {
    if (/^col_buildings$/i.test(m.name)) tris.push(...roofTris(m, MIN_ROOF));
    else if (/^col_alleyblock/i.test(m.name)) {
      m.updateWorldMatrix(true, false);
      const g = m.geometry;
      g.computeBoundingBox();
      const bb = g.boundingBox!.clone().applyMatrix4(m.matrixWorld);
      const r = { minX: bb.min.x, maxX: bb.max.x, minZ: bb.min.z, maxZ: bb.max.z };
      boxes.push({ ...r, key: `alley:${rectKey(r)}`, height: bb.max.y, ground: 0 });
    }
  }
  const blocks = mergeRects(roofRects(tris)).filter(
    r => r.maxX - r.minX > 2.5 && r.maxZ - r.minZ > 2.5,
  );
  const out: Footprint[] = [];
  for (const r of blocks)
    out.push(
      ...splitLong({
        minX: r.minX,
        maxX: r.maxX,
        minZ: r.minZ,
        maxZ: r.maxZ,
        key: rectKey(r),
        height: r.top,
        ground: 0,
      }),
    );
  out.push(...boxes);
  // Stable order (ids don't depend on it, but the list is nicer for tests / the minimap)
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

/** A probe for a door's approach: open ground, nothing standing in front of it. */
export interface PlazaProbe {
  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    far: number,
  ): { point: THREE.Vector3; normal: THREE.Vector3; distance: number } | null;
}

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Collision check for a door's approach: rays straight out from the wall
 * at shin, waist and head height hit nothing for `reach` m, and there's
 * level ground under the spot you'd stand on.
 */
export function approachClear(
  probe: PlazaProbe,
  x: number,
  z: number,
  nx: number,
  nz: number,
  ground: number,
  reach = 1.3,
): boolean {
  _d.set(nx, 0, nz);
  for (const h of [0.35, 1.0, 1.8]) {
    _o.set(x + nx * 0.12, ground + h, z + nz * 0.12);
    if (probe.raycast(_o, _d, reach) !== null) return false;
  }
  // Side-step either side of the door too (a lamp post just off-centre)
  for (const s of [-0.5, 0.5]) {
    _o.set(x + nx * 0.12 - nz * s, ground + 1.0, z + nz * 0.12 + nx * s);
    if (probe.raycast(_o, _d, reach * 0.8) !== null) return false;
  }
  for (const k of [0.6, 1.2]) {
    _o.set(x + nx * k, ground + 2.2, z + nz * k);
    const hit = probe.raycast(_o, DOWN, 3.5);
    if (hit === null || hit.normal.y < 0.8 || Math.abs(hit.point.y - ground) > 0.45) return false;
  }
  return true;
}

export interface PlazaDoorOptions {
  probe?: PlazaProbe;
  /** Extra walkability test (the soft play-area clamp, the alley corridors). */
  open?: (x: number, z: number) => boolean;
  bounds?: number;
}

/** The plaza's doors (the probe, when given, keeps approaches clear). */
export function plazaDoors(
  meshes: readonly THREE.Mesh[],
  opts: PlazaDoorOptions = {},
): BuildingDoor[] {
  return plazaDoorPlan(meshes, opts).doors;
}

/** plazaDoors with its working: the footprints and who joined a neighbour. */
export function plazaDoorPlan(
  meshes: readonly THREE.Mesh[],
  opts: PlazaDoorOptions = {},
): DoorPlan & { footprints: Footprint[] } {
  const fps = plazaFootprints(meshes);
  const { probe } = opts;
  const walkable = reachable(fps, opts.bounds ?? 95, { x: 0, z: 30 }, { open: opts.open });
  const plan = planDoors(fps, {
    area: 'plaza',
    street: () => ({ x: 0, z: 0 }),
    clear: (x, z, nx, nz, fp) => {
      if (!walkable(x + nx * 0.9, z + nz * 0.9)) return false;
      return probe === undefined || approachClear(probe, x, z, nx, nz, fp.ground);
    },
  });
  return { ...plan, footprints: fps };
}
