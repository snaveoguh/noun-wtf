// ── Alleys out of the plaza + the city's retaining wall ─────────────────
//
// One building block on each of three sides of the ring (+Z, +X, −X) is cut
// out of the baked level (render + collision triangles) and replaced by two
// narrower buildings that leave a corridor between them. The corridor floor
// is the terrain itself (terrain.ts ramps it from street level down onto the
// mountain), so there's no seam to trip on. Each alley gets a painted arch
// + banner on the plaza side. Outside the ring (never visible from the
// plaza) a stone retaining wall runs round the city and the blocks get
// back walls, so from the slopes it reads as a walled town on the summit.

import * as THREE from 'three';

import { ALLEYS, ALLEY_O0, MOUNTAIN, alleyToWorld, type AlleyDef } from './config';
import { inAlley, sampleTerrain, type TerrainSample } from './terrain';

const WALL_BOTTOM = -9;
/** The four sides of the ring as alley-frame angles. */
const SIDES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

/** Is (x, z) inside one of the corridors (between its walls)? */
export function inCorridor(x: number, z: number): boolean {
  return inAlley(x, z, 0);
}

/** World AABB of a local-frame (a, o) box on side `angle`. */
function localBox(
  angle: number,
  a0: number,
  a1: number,
  y0: number,
  y1: number,
  o0: number,
  o1: number,
) {
  const al = { angle } as AlleyDef;
  const p = { x: 0, z: 0 };
  const box = new THREE.Box3();
  for (const a of [a0, a1])
    for (const o of [o0, o1]) {
      alleyToWorld(al, a, o, p);
      box.expandByPoint(new THREE.Vector3(p.x, y0, p.z));
      box.expandByPoint(new THREE.Vector3(p.x, y1, p.z));
    }
  return box;
}

/**
 * Footprints of the baked blocks to cut (plaza facade line to the back of
 * the ring). Triangles whose centroid falls inside are dropped.
 */
export function alleyCutBoxes(): THREE.Box3[] {
  return ALLEYS.map(a =>
    localBox(
      a.angle,
      a.cut[0] + 0.05,
      a.cut[1] - 0.05,
      -50,
      400,
      ALLEY_O0 - 1.6,
      MOUNTAIN.wallZ + 0.6,
    ),
  );
}

/**
 * World boxes covering band [o0, o1] of every side of the ring, leaving the
 * alley corridors open (catch floor, retaining wall).
 */
export function ringBands(o0: number, o1: number, aMax: number): THREE.Box3[] {
  const out: THREE.Box3[] = [];
  for (const ang of SIDES) {
    const gaps = ALLEYS.filter(
      a => Math.abs(Math.atan2(Math.sin(a.angle - ang), Math.cos(a.angle - ang))) < 0.01,
    )
      .map(a => [a.a - a.width / 2, a.a + a.width / 2] as const)
      .sort((p, q) => p[0] - q[0]);
    let from = -aMax;
    for (const [g0, g1] of gaps) {
      if (g0 > from) out.push(localBox(ang, from, g0, 0, 0, o0, o1));
      from = g1;
    }
    if (aMax > from) out.push(localBox(ang, from, aMax, 0, 0, o0, o1));
  }
  return out;
}

/** Drop triangles of `mesh` whose centroid is inside any box (keeps attributes). */
export function cutTriangles(
  mesh: THREE.Mesh,
  boxes: THREE.Box3[],
  keep?: (c: THREE.Vector3) => boolean,
) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  if (pos === undefined) return 0;
  mesh.updateWorldMatrix(true, false);
  const mw = mesh.matrixWorld;
  const idx = geo.index;
  const triCount = idx !== null ? idx.count / 3 : pos.count / 3;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const kept: number[] = [];
  let removed = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx !== null ? idx.getX(t * 3) : t * 3;
    const i1 = idx !== null ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx !== null ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(mw);
    b.fromBufferAttribute(pos, i1).applyMatrix4(mw);
    c.fromBufferAttribute(pos, i2).applyMatrix4(mw);
    const cen = a.add(b).add(c).divideScalar(3);
    const inside = boxes.some(bx => bx.containsPoint(cen)) && (keep === undefined || !keep(cen));
    if (inside) removed++;
    else kept.push(i0, i1, i2);
  }
  if (removed === 0) return 0;
  geo.setIndex(kept);
  // Groups (multi-material) would index past the new range: collapse to one
  if (geo.groups.length > 1) {
    geo.clearGroups();
    if (Array.isArray(mesh.material)) mesh.material = mesh.material[0];
  }
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return removed;
}

