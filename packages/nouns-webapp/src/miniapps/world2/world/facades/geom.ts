// ── Geometry accumulator for the facades (pure: plain arrays, no three) ──
//
// Everything is built in a wall's frame (s along the wall, d out from it,
// y up) and lands in world space as flat-shaded, vertex-coloured
// triangles. Faces are wound from their wanted normal, so nothing has to
// get corner order right by hand.

export type V3 = [number, number, number];
export type RGB = [number, number, number];

/** sRGB hex → linear RGB (three's vertex colours are linear). */
export function rgb(hex: number, k = 1): RGB {
  const c = (v: number) => {
    const s = v / 255;
    return (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)) * k;
  };
  return [c((hex >> 16) & 255), c((hex >> 8) & 255), c(hex & 255)];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scale(a: RGB, k: number): RGB {
  return [a[0] * k, a[1] * k, a[2] * k];
}

/** Affine lightmap mapping of a wall: uv1 = o + (s − s0)·ds + (y − y0)·dy. */
export interface LightmapMap {
  s0: number;
  y0: number;
  o: [number, number];
  ds: [number, number];
  dy: [number, number];
}

export class Geo {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  uv1: number[] = [];
  /** Write uv / uv1 for every vertex (skins); details leave them off. */
  constructor(
    readonly withUv = false,
    readonly withUv1 = false,
  ) {}

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  private vert(p: V3, n: V3, c: RGB, uv?: [number, number], uv1?: [number, number]) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2]);
    if (this.withUv) this.uv.push(uv?.[0] ?? 0, uv?.[1] ?? 0);
    if (this.withUv1) this.uv1.push(uv1?.[0] ?? 0, uv1?.[1] ?? 0);
  }

  /**
   * A planar quad a-b-c-d (in order round its edge) facing `n`. Optional
   * per-corner uvs / uv1s in the same order.
   */
  quad(
    a: V3,
    b: V3,
    c: V3,
    d: V3,
    n: V3,
    color: RGB,
    uvs?: [number, number][],
    uv1s?: [number, number][],
  ) {
    const e1x = b[0] - a[0];
    const e1y = b[1] - a[1];
    const e1z = b[2] - a[2];
    const e2x = c[0] - a[0];
    const e2y = c[1] - a[1];
    const e2z = c[2] - a[2];
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const P = flip ? [a, d, c, b] : [a, b, c, d];
    const U = uvs === undefined ? undefined : flip ? [uvs[0]!, uvs[3]!, uvs[2]!, uvs[1]!] : uvs;
    const U1 =
      uv1s === undefined ? undefined : flip ? [uv1s[0]!, uv1s[3]!, uv1s[2]!, uv1s[1]!] : uv1s;
    for (const i of [0, 1, 2, 0, 2, 3]) this.vert(P[i]!, n, color, U?.[i], U1?.[i]);
  }

  /** A triangle facing `n`. */
  tri(a: V3, b: V3, c: V3, n: V3, color: RGB) {
    const cx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    for (const p of flip ? [a, c, b] : [a, b, c]) this.vert(p, n, color);
  }

  /** World axis-aligned box. `skip` names faces left out ('-x', '+y', …). */
  box(min: V3, max: V3, color: RGB, skip: readonly string[] = []) {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6 || z1 - z0 < 1e-6) return;
    const top = color;
    const side = scale(color, 0.92);
    const bottom = scale(color, 0.8);
    if (!skip.includes('+x'))
      this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], side);
    if (!skip.includes('-x'))
      this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], side);
    if (!skip.includes('+z'))
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], color);
    if (!skip.includes('-z'))
      this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], color);
    if (!skip.includes('+y'))
      this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], top);
    if (!skip.includes('-y'))
      this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], bottom);
  }

  /** Vertical cylinder (flat-shaded, `sides` facets), optional caps. */
  cylinder(
    cx: number,
    cz: number,
    y0: number,
    y1: number,
    r: number,
    sides: number,
    color: RGB,
    caps: { top?: boolean; bottom?: boolean } = { top: true },
    r1 = r,
  ) {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const n: V3 = [Math.cos(am), (r - r1) / Math.max(1e-6, y1 - y0), Math.sin(am)];
      const l = Math.hypot(n[0], n[1], n[2]);
      n[0] /= l;
      n[1] /= l;
      n[2] /= l;
      const p00: V3 = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r];
      const p10: V3 = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
      const p11: V3 = [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1];
      const p01: V3 = [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1];
      if (r1 < 1e-4) this.tri(p00, p10, p11, n, scale(color, 0.92 + 0.08 * Math.cos(am)));
      else this.quad(p00, p10, p11, p01, n, scale(color, 0.92 + 0.08 * Math.cos(am)));
      if (caps.top === true && r1 > 1e-4) this.tri([cx, y1, cz], p01, p11, [0, 1, 0], color);
      if (caps.bottom === true) this.tri([cx, y0, cz], p10, p00, [0, -1, 0], scale(color, 0.8));
    }
  }

  /** A slab under a sloped top: 8 corners (bottom then top, each a-b-c-d round the edge). */
  prism(c: V3[], color: RGB) {
    const [b0, b1, b2, b3, t0, t1, t2, t3] = c as [V3, V3, V3, V3, V3, V3, V3, V3];
    const face = (a: V3, b: V3, cc: V3, d: V3, col: RGB) => {
      // Normal from the corners, pointing away from the prism's centre
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = d[0] - a[0];
      const vy = d[1] - a[1];
      const vz = d[2] - a[2];
      let n: V3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / l, n[1] / l, n[2] / l];
      let mx = 0;
      let my = 0;
      let mz = 0;
      for (const p of c) {
        mx += p[0] / 8;
        my += p[1] / 8;
        mz += p[2] / 8;
      }
      const fx = (a[0] + cc[0]) / 2 - mx;
      const fy = (a[1] + cc[1]) / 2 - my;
      const fz = (a[2] + cc[2]) / 2 - mz;
      if (n[0] * fx + n[1] * fy + n[2] * fz < 0) n = [-n[0], -n[1], -n[2]];
      this.quad(a, b, cc, d, n, col);
    };
    face(t0, t1, t2, t3, color);
    face(b0, b1, b2, b3, scale(color, 0.8));
    face(b0, b1, t1, t0, scale(color, 0.92));
    face(b1, b2, t2, t1, scale(color, 0.92));
    face(b2, b3, t3, t2, scale(color, 0.92));
    face(b3, b0, t0, t3, scale(color, 0.92));
  }

  append(o: Geo) {
    for (const v of o.pos) this.pos.push(v);
    for (const v of o.nrm) this.nrm.push(v);
    for (const v of o.col) this.col.push(v);
    if (this.withUv) for (const v of o.uv) this.uv.push(v);
    if (this.withUv1) for (const v of o.uv1) this.uv1.push(v);
  }
}

