// ── Wild things: tiny vertex-coloured geometry builder ──────────────────
//
// Creatures, hill houses and oddities are all assembled from two shapes —
// boxes (optionally split into voxel cells, each coloured by a pattern
// function, for the chunky toy look) and lathes (domes, discs, rings, pipes,
// mushroom caps) — under a transform stack, into ONE indexed geometry with
// position + normal + colour. Everything the wild layer draws per chunk is
// a merge of these, so a chunk costs a couple of draw calls at most.
//
// `solid` parts also write a coarse position-only triangle soup (colliders).

import * as THREE from 'three';

export type ColorFn = (x: number, y: number, z: number) => THREE.Color;
export type Paint = THREE.Color | ColorFn;

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

// Box faces: normal axis + two tangents with u × v = n (CCW seen from outside)
const FACES: [number[], number[], number[]][] = [
  [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  [
    [-1, 0, 0],
    [0, 0, 1],
    [0, 1, 0],
  ],
  [
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 0],
  ],
  [
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, 1],
  ],
  [
    [0, 0, 1],
    [1, 0, 0],
    [0, 1, 0],
  ],
  [
    [0, 0, -1],
    [0, 1, 0],
    [1, 0, 0],
  ],
];

/** Per face: normal axis, its sign, tangent axes u / v. */
const FACE_AXES = FACES.map(([n, u, v]) => {
  const ax = n.findIndex(k => k !== 0);
  return [ax, n[ax], u.findIndex(k => k !== 0), v.findIndex(k => k !== 0)] as const;
});
const _h = [0, 0, 0];
const _c3 = [0, 0, 0];
const _p3 = [0, 0, 0];

