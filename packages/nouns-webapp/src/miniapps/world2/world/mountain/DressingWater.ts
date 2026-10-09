// ── Mountain dressing: streams, ponds, bridges / fords ──────────────────
//
// Streams are global features, not per-chunk ones, so they run seamlessly
// across chunk borders:
//
//  • The world is split into SRC_CELL source cells. Each cell (by hash) may
//    hold a spring and/or a standalone pond. A spring's stream is traced
//    downhill once, cached by cell, and is a pure function of (cell, seed,
//    terrain), so any chunk that asks gets the identical polyline.
//  • Tracing follows −∇height (valleys / flow lines) with a little momentum
//    and meander. Near a dirt track it is pushed away (it would otherwise
//    pour into the track's trench), so creeks run alongside the lines. Only
//    when the track bends into it anyway does it cross, straight across and
//    roughly perpendicular, as a wooden bridge or a flat ford.
//  • A stream ending in a closed hollow fills it as a pond; a few standalone
//    ponds sit in other hollows. Pond water is a flat disc at a level that
//    the basin rim is verified to contain, so the terrain clips its shoreline.
//
// Chunks draw the ribbon segments whose start sample lies inside them (each
// segment belongs to exactly one chunk; shared end samples give identical
// vertices on both sides of a border), plus the ponds / crossings centred in
// them. All water in a chunk is one merged mesh with one material.

import * as THREE from 'three';

import { getToonRamp } from '../../render/Toon';

import { Rand, hash3i, smoothstep, vnoise, type TerrainQuery } from './dressingUtil';

const SRC_CELL = 192;
const STEP = 5;
const MAX_STEPS = 100;
/** A stream can't reach further than this from its spring cell. */
const MAX_REACH = MAX_STEPS * STEP + SRC_CELL;
const SAMPLE = 2;

export interface StreamSample {
  x: number;
  z: number;
  /** Unit tangent (flow direction). */
  tx: number;
  tz: number;
  /** Half-width of the water (m). */
  hw: number;
  /** Arc length from the spring. */
  s: number;
  /** Index into Stream.crossings while inside a crossing zone, else −1. */
  cross: number;
}

export interface Pond {
  x: number;
  z: number;
  /** Disc radius (the rim is verified to stand above `level` here). */
  r: number;
  level: number;
}

export interface Crossing {
  /** Where the stream meets the track centre line. */
  x: number;
  z: number;
  /** Track direction (unit) and stream direction across it. */
  tx: number;
  tz: number;
  sx: number;
  sz: number;
  /** Half-width of the water at the crossing. */
  hw: number;
  kind: 'bridge' | 'ford';
}

export interface Stream {
  id: number;
  samples: StreamSample[];
  crossings: Crossing[];
  pond: Pond | null;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

interface CellFeatures {
  stream: Stream | null;
  pond: Pond | null;
}

export interface WaterQuery {
  streams: Stream[];
  ponds: Pond[];
}

export class StreamNetwork {
  private cells = new Map<number, CellFeatures>();
  /** Hand-placed springs (set pieces / the dev demo), traced on add. */
  private extra: Stream[] = [];
  /** Total ms spent tracing (stats). */
  traceMs = 0;
  traced = 0;
  /** Track clearance the creeks keep (m from the centre line). */
  readonly clear: number;
  private forced: number;

  constructor(
    private t: TerrainQuery,
    private seed: number,
    private trackHalf: number,
  ) {
    this.clear = trackHalf + 11;
    this.forced = trackHalf + 3.5;
  }

  /** Add a hand-placed spring (deterministic: traced like any other). */
  addSpring(x: number, z: number) {
    const s = this.trace(x, z, (Math.floor(x) * 31 + Math.floor(z) * 17) | 0);
    if (s !== null) this.extra.push(s);
    return s;
  }

