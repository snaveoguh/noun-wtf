// ── The park bench: one merged mesh (1 draw) + a box collider ────────────
//
// Wooden slats on cast-iron ends, in bench-local space (x along it, z to
// the mural, y up; place.ts BENCH), coloured per vertex so the whole bench
// is one geometry and one material (toonified with the level's look).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { BENCH, type BenchSite } from './place';

const WOOD = [0xb8743c, 0xa8652f, 0xc07d44];
const IRON = 0x1d2621;

interface Piece {
  w: number;
  h: number;
  d: number;
  x: number;
  y: number;
  z: number;
  /** Tilt about x (rad). */
  rx?: number;
  color: number;
}

/** Every box the bench is made of (local). */
export function benchPieces(): Piece[] {
  const L = BENCH.length;
  const out: Piece[] = [];
  // Seat: three slats
  [0.15, 0, -0.15].forEach((z, i) =>
    out.push({ w: L, h: 0.045, d: 0.125, x: 0, y: BENCH.seatH - 0.0225, z, color: WOOD[i % 3]! }),
  );
  // Back: three slats leaning back a touch (higher = further back)
  const lean = -0.2;
  const backAt = (y: number) => BENCH.backZ - (y - 0.5) * Math.tan(-lean);
  [0.6, 0.75, 0.9].forEach((y, i) =>
    out.push({
      w: L,
      h: 0.105,
      d: 0.035,
      x: 0,
      y,
      z: backAt(y),
      rx: lean,
      color: WOOD[(i + 1) % 3]!,
    }),
  );
  // Ends + a middle support: legs, a rail under the seat, the back post
  for (const x of [-L / 2 + 0.1, 0, L / 2 - 0.1]) {
    const end = x !== 0;
    out.push({
      w: 0.06,
      h: BENCH.seatH - 0.045,
      d: 0.06,
      x,
      y: (BENCH.seatH - 0.045) / 2,
      z: 0.17,
      color: IRON,
    });
    out.push({
      w: 0.06,
      h: BENCH.seatH - 0.045,
      d: 0.06,
      x,
      y: (BENCH.seatH - 0.045) / 2,
      z: -0.19,
      color: IRON,
    });
    out.push({ w: 0.07, h: 0.05, d: 0.46, x, y: BENCH.seatH - 0.07, z: -0.01, color: IRON });
    out.push({
      w: 0.06,
      h: 0.6,
      d: 0.05,
      x,
      y: BENCH.seatH + 0.26,
      z: backAt(BENCH.seatH + 0.26) - 0.042,
      rx: lean,
      color: IRON,
    });
    if (end) {
      // Feet and an armrest
      out.push({ w: 0.12, h: 0.03, d: 0.5, x, y: 0.015, z: -0.01, color: IRON });
      out.push({ w: 0.08, h: 0.04, d: 0.5, x, y: 0.68, z: 0.0, color: IRON });
      out.push({ w: 0.05, h: 0.24, d: 0.05, x, y: 0.57, z: 0.2, color: IRON });
    }
  }
  return out;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

/** The bench as one geometry in local space (position, normal, colour). */
export function benchGeometry(): THREE.BufferGeometry {
  const geos = benchPieces().map(pc => {
    const g = new THREE.BoxGeometry(pc.w, pc.h, pc.d);
    g.deleteAttribute('uv');
    _m.compose(_p.set(pc.x, pc.y, pc.z), _q.setFromEuler(_e.set(pc.rx ?? 0, 0, 0)), _s);
    g.applyMatrix4(_m);
    const c = new THREE.Color(pc.color);
    const n = g.attributes.position!.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const merged = mergeGeometries(geos, false)!;
  for (const g of geos) g.dispose();
  return merged;
}

/** Collider boxes (world space, position only): the seat block and the back. */
export function benchCollider(site: BenchSite): THREE.BufferGeometry {
  const L = BENCH.length;
  const seat = new THREE.BoxGeometry(L, BENCH.seatH, 0.46).translate(0, BENCH.seatH / 2, -0.01);
  const back = new THREE.BoxGeometry(L, BENCH.backTop - BENCH.seatH, 0.1).translate(
    0,
    (BENCH.backTop + BENCH.seatH) / 2,
    BENCH.backZ - 0.02,
  );
  const m = new THREE.Matrix4().makeRotationY(site.yaw).setPosition(site.x, site.y, site.z);
  const geos = [seat, back].map(g => {
    const p = new THREE.BufferGeometry();
    p.setAttribute('position', g.attributes.position!.clone());
    p.setIndex(g.index!.clone());
    g.dispose();
    return p.applyMatrix4(m).toNonIndexed();
  });
  const merged = mergeGeometries(geos, false)!;
  for (const g of geos) g.dispose();
  return merged;
}

/** The bench mesh placed at `site` (one draw). */
export function buildBench(site: BenchSite, shadows: boolean): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const mesh = new THREE.Mesh(benchGeometry(), mat);
  mesh.name = 'MuralBench';
  mesh.position.set(site.x, site.y, site.z);
  mesh.rotation.y = site.yaw;
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  mesh.updateMatrixWorld(true);
  return mesh;
}
