// ── Box-and-wedge kit for the cars: chunky parts → one flat-coloured mesh ──
//
// Every part is a box (optionally tapered, wedged or turned) or a low-sided
// cylinder, painted one flat vertex colour. build() merges them into a
// single non-indexed geometry (flat normals: the toon ramp and the ink pass
// do the rest) with two groups: paint (0) and glow (1: lamps, thruster
// flames), so a whole car body is one mesh and two draw calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface BoxMod {
  /** Scale of the top face (x across, z along). */
  topX?: number;
  topZ?: number;
  /** Slide the top face along z (+ = forward), e.g. a raked windscreen. */
  topDz?: number;
  /** Lower the top-front / top-rear edge (a wedge nose / tail). */
  noseDrop?: number;
  tailDrop?: number;
  /** Raise the bottom-front / bottom-rear edge (a chin / diffuser). */
  chin?: number;
  tailLift?: number;
  /** Euler turn (rad, XYZ) about the part's centre. */
  rot?: [number, number, number];
}

const _c = new THREE.Color();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();

export class Kit {
  private paint: THREE.BufferGeometry[] = [];
  private glow: THREE.BufferGeometry[] = [];

  /** A box `size` centred at `at`, painted `color`. */
  box(
    color: number,
    size: [number, number, number],
    at: [number, number, number],
    mod: BoxMod = {},
    glow = false,
  ): this {
    const [sx, sy, sz] = size;
    const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
    const pos = g.attributes.position as THREE.BufferAttribute;
    const hy = sy / 2;
    const hz = sz / 2;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      const top = y > 0;
      const front = z > 0;
      if (top) {
        x *= mod.topX ?? 1;
        z = z * (mod.topZ ?? 1) + (mod.topDz ?? 0);
        if (front && mod.noseDrop) y -= mod.noseDrop;
        if (!front && mod.tailDrop) y -= mod.tailDrop;
      } else {
        if (front && mod.chin) y += mod.chin;
        if (!front && mod.tailLift) y += mod.tailLift;
      }
      // keep wedged faces from folding through
      y = Math.max(-hy, Math.min(hy, y));
      z = Math.max(-hz * 1.5 + (mod.topDz ?? 0), Math.min(hz * 1.5 + (mod.topDz ?? 0), z));
      pos.setXYZ(i, x, y, z);
    }
    return this.add(g, color, at, mod.rot, glow);
  }

  /** A cylinder of `r` (and `r2` at the far end), `len` long along `axis`. */
  cyl(
    color: number,
    r: number,
    len: number,
    at: [number, number, number],
    axis: 'x' | 'y' | 'z' = 'y',
    seg = 10,
    r2 = r,
    glow = false,
  ): this {
    const g = new THREE.CylinderGeometry(r2, r, len, seg).toNonIndexed();
    if (axis === 'x') g.rotateZ(-Math.PI / 2);
    else if (axis === 'z') g.rotateX(Math.PI / 2);
    return this.add(g, color, at, undefined, glow);
  }

  /** A low sphere (headlamp pods, the bubble car's dome). */
  ball(
    color: number,
    r: number,
    at: [number, number, number],
    scale: [number, number, number] = [1, 1, 1],
    glow = false,
  ): this {
    const g = new THREE.SphereGeometry(r, 8, 6).toNonIndexed();
    g.scale(scale[0], scale[1], scale[2]);
    return this.add(g, color, at, undefined, glow);
  }

  private add(
    g: THREE.BufferGeometry,
    color: number,
    at: [number, number, number],
    rot: [number, number, number] | undefined,
    glow: boolean,
  ): this {
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    if (rot !== undefined) {
      _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
      _m.compose(_p.set(at[0], at[1], at[2]), _q, _s);
    } else _m.makeTranslation(at[0], at[1], at[2]);
    g.applyMatrix4(_m);
    g.computeVertexNormals(); // non-indexed: flat per face
    _c.setHex(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (glow ? this.glow : this.paint).push(g);
    return this;
  }

  get empty(): boolean {
    return this.paint.length === 0 && this.glow.length === 0;
  }

  /** One geometry: group 0 paint, group 1 glow (always both, maybe empty). */
  build(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const paint = this.paint.length > 0 ? mergeGeometries(this.paint, false) : null;
    const glow = this.glow.length > 0 ? mergeGeometries(this.glow, false) : null;
    if (paint !== null) parts.push(paint);
    if (glow !== null) parts.push(glow);
    const out = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
    out.clearGroups();
    const np = paint?.attributes.position.count ?? 0;
    const ng = glow?.attributes.position.count ?? 0;
    out.addGroup(0, np, 0);
    out.addGroup(np, ng, 1);
    for (const g of [...this.paint, ...this.glow]) g.dispose();
    if (parts.length > 1) for (const p of parts) p.dispose();
    this.paint = [];
    this.glow = [];
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  }
}

/** Shared car materials (one set for every car, so toonify converts each once). */
let mats: [THREE.MeshStandardMaterial, THREE.MeshBasicMaterial] | null = null;

export function carMaterials(): [THREE.MeshStandardMaterial, THREE.MeshBasicMaterial] {
  if (mats !== null) return mats;
  const paint = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0,
    // a little lift so light paints stay light in the toon mid band
    emissive: 0x1c1c1c,
  });
  paint.name = 'car-paint';
  // Lamps and flames: unlit, full colour (toonify leaves basic materials alone)
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  glow.name = 'car-glow';
  mats = [paint, glow];
  return mats;
}

/** Count triangles under an object (tests / credits). */
export function triCount(o: THREE.Object3D): number {
  let n = 0;
  o.traverse(c => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const g = m.geometry;
    n += (g.index !== null ? g.index.count : g.attributes.position.count) / 3;
  });
  return n;
}