  /** Streams + ponds whose bounds come within `margin` of the rectangle. */
  query(x0: number, z0: number, x1: number, z1: number, margin: number): WaterQuery {
    const out: WaterQuery = { streams: [], ponds: [] };
    for (const s of this.extra) {
      if (
        s.maxX < x0 - margin ||
        s.minX > x1 + margin ||
        s.maxZ < z0 - margin ||
        s.minZ > z1 + margin
      )
        continue;
      out.streams.push(s);
      if (s.pond !== null) out.ponds.push(s.pond);
    }
    const c0x = Math.floor((x0 - MAX_REACH) / SRC_CELL);
    const c1x = Math.floor((x1 + MAX_REACH) / SRC_CELL);
    const c0z = Math.floor((z0 - MAX_REACH) / SRC_CELL);
    const c1z = Math.floor((z1 + MAX_REACH) / SRC_CELL);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const f = this.cell(cx, cz);
        const s = f.stream;
        if (
          s !== null &&
          s.maxX >= x0 - margin &&
          s.minX <= x1 + margin &&
          s.maxZ >= z0 - margin &&
          s.minZ <= z1 + margin
        ) {
          out.streams.push(s);
          if (s.pond !== null) out.ponds.push(s.pond);
        }
        const p = f.pond;
        if (
          p !== null &&
          p.x + p.r >= x0 - margin &&
          p.x - p.r <= x1 + margin &&
          p.z + p.r >= z0 - margin &&
          p.z - p.r <= z1 + margin
        )
          out.ponds.push(p);
      }
    }
    return out;
  }

  private cell(cx: number, cz: number): CellFeatures {
    const key = (cx + 32768) * 65536 + (cz + 32768);
    let f = this.cells.get(key);
    if (f !== undefined) return f;
    if (this.cells.size > 6000) this.cells.clear(); // deterministic: just recompute later
    const t0 = performance.now();
    f = { stream: null, pond: null };
    const sd = this.seed;
    if (hash3i(cx, cz, 1, sd) < 0.55) {
      const x = (cx + 0.15 + 0.7 * hash3i(cx, cz, 2, sd)) * SRC_CELL;
      const z = (cz + 0.15 + 0.7 * hash3i(cx, cz, 3, sd)) * SRC_CELL;
      f.stream = this.trace(x, z, cx * 7919 + cz * 104729);
    }
    if (hash3i(cx, cz, 4, sd) < 0.35) {
      const x = (cx + 0.1 + 0.8 * hash3i(cx, cz, 5, sd)) * SRC_CELL;
      const z = (cz + 0.1 + 0.8 * hash3i(cx, cz, 6, sd)) * SRC_CELL;
      if (this.ok(x, z, this.clear)) {
        const m = this.descend(x, z, 12);
        f.pond = m !== null ? this.pondAt(m.x, m.z, hash3i(cx, cz, 8, sd)) : null;
      }
    }
    this.cells.set(key, f);
    this.traceMs += performance.now() - t0;
    this.traced++;
    return f;
  }

  private ok(x: number, z: number, clear: number) {
    if (this.t.blocked?.(x, z) === true) return false;
    return this.t.trackDist(x, z) > clear;
  }

  /** Gradient descent into the nearest hollow; null if it runs off or onto a track. */
  private descend(x: number, z: number, steps: number): { x: number; z: number } | null {
    const H = (a: number, b: number) => this.t.height(a, b);
    for (let i = 0; i < steps; i++) {
      const h = H(x, z);
      const gx = (H(x + 1, z) - H(x - 1, z)) / 2;
      const gz = (H(x, z + 1) - H(x, z - 1)) / 2;
      const g = Math.hypot(gx, gz);
      if (g < 0.01) return { x, z };
      const st = Math.min(3, g * 12);
      const nx = x - (gx / g) * st;
      const nz = z - (gz / g) * st;
      if (H(nx, nz) >= h) return { x, z };
      x = nx;
      z = nz;
      if (!this.ok(x, z, this.clear)) return null;
    }
    return { x, z };
  }

  /**
   * Pond (a level tarn) centred at (x, z), or null. The water sits a little
   * above the centre's ground: where the terrain rises above it (uphill /
   * real hollow rims) the ground clips a natural shoreline; on the downhill
   * side an earthen berm (built with the water mesh) holds it in. Rejected
   * when that berm would be too tall, or near a track.
   */
  private pondAt(x: number, z: number, h01: number): Pond | null {
    const H = (a: number, b: number) => this.t.height(a, b);
    const h0 = H(x, z);
    const N = 16;
    for (let r = 4.5 + h01 * 5; r >= 3.5; r *= 0.72) {
      if (!this.ok(x, z, this.trackHalf + r + 10)) continue;
      let min = Infinity;
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2;
        min = Math.min(min, H(x + Math.cos(a) * r, z + Math.sin(a) * r));
      }
      const level = Math.min(h0 + 0.3, Math.max(h0, min) + 0.3);
      if (level - min < 1.4) return { x, z, r, level };
    }
    return null;
  }

  /** Trace a stream downhill from a spring. */
  private trace(sx: number, sz: number, id: number): Stream | null {
    const t = this.t;
    if (!this.ok(sx, sz, this.clear + 4)) return null;
    const H = (a: number, b: number) => t.height(a, b);
    const T = (a: number, b: number) => t.trackDist(a, b);
    const rnd = new Rand(id ^ this.seed);
    const steps = 36 + Math.floor(rnd.next() * (MAX_STEPS - 36));
    const xs = [sx];
    const zs = [sz];
    const zone: number[] = [-1];
    const crossings: Crossing[] = [];
    let x = sx;
    let z = sz;
    let hx = 0;
    let hz = 0;
    let hug = 0;
    let endPond = false;
    let s = 0;
    const E = 1.5;
    let hNext = NaN;
    for (let i = 0; i < steps; i++) {
      // Forward differences + the previous step's look-ahead height: 3 evals/step
      const h0 = Number.isNaN(hNext) ? H(x, z) : hNext;
      const gx = (H(x + E, z) - h0) / E;
      const gz = (H(x, z + E) - h0) / E;
      const gl = Math.hypot(gx, gz);
      if (gl < 0.006) {
        endPond = true;
        break;
      }
      let dx = -gx / gl;
      let dz = -gz / gl;
      // Meander a little (smooth along the path)
      const wob = vnoise(s / 55, id * 0.37, this.seed + 91) * 0.45;
      const c = Math.cos(wob);
      const sn = Math.sin(wob);
      [dx, dz] = [dx * c - dz * sn, dx * sn + dz * c];
      // Keep off the dirt track
      const d = T(x, z);
      if (d < this.clear) {
        let tgx = (T(x + E, z) - T(x - E, z)) / (2 * E);
        let tgz = (T(x, z + E) - T(x, z - E)) / (2 * E);
        const tl = Math.hypot(tgx, tgz) || 1;
        tgx /= tl;
        tgz /= tl;
        if (d < this.forced) {
          // Squeezed onto the track anyway: cross it, straight over
          const cr = this.cross(x, z, -tgx, -tgz, s, crossings, xs, zs, zone);
          if (cr === null) break;
          x = cr.x;
          z = cr.z;
          s = cr.s;
          hx = -tgx;
          hz = -tgz;
          hug = 0;
          hNext = NaN;
          continue;
        }
        const w = 1 - smoothstep(this.forced, this.clear, d);
        const dot = dx * tgx + dz * tgz;
        if (dot < 0) {
          dx -= tgx * dot * (0.5 + 0.5 * w);
          dz -= tgz * dot * (0.5 + 0.5 * w);
        }
        dx += tgx * w * 0.9;
        dz += tgz * w * 0.9;
        hug++;
      } else hug = Math.max(0, hug - 2);
      if (hug > 16 && crossings.length < 2) {
        // Long run beside the line: hop over to the other side (creeks wander)
        let tgx = (T(x + E, z) - T(x - E, z)) / (2 * E);
        let tgz = (T(x, z + E) - T(x, z - E)) / (2 * E);
        const tl = Math.hypot(tgx, tgz) || 1;
        tgx /= tl;
        tgz /= tl;
        const cr = this.cross(x, z, -tgx, -tgz, s, crossings, xs, zs, zone);
        if (cr === null) break;
        x = cr.x;
        z = cr.z;
        s = cr.s;
        hx = -tgx;
        hz = -tgz;
        hug = 0;
        hNext = NaN;
        continue;
      }
      if (hug > 36) break; // stuck hugging a line: let it seep away
      if (i > 0) {
        dx = hx * 0.55 + dx * 0.45;
        dz = hz * 0.55 + dz * 0.45;
      }
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl;
      dz /= dl;
      const nx = x + dx * STEP;
      const nz = z + dz * STEP;
      if (t.blocked?.(nx, nz) === true) break;
      hNext = H(nx, nz);
      if (hNext > h0 + 0.03) {
        endPond = true;
        break;
      }
      hx = dx;
      hz = dz;
      x = nx;
      z = nz;
      s += STEP;
      xs.push(x);
      zs.push(z);
      zone.push(-1);
    }
    if (xs.length < 6) return null;
    const ph = rnd.next();
    const pond = endPond || ph < 0.5 ? this.pondAt(x, z, ph) : null;
    return this.finish(id, xs, zs, zone, crossings, pond, rnd);
  }

  /** March straight across the track; records the crossing. Null if it can't get across. */
  private cross(
    x: number,
    z: number,
    cx: number,
    cz: number,
    s: number,
    crossings: Crossing[],
    xs: number[],
    zs: number[],
    zone: number[],
  ): { x: number; z: number; s: number } | null {
    const T = (a: number, b: number) => this.t.trackDist(a, b);
    let best = Infinity;
    let bx = x;
    let bz = z;
    let passed = false;
    const px: number[] = [];
    const pz: number[] = [];
    let ex = x;
    let ez = z;
    for (let k = 1; k <= 26; k++) {
      ex = x + cx * k * 2;
      ez = z + cz * k * 2;
      if (this.t.blocked?.(ex, ez) === true) return null;
      const d = T(ex, ez);
      px.push(ex);
      pz.push(ez);
      if (d < best) {
        best = d;
        bx = ex;
        bz = ez;
      } else if (best < this.trackHalf) passed = true;
      if (passed && d > this.forced + 1.5) break;
    }
    if (!passed || T(ex, ez) <= this.forced + 1.5) return null;
    if (this.t.height(ex, ez) > this.t.height(x, z) + 1.2) return null;
    const ci = crossings.length;
    crossings.push({ x: bx, z: bz, tx: -cz, tz: cx, sx: cx, sz: cz, hw: 0, kind: 'ford' });
    for (let k = 0; k < px.length; k++) {
      xs.push(px[k]);
      zs.push(pz[k]);
      zone.push(ci);
    }
    return { x: ex, z: ez, s: s + px.length * 2 };
  }

  /** Resample to SAMPLE m, smooth (crossings pinned straight), widths + tangents. */
  private finish(
    id: number,
    xs: number[],
    zs: number[],
    zone: number[],
    crossings: Crossing[],
    pond: Pond | null,
    rnd: Rand,
  ): Stream {
    // Arc-length resample
    const rx: number[] = [xs[0]];
    const rz: number[] = [zs[0]];
    const rzone: number[] = [zone[0]];
    let carry = 0;
    for (let i = 1; i < xs.length; i++) {
      const ax = xs[i - 1];
      const az = zs[i - 1];
      const L = Math.hypot(xs[i] - ax, zs[i] - az);
      let u = SAMPLE - carry;
      while (u <= L) {
        const f = u / L;
        rx.push(ax + (xs[i] - ax) * f);
        rz.push(az + (zs[i] - az) * f);
        rzone.push(zone[i] >= 0 && zone[i - 1] >= 0 ? zone[i] : -1);
        u += SAMPLE;
      }
      carry = L - (u - SAMPLE);
    }
    // Smooth (Laplacian), endpoints + crossing zones pinned
    const n = rx.length;
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 1; i < n - 1; i++) {
        if (rzone[i] >= 0) continue;
        rx[i] = rx[i] * 0.5 + (rx[i - 1] + rx[i + 1]) * 0.25;
        rz[i] = rz[i] * 0.5 + (rz[i - 1] + rz[i + 1]) * 0.25;
      }
    }
    const base = 0.55 + rnd.next() * 0.4;
    const samples: StreamSample[] = [];
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    const total = (n - 1) * SAMPLE;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      let tx = rx[b] - rx[a];
      let tz = rz[b] - rz[a];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const s = i * SAMPLE;
      // Spring trickle → widening creek; tapers out at a dry end, flares into a pond
      let hw = base * Math.min(2.4, 1 + s / 260) * smoothstep(0, 16, s);
      hw *=
        pond !== null
          ? 1 + smoothstep(total - 10, total, s) * 0.6
          : 0.25 + 0.75 * smoothstep(total, total - 18, s);
      hw = Math.max(0.12, hw);
      const cross = rzone[i];
      if (cross >= 0) crossings[cross].hw = Math.max(crossings[cross].hw, hw);
      samples.push({ x: rx[i], z: rz[i], tx, tz, hw, s, cross });
      minX = Math.min(minX, rx[i]);
      minZ = Math.min(minZ, rz[i]);
      maxX = Math.max(maxX, rx[i]);
      maxZ = Math.max(maxZ, rz[i]);
    }
    // Real creeks get a bridge; trickles a flat ford (with a little variety)
    for (const c of crossings) {
      const h = hash3i(Math.floor(c.x), Math.floor(c.z), 7, this.seed);
      c.kind = c.hw > 0.9 ? (h < 0.85 ? 'bridge' : 'ford') : h < 0.3 ? 'bridge' : 'ford';
    }
    const pad = 6 + (pond?.r ?? 0);
    return {
      id,
      samples,
      crossings,
      pond,
      minX: minX - pad,
      minZ: minZ - pad,
      maxX: maxX + pad,
      maxZ: maxZ + pad,
    };
  }
}