export class GeoBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private stack: THREE.Matrix4[] = [];
  private m = new THREE.Matrix4();
  /** Normal matrix of `m` (inverse transpose of its 3×3). */
  private nm = new THREE.Matrix3();
  /** Collider triangle soup (position only), filled by solid parts. */
  readonly solidTris: number[] = [];

  get vertexCount() {
    return this.pos.length / 3;
  }

  get empty() {
    return this.idx.length === 0;
  }

  /** Push a transform (applied to everything until the matching pop). */
  push(m: THREE.Matrix4) {
    this.stack.push(this.m.clone());
    this.m.multiply(m);
    this.nm.getNormalMatrix(this.m);
    return this;
  }

  pop() {
    const m = this.stack.pop();
    if (m !== undefined) this.m = m;
    this.nm.getNormalMatrix(this.m);
    return this;
  }

  /** Run `fn` translated to (x, y, z), rotated (Euler XYZ order YXZ), scaled. */
  at(x: number, y: number, z: number, ry: number, rx: number, rz: number, fn: () => void, s = 1) {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
    this.push(_m);
    fn();
    this.pop();
  }

  /** Push a vertex (local position + local normal) through the current transform. */
  private vert(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    c: THREE.Color,
  ): number {
    const e = this.m.elements;
    this.pos.push(
      e[0] * x + e[4] * y + e[8] * z + e[12],
      e[1] * x + e[5] * y + e[9] * z + e[13],
      e[2] * x + e[6] * y + e[10] * z + e[14],
    );
    const n = this.nm.elements;
    const wx = n[0] * nx + n[3] * ny + n[6] * nz;
    const wy = n[1] * nx + n[4] * ny + n[7] * nz;
    const wz = n[2] * nx + n[5] * ny + n[8] * nz;
    const l = Math.hypot(wx, wy, wz) || 1;
    this.nrm.push(wx / l, wy / l, wz / l);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }

  /**
   * Axis-aligned box (centre, full size) in the current frame. With `cell`
   * > 0 each face is split into ~cell-sized quads, each coloured by `paint`
   * at its centre (voxel patterns: stripes, spots, bellies…).
   */
  box(
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    paint: Paint,
    cell = 0,
    solid = false,
  ) {
    const h = _h;
    const c = _c3;
    const p = _p3;
    h[0] = sx / 2;
    h[1] = sy / 2;
    h[2] = sz / 2;
    c[0] = cx;
    c[1] = cy;
    c[2] = cz;
    const fn = typeof paint === 'function' ? paint : null;
    for (const [ax, sg, au, av] of FACE_AXES) {
      const fx = ax === 0 ? sg : 0;
      const fy = ax === 1 ? sg : 0;
      const fz = ax === 2 ? sg : 0;
      const lu = h[au] * 2;
      const lv = h[av] * 2;
      const nu = cell > 0 && fn !== null ? Math.max(1, Math.round(lu / cell)) : 1;
      const nv = cell > 0 && fn !== null ? Math.max(1, Math.round(lv / cell)) : 1;
      p[ax] = c[ax] + sg * h[ax];
      const u00 = c[au] - h[au];
      const v00 = c[av] - h[av];
      for (let j = 0; j < nv; j++) {
        const v0 = v00 + (lv * j) / nv;
        const v1 = v00 + (lv * (j + 1)) / nv;
        for (let i = 0; i < nu; i++) {
          const u0 = u00 + (lu * i) / nu;
          const u1 = u00 + (lu * (i + 1)) / nu;
          let color = paint as THREE.Color;
          if (fn !== null) {
            p[au] = (u0 + u1) / 2;
            p[av] = (v0 + v1) / 2;
            color = fn(p[0], p[1], p[2]);
          }
          p[au] = u0;
          p[av] = v0;
          const ia = this.vert(p[0], p[1], p[2], fx, fy, fz, color);
          p[au] = u1;
          this.vert(p[0], p[1], p[2], fx, fy, fz, color);
          p[av] = v1;
          this.vert(p[0], p[1], p[2], fx, fy, fz, color);
          p[au] = u0;
          this.vert(p[0], p[1], p[2], fx, fy, fz, color);
          this.idx.push(ia, ia + 1, ia + 2, ia, ia + 2, ia + 3);
        }
      }
    }
    if (solid) this.solidBox(cx, cy, cz, sx, sy, sz);
    return this;
  }

  /** Collider-only box (12 triangles in the current frame). */
  solidBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) {
    const h = [sx / 2, sy / 2, sz / 2];
    const c = [cx, cy, cz];
    for (const [n, u, v] of FACES) {
      const corner = (su: number, sv: number) => {
        const p = [0, 0, 0];
        for (let k = 0; k < 3; k++) p[k] = c[k] + (n[k] + u[k] * su + v[k] * sv) * h[k];
        _v.set(p[0], p[1], p[2]).applyMatrix4(this.m);
        return [_v.x, _v.y, _v.z];
      };
      const a = corner(-1, -1);
      const b = corner(1, -1);
      const d = corner(1, 1);
      const e = corner(-1, 1);
      this.solidTris.push(...a, ...b, ...d, ...a, ...d, ...e);
    }
  }

  /**
   * Surface of revolution about the local Y axis. `profile` is a list of
   * (radius, y) from bottom to top; `paint` gets the vertex position. With
   * `closed` the last ring joins the first (rings / tori).
   */
  lathe(
    profile: [number, number][],
    segs: number,
    paint: Paint | null,
    closed = false,
    solid = false,
  ) {
    const fn = typeof paint === 'function' ? paint : null;
    const rows = profile.length;
    const pts: number[] = [];
    for (let i = 0; i < rows; i++) {
      const [r, y] = profile[i];
      // Smooth normal in the (radius, y) plane from the neighbouring profile points
      const prev = profile[closed ? (i - 1 + rows) % rows : Math.max(0, i - 1)];
      const next = profile[closed ? (i + 1) % rows : Math.min(rows - 1, i + 1)];
      let nr = next[1] - prev[1];
      let ny = prev[0] - next[0];
      const nl = Math.hypot(nr, ny) || 1;
      nr /= nl;
      ny /= nl;
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        _v.set(r * ca, y, r * sa);
        if (paint !== null) {
          const c = fn !== null ? fn(_v.x, _v.y, _v.z) : (paint as THREE.Color);
          this.vert(_v.x, _v.y, _v.z, nr * ca, ny, nr * sa, c);
          _v.set(r * ca, y, r * sa);
        }
        _v.applyMatrix4(this.m);
        pts.push(_v.x, _v.y, _v.z);
      }
    }
    const base = this.vertexCount - (paint !== null ? rows * segs : 0);
    const rowsN = closed ? rows : rows - 1;
    for (let i = 0; i < rowsN; i++) {
      const i1 = (i + 1) % rows;
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        const a = i * segs + j;
        const b = i1 * segs + j;
        const c = i1 * segs + j1;
        const d = i * segs + j1;
        if (paint !== null)
          this.idx.push(base + a, base + b, base + c, base + a, base + c, base + d);
        if (solid) {
          for (const k of [a, b, c, a, c, d])
            this.solidTris.push(pts[k * 3], pts[k * 3 + 1], pts[k * 3 + 2]);
        }
      }
    }
    return this;
  }

  /** Capped cylinder / cone frustum along +Y from y0 to y1. */
  cyl(r0: number, r1: number, y0: number, y1: number, segs: number, paint: Paint, solid = false) {
    return this.lathe(
      [
        [0, y0],
        [r0, y0],
        [r1, y1],
        [0, y1],
      ],
      segs,
      paint,
      false,
      solid,
    );
  }

  /** Sphere-ish ellipsoid (rx, ry, rz) about (0, cy, 0); rows ≥ 3. */
  ball(rx: number, ry: number, rz: number, cy: number, segs: number, rows: number, paint: Paint) {
    const prof: [number, number][] = [];
    for (let i = 0; i <= rows; i++) {
      const a = -Math.PI / 2 + (i / rows) * Math.PI;
      prof.push([Math.cos(a), Math.sin(a)]);
    }
    _m.makeScale(rx, ry, rz).setPosition(0, cy, 0);
    this.push(_m);
    this.lathe(prof, segs, paint);
    this.pop();
    return this;
  }

  /** Torus (ring) lying in the XZ plane: radius R, tube r. */
  ring(R: number, r: number, segs: number, tube: number, paint: Paint) {
    const prof: [number, number][] = [];
    for (let i = 0; i < tube; i++) {
      const a = (i / tube) * Math.PI * 2;
      prof.push([R + r * Math.cos(a), r * Math.sin(a)]);
    }
    return this.lathe(prof, segs, paint, true);
  }

  /** Indexed render geometry (smooth normals around a lathe, flat on boxes). */
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const n = this.vertexCount;
    g.setIndex(
      n > 65535
        ? new THREE.Uint32BufferAttribute(this.idx, 1)
        : new THREE.Uint16BufferAttribute(this.idx, 1),
    );
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  /** The solid parts as a non-indexed position-only geometry, or null. */
  buildCollider(): THREE.BufferGeometry | null {
    if (this.solidTris.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.solidTris, 3));
    return g;
  }
}

/** Shorthand for a colour from a hex / HSL triple (linear working space). */
export const hex = (h: number) => new THREE.Color(h);
export const hsl = (h: number, s: number, l: number) =>
  new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l);
