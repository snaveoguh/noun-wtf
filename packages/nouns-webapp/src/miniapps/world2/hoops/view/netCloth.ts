// ── Basketball net: a little verlet cloth hanging off the rim ───────────
//
// A diamond lattice (rows × columns, every other row staggered half a
// cell), its top row pinned to the rim. The ball pushes the knots out of
// its way, so anything dropping through the rim swishes it for real; the
// `net` / `score` events add a flare on top (the sim's ball and the drawn
// net never quite agree). Drawn as camera-facing ribbons (high / medium)
// or 1 px lines (low). Works in the rim's own frame: origin at the rim
// centre, y up.

import * as THREE from 'three';

interface Link {
  a: number;
  b: number;
  rest: number;
}

const _cam = new THREE.Vector3();
const _d = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();

export class NetCloth {
  readonly object: THREE.Object3D;
  private n: number;
  private p: Float32Array;
  private q: Float32Array;
  private pin: Float32Array;
  private links: Link[] = [];
  private rows: number;
  private cols: number;
  private ribbons: boolean;
  private geo = new THREE.BufferGeometry();
  private posAttr: THREE.BufferAttribute;
  readonly mat: THREE.MeshBasicMaterial | THREE.LineBasicMaterial;
  private acc = 0;
  /** 0..1 orange burn tint (on-fire swishes). */
  burn = 0;

  constructor(
    readonly rimRadius: number,
    low: boolean,
  ) {
    this.rows = low ? 4 : 6;
    this.cols = low ? 10 : 14;
    this.ribbons = !low;
    const R = this.rows;
    const C = this.cols;
    this.n = R * C;
    this.p = new Float32Array(this.n * 3);
    this.q = new Float32Array(this.n * 3);
    this.pin = new Float32Array(C * 3);
    const depth = 0.44;
    for (let r = 0; r < R; r++) {
      const k = r / (R - 1);
      const rad = rimRadius * (1 - k) + 0.135 * k - 0.004;
      for (let c = 0; c < C; c++) {
        const a = ((c + (r % 2) * 0.5) / C) * Math.PI * 2;
        const i = (r * C + c) * 3;
        this.p[i] = Math.cos(a) * rad;
        this.p[i + 1] = -depth * k;
        this.p[i + 2] = Math.sin(a) * rad;
      }
    }
    for (let c = 0; c < C; c++) {
      this.pin[c * 3] = this.p[c * 3];
      this.pin[c * 3 + 1] = this.p[c * 3 + 1];
      this.pin[c * 3 + 2] = this.p[c * 3 + 2];
    }
    this.q.set(this.p);
    const link = (a: number, b: number) => {
      const dx = this.p[a * 3] - this.p[b * 3];
      const dy = this.p[a * 3 + 1] - this.p[b * 3 + 1];
      const dz = this.p[a * 3 + 2] - this.p[b * 3 + 2];
      this.links.push({ a, b, rest: Math.hypot(dx, dy, dz) });
    };
    for (let r = 0; r < R - 1; r++)
      for (let c = 0; c < C; c++) {
        const i = r * C + c;
        // Staggered rows: even rows link down to c and c−1, odd rows to c and c+1
        const c2 = r % 2 === 0 ? (c - 1 + C) % C : (c + 1) % C;
        link(i, (r + 1) * C + c);
        link(i, (r + 1) * C + c2);
      }
    // Bottom ring keeps the net's mouth round
    for (let c = 0; c < C; c++) link((R - 1) * C + c, (R - 1) * C + ((c + 1) % C));
    const segs = this.links.length;
    if (this.ribbons) {
      this.posAttr = new THREE.BufferAttribute(new Float32Array(segs * 4 * 3), 3);
      this.posAttr.setUsage(THREE.DynamicDrawUsage);
      const idx: number[] = [];
      for (let s = 0; s < segs; s++) {
        const o = s * 4;
        idx.push(o, o + 1, o + 2, o + 2, o + 1, o + 3);
      }
      this.geo.setIndex(idx);
      this.geo.setAttribute('position', this.posAttr);
      this.mat = new THREE.MeshBasicMaterial({ color: 0xf6f4ee, side: THREE.DoubleSide });
      this.object = new THREE.Mesh(this.geo, this.mat);
    } else {
      this.posAttr = new THREE.BufferAttribute(new Float32Array(segs * 2 * 3), 3);
      this.posAttr.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute('position', this.posAttr);
      this.mat = new THREE.LineBasicMaterial({ color: 0xf6f4ee });
      this.object = new THREE.LineSegments(this.geo, this.mat);
    }
    this.object.frustumCulled = false;
    this.object.name = 'HoopsNet';
    this.mat.userData.noToon = true;
  }