// ── Water-distance field for one chunk (foliage keeps off / clusters near) ──

export class WaterField {
  private buckets = new Map<number, number[]>();
  private sx: number[] = [];
  private sz: number[] = [];
  private shw: number[] = [];
  private ponds: Pond[];
  private static B = 16;

  constructor(q: WaterQuery, x0: number, z0: number, x1: number, z1: number, margin: number) {
    this.ponds = q.ponds;
    const B = WaterField.B;
    for (const st of q.streams) {
      for (const p of st.samples) {
        if (p.x < x0 - margin || p.x > x1 + margin || p.z < z0 - margin || p.z > z1 + margin)
          continue;
        const i = this.sx.length;
        this.sx.push(p.x);
        this.sz.push(p.z);
        this.shw.push(p.hw);
        const key = Math.floor(p.x / B) * 100003 + Math.floor(p.z / B);
        let l = this.buckets.get(key);
        if (l === undefined) this.buckets.set(key, (l = []));
        l.push(i);
      }
    }
  }

  get empty() {
    return this.sx.length === 0 && this.ponds.length === 0;
  }

  /**
   * Distance (m) from (x, z) to the nearest water edge, ≤ 16 m resolution
   * (returns 16 when nothing is that close). Negative inside the water.
   */
  dist(x: number, z: number): number {
    let best = 16;
    const B = WaterField.B;
    const bx = Math.floor(x / B);
    const bz = Math.floor(z / B);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const l = this.buckets.get((bx + i) * 100003 + bz + j);
        if (l === undefined) continue;
        for (const k of l) {
          const d = Math.hypot(this.sx[k] - x, this.sz[k] - z) - this.shw[k];
          if (d < best) best = d;
        }
      }
    }
    for (const p of this.ponds) {
      const d = Math.hypot(p.x - x, p.z - z) - p.r * 0.85;
      if (d < best) best = d;
    }
    return best;
  }
}