// ── Geometry builder (non-indexed, vertex colours) ──

class Builder {
  pos: number[] = [];
  col: number[] = [];
  uv: number[] = [];

  /** Quad a→b→c→d, counter-clockwise from the visible side. */
  quad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    color: THREE.Color,
    uvs?: number[],
  ) {
    for (const v of [a, b, c, a, c, d]) this.pos.push(v.x, v.y, v.z);
    for (let i = 0; i < 6; i++) this.col.push(color.r, color.g, color.b);
    const u = uvs ?? [0, 0, 1, 0, 1, 1, 0, 1];
    const order = [0, 1, 2, 0, 2, 3];
    for (const o of order) this.uv.push(u[o * 2], u[o * 2 + 1]);
  }

  /** Axis-aligned box (all six faces unless skipped). */
  box(
    min: THREE.Vector3,
    max: THREE.Vector3,
    color: THREE.Color,
    top?: THREE.Color,
    skipBottom = true,
  ) {
    const [x0, y0, z0] = [min.x, min.y, min.z];
    const [x1, y1, z1] = [max.x, max.y, max.z];
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    this.quad(V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1), color); // +Z
    this.quad(V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0), color); // −Z
    this.quad(V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), color); // +X
    this.quad(V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0), color); // −X
    this.quad(V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0), top ?? color); // top
    if (!skipBottom) this.quad(V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1), color);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

function boxCollider(min: THREE.Vector3, max: THREE.Vector3, name: string): THREE.Mesh {
  const size = new THREE.Vector3().subVectors(max, min);
  const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z));
  m.name = name;
  m.position.addVectors(min, max).multiplyScalar(0.5);
  m.updateMatrixWorld(true);
  return m;
}

