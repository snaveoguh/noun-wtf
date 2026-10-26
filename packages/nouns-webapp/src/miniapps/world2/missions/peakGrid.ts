// ── The Big Drop's terrain meshes: camera-centred grids, built in slices ──
//
// A square grid whose rows/columns are dense at its centre and spread out
// geometrically to `edge` m, re-sampled around a new centre whenever it
// moves. peak.ts runs two: a fine NEAR grid (a few hundred metres, rebuilt
// every frame) and a coarse FAR one out to the fog (rebuilt a few rows a
// frame into a spare mesh, then swapped in), so a frame samples a third of
// the heights one big grid would. Under the near grid the far one sinks out
// of sight. Vertex data is relative to the mesh's own origin (float32-safe);
// the origin is kept in peak coordinates and placed in local space by the
// caller every frame.

import * as THREE from 'three';

/** Grid offsets for one axis: `s0` apart at the centre, geometric out to `edge`. */
export function gridOffsets(n: number, s0: number, edge: number): Float64Array {
  const k = (n - 1) / 2;
  // Solve (1+q)^k − 1 = edge·q / s0 for q (bisection; it's monotone)
  let lo = 1e-4;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const q = (lo + hi) / 2;
    if ((Math.pow(1 + q, k) - 1) * (s0 / q) > edge) hi = q;
    else lo = q;
  }
  const q = (lo + hi) / 2;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = i - k;
    out[i] = (Math.sign(j) * (s0 * (Math.pow(1 + q, Math.abs(j)) - 1))) / q;
  }
  return out;
}

export interface GridSampler {
  /** Surface height at (x, z), peak coordinates. */
  height(x: number, z: number): number;
  /** Vertex colour at (x, z), peak coordinates, given the normal's y. */
  color(x: number, z: number, ny: number, out: THREE.Color): void;
}

/** Sink the grid this far (m) inside a square of half-size `hole` round its centre. */
export interface GridHole {
  half: number;
  depth: number;
}

const _c = new THREE.Color();

export class GridMesh {
  readonly mesh: THREE.Mesh;
  readonly off: Float64Array;
  readonly n: number;
  /** Peak coordinates of the mesh origin (its centre, at the base height). */
  readonly at = new THREE.Vector3(Infinity, 0, 0);
  private hs: Float64Array;
  // An in-progress build: centre + base height (peak coordinates), next row, stage
  private bx = 0;
  private by = 0;
  private bz = 0;
  private row = 0;
  private stage: 'idle' | 'heights' | 'attrs' = 'idle';

  constructor(
    n: number,
    s0: number,
    edge: number,
    material: THREE.Material,
    private hole: GridHole | null = null,
  ) {
    this.n = n;
    this.off = gridOffsets(n, s0, edge);
    this.hs = new Float64Array(n * n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let o = 0;
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        idx[o++] = a;
        idx[o++] = a + n;
        idx[o++] = a + 1;
        idx[o++] = a + 1;
        idx[o++] = a + n;
        idx[o++] = a + n + 1;
      }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
  }

  get building() {
    return this.stage !== 'idle';
  }

  /** Start re-sampling round (cx, cz) with vertex heights relative to `base` (peak coordinates). */
  begin(cx: number, base: number, cz: number) {
    this.bx = cx;
    this.by = base;
    this.bz = cz;
    this.row = 0;
    this.stage = 'heights';
  }

  /**
   * Do up to `rows` rows of work (heights first, then positions, normals and
   * colours). Returns true when the build has finished (the mesh now shows
   * the new centre).
   */
  step(rows: number, s: GridSampler): boolean {
    const { n, off, hs } = this;
    if (this.stage === 'heights') {
      const end = Math.min(n, this.row + rows);
      const hole = this.hole;
      for (let j = this.row; j < end; j++) {
        const z = this.bz + off[j]!;
        const inZ = hole !== null && Math.abs(off[j]!) < hole.half;
        for (let i = 0; i < n; i++) {
          let h = s.height(this.bx + off[i]!, z);
          if (inZ && Math.abs(off[i]!) < hole!.half) h -= hole!.depth;
          hs[j * n + i] = h;
        }
      }
      this.row = end;
      if (end < n) return false;
      this.stage = 'attrs';
      this.row = 0;
      return false;
    }
    if (this.stage === 'attrs') {
      const geo = this.mesh.geometry;
      const P = (geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      const N = (geo.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array;
      const C = (geo.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
      const end = Math.min(n, this.row + rows * 2);
      for (let j = this.row; j < end; j++) {
        const j0 = j > 0 ? j - 1 : j;
        const j1 = j < n - 1 ? j + 1 : j;
        for (let i = 0; i < n; i++) {
          const i0 = i > 0 ? i - 1 : i;
          const i1 = i < n - 1 ? i + 1 : i;
          const v = j * n + i;
          const gx = (hs[j * n + i1]! - hs[j * n + i0]!) / (off[i1]! - off[i0]!);
          const gz = (hs[j1 * n + i]! - hs[j0 * n + i]!) / (off[j1]! - off[j0]!);
          const l = Math.hypot(gx, 1, gz);
          const ny = 1 / l;
          P[v * 3] = off[i]!;
          P[v * 3 + 1] = hs[v]! - this.by;
          P[v * 3 + 2] = off[j]!;
          N[v * 3] = -gx / l;
          N[v * 3 + 1] = ny;
          N[v * 3 + 2] = -gz / l;
          s.color(this.bx + off[i]!, this.bz + off[j]!, ny, _c);
          C[v * 3] = _c.r;
          C[v * 3 + 1] = _c.g;
          C[v * 3 + 2] = _c.b;
        }
      }
      this.row = end;
      if (end < n) return false;
      this.stage = 'idle';
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
      (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
      this.at.set(this.bx, this.by, this.bz);
      return true;
    }
    return true;
  }

  /** Build round (cx, cz) right now. */
  buildNow(cx: number, base: number, cz: number, s: GridSampler) {
    this.begin(cx, base, cz);
    while (!this.step(this.n, s));
  }

  dispose() {
    this.mesh.geometry.dispose();
  }
}