// ── Geometry ────────────────────────────────────────────────────────────

const C_BANK = new THREE.Color(0x6e5636);
const C_BANK_OUT = new THREE.Color(0x5c8f3a);
const C_EDGE = new THREE.Color(0x52d6ff);
const C_DEEP = new THREE.Color(0x1f86f0);
const C_FORD = new THREE.Color(0x8fe6ff);
const C_POND_DEEP = new THREE.Color(0x1673e0);

class WaterBuilder {
  pos: number[] = [];
  col: number[] = [];
  wat: number[] = [];
  idx: number[] = [];

  vert(x: number, y: number, z: number, c: THREE.Color, fx: number, fz: number, wet: number) {
    this.pos.push(x, y, z);
    this.col.push(c.r, c.g, c.b);
    this.wat.push(fx, fz, wet);
    return this.pos.length / 3 - 1;
  }

  /** Quad strip between two rows of vertex ids. */
  strip(a: number[], b: number[]) {
    for (let k = 0; k < a.length - 1; k++) {
      // CCW seen from above (rows run left → right across the flow)
      this.idx.push(a[k], a[k + 1], b[k], a[k + 1], b[k + 1], b[k]);
    }
  }

  build(): THREE.BufferGeometry | null {
    if (this.idx.length === 0) return null;
    const g = new THREE.BufferGeometry();
    const n = this.pos.length / 3;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    const nrm = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) nrm[i * 3 + 1] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aWater', new THREE.Float32BufferAttribute(this.wat, 3));
    g.setIndex(
      n > 65535
        ? new THREE.Uint32BufferAttribute(this.idx, 1)
        : new THREE.Uint16BufferAttribute(this.idx, 1),
    );
    g.computeBoundingSphere();
    return g;
  }
}