function bannerTexture(text: string, tint: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#' + new THREE.Color(tint).getHexString();
  g.fillRect(0, 0, c.width, c.height);
  // Noggles-red border + stripes
  g.fillStyle = '#e8352b';
  g.fillRect(0, 0, c.width, 22);
  g.fillRect(0, c.height - 22, c.width, 22);
  g.fillStyle = '#ffffff';
  for (let x = -40; x < c.width; x += 70) {
    g.beginPath();
    g.moveTo(x, 22);
    g.lineTo(x + 18, 22);
    g.lineTo(x + 34, 0);
    g.lineTo(x + 16, 0);
    g.closePath();
    g.fill();
  }
  const label = `${text} ↓`;
  let size = 132;
  g.font = `900 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const w = g.measureText(label).width;
  if (w > c.width - 90) size = Math.floor((size * (c.width - 90)) / w);
  g.font = `900 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 14;
  g.strokeStyle = '#141018';
  g.strokeText(label, c.width / 2, c.height / 2 + 6);
  g.fillStyle = '#ffffff';
  g.fillText(label, c.width / 2, c.height / 2 + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * The baked ring was only ever seen from the plaza, so its blocks have no
 * outward-facing walls. From the mountain you'd see straight through them:
 * add a plain windowed back wall to every outer side of every block (found
 * from the roof rectangles of the COL_Buildings collision mesh).
 */
export function buildRingBacks(colBuildings: THREE.Mesh | null): THREE.Mesh | null {
  if (colBuildings === null) return null;
  const geo = colBuildings.geometry;
  const pos = geo.attributes.position;
  if (pos === undefined) return null;
  colBuildings.updateWorldMatrix(true, false);
  const mw = colBuildings.matrixWorld;
  const idx = geo.index;
  const triCount = idx !== null ? idx.count / 3 : pos.count / 3;
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const n = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  // Footprint (rounded) → highest roof
  const blocks = new Map<string, { x0: number; x1: number; z0: number; z1: number; top: number }>();
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++)
      v[k]
        .fromBufferAttribute(pos, idx !== null ? idx.getX(t * 3 + k) : t * 3 + k)
        .applyMatrix4(mw);
    n.crossVectors(e1.subVectors(v[1], v[0]), e2.subVectors(v[2], v[0])).normalize();
    if (Math.abs(n.y) < 0.9) continue;
    const x0 = Math.min(v[0].x, v[1].x, v[2].x);
    const x1 = Math.max(v[0].x, v[1].x, v[2].x);
    const z0 = Math.min(v[0].z, v[1].z, v[2].z);
    const z1 = Math.max(v[0].z, v[1].z, v[2].z);
    if ((x1 - x0) * (z1 - z0) < 20 || v[0].y < 2) continue;
    const key = `${x0.toFixed(1)},${x1.toFixed(1)},${z0.toFixed(1)},${z1.toFixed(1)}`;
    const b = blocks.get(key);
    if (b === undefined) blocks.set(key, { x0, x1, z0, z1, top: v[0].y });
    else b.top = Math.max(b.top, v[0].y);
  }
  const out = new Builder();
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const palette = [0xd9c7a8, 0xc9b39a, 0xb8c4cf, 0xd8b4a0, 0xc2cdb0];
  const win = new THREE.Color(0x3a4f78);
  const off = 0.04;
  let i = 0;
  for (const b of blocks.values()) {
    const wall = new THREE.Color(palette[i++ % palette.length]);
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    // [normal, plane coordinate, along-axis range]
    const sides: { nx: number; nz: number; at: number; a0: number; a1: number }[] = [
      { nx: 0, nz: 1, at: b.z1 + off, a0: b.x0, a1: b.x1 },
      { nx: 0, nz: -1, at: b.z0 - off, a0: b.x0, a1: b.x1 },
      { nx: 1, nz: 0, at: b.x1 + off, a0: b.z0, a1: b.z1 },
      { nx: -1, nz: 0, at: b.x0 - off, a0: b.z0, a1: b.z1 },
    ];
    for (const sd of sides) {
      // Outward (away from the plaza centre) only
      const fx = sd.nx !== 0 ? sd.at : cx;
      const fz = sd.nz !== 0 ? sd.at : cz;
      const cos = (sd.nx * fx + sd.nz * fz) / Math.hypot(fx, fz);
      if (cos < 0.7) continue;
      const quad = (a0: number, a1: number, y0: number, y1: number, c: THREE.Color, d = 0) => {
        const at = sd.at + d * (sd.nx + sd.nz);
        // Build CCW as seen from outside
        const P = (a: number, y: number) => (sd.nx !== 0 ? V(at, y, a) : V(a, y, at));
        const [l, r] = sd.nz > 0 || sd.nx < 0 ? [a0, a1] : [a1, a0];
        out.quad(P(l, y0), P(r, y0), P(r, y1), P(l, y1), c);
      };
      quad(sd.a0, sd.a1, 0, b.top, wall);
      for (let y = 3.4; y + 2 < b.top; y += 3.6)
        for (let a = sd.a0 + 1.2; a + 1.8 < sd.a1; a += 3) quad(a, a + 1.6, y, y + 1.8, win, 0.03);
    }
  }
  if (out.pos.length === 0) return null;
  const mesh = new THREE.Mesh(
    out.geometry(),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
  );
  mesh.name = 'RingBacks';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

export interface AlleyBuild {
  group: THREE.Group;
  collision: THREE.Mesh[];
}

/** New alley-side buildings, arches, banners and the retaining wall. */
export function buildAlleys(): AlleyBuild {
  const group = new THREE.Group();
  group.name = 'Alleys';
  const collision: THREE.Mesh[] = [];
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const z0 = ALLEY_O0;
  const z1 = MOUNTAIN.wallZ;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const roofCol = new THREE.Color(0x6b6578);
  const windowCol = new THREE.Color(0x35507f);
  const windowLit = new THREE.Color(0xffd98a);
  const trim = new THREE.Color(0xf4f1ea);

  // Everything for one alley is built in its local frame (x = a, z = o,
  // i.e. as if on the +Z side) and then turned onto its side of the ring.
  ALLEYS.forEach((a, i) => {
    const walls = new Builder();
    const local: THREE.Mesh[] = [];
    const addBlock = (x0: number, x1: number, corridorSide: 1 | -1, seed: number) => {
      if (x1 - x0 < 0.2) return;
      const wall = new THREE.Color(a.tint);
      const min = V(x0, WALL_BOTTOM + 5, z0);
      const max = V(x1, a.roof, z1);
      walls.box(min, max, wall, roofCol);
      local.push(boxCollider(min, max, 'COL_AlleyBlock'));
      walls.box(V(x0 - 0.05, a.roof, z0 - 0.15), V(x1 + 0.05, a.roof + 0.5, z0 + 0.35), trim);
      let k = seed;
      const lit = () => {
        k = (k * 16807) % 2147483647;
        return k / 2147483647 < 0.25;
      };
      for (let y = 3.6; y + 2 < a.roof; y += 3.6) {
        for (let x = x0 + 1; x + 1.6 < x1; x += 3) {
          const c = lit() ? windowLit : windowCol;
          walls.quad(
            V(x + 1.6, y, z0 - 0.03),
            V(x, y, z0 - 0.03),
            V(x, y + 1.9, z0 - 0.03),
            V(x + 1.6, y + 1.9, z0 - 0.03),
            c,
          );
        }
        const fx = corridorSide > 0 ? x1 + 0.03 : x0 - 0.03;
        for (let z = z0 + 1.5; z + 1.6 < z1; z += 3) {
          const c = lit() ? windowLit : windowCol;
          if (corridorSide > 0)
            walls.quad(
              V(fx, y, z + 1.6),
              V(fx, y, z),
              V(fx, y + 1.9, z),
              V(fx, y + 1.9, z + 1.6),
              c,
            );
          else
            walls.quad(
              V(fx, y, z),
              V(fx, y, z + 1.6),
              V(fx, y + 1.9, z + 1.6),
              V(fx, y + 1.9, z),
              c,
            );
        }
      }
      // Painted stripe along the corridor at board height
      const fx = corridorSide > 0 ? x1 + 0.02 : x0 - 0.02;
      const stripe = new THREE.Color(a.tint).offsetHSL(0.5, 0.25, -0.15);
      if (corridorSide > 0)
        walls.quad(V(fx, 0.6, z1), V(fx, 0.6, z0), V(fx, 1.5, z0), V(fx, 1.5, z1), stripe);
      else walls.quad(V(fx, 0.6, z0), V(fx, 0.6, z1), V(fx, 1.5, z1), V(fx, 1.5, z0), stripe);
    };
    const half = a.width / 2;
    addBlock(a.cut[0], a.a - half, 1, 101 + i * 7);
    addBlock(a.a + half, a.cut[1], -1, 211 + i * 7);
    // Arch on the plaza side: pillars against the walls + a beam across
    const archH = Math.min(7.2, a.roof - 1.5);
    const pc = new THREE.Color(a.tint).offsetHSL(0, 0.1, -0.25);
    for (const px of [a.a - half - 0.7, a.a + half]) {
      const min = V(px, 0, z0 - 0.9);
      const max = V(px + 0.7, archH + 0.9, z0 + 0.2);
      walls.box(min, max, pc);
      local.push(boxCollider(min, max, 'COL_AlleyArch'));
    }
    const bmin = V(a.a - half - 0.7, archH, z0 - 0.8);
    const bmax = V(a.a + half + 0.7, archH + 0.9, z0 + 0.1);
    walls.box(bmin, bmax, pc, undefined, false);
    local.push(boxCollider(bmin, bmax, 'COL_AlleyArch'));
    const side = new THREE.Group();
    side.name = `Alley:${a.label}`;
    side.rotation.y = a.angle;
    const mesh = new THREE.Mesh(walls.geometry(), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    side.add(mesh);
    // Banner under the beam, readable from the plaza
    const bw = a.width - 0.6;
    const bh = bw / 4;
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(bw, bh),
      new THREE.MeshStandardMaterial({
        map: bannerTexture(a.label, a.tint),
        side: THREE.DoubleSide,
        roughness: 0.9,
      }),
    );
    banner.position.set(a.a, archH - bh / 2 - 0.05, z0 - 0.45);
    banner.rotation.y = Math.PI;
    banner.name = 'AlleyBanner';
    side.add(banner);
    group.add(side);
    side.updateMatrixWorld(true);
    for (const m of local) {
      m.applyMatrix4(side.matrixWorld);
      m.updateMatrixWorld(true);
      collision.push(m);
    }
  });

  // Retaining wall round the outside of the ring (gaps for the alleys)
  const wallB = new Builder();
  const stone = new THREE.Color(0xc9bea8);
  const cap = new THREE.Color(0x8f8576);
  for (const b of ringBands(z1 - 2, z1 + 1, z1 + 1)) {
    const min = V(b.min.x, WALL_BOTTOM, b.min.z);
    const max = V(b.max.x, 0, b.max.z);
    wallB.box(min, max, stone, cap);
    collision.push(boxCollider(min, max, 'COL_CityWall'));
  }
  const wallMesh = new THREE.Mesh(wallB.geometry(), mat);
  wallMesh.name = 'CityWall';
  wallMesh.receiveShadow = true;
  group.add(wallMesh);
  return { group, collision };
}

/**
 * The baked backdrop (a painted ring of distant blocks on a flat ground
 * plane out to 240 m) now stands where the slopes fall away. Keep the
 * skyline: drop the flat ground, seat every block on the terrain under its
 * footprint (sunk to its lowest corner), give it a box collider, and clear
 * any block that would sit on a dirt track.
 */
export function seatBackdrop(mesh: THREE.Mesh): THREE.Mesh[] {
  const geo = mesh.geometry;
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (pos === undefined) return [];
  mesh.updateWorldMatrix(true, false);
  const mw = mesh.matrixWorld;
  const inv = mw.clone().invert();
  const idx = geo.index;
  const triCount = idx !== null ? idx.count / 3 : pos.count / 3;
  const vi = (t: number, k: number) => (idx !== null ? idx.getX(t * 3 + k) : t * 3 + k);
  const world: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++)
    world.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mw));
  const isGround = (t: number) => {
    for (let k = 0; k < 3; k++) if (Math.abs(world[vi(t, k)].y) > 0.05) return false;
    return true;
  };
  // Union-find over vertex positions → one component per block
  const key = (v: THREE.Vector3) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  for (let t = 0; t < triCount; t++) {
    if (isGround(t)) continue;
    const ks = [0, 1, 2].map(k => key(world[vi(t, k)]));
    for (const k of ks) if (!parent.has(k)) parent.set(k, k);
    const a = find(ks[0]);
    for (const k of ks.slice(1)) {
      const b = find(k);
      if (a !== b) parent.set(b, a);
    }
  }
  const boxes = new Map<string, THREE.Box3>();
  for (let t = 0; t < triCount; t++) {
    if (isGround(t)) continue;
    for (let k = 0; k < 3; k++) {
      const v = world[vi(t, k)];
      const r = find(key(v));
      let b = boxes.get(r);
      if (b === undefined) boxes.set(r, (b = new THREE.Box3()));
      b.expandByPoint(v);
    }
  }
  // Per block: dropped (null: on a track / alley / against the ring) or the
  // y shift that seats it on the slope
  const shift = new Map<string, number | null>();
  const s: TerrainSample = { y: 0, track: 0, alley: 0, side: 0, dist: 0 };
  const w = MOUNTAIN.wallZ + 2;
  for (const [r, b] of boxes) {
    let lo = Infinity;
    let clash = b.min.x < w && b.max.x > -w && b.min.z < w && b.max.z > -w;
    for (let i = 0; i <= 4 && !clash; i++)
      for (let j = 0; j <= 4; j++) {
        const x = THREE.MathUtils.lerp(b.min.x, b.max.x, i / 4);
        const z = THREE.MathUtils.lerp(b.min.z, b.max.z, j / 4);
        sampleTerrain(x, z, s);
        if (s.dist < MOUNTAIN.trackHalf + MOUNTAIN.trackShoulder + 4 || s.alley > 0) clash = true;
        lo = Math.min(lo, s.y);
      }
    shift.set(r, clash ? null : lo - 0.6);
  }
  const kept: number[] = [];
  const moved = new Set<number>();
  const v = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    if (isGround(t)) continue;
    const dy = shift.get(find(key(world[vi(t, 0)])));
    if (dy === null || dy === undefined) continue;
    for (let k = 0; k < 3; k++) {
      const i = vi(t, k);
      kept.push(i);
      if (moved.has(i)) continue;
      moved.add(i);
      v.copy(world[i]);
      v.y += dy;
      v.applyMatrix4(inv);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  pos.needsUpdate = true;
  geo.setIndex(kept);
  if (geo.groups.length > 1) {
    geo.clearGroups();
    if (Array.isArray(mesh.material)) mesh.material = mesh.material[0];
  }
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const colliders: THREE.Mesh[] = [];
  for (const [r, b] of boxes) {
    const dy = shift.get(r);
    if (dy === null || dy === undefined) continue;
    colliders.push(
      boxCollider(
        new THREE.Vector3(b.min.x, b.min.y + dy, b.min.z),
        new THREE.Vector3(b.max.x, b.max.y + dy, b.max.z),
        'COL_Backdrop',
      ),
    );
  }
  return colliders;
}
