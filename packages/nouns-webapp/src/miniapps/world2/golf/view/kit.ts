// ── Noun Golf view: a tiny mesh kit (pure, no three.js) ──────────────────
//
// Everything static on the course (buildings, poles, markers, benches, the
// range, signs) is boxes, cylinders and quads, coloured per vertex and
// merged per material into one MeshBuf, so a whole category is one draw.
// Pieces are placed in a local frame (setFrame: origin + yaw, the same
// heading convention as the course: yaw 0 = +Z, local x = right).
//
// Positions are relative to the buffer's `origin` (the course's centre),
// so kilometres out the GPU still only sees small numbers.

import type { Rgb } from '../course/colors';

import { hexLinear } from '../course/colors';

export type Colour = number | Rgb;

const cache = new Map<number, Rgb>();
export function rgb(c: Colour): Rgb {
  if (typeof c !== 'number') return c;
  let v = cache.get(c);
  if (v === undefined) cache.set(c, (v = hexLinear(c)));
  return v;
}

export interface MeshData {
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
  uv: Float32Array | null;
  idx: Uint32Array;
  /** Vertex count. */
  count: number;
}

export class MeshBuf {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  uv: number[] | null;
  idx: number[] = [];
  /** Frame: world origin of local (0, 0, 0) and its yaw. */
  private fx = 0;
  private fy = 0;
  private fz = 0;
  private c = 1;
  private s = 0;

  constructor(
    /** Positions are written relative to this world point. */
    readonly ox = 0,
    readonly oz = 0,
    withUv = false,
  ) {
    this.uv = withUv ? [] : null;
  }

  get count(): number {
    return this.pos.length / 3;
  }

  /** Local frame for the next pieces: origin (world) and heading. */
  setFrame(x: number, y: number, z: number, yaw = 0): this {
    this.fx = x;
    this.fy = y;
    this.fz = z;
    this.c = Math.cos(yaw);
    this.s = Math.sin(yaw);
    return this;
  }

  /** Local → buffer space (x right, z forward along the frame's yaw). */
  private px(lx: number, lz: number): number {
    return this.fx + lx * this.c + lz * this.s - this.ox;
  }

  private pz(lx: number, lz: number): number {
    return this.fz - lx * this.s + lz * this.c - this.oz;
  }

  /** Add a vertex in local coordinates (normal local too). */
  vert(lx: number, ly: number, lz: number, nx: number, ny: number, nz: number, col: Rgb, u = 0, v = 0) {
    this.pos.push(this.px(lx, lz), this.fy + ly, this.pz(lx, lz));
    this.nrm.push(nx * this.c + nz * this.s, ny, -nx * this.s + nz * this.c);
    this.col.push(col.r, col.g, col.b);
    this.uv?.push(u, v);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }

