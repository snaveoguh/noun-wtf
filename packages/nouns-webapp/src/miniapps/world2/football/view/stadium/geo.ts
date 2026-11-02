// ── A tiny geometry writer: quads, boxes, beams into one merged buffer ──
//
// Every static part of the stadium is written straight into one of a few
// of these (one per material), so "merging" costs nothing and each
// material is one draw. Colours are sRGB hex, stored linear (three's
// vertex colours are linear). Faces take the normal they should face and
// fix their own winding, so nothing here depends on getting CCW right.

import * as THREE from 'three';

export type V3 = readonly [number, number, number];

const _c = new THREE.Color();

/** Colour cache: hex → linear rgb. */
const lin = new Map<number, [number, number, number]>();
export function linear(hex: number): [number, number, number] {
  let v = lin.get(hex);
  if (v === undefined) {
    _c.setHex(hex);
    v = [_c.r, _c.g, _c.b];
    lin.set(hex, v);
  }
  return v;
}

/** A growable typed array (number[] pushes + a copy cost ~5× more at build time). */
class Buf<T extends Float32Array | Uint32Array | Uint8Array> {
  length = 0;
  constructor(public a: T) {}
  private grow(n: number) {
    if (this.length + n <= this.a.length) return;
    const C = this.a.constructor as new (n: number) => T;
    const b = new C(Math.max(this.a.length * 2, this.length + n));
    b.set(this.a);
    this.a = b;
  }
  push1(x: number) {
    this.grow(1);
    this.a[this.length++] = x;
  }
  push2(x: number, y: number) {
    this.grow(2);
    this.a[this.length++] = x;
    this.a[this.length++] = y;
  }
  push3(x: number, y: number, z: number) {
    this.grow(3);
    this.a[this.length++] = x;
    this.a[this.length++] = y;
    this.a[this.length++] = z;
  }
  /** A right-sized copy. */
  out(): T {
    return this.a.slice(0, this.length) as T;
  }
}

export class Geo {
  pos = new Buf(new Float32Array(3 * 1024));
  nrm = new Buf(new Float32Array(3 * 1024));
  col = new Buf(new Float32Array(3 * 1024));
  uv = new Buf(new Float32Array(2 * 1024));
  idx = new Buf(new Uint32Array(1536));
  /** Optional per-vertex tag (setKits recolours seats by it). */
  tag = new Buf(new Uint8Array(1024));
  /** Write UVs too (else none). */
  constructor(readonly withUv = false) {}

  get vertexCount() {
    return this.pos.length / 3;
  }