  /** Kick the lower rows: down (swish) + outward (flare). */
  impulse(down: number, out: number) {
    const C = this.cols;
    for (let r = 1; r < this.rows; r++) {
      const k = r / (this.rows - 1);
      for (let c = 0; c < C; c++) {
        const i = (r * C + c) * 3;
        const x = this.p[i];
        const z = this.p[i + 2];
        const l = Math.hypot(x, z) || 1;
        const j = 0.6 + Math.random() * 0.8;
        // Verlet: velocity lives in p − q
        this.q[i] -= (x / l) * out * k * j * 0.016;
        this.q[i + 2] -= (z / l) * out * k * j * 0.016;
        this.q[i + 1] += down * k * j * 0.016;
      }
    }
  }

  /**
   * Step the cloth. `ball` is the ball centre in rim space (or null), `rimOff`
   * the rim's current shake offset (rim space) the top row follows.
   */
  update(dt: number, ball: THREE.Vector3 | null, ballR: number, rimOff: THREE.Vector3) {
    this.acc = Math.min(this.acc + dt, 0.05);
    const h = 1 / 90;
    while (this.acc >= h) {
      this.acc -= h;
      this.step(h, ball, ballR, rimOff);
    }
    this.burn = Math.max(0, this.burn - dt * 0.5);
    (this.mat.color as THREE.Color).setRGB(0.965, 0.955 - this.burn * 0.5, 0.93 - this.burn * 0.85);
  }

  private step(h: number, ball: THREE.Vector3 | null, ballR: number, off: THREE.Vector3) {
    const { p, q, n } = this;
    const damp = 0.965;
    const g = -9.8 * 0.35 * h * h;
    for (let i = 0; i < n * 3; i += 3) {
      const vx = (p[i] - q[i]) * damp;
      const vy = (p[i + 1] - q[i + 1]) * damp;
      const vz = (p[i + 2] - q[i + 2]) * damp;
      q[i] = p[i];
      q[i + 1] = p[i + 1];
      q[i + 2] = p[i + 2];
      p[i] += vx;
      p[i + 1] += vy + g;
      p[i + 2] += vz;
    }
    for (let it = 0; it < 3; it++) {
      for (const l of this.links) {
        const a = l.a * 3;
        const b = l.b * 3;
        const dx = p[b] - p[a];
        const dy = p[b + 1] - p[a + 1];
        const dz = p[b + 2] - p[a + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        // Strings: only resist stretching
        if (d <= l.rest) continue;
        const f = ((d - l.rest) / d) * 0.5;
        p[a] += dx * f;
        p[a + 1] += dy * f;
        p[a + 2] += dz * f;
        p[b] -= dx * f;
        p[b + 1] -= dy * f;
        p[b + 2] -= dz * f;
      }
      // Pins: the top row rides the rim
      for (let c = 0; c < this.cols; c++) {
        const i = c * 3;
        p[i] = this.pin[i] + off.x;
        p[i + 1] = this.pin[i + 1] + off.y;
        p[i + 2] = this.pin[i + 2] + off.z;
      }
      if (ball !== null) {
        const rr = ballR + 0.012;
        for (let i = this.cols * 3; i < n * 3; i += 3) {
          const dx = p[i] - ball.x;
          const dy = p[i + 1] - ball.y;
          const dz = p[i + 2] - ball.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < rr * rr) {
            const d = Math.sqrt(d2) || 1e-6;
            const f = (rr - d) / d;
            p[i] += dx * f;
            p[i + 1] += dy * f;
            p[i + 2] += dz * f;
          }
        }
      }
    }
  }

  /** Rebuild the drawn strands; `camLocal` = camera position in rim space. */
  draw(camLocal: THREE.Vector3) {
    const a = this.posAttr.array as Float32Array;
    const { p } = this;
    if (!this.ribbons) {
      let o = 0;
      for (const l of this.links) {
        for (const k of [l.a, l.b]) {
          a[o++] = p[k * 3];
          a[o++] = p[k * 3 + 1];
          a[o++] = p[k * 3 + 2];
        }
      }
    } else {
      const w = 0.0075;
      _cam.copy(camLocal);
      let o = 0;
      for (const l of this.links) {
        const ai = l.a * 3;
        const bi = l.b * 3;
        _d.set(p[bi] - p[ai], p[bi + 1] - p[ai + 1], p[bi + 2] - p[ai + 2]);
        _v.set(p[ai] - _cam.x, p[ai + 1] - _cam.y, p[ai + 2] - _cam.z);
        _s.crossVectors(_d, _v);
        const sl = _s.length();
        if (sl > 1e-8) _s.multiplyScalar(w / sl);
        for (const [i, sg] of [
          [ai, 1],
          [ai, -1],
          [bi, 1],
          [bi, -1],
        ] as const) {
          a[o++] = p[i] + _s.x * sg;
          a[o++] = p[i + 1] + _s.y * sg;
          a[o++] = p[i + 2] + _s.z * sg;
        }
      }
    }
    this.posAttr.needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}