  /**
   * An axis-aligned (in the frame) box: centre (x, y, z), size (w, h, d),
   * turned `yaw` about its own centre. `bottom` false leaves the base off.
   */
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    colour: Colour,
    yaw = 0,
    bottom = false,
  ): this {
    const col = rgb(colour);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    // Faces: +x, −x, +y, −y, +z, −z (local to the box)
    const F: [number, number, number][] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    for (const [nx, ny, nz] of F) {
      if (ny === -1 && !bottom) continue;
      // Two tangents
      const [ux, uy, uz] = ny !== 0 ? [1, 0, 0] : [0, 1, 0];
      const vx = ny * uz - nz * uy;
      const vy = nz * ux - nx * uz;
      const vz = nx * uy - ny * ux;
      const base = this.count;
      for (const [a, b] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const bx = (nx + ux * a + vx * b) * hw;
        const by = (ny + uy * a + vy * b) * hh;
        const bz = (nz + uz * a + vz * b) * hd;
        this.vert(
          x + bx * c + bz * s,
          y + by,
          z - bx * s + bz * c,
          nx * c + nz * s,
          ny,
          -nx * s + nz * c,
          col,
        );
      }
      // Wind so the face points along n
      const p0 = this.local(base);
      const p1 = this.local(base + 1);
      const p2 = this.local(base + 2);
      const cx = (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]);
      const cy = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
      const cz = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
      const ni = base * 3;
      const dot = cx * this.nrm[ni] + cy * this.nrm[ni + 1] + cz * this.nrm[ni + 2];
      if (dot >= 0) {
        this.tri(base, base + 1, base + 2);
        this.tri(base, base + 2, base + 3);
      } else {
        this.tri(base, base + 2, base + 1);
        this.tri(base, base + 3, base + 2);
      }
    }
    return this;
  }

  private local(i: number): [number, number, number] {
    return [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]];
  }

  /** A vertical cylinder / cone frustum: base centre (x, y, z), radii, height. */
  cyl(
    x: number,
    y: number,
    z: number,
    rBot: number,
    rTop: number,
    h: number,
    sides: number,
    colour: Colour,
    cap = true,
  ): this {
    const col = rgb(colour);
    const slope = (rBot - rTop) / h;
    const ny = slope / Math.sqrt(1 + slope * slope);
    const nk = 1 / Math.sqrt(1 + slope * slope);
    const base = this.count;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      this.vert(x + ca * rBot, y, z + sa * rBot, ca * nk, ny, sa * nk, col);
      this.vert(x + ca * rTop, y + h, z + sa * rTop, ca * nk, ny, sa * nk, col);
    }
    for (let i = 0; i < sides; i++) {
      const a = base + i * 2;
      // Outward, CCW from outside
      this.tri(a, a + 1, a + 3);
      this.tri(a, a + 3, a + 2);
    }
    if (cap && rTop > 0.001) {
      const c0 = this.vert(x, y + h, z, 0, 1, 0, col);
      const r0 = this.count;
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        this.vert(x + Math.cos(a) * rTop, y + h, z + Math.sin(a) * rTop, 0, 1, 0, col);
      }
      for (let i = 0; i < sides; i++) this.tri(c0, r0 + i + 1, r0 + i);
    }
    return this;
  }

  /**
   * A flat quad facing the frame's local direction `yaw` (0 = +z): centre,
   * width, height; with UVs (u0, v0)–(u1, v1) when the buffer has them.
   */
  panel(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    yaw: number,
    colour: Colour,
    uvs: [number, number, number, number] = [0, 0, 1, 1],
  ): this {
    const col = rgb(colour);
    const nx = Math.sin(yaw);
    const nz = Math.cos(yaw);
    // Right (seen from the front) = (nz, −nx)
    const rx = nz;
    const rz = -nx;
    const hw = w / 2;
    const hh = h / 2;
    const [u0, v0, u1, v1] = uvs;
    const a = this.vert(x - rx * hw, y - hh, z - rz * hw, nx, 0, nz, col, u0, v0);
    const b = this.vert(x + rx * hw, y - hh, z + rz * hw, nx, 0, nz, col, u1, v0);
    const c = this.vert(x + rx * hw, y + hh, z + rz * hw, nx, 0, nz, col, u1, v1);
    const d = this.vert(x - rx * hw, y + hh, z - rz * hw, nx, 0, nz, col, u0, v1);
    this.tri(a, b, c);
    this.tri(a, c, d);
    return this;
  }

  /** A flat ring / disc on the ground (y up), inner radius 0 = a disc. */
  ring(x: number, y: number, z: number, r0: number, r1: number, sides: number, colour: Colour): this {
    const col = rgb(colour);
    const base = this.count;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      this.vert(x + ca * r0, y, z + sa * r0, 0, 1, 0, col);
      this.vert(x + ca * r1, y, z + sa * r1, 0, 1, 0, col);
    }
    for (let i = 0; i < sides; i++) {
      const a = base + i * 2;
      this.tri(a, a + 3, a + 1);
      this.tri(a, a + 2, a + 3);
    }
    return this;
  }

  /**
   * A gable roof: a triangular prism, ridge along local x at height h over
   * its base (y), width w (along x) and depth d (along z), eaves included.
   */
  gable(x: number, y: number, z: number, w: number, d: number, h: number, colour: Colour, ends: Colour = colour): this {
    const col = rgb(colour);
    const ce = rgb(ends);
    const hw = w / 2;
    const hd = d / 2;
    const L = Math.hypot(hd, h);
    const ny = hd / L;
    const nz = h / L;
    for (const sz of [1, -1]) {
      const a = this.vert(x - hw, y, z + sz * hd, 0, ny, sz * nz, col);
      const b = this.vert(x + hw, y, z + sz * hd, 0, ny, sz * nz, col);
      const c = this.vert(x + hw, y + h, z, 0, ny, sz * nz, col);
      const e = this.vert(x - hw, y + h, z, 0, ny, sz * nz, col);
      if (sz > 0) {
        this.tri(a, b, c);
        this.tri(a, c, e);
      } else {
        this.tri(a, c, b);
        this.tri(a, e, c);
      }
    }
    for (const sx of [1, -1]) {
      const a = this.vert(x + sx * hw, y, z - hd, sx, 0, 0, ce);
      const b = this.vert(x + sx * hw, y, z + hd, sx, 0, 0, ce);
      const c = this.vert(x + sx * hw, y + h, z, sx, 0, 0, ce);
      if (sx > 0) this.tri(a, c, b);
      else this.tri(a, b, c);
    }
    return this;
  }

  /** Append another buffer's data (same origin assumed). */
  append(o: MeshData) {
    const base = this.count;
    for (let i = 0; i < o.count * 3; i++) {
      this.pos.push(o.pos[i]);
      this.nrm.push(o.nrm[i]);
      this.col.push(o.col[i]);
    }
    if (this.uv !== null) for (let i = 0; i < o.count * 2; i++) this.uv.push(o.uv?.[i] ?? 0);
    for (let i = 0; i < o.idx.length; i++) this.idx.push(o.idx[i] + base);
  }

  data(): MeshData {
    return {
      pos: Float32Array.from(this.pos),
      nrm: Float32Array.from(this.nrm),
      col: Float32Array.from(this.col),
      uv: this.uv !== null ? Float32Array.from(this.uv) : null,
      idx: Uint32Array.from(this.idx),
      count: this.count,
    };
  }
}