  /**
   * A planar quad a b c d (in order round its edge), facing `n` (any length).
   * `uvs`: per-corner uv (withUv only).
   */
  quad(
    a: V3,
    b: V3,
    c: V3,
    d: V3,
    n: V3,
    color: number,
    uvs?: readonly [number, number][],
    tag = 0,
  ) {
    const base = this.vertexCount;
    // winding: (b − a) × (c − a) should point along n
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const [r, g, bl] = linear(color);
    for (const p of [a, b, c, d]) {
      this.pos.push3(p[0], p[1], p[2]);
      this.nrm.push3(n[0] / l, n[1] / l, n[2] / l);
      this.col.push3(r, g, bl);
      this.tag.push1(tag);
    }
    if (this.withUv) {
      const u = uvs ?? [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      for (const q of u) this.uv.push2(q[0], q[1]);
    }
    if (flip) {
      this.idx.push3(base, base + 2, base + 1);
      this.idx.push3(base, base + 3, base + 2);
    } else {
      this.idx.push3(base, base + 1, base + 2);
      this.idx.push3(base, base + 2, base + 3);
    }
  }

  /** Axis-aligned box. `skip`: faces to leave out ('-y' bottom etc.). */
  box(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    color: number,
    skip = '',
    tag = 0,
  ) {
    const f = (k: string) => !skip.includes(k);
    if (f('+y'))
      this.quad(
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x0, y1, z1],
        [0, 1, 0],
        color,
        undefined,
        tag,
      );
    if (f('-y'))
      this.quad(
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
        [0, -1, 0],
        color,
        undefined,
        tag,
      );
    if (f('+x'))
      this.quad(
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1],
        [1, 0, 0],
        color,
        undefined,
        tag,
      );
    if (f('-x'))
      this.quad(
        [x0, y0, z0],
        [x0, y1, z0],
        [x0, y1, z1],
        [x0, y0, z1],
        [-1, 0, 0],
        color,
        undefined,
        tag,
      );
    if (f('+z'))
      this.quad(
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
        [0, 0, 1],
        color,
        undefined,
        tag,
      );
    if (f('-z'))
      this.quad(
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
        [0, 0, -1],
        color,
        undefined,
        tag,
      );
  }

  /** A square-section beam from p to q (`w` wide), e.g. a strut or a tie. */
  beam(p: V3, q: V3, w: number, color: number) {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const dz = q[2] - p[2];
    const L = Math.hypot(dx, dy, dz) || 1;
    const f = [dx / L, dy / L, dz / L];
    // any perpendicular
    const up = Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ax = up[1] * f[2] - up[2] * f[1];
    let ay = up[2] * f[0] - up[0] * f[2];
    let az = up[0] * f[1] - up[1] * f[0];
    const al = Math.hypot(ax, ay, az);
    ax /= al;
    ay /= al;
    az /= al;
    const bx = f[1] * az - f[2] * ay;
    const by = f[2] * ax - f[0] * az;
    const bz = f[0] * ay - f[1] * ax;
    const h = w / 2;
    const corner = (o: V3, sa: number, sb: number): V3 => [
      o[0] + (ax * sa + bx * sb) * h,
      o[1] + (ay * sa + by * sb) * h,
      o[2] + (az * sa + bz * sb) * h,
    ];
    const sides: [number, number][] = [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ];
    for (let i = 0; i < 4; i++) {
      const [sa, sb] = sides[i]!;
      const [ta, tb] = sides[(i + 1) % 4]!;
      const nx = (ax * (sa + ta) + bx * (sb + tb)) / 2;
      const ny = (ay * (sa + ta) + by * (sb + tb)) / 2;
      const nz = (az * (sa + ta) + bz * (sb + tb)) / 2;
      this.quad(
        corner(p, sa, sb),
        corner(p, ta, tb),
        corner(q, ta, tb),
        corner(q, sa, sb),
        [nx, ny, nz],
        color,
      );
    }
  }

  /** An n-sided upright-or-not cylinder (goal posts, flag poles), open ends. */
  cyl(p: V3, q: V3, r: number, color: number, sides = 8, caps = false) {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const dz = q[2] - p[2];
    const L = Math.hypot(dx, dy, dz) || 1;
    const f = [dx / L, dy / L, dz / L];
    const up = Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ax = up[1] * f[2] - up[2] * f[1];
    let ay = up[2] * f[0] - up[0] * f[2];
    let az = up[0] * f[1] - up[1] * f[0];
    const al = Math.hypot(ax, ay, az);
    ax /= al;
    ay /= al;
    az /= al;
    const bx = f[1] * az - f[2] * ay;
    const by = f[2] * ax - f[0] * az;
    const bz = f[0] * ay - f[1] * ax;
    const ring = (k: number): V3 => {
      const t = (k / sides) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      return [ax * c + bx * s, ay * c + by * s, az * c + bz * s];
    };
    for (let k = 0; k < sides; k++) {
      const u = ring(k);
      const v = ring(k + 1);
      const m = ring(k + 0.5);
      this.quad(
        [p[0] + u[0] * r, p[1] + u[1] * r, p[2] + u[2] * r],
        [p[0] + v[0] * r, p[1] + v[1] * r, p[2] + v[2] * r],
        [q[0] + v[0] * r, q[1] + v[1] * r, q[2] + v[2] * r],
        [q[0] + u[0] * r, q[1] + u[1] * r, q[2] + u[2] * r],
        m,
        color,
      );
    }
    if (caps) {
      // flat end over q (a cheap fan as quads)
      for (let k = 0; k < sides; k += 2) {
        const u = ring(k);
        const v = ring(k + 1);
        const w = ring(k + 2);
        this.quad(
          q,
          [q[0] + u[0] * r, q[1] + u[1] * r, q[2] + u[2] * r],
          [q[0] + v[0] * r, q[1] + v[1] * r, q[2] + v[2] * r],
          [q[0] + w[0] * r, q[1] + w[1] * r, q[2] + w[2] * r],
          f as unknown as V3,
          color,
        );
      }
    }
  }

  /** A BufferGeometry of everything written (indexed). */
  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.out(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.out(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.out(), 3));
    if (this.withUv) g.setAttribute('uv', new THREE.BufferAttribute(this.uv.out(), 2));
    const n = this.vertexCount;
    g.setIndex(
      n > 65535
        ? new THREE.BufferAttribute(this.idx.out(), 1)
        : new THREE.BufferAttribute(Uint16Array.from(this.idx.out()), 1),
    );
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