const _c = new THREE.Color();

/**
 * Water ribbons (owned segments), ponds (owned centres) and the stats for
 * one chunk. Chunk-local coordinates (origin subtracted).
 */
export function buildWaterGeometry(
  q: WaterQuery,
  t: TerrainQuery,
  x0: number,
  z0: number,
  size: number,
): { geometry: THREE.BufferGeometry | null; crossings: Crossing[]; samples: number } {
  const wb = new WaterBuilder();
  const x1 = x0 + size;
  const z1 = z0 + size;
  const inside = (x: number, z: number) => x >= x0 && x < x1 && z >= z0 && z < z1;
  const crossings: Crossing[] = [];
  let samples = 0;
  for (const st of q.streams) {
    for (const c of st.crossings) if (inside(c.x, c.z)) crossings.push(c);
    const S = st.samples;
    let i = 0;
    while (i < S.length - 1) {
      if (!inside(S[i].x, S[i].z)) {
        i++;
        continue;
      }
      // Run of owned segments [a, b): vertices for samples a..b
      const a = i;
      while (i < S.length - 1 && inside(S[i].x, S[i].z)) i++;
      const b = i;
      let prev: number[] | null = null;
      for (let k = a; k <= b; k++) {
        const p = S[k];
        const cr = p.cross >= 0 ? st.crossings[p.cross] : null;
        const bridge = cr !== null && cr.kind === 'bridge';
        const ford = cr !== null && cr.kind === 'ford';
        const nx = -p.tz;
        const nz = p.tx;
        const hw = ford ? p.hw * 1.35 : p.hw;
        const bank = bridge || ford ? 0.25 : 0.5 + hw * 0.3;
        const off = [-(hw + bank), -hw, -hw * 0.4, hw * 0.4, hw, hw + bank];
        const hs = off.map(o => t.height(p.x + nx * o, p.z + nz * o));
        const lx = p.x - x0;
        const lz = p.z - z0;
        const flow = Math.min(1.6, 0.35 + p.hw * 0.25) * (ford ? 0.6 : 1);
        const fx = p.tx * flow;
        const fz = p.tz * flow;
        const yw = bridge ? 0.03 : ford ? 0.05 : 0.07;
        const yl = bridge || ford ? yw : 0.13;
        const ids: number[] = [];
        // left bank (outer → lip)
        ids.push(wb.vert(lx + nx * off[0], hs[0] + 0.025, lz + nz * off[0], C_BANK_OUT, 0, 0, 0));
        ids.push(wb.vert(lx + nx * off[1], hs[1] + yl, lz + nz * off[1], C_BANK, 0, 0, 0));
        // water
        const edge = ford ? C_FORD : C_EDGE;
        const deep = ford
          ? _c.copy(C_FORD).lerp(C_DEEP, 0.35)
          : _c.copy(C_EDGE).lerp(C_DEEP, Math.min(1, 0.45 + p.hw * 0.3));
        ids.push(wb.vert(lx + nx * off[1], hs[1] + yw, lz + nz * off[1], edge, fx, fz, 1));
        ids.push(wb.vert(lx + nx * off[2], hs[2] + yw, lz + nz * off[2], deep, fx, fz, 1));
        ids.push(wb.vert(lx + nx * off[3], hs[3] + yw, lz + nz * off[3], deep, fx, fz, 1));
        ids.push(wb.vert(lx + nx * off[4], hs[4] + yw, lz + nz * off[4], edge, fx, fz, 1));
        // right bank (lip → outer)
        ids.push(wb.vert(lx + nx * off[4], hs[4] + yl, lz + nz * off[4], C_BANK, 0, 0, 0));
        ids.push(wb.vert(lx + nx * off[5], hs[5] + 0.025, lz + nz * off[5], C_BANK_OUT, 0, 0, 0));
        if (prev !== null) {
          wb.strip(prev.slice(0, 2), ids.slice(0, 2));
          wb.strip(prev.slice(2, 6), ids.slice(2, 6));
          wb.strip(prev.slice(6, 8), ids.slice(6, 8));
        }
        prev = ids;
        samples++;
      }
    }
  }
  for (const p of q.ponds) {
    if (!inside(p.x, p.z)) continue;
    const N = 28;
    const cx = p.x - x0;
    const cz = p.z - z0;
    const centre = wb.vert(cx, p.level, cz, C_POND_DEEP, 0, 0, 1);
    const rings = [0.5, 1];
    const ringIds: number[][] = [];
    for (const rf of rings) {
      const ids: number[] = [];
      const c = rf < 1 ? _c.copy(C_POND_DEEP).lerp(C_EDGE, 0.35) : C_EDGE;
      for (let k = 0; k <= N; k++) {
        const a = (-k / N) * Math.PI * 2;
        ids.push(
          wb.vert(cx + Math.cos(a) * p.r * rf, p.level, cz + Math.sin(a) * p.r * rf, c, 0, 0, 1),
        );
      }
      ringIds.push(ids);
    }
    // Angles decrease with k, which is CCW seen from +Y in three's XZ frame
    for (let k = 0; k < N; k++) wb.idx.push(centre, ringIds[0][k], ringIds[0][k + 1]);
    for (let k = 0; k < N; k++) {
      const a0 = ringIds[0][k];
      const a1 = ringIds[0][k + 1];
      const b0 = ringIds[1][k];
      const b1 = ringIds[1][k + 1];
      wb.idx.push(a0, b0, a1, a1, b0, b1);
    }
    // Earthen berm / muddy shore: lip just above the water on the downhill
    // side, sloping out to the ground (wider where it has to stand taller)
    const inner: number[] = [];
    const outer: number[] = [];
    for (let k = 0; k <= N; k++) {
      const a = (-k / N) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const gi = t.height(p.x + ca * p.r, p.z + sa * p.r);
      const lip = Math.max(p.level + 0.1, gi + 0.04);
      const ro = p.r + 1.3 + Math.max(0, lip - gi) * 2.2;
      const go = t.height(p.x + ca * ro, p.z + sa * ro);
      inner.push(wb.vert(cx + ca * p.r, lip, cz + sa * p.r, C_BANK, 0, 0, 0));
      outer.push(wb.vert(cx + ca * ro, go + 0.025, cz + sa * ro, C_BANK_OUT, 0, 0, 0));
    }
    for (let k = 0; k < N; k++)
      wb.idx.push(inner[k], outer[k], inner[k + 1], inner[k + 1], outer[k], outer[k + 1]);
  }
  return { geometry: wb.build(), crossings, samples };
}