/** A solid box for the collider (world space, position-only triangles). */
export interface ColliderBox {
  x: number;
  y: number;
  z: number;
  /** Half sizes along the frame's local x / z, and height from y. */
  hw: number;
  hl: number;
  h: number;
  yaw: number;
}

/** Collider boxes → non-indexed triangle positions relative to (ox, oz). */
export function colliderTriangles(boxes: ColliderBox[], ox: number, oz: number): Float32Array {
  const out = new Float32Array(boxes.length * 36 * 3);
  let o = 0;
  const corner = (b: ColliderBox, sx: number, sy: number, sz: number) => {
    const c = Math.cos(b.yaw);
    const s = Math.sin(b.yaw);
    const lx = sx * b.hw;
    const lz = sz * b.hl;
    return [b.x + lx * c + lz * s - ox, b.y + (sy > 0 ? b.h : 0), b.z - lx * s + lz * c - oz];
  };
  const quads = [
    [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1],
    [-1, -1, 1, -1, 1, 1, 1, 1, 1, 1, -1, 1],
    [-1, -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1],
    [1, -1, -1, 1, -1, 1, 1, 1, 1, 1, 1, -1],
    [-1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1],
    [-1, -1, -1, -1, -1, 1, 1, -1, 1, 1, -1, -1],
  ];
  for (const b of boxes)
    for (const q of quads) {
      const p = [0, 1, 2, 3].map(i => corner(b, q[i * 3], q[i * 3 + 1], q[i * 3 + 2]));
      for (const i of [0, 1, 2, 0, 2, 3]) {
        out[o++] = p[i][0];
        out[o++] = p[i][1];
        out[o++] = p[i][2];
      }
    }
  return out;
}