/** A wall's frame: (s, d, y) ↔ world. */
export class WallFrame {
  constructor(
    readonly nx: number,
    readonly nz: number,
    readonly at: number,
  ) {}

  /** World point. */
  p(s: number, d: number, y: number): V3 {
    return this.nz !== 0 ? [s, y, this.at + d * this.nz] : [this.at + d * this.nx, y, s];
  }

  /** World direction of +d. */
  get n(): V3 {
    return [this.nx, 0, this.nz];
  }

  /** World direction of +s. */
  get t(): V3 {
    return this.nz !== 0 ? [1, 0, 0] : [0, 0, 1];
  }

  /** A box given in the frame, as a world AABB. */
  box(g: Geo, s0: number, s1: number, d0: number, d1: number, y0: number, y1: number, c: RGB) {
    const a = this.p(Math.min(s0, s1), Math.min(d0, d1), y0);
    const b = this.p(Math.max(s0, s1), Math.max(d0, d1), y1);
    // Leave out the face pressed into the wall when the box starts inside it
    const back =
      d0 < 0 && d1 > 0
        ? [this.nz !== 0 ? (this.nz > 0 ? '-z' : '+z') : this.nx > 0 ? '-x' : '+x']
        : [];
    g.box(
      [Math.min(a[0], b[0]), y0, Math.min(a[2], b[2])],
      [Math.max(a[0], b[0]), y1, Math.max(a[2], b[2])],
      c,
      back,
    );
  }
}

/**
 * How many triangles of a soup lie parallel to a wall, within `eps` of the
 * plane `d` out from it (and, given `rect`, overlapping that stretch of it).
 */
export function facesNearPlane(
  pos: readonly number[],
  nrm: readonly number[],
  frame: { nx: number; nz: number; at: number },
  d: number,
  eps: number,
  rect?: { s0: number; s1: number; y0: number; y1: number },
): number {
  let hits = 0;
  for (let t = 0; t < pos.length / 9; t++) {
    const nx = nrm[t * 9]!;
    const nz = nrm[t * 9 + 2]!;
    // Parallel to the wall: normal along ±n
    if (Math.abs(nx * frame.nx + nz * frame.nz) < 0.999) continue;
    let ok = true;
    let s0 = Infinity;
    let s1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const x = pos[t * 9 + k * 3]!;
      const y = pos[t * 9 + k * 3 + 1]!;
      const z = pos[t * 9 + k * 3 + 2]!;
      const dd = frame.nz !== 0 ? (z - frame.at) * frame.nz : (x - frame.at) * frame.nx;
      if (Math.abs(dd - d) > eps) ok = false;
      const s = frame.nz !== 0 ? x : z;
      s0 = Math.min(s0, s);
      s1 = Math.max(s1, s);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    if (!ok) continue;
    if (
      rect !== undefined &&
      (s1 <= rect.s0 + 1e-4 || s0 >= rect.s1 - 1e-4 || y1 <= rect.y0 + 1e-4 || y0 >= rect.y1 - 1e-4)
    )
      continue;
    hits++;
  }
  return hits;
}