// ── Bridges ─────────────────────────────────────────────────────────────

const WOOD = new THREE.Color(0xf4c27a);
const WOOD_DARK = new THREE.Color(0xdc9c56);
const POST = new THREE.Color(0x7a4a2a);
const RAIL = new THREE.Color(0xff4f9a);

/**
 * Plank bridge carrying the track over a crossing (chunk-local). The deck
 * follows the terrain a few cm up (the analytic ground stays the riding
 * surface, so there's no lip to catch a wheel); rails sit outside the
 * track corridor and are the only collision.
 */
export function buildBridge(
  c: Crossing,
  t: TerrainQuery,
  x0: number,
  z0: number,
  trackHalf: number,
  pos: number[],
  col: number[],
  collision: number[],
) {
  const L = 2 * (c.hw + 1.4); // along the track
  const A = trackHalf + 1.1; // half-span across the track
  const tri = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    color: THREE.Color,
    out = pos,
    outC: number[] | null = col,
  ) => {
    out.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    if (outC !== null) for (let k = 0; k < 3; k++) outC.push(color.r, color.g, color.b);
  };
  // world point at (along a, across u)
  const P = (a: number, u: number, dy: number, o: number[]) => {
    const x = c.x + c.tx * a + c.sx * u;
    const z = c.z + c.tz * a + c.sz * u;
    o[0] = x - x0;
    o[1] = t.height(x, z) + dy;
    o[2] = z - z0;
    return o;
  };
  const p0 = [0, 0, 0];
  const p1 = [0, 0, 0];
  const p2 = [0, 0, 0];
  const p3 = [0, 0, 0];
  const quad = (q0: number[], q1: number[], q2: number[], q3: number[], color: THREE.Color) => {
    tri(q0[0], q0[1], q0[2], q1[0], q1[1], q1[2], q2[0], q2[1], q2[2], color);
    tri(q0[0], q0[1], q0[2], q2[0], q2[1], q2[2], q3[0], q3[1], q3[2], color);
  };
  // One continuous deck (planks are colour bands, not separate boxes: no
  // gaps, so the ink pass draws a clean outline instead of a black slab)
  const nP = Math.max(4, Math.round(L / 0.55));
  const SEG = 6;
  for (let i = 0; i < nP; i++) {
    const a0 = -L / 2 + (i / nP) * L;
    const a1 = -L / 2 + ((i + 1) / nP) * L;
    const color = i % 2 === 0 ? WOOD : WOOD_DARK;
    for (let k = 0; k < SEG; k++) {
      const u0 = -A + (k / SEG) * 2 * A;
      const u1 = -A + ((k + 1) / SEG) * 2 * A;
      quad(
        P(a0, u0, 0.08, p0),
        P(a0, u1, 0.08, p1),
        P(a1, u1, 0.08, p2),
        P(a1, u0, 0.08, p3),
        color,
      );
      quad(
        P(a0, u0, 0.08, p0),
        P(a1, u0, 0.08, p3),
        P(a1, u1, 0.08, p2),
        P(a0, u1, 0.08, p1),
        color,
      );
    }
  }
  // Deck edges skirt down into the banks at both ends
  for (const a of [-L / 2, L / 2]) {
    for (let k = 0; k < SEG; k++) {
      const u0 = -A + (k / SEG) * 2 * A;
      const u1 = -A + ((k + 1) / SEG) * 2 * A;
      quad(P(a, u0, 0.08, p0), P(a, u1, 0.08, p1), P(a, u1, -0.3, p2), P(a, u0, -0.3, p3), POST);
      quad(P(a, u0, 0.08, p0), P(a, u0, -0.3, p3), P(a, u1, -0.3, p2), P(a, u1, 0.08, p1), POST);
    }
  }
  // Rails on both sides, outside the riding corridor
  for (const side of [-1, 1]) {
    const u = side * (A + 0.3);
    const ya = t.height(c.x + c.tx * (-L / 2) + c.sx * u, c.z + c.tz * (-L / 2) + c.sz * u);
    const yb = t.height(c.x + c.tx * (L / 2) + c.sx * u, c.z + c.tz * (L / 2) + c.sz * u);
    const posts = Math.max(2, Math.round(L / 1.7) + 1);
    for (let k = 0; k < posts; k++) {
      const a = -L / 2 + (k / (posts - 1)) * L;
      box(c, x0, z0, t, a, u, 0.09, 0.09, -0.3, 0.98, POST, tri);
    }
    // top rail: straight between the end posts
    railBox(c, x0, z0, -L / 2 - 0.15, L / 2 + 0.15, u, ya + 0.9, yb + 0.9, 0.14, 0.11, RAIL, tri);
    railBox(c, x0, z0, -L / 2, L / 2, u, ya + 0.45, yb + 0.45, 0.06, 0.06, POST, tri);
    // collision: one slab per side
    railBox(
      c,
      x0,
      z0,
      -L / 2 - 0.1,
      L / 2 + 0.1,
      u,
      ya + 0.5,
      yb + 0.5,
      0.14,
      0.55,
      RAIL,
      (ax, ay, az, bx, by, bz, cx, cy, cz) => collision.push(ax, ay, az, bx, by, bz, cx, cy, cz),
    );
  }
}

