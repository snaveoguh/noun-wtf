// ── Infill: close the slots between the ring's blocks ────────────────────
//
// The baked ring leaves a 4.5 m dead-end slot between some neighbouring
// blocks (one per side: a street-level notch running back from the plaza
// facade to a low block behind it). From a roof you looked over the
// parapet, past the taller neighbour's wall and straight down to the
// street. Each slot gets a narrow building of its own: its roof flush with
// the block behind it (so the two read as one roof), a parapet and a
// windowed wall on the plaza side, and a solid collider so parkour sees a
// roof there, not a gap. Where that back block stops short of its
// neighbours (a 1 m notch at the back of the ring) a strip fills that too.
//
// The slots are found from the seated COL_Buildings roofs, so nothing is
// hand-placed: `findInfills` is pure and tested against the real plaza.

import * as THREE from 'three';

/** A block's roof (world XZ rectangle, visible roof height). */
export interface RoofRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
}

export interface Infill extends RoofRect {
  /** Outward normal of its side of the ring (away from the plaza). */
  nx: number;
  nz: number;
  /** Plaza-facing wall line (|x| or |z|). */
  facade: number;
  /** On the facade line: a plaza wall + parapet (else a strip behind the back block). */
  front: boolean;
  /** Its outer end is open air (the ring's back): wall it. */
  outer: boolean;
  /** Roof heights of the blocks either side (low u side, high u side). */
  neighbours: [number, number];
}

/** Plaza facade line of the ring (|x| or |z|). */
export const FACADE = 76;
/** Widest slot that's a gap between buildings rather than a street. */
const MAX_GAP = 6;
const MIN_GAP = 0.05;
const ON_LINE = 0.3;
const PARAPET_H = 0.9;
const PARAPET_D = 0.3;

const SIDES: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** A rect in a side's frame: u along the side, o outward (o0 = plaza edge). */
interface Local {
  u0: number;
  u1: number;
  o0: number;
  o1: number;
  top: number;
}

function toLocal(r: RoofRect, nx: number, nz: number): Local {
  if (nx !== 0) {
    const [o0, o1] = nx > 0 ? [r.minX, r.maxX] : [-r.maxX, -r.minX];
    return { u0: r.minZ, u1: r.maxZ, o0, o1, top: r.top };
  }
  const [o0, o1] = nz > 0 ? [r.minZ, r.maxZ] : [-r.maxZ, -r.minZ];
  return { u0: r.minX, u1: r.maxX, o0, o1, top: r.top };
}

function toWorld(
  u0: number,
  u1: number,
  o0: number,
  o1: number,
  nx: number,
  nz: number,
): Omit<RoofRect, 'top'> {
  if (nx !== 0) {
    const [minX, maxX] = nx > 0 ? [o0, o1] : [-o1, -o0];
    return { minX, maxX, minZ: u0, maxZ: u1 };
  }
  const [minZ, maxZ] = nz > 0 ? [o0, o1] : [-o1, -o0];
  return { minX: u0, maxX: u1, minZ, maxZ };
}

/**
 * Slots between neighbouring blocks on the plaza facade line, each as the
 * box that fills it: from the facade back to the block behind (or as deep
 * as its neighbours), up to that block's roof (or the lower neighbour's).
 */
export function findInfills(roofs: readonly RoofRect[], facade = FACADE): Infill[] {
  const out: Infill[] = [];
  for (const [nx, nz] of SIDES) {
    const local = roofs.map(r => toLocal(r, nx, nz));
    const front = local.filter(r => Math.abs(r.o0 - facade) < ON_LINE).sort((a, b) => a.u0 - b.u0);
    for (let i = 1; i < front.length; i++) {
      const a = front[i - 1]!;
      const b = front[i]!;
      const gap = b.u0 - a.u1;
      if (gap <= MIN_GAP || gap > MAX_GAP) continue;
      const mid = (a.u1 + b.u0) / 2;
      let back: Local | null = null;
      for (const r of local)
        if (
          r.u0 < mid &&
          r.u1 > mid &&
          r.o0 > facade + ON_LINE &&
          (back === null || r.o0 < back.o0)
        )
          back = r;
      const deep = Math.min(a.o1, b.o1);
      const top = back !== null ? back.top : Math.min(a.top, b.top);
      const piece = (o0: number, o1: number, front: boolean, outer: boolean): Infill => ({
        ...toWorld(a.u1, b.u0, o0, o1, nx, nz),
        top,
        nx,
        nz,
        facade,
        front,
        outer,
        neighbours: [a.top, b.top],
      });
      if (back === null) {
        out.push(piece(facade, deep, true, true));
        continue;
      }
      out.push(piece(facade, back.o0, true, false));
      if (deep - back.o1 > MIN_GAP) out.push(piece(back.o1, deep, false, true));
    }
  }
  return out;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Non-indexed, vertex-coloured triangles; each quad is wound to face `n`. */
class Quads {
  pos: number[] = [];
  col: number[] = [];

  quad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    n: THREE.Vector3,
    color: THREE.Color,
  ) {
    const face = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const vs = face.dot(n) >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    for (const v of vs) this.pos.push(v.x, v.y, v.z);
    for (let i = 0; i < 6; i++) this.col.push(color.r, color.g, color.b);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

function boxCollider(min: THREE.Vector3, max: THREE.Vector3): THREE.Mesh {
  const size = new THREE.Vector3().subVectors(max, min);
  const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z));
  m.name = 'COL_BuildingsInfill';
  m.position.addVectors(min, max).multiplyScalar(0.5);
  m.updateMatrixWorld(true);
  return m;
}