type TriFn = (
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  color: THREE.Color,
) => void;

/** Vertical post box at (a, u) from ground+y0 to ground+y1 (half sizes hx, hz). */
function box(
  c: Crossing,
  x0: number,
  z0: number,
  t: TerrainQuery,
  a: number,
  u: number,
  hx: number,
  hz: number,
  y0: number,
  y1: number,
  color: THREE.Color,
  tri: TriFn,
) {
  const wx = c.x + c.tx * a + c.sx * u;
  const wz = c.z + c.tz * a + c.sz * u;
  const g = t.height(wx, wz);
  const cx = wx - x0;
  const cz = wz - z0;
  const corners: [number, number][] = [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ];
  const pt = (i: number, y: number) => {
    const [da, du] = corners[i % 4];
    return [cx + c.tx * da + c.sx * du, g + y, cz + c.tz * da + c.sz * du];
  };
  for (let i = 0; i < 4; i++) {
    const a0 = pt(i, y0);
    const a1 = pt(i + 1, y0);
    const b1 = pt(i + 1, y1);
    const b0 = pt(i, y1);
    tri(a0[0], a0[1], a0[2], a1[0], a1[1], a1[2], b1[0], b1[1], b1[2], color);
    tri(a0[0], a0[1], a0[2], b1[0], b1[1], b1[2], b0[0], b0[1], b0[2], color);
    tri(a0[0], a0[1], a0[2], b1[0], b1[1], b1[2], a1[0], a1[1], a1[2], color);
    tri(a0[0], a0[1], a0[2], b0[0], b0[1], b0[2], b1[0], b1[1], b1[2], color);
  }
  const top = [0, 1, 2, 3].map(i => pt(i, y1));
  tri(
    top[0][0],
    top[0][1],
    top[0][2],
    top[1][0],
    top[1][1],
    top[1][2],
    top[2][0],
    top[2][1],
    top[2][2],
    color,
  );
  tri(
    top[0][0],
    top[0][1],
    top[0][2],
    top[2][0],
    top[2][1],
    top[2][2],
    top[3][0],
    top[3][1],
    top[3][2],
    color,
  );
  tri(
    top[0][0],
    top[0][1],
    top[0][2],
    top[2][0],
    top[2][1],
    top[2][2],
    top[1][0],
    top[1][1],
    top[1][2],
    color,
  );
  tri(
    top[0][0],
    top[0][1],
    top[0][2],
    top[3][0],
    top[3][1],
    top[3][2],
    top[2][0],
    top[2][1],
    top[2][2],
    color,
  );
}

/** Straight rail along the track direction from a0 to a1 at offset u (both windings). */
function railBox(
  c: Crossing,
  x0: number,
  z0: number,
  a0: number,
  a1: number,
  u: number,
  ya: number,
  yb: number,
  hu: number,
  hy: number,
  color: THREE.Color,
  tri: TriFn,
) {
  const P = (a: number, du: number, y: number) => [
    c.x + c.tx * a + c.sx * (u + du) - x0,
    y,
    c.z + c.tz * a + c.sz * (u + du) - z0,
  ];
  const ring = (a: number, y: number) => [
    P(a, -hu, y - hy),
    P(a, hu, y - hy),
    P(a, hu, y + hy),
    P(a, -hu, y + hy),
  ];
  const r0 = ring(a0, ya);
  const r1 = ring(a1, yb);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const A0 = r0[i];
    const A1 = r0[j];
    const B0 = r1[i];
    const B1 = r1[j];
    tri(A0[0], A0[1], A0[2], A1[0], A1[1], A1[2], B1[0], B1[1], B1[2], color);
    tri(A0[0], A0[1], A0[2], B1[0], B1[1], B1[2], B0[0], B0[1], B0[2], color);
    tri(A0[0], A0[1], A0[2], B1[0], B1[1], B1[2], A1[0], A1[1], A1[2], color);
    tri(A0[0], A0[1], A0[2], B0[0], B0[1], B0[2], B1[0], B1[1], B1[2], color);
  }
  for (const r of [r0, r1]) {
    tri(r[0][0], r[0][1], r[0][2], r[1][0], r[1][1], r[1][2], r[2][0], r[2][1], r[2][2], color);
    tri(r[0][0], r[0][1], r[0][2], r[2][0], r[2][1], r[2][2], r[3][0], r[3][1], r[3][2], color);
    tri(r[0][0], r[0][1], r[0][2], r[2][0], r[2][1], r[2][2], r[1][0], r[1][1], r[1][2], color);
    tri(r[0][0], r[0][1], r[0][2], r[3][0], r[3][1], r[3][2], r[2][0], r[2][1], r[2][2], color);
  }
}

// ── Water material: flat toon blue + scrolling cel glints ───────────────

/** Seconds; advanced by the dressing roots each frame they're drawn. */
export const dressingTime = { value: 0 };

let waterMat: THREE.MeshToonMaterial | null = null;

export function dressingWaterMaterial(): THREE.MeshToonMaterial {
  if (waterMat !== null) return waterMat;
  const m = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap: getToonRamp(),
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  m.name = 'DressingWater';
  m.userData.noToon = true;
  m.onBeforeCompile = shader => {
    shader.uniforms.uDressTime = dressingTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aWater;
varying vec3 vDwWater;
varying vec3 vDwPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vDwWater = aWater;
vDwPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uDressTime;
varying vec3 vDwWater;
varying vec3 vDwPos;
float dwHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float dwNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( dwHash( i ), dwHash( i + vec2( 1.0, 0.0 ) ), f.x ),
              mix( dwHash( i + vec2( 0.0, 1.0 ) ), dwHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if ( vDwWater.z > 0.5 ) {
  vec2 fl = vDwWater.xy;
  float sp = length( fl );
  vec2 d = sp > 1e-3 ? fl / sp : vec2( 0.8, 0.6 );
  vec2 p = vec2( dot( vDwPos.xz, d ), dot( vDwPos.xz, vec2( -d.y, d.x ) ) );
  float t = uDressTime;
  float n1 = dwNoise( vec2( p.x * 0.42 - t * ( 0.25 + sp * 1.7 ), p.y * 1.5 ) );
  float n2 = dwNoise( vec2( p.x * 0.95 - t * ( 0.45 + sp * 2.6 ) + 17.0, p.y * 2.7 + 5.0 ) );
  float n = n1 * 0.62 + n2 * 0.38;
  float fw = fwidth( n ) + 1e-3;
  float glint = smoothstep( 0.71 - fw, 0.71 + fw, n );
  float band = smoothstep( 0.5 - fw, 0.5 + fw, n ) * ( 1.0 - glint );
  diffuseColor.rgb = mix( diffuseColor.rgb * ( 1.0 + band * 0.12 ), vec3( 0.88, 0.97, 1.0 ), glint * 0.8 );
}`,
      );
  };
  m.customProgramCacheKey = () => 'dressing-water-1';
  waterMat = m;
  return m;
}

let bridgeMat: THREE.MeshToonMaterial | null = null;

export function dressingBridgeMaterial(): THREE.MeshToonMaterial {
  if (bridgeMat === null) {
    bridgeMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonRamp() });
    bridgeMat.name = 'DressingBridge';
  }
  return bridgeMat;
}

export { MAX_REACH };