const PALETTE = [0xd8b4a0, 0xc9b39a, 0xb8c4cf, 0xd9c7a8];

/** The infill buildings (one mesh) and their colliders (a body each, plus the parapets). */
export function buildInfills(infills: readonly Infill[]): {
  mesh: THREE.Mesh | null;
  collision: THREE.Mesh[];
} {
  const q = new Quads();
  const collision: THREE.Mesh[] = [];
  // Lit like the baked roofs (lightmapped) next to it, not like the alley blocks
  const roofCol = new THREE.Color(0xaaa1be);
  const trim = new THREE.Color(0xf4f1ea);
  const win = new THREE.Color(0x3a4f78);
  infills.forEach((f, i) => {
    const wall = new THREE.Color(PALETTE[i % PALETTE.length]);
    // Side frame: u along the plaza wall, o outward; P(u, y, o) → world
    const local = toLocal(f, f.nx, f.nz);
    const P = (u: number, y: number, o: number) =>
      f.nx !== 0 ? V(o * f.nx, y, u) : V(u, y, o * f.nz);
    const out = V(f.nx, 0, f.nz);
    const toPlaza = out.clone().negate();
    const along = f.nx !== 0 ? V(0, 0, 1) : V(1, 0, 0);
    const { u0, u1, o0, o1, top } = local;
    const pTop = top + PARAPET_H;
    const pIn = o0 + PARAPET_D;
    const body = [P(u0, 0, o0), P(u1, top, o1)];
    collision.push(boxCollider(body[0]!.clone().min(body[1]!), body[0]!.clone().max(body[1]!)));
    // Over a lower neighbour the infill's side shows: wall it
    f.neighbours.forEach((nTop, k) => {
      if (nTop >= top - 0.05) return;
      const u = k === 0 ? u0 : u1;
      const n = k === 0 ? along.clone().negate() : along;
      q.quad(P(u, nTop, o0), P(u, nTop, o1), P(u, top, o1), P(u, top, o0), n, wall);
    });
    if (f.outer) q.quad(P(u0, 0, o1), P(u1, 0, o1), P(u1, top, o1), P(u0, top, o1), out, wall);
    if (!f.front) {
      q.quad(P(u0, top, o0), P(u1, top, o0), P(u1, top, o1), P(u0, top, o1), V(0, 1, 0), roofCol);
      return;
    }
    // Plaza wall, up to the parapet's top
    q.quad(P(u0, 0, o0), P(u1, 0, o0), P(u1, pTop, o0), P(u0, pTop, o0), toPlaza, wall);
    for (let y = 3.6; y + 2 < top; y += 3.6)
      for (let u = u0 + 0.75; u + 1.4 <= u1 - 0.5; u += 2.2)
        q.quad(
          P(u, y, o0 - 0.03),
          P(u + 1.4, y, o0 - 0.03),
          P(u + 1.4, y + 1.8, o0 - 0.03),
          P(u, y + 1.8, o0 - 0.03),
          toPlaza,
          win,
        );
    // Roof, then the parapet's cap and its roof-side face
    q.quad(P(u0, top, pIn), P(u1, top, pIn), P(u1, top, o1), P(u0, top, o1), V(0, 1, 0), roofCol);
    q.quad(P(u0, pTop, o0), P(u1, pTop, o0), P(u1, pTop, pIn), P(u0, pTop, pIn), V(0, 1, 0), trim);
    q.quad(P(u0, top, pIn), P(u1, top, pIn), P(u1, pTop, pIn), P(u0, pTop, pIn), out, trim);
    const lip = [P(u0, top, o0), P(u1, pTop, pIn)];
    collision.push(boxCollider(lip[0]!.clone().min(lip[1]!), lip[0]!.clone().max(lip[1]!)));
  });
  if (q.pos.length === 0) return { mesh: null, collision };
  const mesh = new THREE.Mesh(
    q.geometry(),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
  );
  mesh.name = 'RingInfill';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, collision };
}
