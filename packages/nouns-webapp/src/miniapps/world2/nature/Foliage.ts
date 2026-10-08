// ── Procedural instanced vegetation ─────────────────────────────────────
//
// Broadleaf trees (tapered-tube skeleton + folded leaf cards), palms
// (curved ringed trunk + arching fronds), bushes (+ blossoms), grass tufts
// and meadow flowers. Every plant type is generated as a few seeded
// variants, then instanced in XZ chunks with shared materials:
//
//  - leaf cards are alpha-tested, double-sided, with *bent normals* (pointing
//    out of the canopy ellipsoid) so a crown shades as one soft volume, a
//    vertex-colour AO term (darker inside/below), and a back-lit
//    translucency term injected into the shadowed sun loop;
//  - all foliage sways from one shared wind uniform set (trunk sway weighted
//    by height², leaf flutter along the normal);
//  - cards cast alpha-tested shadows through a matching customDepthMaterial,
//    so the ground under a tree gets dappled light;
//  - grass/flowers shrink into the ground with camera distance and whole
//    chunks are hidden beyond the fade radius.

import * as THREE from 'three';

import {
  type FoliagePatchOptions,
  type GroundQuery,
  type InstanceSpec,
  type NatureQuality,
  type Region,
  Rng,
  buildInstancedChunks,
  fbm2,
  foliageDepthMaterial,
  groundAt,
  patchFoliageMaterial,
  regionSampler,
} from './shared';
import {
  FLOWER_CELLS,
  barkTextures,
  flowerAtlasTexture,
  lawnTexture,
  leafClusterTexture,
  palmFrondTexture,
} from './textures';

// ── Geometry builder ────────────────────────────────────────────────────

class GeoBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  wind: number[] = [];
  idx: number[] = [];

  get count() {
    return this.pos.length / 3;
  }

  vert(
    p: THREE.Vector3,
    n: THREE.Vector3,
    u: number,
    v: number,
    c: THREE.Color,
    w: [number, number],
  ) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
    this.wind.push(w[0], w[1]);
    return this.count - 1;
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('wind', new THREE.Float32BufferAttribute(this.wind, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(1, 1, 1);

/** Tapered tube along a Catmull-Rom spline (bark UVs in metres). */
function tube(
  b: GeoBuilder,
  pts: THREE.Vector3[],
  radius: (t: number) => number,
  radial: number,
  segs: number,
  wind: (p: THREE.Vector3) => [number, number],
  color: THREE.Color = WHITE,
  capEnd = false,
) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const frames = curve.computeFrenetFrames(segs, false);
  const len = curve.getLength();
  const uRepeat = Math.max(1, Math.round((2 * Math.PI * radius(0)) / 0.45));
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const v = new THREE.Vector3();
  const start = b.count;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, p);
    const r = radius(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      n.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a)).normalize();
      v.copy(p).addScaledVector(n, r);
      b.vert(v, n, (j / radial) * uRepeat, (t * len) / 1.4, color, wind(v));
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = start + i * (radial + 1) + j;
      const c = a + radial + 1;
      b.quad(a, c, c + 1, a + 1);
    }
  }
  if (capEnd) {
    curve.getPointAt(1, p);
    const tip = b.vert(p, frames.tangents[segs], 0, 0, color, wind(p));
    const last = start + segs * (radial + 1);
    for (let j = 0; j < radial; j++) b.tri(last + j, tip, last + j + 1);
  }
  return curve;
}

/** Folded (V) leaf card: base at `base`, extending along `up`, facing `normal`. */
function leafCard(
  b: GeoBuilder,
  base: THREE.Vector3,
  up: THREE.Vector3,
  right: THREE.Vector3,
  w: number,
  h: number,
  fold: number,
  normalAt: (p: THREE.Vector3) => THREE.Vector3,
  colorAt: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color,
  windAt: (p: THREE.Vector3) => [number, number],
  uvRect: [number, number, number, number] = [0, 0, 1, 1],
  droop = 0,
) {
  const fn = new THREE.Vector3().crossVectors(right, up).normalize();
  const rows = droop !== 0 ? 3 : 2;
  const ids: number[][] = [];
  const p = new THREE.Vector3();
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const row: number[] = [];
    for (let c = 0; c < 3; c++) {
      const s = c - 1;
      p.copy(base)
        .addScaledVector(up, h * t)
        .addScaledVector(right, (s * w) / 2)
        .addScaledVector(fn, s === 0 ? fold * w : 0)
        .addScaledVector(UP, -droop * h * t * t);
      const n = normalAt(p);
      const u = uvRect[0] + (uvRect[2] - uvRect[0]) * (c / 2);
      const v = uvRect[1] + (uvRect[3] - uvRect[1]) * t;
      row.push(b.vert(p, n, u, v, colorAt(p, n), windAt(p)));
    }
    ids.push(row);
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < 2; c++) b.quad(ids[r][c], ids[r][c + 1], ids[r + 1][c + 1], ids[r + 1][c]);
  }
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ── Plant generators ────────────────────────────────────────────────────

export interface PlantAsset {
  kind: 'broadleaf' | 'palm' | 'bush';
  /** Trunk/branches (bark material). May be empty for bushes. */
  wood: THREE.BufferGeometry | null;
  /** Leaf / frond cards. */
  leaves: THREE.BufferGeometry;
  /** Blossom cards (flower atlas), bushes only. */
  blossoms: THREE.BufferGeometry | null;
  height: number;
  radius: number;
  trunkRadius: number;
}

export interface TreeOptions {
  seed?: number;
  height?: number;
  crownRadius?: number;
  trunkRadius?: number;
  /** Multiplier on leaf-card count (quality tiers scale this). */
  leafDensity?: number;
  leafSize?: number;
}

const CARD_COUNT: Record<NatureQuality, number> = { low: 0.55, medium: 1, high: 1.45 };

export function generateBroadleaf(o: TreeOptions = {}): PlantAsset {
  const rng = new Rng(o.seed ?? 1);
  const H = o.height ?? rng.range(6.5, 8.5);
  const R = o.crownRadius ?? H * rng.range(0.4, 0.5);
  const tr = o.trunkRadius ?? H * 0.03;
  const dens = o.leafDensity ?? 1;
  const leafSize = o.leafSize ?? 1.25;
  const wood = new GeoBuilder();
  const leaves = new GeoBuilder();

  const split = H * rng.range(0.36, 0.46);
  const lean = new THREE.Vector3(rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3));
  const Ry = (H - split) * 0.58;
  const C = new THREE.Vector3(lean.x * 1.4, H - Ry, lean.z * 1.4);
  const radii = new THREE.Vector3(R, Ry, R);
  const windAt = (p: THREE.Vector3): [number, number] => {
    const hy = Math.max(0, p.y / H);
    const horiz = Math.hypot(p.x - C.x, p.z - C.z) / R;
    return [hy * hy * (0.7 + 0.3 * horiz), 0];
  };

  // Trunk
  const trunkTop = new THREE.Vector3(lean.x, split, lean.z);
  tube(
    wood,
    [
      new THREE.Vector3(0, -0.1, 0),
      new THREE.Vector3(lean.x * 0.2 + rng.range(-0.05, 0.05), split * 0.45, lean.z * 0.2),
      trunkTop,
      new THREE.Vector3(C.x, split + Ry * 0.5, C.z),
    ],
    t => tr * (1 - 0.45 * t) * (1 + 0.7 * Math.exp(-t * 18)),
    9,
    12,
    windAt,
  );

  const tips: { p: THREE.Vector3; r: number }[] = [];
  const nMain = rng.int(5, 7);
  const branchPts = (start: THREE.Vector3, end: THREE.Vector3, lift: number) => {
    const mid = start.clone().lerp(end, 0.45).addScaledVector(UP, lift);
    const m2 = start
      .clone()
      .lerp(end, 0.8)
      .addScaledVector(UP, lift * 0.5);
    return [start, mid, m2, end];
  };
  for (let i = 0; i < nMain; i++) {
    const az = (i / nMain) * Math.PI * 2 + rng.range(-0.35, 0.35);
    const sy = split + rng.range(-0.1, 0.45) * Ry * 0.5;
    const start = new THREE.Vector3(
      lean.x + (C.x - lean.x) * ((sy - split) / Ry),
      sy,
      lean.z + (C.z - lean.z) * ((sy - split) / Ry),
    );
    const reach = rng.range(0.6, 0.85);
    const end = new THREE.Vector3(
      C.x + Math.cos(az) * R * reach,
      C.y + rng.range(-0.15, 0.55) * Ry,
      C.z + Math.sin(az) * R * reach,
    );
    const pts = branchPts(start, end, rng.range(0.3, 0.8));
    const r0 = tr * rng.range(0.42, 0.55);
    const curve = tube(wood, pts, t => r0 * (1 - 0.82 * t) + 0.012, 6, 7, windAt);
    tips.push({ p: end.clone(), r: rng.range(0.85, 1.1) });
    // Sub-branches
    const nSub = rng.int(2, 3);
    for (let k = 0; k < nSub; k++) {
      const t0 = rng.range(0.4, 0.8);
      const s = curve.getPointAt(t0);
      const tan = curve.getTangentAt(t0);
      const d = tan
        .clone()
        .applyAxisAngle(UP, rng.range(-1.2, 1.2))
        .addScaledVector(UP, rng.range(0.1, 0.6))
        .normalize();
      const e = s.clone().addScaledVector(d, rng.range(0.9, 1.6) * (R / 3.2));
      // keep inside the crown ellipsoid
      const rel = e.clone().sub(C).divide(radii);
      if (rel.length() > 0.95) e.copy(C).add(rel.setLength(0.95).multiply(radii));
      const sr = r0 * (1 - 0.82 * t0) * 0.6;
      tube(
        wood,
        [s, s.clone().lerp(e, 0.5).addScaledVector(UP, 0.12), e],
        t => sr * (1 - 0.8 * t) + 0.006,
        4,
        3,
        windAt,
      );
      tips.push({ p: e, r: rng.range(0.65, 0.9) });
      tips.push({ p: s.clone().lerp(e, 0.45), r: rng.range(0.5, 0.7) });
    }
  }
  // Leader + a few interior fill clumps so the crown reads solid from below
  tips.push({ p: new THREE.Vector3(C.x, C.y + Ry * 0.75, C.z), r: 1.1 });
  for (let i = 0; i < 4; i++) {
    const d = rng.dir().multiplyScalar(0.45).multiply(radii);
    d.y = Math.abs(d.y) * 0.6;
    tips.push({ p: C.clone().add(d), r: 0.9 });
  }

  // Leaf cards
  const cardsPer = Math.round(11 * dens);
  const tmp = new THREE.Vector3();
  const tint = new THREE.Color();
  for (const tip of tips) {
    const outward = tip.p.clone().sub(C).divide(radii);
    const od = outward.lengthSq() > 1e-4 ? outward.clone().normalize() : UP.clone();
    const clumpTint = rng.range(-1, 1);
    const n = Math.max(3, Math.round(cardsPer * tip.r));
    const clumpR = tip.r * (R / 3.4);
    for (let k = 0; k < n; k++) {
      const d = rng.dir().addScaledVector(od, 0.75).normalize();
      const centre = tip.p.clone().addScaledVector(d, clumpR * Math.sqrt(rng.next()));
      const upv = d
        .clone()
        .multiplyScalar(0.7)
        .add(rng.dir().multiplyScalar(0.45))
        .addScaledVector(UP, 0.25)
        .normalize();
      const right = new THREE.Vector3().crossVectors(upv, rng.dir()).normalize();
      const size = leafSize * rng.range(0.8, 1.15) * (R / 3.4);
      const base = centre.clone().addScaledVector(upv, -size * 0.45);
      leafCard(
        leaves,
        base,
        upv,
        right,
        size,
        size,
        0.12,
        p => {
          tmp.copy(p).sub(C).divide(radii);
          const ell = tmp.clone().normalize();
          const local = p.clone().sub(tip.p).normalize();
          return ell
            .multiplyScalar(0.72)
            .addScaledVector(local, 0.28)
            .addScaledVector(UP, 0.12)
            .normalize();
        },
        (p, nn) => {
          tmp.copy(p).sub(C).divide(radii);
          const e = tmp.length();
          const ao = (0.42 + 0.58 * smooth(0.3, 1.0, e)) * (0.78 + 0.22 * (nn.y * 0.5 + 0.5));
          const top = smooth(-0.2, 0.9, tmp.y);
          tint.setRGB(
            ao * (1 + 0.06 * clumpTint + 0.08 * top),
            ao * (1 + 0.03 * top),
            ao * (1 - 0.08 * clumpTint - 0.1 * top),
          );
          return tint;
        },
        p => {
          const w = windAt(p);
          return [w[0], 1];
        },
        [0, 0, 1, 1],
        0.08,
      );
    }
  }
  return {
    kind: 'broadleaf',
    wood: wood.build(),
    leaves: leaves.build(),
    blossoms: null,
    height: H,
    radius: R,
    trunkRadius: tr,
  };
}

export interface PalmOptions {
  seed?: number;
  height?: number;
  fronds?: number;
  frondLength?: number;
}

export function generatePalm(o: PalmOptions = {}): PlantAsset {
  const rng = new Rng(o.seed ?? 3);
  const H = o.height ?? rng.range(7, 10);
  const nF = o.fronds ?? 16;
  const FL = o.frondLength ?? rng.range(3.2, 4.0);
  const wood = new GeoBuilder();
  const leaves = new GeoBuilder();
  const leanDir = new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, rng.range(0, Math.PI * 2));
  const leanAmt = rng.range(0.5, 1.4);
  const trunkAt = (t: number) =>
    new THREE.Vector3()
      .addScaledVector(leanDir, leanAmt * (t * t * 0.8 + Math.sin(t * Math.PI) * 0.15))
      .addScaledVector(UP, H * t);
  const top = trunkAt(1);
  const windTrunk = (p: THREE.Vector3): [number, number] => {
    const h = Math.max(0, p.y / H);
    return [h * h, 0];
  };
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) pts.push(trunkAt(i / 8));
  pts[0].y = -0.1;
  tube(
    wood,
    pts,
    t => 0.2 * (1 - 0.3 * t) + 0.16 * Math.exp(-t * 22) + (t > 0.92 ? (t - 0.92) * 0.9 : 0),
    10,
    30,
    windTrunk,
  );
  // Crown boot + coconuts
  const nutCol = new THREE.Color().setRGB(0.32, 0.26, 0.1);
  for (let i = 0; i < 4; i++) {
    const a = rng.range(0, Math.PI * 2);
    const c = top
      .clone()
      .add(new THREE.Vector3(Math.cos(a) * 0.24, -0.25 - rng.range(0, 0.15), Math.sin(a) * 0.24));
    const sg = new THREE.SphereGeometry(0.13, 8, 6);
    const p = sg.attributes.position;
    const nn = sg.attributes.normal;
    const uvs = sg.attributes.uv;
    const s = wood.count;
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k).add(c);
      n.fromBufferAttribute(nn, k);
      wood.vert(v, n, uvs.getX(k), uvs.getY(k), nutCol, windTrunk(v));
    }
    const idx = sg.index;
    if (idx !== null)
      for (let k = 0; k < idx.count; k += 3)
        wood.tri(s + idx.getX(k), s + idx.getX(k + 1), s + idx.getX(k + 2));
    sg.dispose();
  }

  const crownC = top.clone().addScaledVector(UP, 0.3);
  const frondTint = new THREE.Color();
  const addFrond = (az: number, elev: number, len: number, droop: number, dead: boolean) => {
    const hd = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const lat = new THREE.Vector3(-hd.z, 0, hd.x);
    const segs = 9;
    const W = len * 0.3;
    const rows: number[][] = [];
    const tw = rng.range(-0.25, 0.25);
    for (let i = 0; i <= segs; i++) {
      const s = i / segs;
      const d = s * len;
      const centre = top
        .clone()
        .addScaledVector(hd, Math.cos(elev) * d)
        .addScaledVector(UP, Math.sin(elev) * d - droop * d * d);
      // Tangent for the local frond frame
      const d2 = d + 0.05;
      const next = top
        .clone()
        .addScaledVector(hd, Math.cos(elev) * d2)
        .addScaledVector(UP, Math.sin(elev) * d2 - droop * d2 * d2);
      const tan = next.sub(centre).normalize();
      const l2 = lat.clone().applyAxisAngle(tan, tw * s);
      const fUp = new THREE.Vector3().crossVectors(l2, tan).normalize();
      const width = W * Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + s * 0.98)), 0.6) + 0.04;
      const row: number[] = [];
      for (const side of [-1, 0, 1]) {
        const p = centre
          .clone()
          .addScaledVector(l2, side * width * 0.5)
          .addScaledVector(fUp, side !== 0 ? -width * 0.22 : 0);
        const n = fUp
          .clone()
          .multiplyScalar(0.35)
          .add(p.clone().sub(crownC).normalize().multiplyScalar(0.45))
          .addScaledVector(UP, 0.35)
          .normalize();
        const ao = 0.55 + 0.45 * smooth(0, 0.6, s);
        if (dead) frondTint.setRGB(1.25 * ao, 0.82 * ao, 0.42 * ao);
        else frondTint.setRGB(ao * (1 + 0.05 * s), ao, ao * (1 - 0.1 * s));
        const tipW = windTrunk(top)[0] + s * s * 0.9;
        row.push(leaves.vert(p, n, (side + 1) / 2, s, frondTint, [tipW, Math.abs(side) * s]));
      }
      rows.push(row);
    }
    for (let i = 0; i < segs; i++) {
      for (let c = 0; c < 2; c++)
        leaves.quad(rows[i][c], rows[i][c + 1], rows[i + 1][c + 1], rows[i + 1][c]);
    }
  };
  for (let i = 0; i < nF; i++) {
    const ring = i % 3;
    const az = (i / nF) * Math.PI * 2 * 2.618 + rng.range(-0.2, 0.2);
    const elev =
      ring === 0
        ? rng.range(0.55, 0.95)
        : ring === 1
          ? rng.range(0.15, 0.45)
          : rng.range(-0.35, 0.05);
    const len = FL * rng.range(0.85, 1.1) * (ring === 0 ? 0.85 : 1);
    addFrond(az, elev, len, rng.range(0.07, 0.11), false);
  }
  for (let i = 0; i < 3; i++) {
    addFrond(rng.range(0, Math.PI * 2), rng.range(-1.25, -1.0), FL * 0.6, 0.02, true);
  }
  return {
    kind: 'palm',
    wood: wood.build(),
    leaves: leaves.build(),
    blossoms: null,
    height: H,
    radius: FL,
    trunkRadius: 0.24,
  };
}

export interface BushOptions {
  seed?: number;
  radius?: number;
  height?: number;
  /** Atlas cell (FLOWER_CELLS.*Blossom) or null for a plain green bush. */
  blossom?: number | null;
  leafDensity?: number;
}

export function generateBush(o: BushOptions = {}): PlantAsset {
  const rng = new Rng(o.seed ?? 7);
  const R = o.radius ?? rng.range(0.7, 1.1);
  const Hh = o.height ?? R * rng.range(1.0, 1.3);
  const dens = o.leafDensity ?? 1;
  const Ry = Hh * 0.55;
  const C = new THREE.Vector3(0, Ry * 0.85, 0);
  const radii = new THREE.Vector3(R, Ry, R);
  const leaves = new GeoBuilder();
  const blossoms = new GeoBuilder();
  const windAt = (p: THREE.Vector3): [number, number] => [Math.max(0, p.y / Hh) * 0.9, 1];
  const nClumps = Math.round(9 + R * 6);
  const tmp = new THREE.Vector3();
  const tint = new THREE.Color();
  const nrm = (p: THREE.Vector3) =>
    tmp.copy(p).sub(C).divide(radii).normalize().addScaledVector(UP, 0.15).normalize().clone();
  const colAt = (p: THREE.Vector3) => {
    tmp.copy(p).sub(C).divide(radii);
    const e = tmp.length();
    const ao = (0.4 + 0.6 * smooth(0.25, 1.0, e)) * (0.7 + 0.3 * smooth(-0.6, 0.8, tmp.y));
    return tint.setRGB(ao, ao, ao);
  };
  for (let i = 0; i < nClumps; i++) {
    // Fibonacci-ish distribution over the upper dome
    const yv = 1 - ((i + 0.5) / nClumps) * 1.35;
    const r = Math.sqrt(Math.max(0, 1 - yv * yv));
    const a = i * 2.39996 + rng.range(-0.3, 0.3);
    const dir = new THREE.Vector3(Math.cos(a) * r, yv, Math.sin(a) * r);
    const centre = C.clone().add(dir.clone().multiply(radii).multiplyScalar(0.62));
    const nCards = Math.max(3, Math.round(7 * dens));
    for (let k = 0; k < nCards; k++) {
      const d = rng.dir().addScaledVector(dir, 0.9).normalize();
      const upv = d.clone().add(rng.dir().multiplyScalar(0.4)).addScaledVector(UP, 0.3).normalize();
      const right = new THREE.Vector3().crossVectors(upv, rng.dir()).normalize();
      const size = rng.range(0.5, 0.7) * Math.min(1.3, R);
      const base = centre
        .clone()
        .addScaledVector(d, rng.range(0, 0.25) * R)
        .addScaledVector(upv, -size * 0.4);
      leafCard(leaves, base, upv, right, size, size, 0.1, nrm, colAt, windAt);
    }
  }
  const cell = o.blossom ?? null;
  if (cell !== null) {
    const col = cell % 4;
    const row = Math.floor(cell / 4);
    const rect: [number, number, number, number] = [
      col / 4 + 0.004,
      row / 2 + 0.004,
      (col + 1) / 4 - 0.004,
      (row + 1) / 2 - 0.004,
    ];
    const nB = Math.round(16 + R * 10);
    for (let i = 0; i < nB; i++) {
      const dir = rng.dir();
      dir.y = Math.abs(dir.y) * 0.9 + 0.1;
      dir.normalize();
      const p = C.clone().add(dir.clone().multiply(radii).multiplyScalar(rng.range(0.9, 1.04)));
      const upv = new THREE.Vector3().crossVectors(dir, rng.dir()).normalize();
      const right = new THREE.Vector3().crossVectors(upv, dir).normalize();
      const s = rng.range(0.28, 0.4);
      leafCard(
        blossoms,
        p.clone().addScaledVector(upv, -s / 2),
        upv,
        right,
        s,
        s,
        0.05,
        nrm,
        () => tint.setRGB(1, 1, 1),
        windAt,
        rect,
      );
    }
  }
  return {
    kind: 'bush',
    wood: null,
    leaves: leaves.build(),
    blossoms: cell !== null ? blossoms.build() : null,
    height: Hh,
    radius: R,
    trunkRadius: 0,
  };
}

/** Clump of curved, tapered grass blades (base at y=0). */
export function generateGrassTuft(seed: number, blades: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const b = new GeoBuilder();
  const base = new THREE.Color().setRGB(0.18, 0.3, 0.07, THREE.SRGBColorSpace);
  const mid = new THREE.Color().setRGB(0.36, 0.55, 0.14, THREE.SRGBColorSpace);
  const tipC = new THREE.Color().setRGB(0.66, 0.78, 0.28, THREE.SRGBColorSpace);
  const dry = new THREE.Color().setRGB(0.72, 0.68, 0.36, THREE.SRGBColorSpace);
  const c = new THREE.Color();
  for (let i = 0; i < blades; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * 0.16;
    const root = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    const lean = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
      .applyAxisAngle(UP, rng.range(-0.8, 0.8))
      .multiplyScalar(rng.range(0.1, 0.45));
    const h = rng.range(0.22, 0.5);
    const w = rng.range(0.022, 0.035);
    const side = new THREE.Vector3(-lean.z, 0, lean.x)
      .normalize()
      .applyAxisAngle(UP, rng.range(-0.6, 0.6));
    const isDry = rng.next() < 0.08;
    const ts = [0, 0.42, 0.78, 1];
    const ids: number[][] = [];
    for (const t of ts) {
      const p = root
        .clone()
        .addScaledVector(lean, t * t * h)
        .addScaledVector(UP, t * h * (1 - 0.25 * t * lean.length()));
      const n = UP.clone()
        .multiplyScalar(0.8)
        .addScaledVector(lean.clone().normalize(), 0.3)
        .normalize();
      if (t < 0.5) c.copy(base).lerp(mid, t / 0.5);
      else c.copy(mid).lerp(tipC, (t - 0.5) / 0.5);
      if (isDry) c.lerp(dry, 0.6 + 0.4 * t);
      const wt: [number, number] = [Math.pow(t, 1.5) * (h / 0.4), t * 0.3];
      if (t === 1) {
        ids.push([b.vert(p, n, 0.5, 1, c, wt)]);
      } else {
        const wd = w * (1 - Math.pow(t, 1.3));
        ids.push([
          b.vert(p.clone().addScaledVector(side, -wd), n, 0, t, c, wt),
          b.vert(p.clone().addScaledVector(side, wd), n, 1, t, c, wt),
        ]);
      }
    }
    for (let k = 0; k < 2; k++) b.quad(ids[k][0], ids[k][1], ids[k + 1][1], ids[k + 1][0]);
    b.tri(ids[2][0], ids[2][1], ids[3][0]);
  }
  return b.build();
}

/** Two crossed vertical quads for side-view flower sprites (atlas row 0). */
export function generateFlowerSprite(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const w = 0.5;
  const h = 0.5;
  for (let q = 0; q < 2; q++) {
    const a = (q * Math.PI) / 2 + 0.3;
    const r = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const ids: number[] = [];
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]) {
      const p = r
        .clone()
        .multiplyScalar((u - 0.5) * w)
        .addScaledVector(UP, v * h);
      const n = UP.clone()
        .multiplyScalar(0.75)
        .addScaledVector(new THREE.Vector3(-r.z, 0, r.x), 0.3)
        .normalize();
      ids.push(b.vert(p, n, u, v, WHITE, [v * v * 1.1, v * 0.4]));
    }
    b.quad(ids[0], ids[1], ids[2], ids[3]);
  }
  return b.build();
}

// ── Materials ───────────────────────────────────────────────────────────

const PATCH = {
  tree: {
    key: 'tree',
    wind: { swayAmp: 0.32, swayFreq: 0.85, flutterAmp: 0.05, flutterFreq: 5.5 },
  },
  palm: {
    key: 'palm',
    wind: { swayAmp: 0.55, swayFreq: 0.65, flutterAmp: 0.07, flutterFreq: 4.2 },
  },
  bush: {
    key: 'bush',
    wind: { swayAmp: 0.08, swayFreq: 1.3, flutterAmp: 0.03, flutterFreq: 6.5 },
  },
  grass: {
    key: 'grass',
    wind: { swayAmp: 0.12, swayFreq: 1.7, flutterAmp: 0.015, flutterFreq: 8 },
  },
} satisfies Record<string, FoliagePatchOptions>;

export interface FoliageMaterials {
  leaf: THREE.MeshStandardMaterial;
  leafDepth: THREE.MeshDepthMaterial;
  bark: THREE.MeshStandardMaterial;
  barkDepth: THREE.MeshDepthMaterial;
  frond: THREE.MeshStandardMaterial;
  frondDepth: THREE.MeshDepthMaterial;
  palmBark: THREE.MeshStandardMaterial;
  palmBarkDepth: THREE.MeshDepthMaterial;
  bush: THREE.MeshStandardMaterial;
  bushDepth: THREE.MeshDepthMaterial;
  blossom: THREE.MeshStandardMaterial;
  blossomDepth: THREE.MeshDepthMaterial;
  grass: THREE.MeshStandardMaterial;
  meadow: THREE.MeshStandardMaterial;
  lawn: THREE.MeshStandardMaterial;
}

let sharedMats: FoliageMaterials | null = null;

export function foliageMaterials(quality: NatureQuality = 'medium'): FoliageMaterials {
  if (sharedMats !== null) return sharedMats;
  const leafTex = leafClusterTexture('broadleaf');
  const bushTex = leafClusterTexture('bush');
  const frondTex = palmFrondTexture();
  const flowers = flowerAtlasTexture();
  const bark = barkTextures('broadleaf');
  const pbark = barkTextures('palm');
  const AT = 0.42;
  const card = (
    map: THREE.Texture,
    patch: FoliagePatchOptions,
    trans: THREE.Color,
    s: number,
    texSize: number,
    key: string,
  ) => {
    const o: FoliagePatchOptions = {
      ...patch,
      key,
      bentNormals: true,
      translucency: { color: trans, strength: s },
      alphaMip: { texSize, amount: 0.22 },
    };
    const m = new THREE.MeshStandardMaterial({
      map,
      alphaTest: AT,
      side: THREE.DoubleSide,
      vertexColors: true,
      roughness: 0.72,
      metalness: 0,
      envMapIntensity: 0.7,
    });
    m.shadowSide = THREE.DoubleSide;
    patchFoliageMaterial(m, o);
    const d = foliageDepthMaterial(map, AT, { ...o, translucency: undefined, bentNormals: false });
    return [m, d] as const;
  };
  const wood = (
    maps: { map: THREE.Texture; normal: THREE.Texture },
    patch: FoliagePatchOptions,
    key: string,
  ) => {
    const m = new THREE.MeshStandardMaterial({
      map: maps.map,
      normalMap: maps.normal,
      normalScale: new THREE.Vector2(1.2, 1.2),
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
    });
    const o: FoliagePatchOptions = { ...patch, key, wind: { ...patch.wind, flutterAmp: 0 } };
    patchFoliageMaterial(m, o);
    const d = foliageDepthMaterial(null, 0, o);
    return [m, d] as const;
  };
  const [leaf, leafDepth] = card(
    leafTex,
    PATCH.tree,
    new THREE.Color(1.0, 1.05, 0.35),
    0.85,
    512,
    'leaf',
  );
  const [bush, bushDepth] = card(
    bushTex,
    PATCH.bush,
    new THREE.Color(0.85, 1.0, 0.35),
    0.6,
    512,
    'bushleaf',
  );
  const [frond, frondDepth] = card(
    frondTex,
    PATCH.palm,
    new THREE.Color(1.0, 1.0, 0.4),
    0.75,
    1024,
    'frond',
  );
  const [blossom, blossomDepth] = card(
    flowers,
    PATCH.bush,
    new THREE.Color(1, 0.9, 0.8),
    0.45,
    512,
    'blossom',
  );
  const [barkM, barkDepth] = wood(bark, PATCH.tree, 'bark');
  const [palmBark, palmBarkDepth] = wood(pbark, PATCH.palm, 'pbark');

  const fade = { low: [10, 15], medium: [20, 28], high: [32, 42] }[quality];
  const grass = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.78,
    metalness: 0,
    envMapIntensity: 0.6,
  });
  patchFoliageMaterial(grass, {
    ...PATCH.grass,
    bentNormals: true,
    translucency: { color: new THREE.Color(0.9, 1.0, 0.4), strength: 0.5 },
    grass: { fadeStart: fade[0], fadeEnd: fade[1], trample: true },
    tipLight: 0.15,
  });
  const meadow = new THREE.MeshStandardMaterial({
    map: flowers,
    alphaTest: AT,
    side: THREE.DoubleSide,
    roughness: 0.7,
    metalness: 0,
  });
  patchFoliageMaterial(meadow, {
    ...PATCH.grass,
    key: 'meadow',
    bentNormals: true,
    translucency: { color: new THREE.Color(1, 0.95, 0.8), strength: 0.35 },
    grass: { fadeStart: fade[0] * 0.9, fadeEnd: fade[1] * 0.9, trample: true },
    atlas: { cols: 4, rows: 2 },
    alphaMip: { texSize: 256, amount: 0.2 },
  });
  const lawn = new THREE.MeshStandardMaterial({
    map: lawnTexture(),
    roughness: 0.95,
    metalness: 0,
  });
  sharedMats = {
    leaf,
    leafDepth,
    bark: barkM,
    barkDepth,
    frond,
    frondDepth,
    palmBark,
    palmBarkDepth,
    bush,
    bushDepth,
    blossom,
    blossomDepth,
    grass,
    meadow,
    lawn,
  };
  return sharedMats;
}

// ── Single-plant convenience ────────────────────────────────────────────

/** One tree as a plain Group (not instanced) — handy for hero placements. */
export function createTree(
  opts: TreeOptions & { kind?: 'broadleaf' | 'palm' | 'bush'; blossom?: number | null } = {},
): THREE.Group {
  const m = foliageMaterials();
  const kind = opts.kind ?? 'broadleaf';
  const asset =
    kind === 'palm'
      ? generatePalm({ seed: opts.seed, height: opts.height })
      : kind === 'bush'
        ? generateBush({ seed: opts.seed, radius: opts.crownRadius, blossom: opts.blossom })
        : generateBroadleaf(opts);
  const g = new THREE.Group();
  g.name = `nature-${kind}`;
  const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material, depth: THREE.Material) => {
    if (geo === null) return;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = depth;
    g.add(mesh);
  };
  if (kind === 'palm') {
    add(asset.wood, m.palmBark, m.palmBarkDepth);
    add(asset.leaves, m.frond, m.frondDepth);
  } else if (kind === 'bush') {
    add(asset.leaves, m.bush, m.bushDepth);
    add(asset.blossoms, m.blossom, m.blossomDepth);
  } else {
    add(asset.wood, m.bark, m.barkDepth);
    add(asset.leaves, m.leaf, m.leafDepth);
  }
  return g;
}

// ── Foliage system (instanced, chunked) ─────────────────────────────────

export type PlantKind = 'broadleaf' | 'palm' | 'bush' | 'flowerBush';

export interface PlantPlacement {
  kind: PlantKind;
  position: THREE.Vector3;
  rotation?: number;
  scale?: number;
  /** Variant index (defaults to a hash of the position). */
  variant?: number;
}

export interface FoliageRegion {
  region: Region;
  /** Grass density multiplier (1 = quality default; 0 = none). */
  grass?: number;
  /** Meadow flowers per m² (scaled by quality). */
  flowers?: number;
  /** Broadleaf trees per 100 m². */
  trees?: number;
  palms?: number;
  /** Bushes per 100 m² (a third get blossoms). */
  bushes?: number;
  /** Add a lawn ground mesh slightly above the region's ground height. */
  lawn?: boolean;
  /** Expected ground height (fallback when the collision ray misses). */
  y?: number;
  /** Keep this far from the region edge for plants (m). */
  inset?: number;
  /** Positions to keep clear (e.g. water, paths): returns true to reject. */
  exclude?: (x: number, z: number) => boolean;
}

const GRASS_DENSITY: Record<NatureQuality, number> = { low: 1.6, medium: 6, high: 11 };
const GRASS_BLADES: Record<NatureQuality, number> = { low: 6, medium: 8, high: 10 };
const VARIANTS = 3;

export class FoliageSystem {
  readonly group = new THREE.Group();
  readonly quality: NatureQuality;
  readonly mats: FoliageMaterials;
  /** Simple trunk boxes for the collision world (add before CollisionWorld.build). */
  readonly collisionMeshes: THREE.Mesh[] = [];
  private placements: PlantPlacement[] = [];
  private grassInst: InstanceSpec[] = [];
  private flowerInst: InstanceSpec[] = [];
  private grassChunks: THREE.InstancedMesh[] = [];
  private assets = new Map<string, PlantAsset>();
  private built: THREE.Object3D[] = [];
  private seed: number;

  constructor(quality: NatureQuality = 'medium', seed = 1) {
    this.quality = quality;
    this.seed = seed;
    this.mats = foliageMaterials(quality);
    this.group.name = 'nature-foliage';
  }

  private asset(kind: PlantKind, variant: number): PlantAsset {
    const key = `${kind}:${variant}`;
    let a = this.assets.get(key);
    if (a === undefined) {
      const dens = CARD_COUNT[this.quality];
      const seed = this.seed * 101 + variant * 17 + 3;
      if (kind === 'broadleaf') a = generateBroadleaf({ seed, leafDensity: dens });
      else if (kind === 'palm')
        a = generatePalm({ seed, fronds: this.quality === 'low' ? 12 : 16 });
      else {
        const cells = [
          FLOWER_CELLS.pinkBlossom,
          FLOWER_CELLS.whiteBlossom,
          FLOWER_CELLS.blueBlossom,
        ];
        a = generateBush({
          seed,
          leafDensity: dens,
          blossom: kind === 'flowerBush' ? cells[variant % cells.length] : null,
        });
      }
      this.assets.set(key, a);
    }
    return a;
  }

  addPlant(p: PlantPlacement) {
    this.placements.push(p);
    if (p.kind === 'broadleaf' || p.kind === 'palm') {
      const s = p.scale ?? 1;
      const r = (p.kind === 'palm' ? 0.26 : 0.32) * s;
      const col = new THREE.Mesh(new THREE.BoxGeometry(r * 2, 3 * s, r * 2));
      col.position.set(p.position.x, p.position.y + 1.5 * s, p.position.z);
      col.updateMatrixWorld(true);
      this.collisionMeshes.push(col);
    }
  }

  /** Grass tufts over a region at the quality's density × `density`. */
  addGrass(
    region: Region,
    ground: GroundQuery | null,
    y = 0,
    density = 1,
    exclude?: (x: number, z: number) => boolean,
  ) {
    const s = regionSampler(region);
    const n = Math.round(s.area * GRASS_DENSITY[this.quality] * density);
    const rng = new Rng(this.seed * 7 + this.grassInst.length);
    const q = new THREE.Quaternion();
    const tint = new THREE.Color();
    for (let i = 0; i < n * 1.5 && this.grassInst.length < 400000; i++) {
      const x = rng.range(s.bbox.min.x, s.bbox.max.x);
      const z = rng.range(s.bbox.min.y, s.bbox.max.y);
      if (!s.contains(x, z)) continue;
      if (exclude?.(x, z) === true) continue;
      const g = groundAt(ground, x, z, y, y + 1.2);
      if (Math.abs(g.y - y) > 0.4) continue;
      const edge = smooth(0, 0.8, s.edgeDistance(x, z));
      const patch = fbm2(x * 0.03, z * 0.03, 5, 3, 8);
      const sc = rng.range(0.7, 1.25) * (0.55 + 0.45 * edge) * (0.75 + patch * 0.6);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, Math.PI * 2));
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, g.y, z),
        q,
        new THREE.Vector3(sc, sc * rng.range(0.85, 1.15), sc),
      );
      const yellow = smooth(0.45, 0.75, patch);
      tint.setRGB(1 + 0.12 * yellow, 1 + 0.02 * yellow, 1 - 0.25 * yellow);
      tint.multiplyScalar(rng.range(0.88, 1.08));
      this.grassInst.push({ matrix: m, color: tint.clone() });
    }
  }

  /** Meadow flower sprites (pink/white/yellow/lavender), clustered by noise. */
  addFlowers(
    region: Region,
    ground: GroundQuery | null,
    y = 0,
    perM2 = 0.6,
    exclude?: (x: number, z: number) => boolean,
  ) {
    const s = regionSampler(region);
    const qMul = this.quality === 'low' ? 0.4 : this.quality === 'medium' ? 1 : 1.4;
    const n = Math.round(s.area * perM2 * qMul);
    const rng = new Rng(this.seed * 13 + this.flowerInst.length);
    const q = new THREE.Quaternion();
    for (let i = 0, placed = 0; i < n * 4 && placed < n; i++) {
      const x = rng.range(s.bbox.min.x, s.bbox.max.x);
      const z = rng.range(s.bbox.min.y, s.bbox.max.y);
      if (!s.contains(x, z) || exclude?.(x, z) === true) continue;
      const cl = fbm2(x * 0.08 + 3, z * 0.08, 17, 3, 8);
      if (rng.next() > smooth(0.4, 0.62, cl) + 0.08) continue;
      const g = groundAt(ground, x, z, y, y + 1.2);
      if (Math.abs(g.y - y) > 0.4) continue;
      const type = Math.floor(fbm2(x * 0.05, z * 0.05, 29, 2, 8) * 7.99) % 4;
      const sc = rng.range(0.6, 1.1);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, Math.PI * 2));
      this.flowerInst.push({
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(x, g.y, z),
          q,
          new THREE.Vector3(sc, sc, sc),
        ),
        cell: type,
      });
      placed++;
    }
  }

  /** Lawn ground mesh (receives shadows) shaped like the region. */
  addLawn(region: Region, y: number): THREE.Mesh {
    let geo: THREE.BufferGeometry;
    if (region.type === 'circle') {
      geo = new THREE.CircleGeometry(region.radius, 48);
      geo.rotateX(-Math.PI / 2);
      const c = Array.isArray(region.center) ? region.center : [region.center.x, region.center.y];
      geo.translate(c[0], 0, c[1]);
    } else {
      const s = regionSampler(region);
      const pts: THREE.Vector2[] =
        region.type === 'polygon'
          ? region.points.map(p => (Array.isArray(p) ? new THREE.Vector2(p[0], p[1]) : p.clone()))
          : [
              new THREE.Vector2(s.bbox.min.x, s.bbox.min.y),
              new THREE.Vector2(s.bbox.max.x, s.bbox.min.y),
              new THREE.Vector2(s.bbox.max.x, s.bbox.max.y),
              new THREE.Vector2(s.bbox.min.x, s.bbox.max.y),
            ];
      geo = new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, -p.y))));
      geo.rotateX(-Math.PI / 2);
    }
    // World-space UVs (≈ 3 m tile)
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i) / 3;
      uv[i * 2 + 1] = pos.getZ(i) / 3;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(geo, this.mats.lawn);
    mesh.position.y = y + 0.012;
    mesh.receiveShadow = true;
    mesh.name = 'nature-lawn';
    this.group.add(mesh);
    return mesh;
  }

  /** Scatter plants + grass + flowers over regions (see FoliageRegion). */
  scatter(ground: GroundQuery | null, regions: FoliageRegion[]) {
    const rng = new Rng(this.seed * 31 + 9);
    for (const fr of regions) {
      const s = regionSampler(fr.region);
      const y = fr.y ?? 0;
      const inset = fr.inset ?? 1;
      if (fr.lawn === true) this.addLawn(fr.region, y);
      const taken: { x: number; z: number; r: number }[] = [];
      const place = (kind: PlantKind, per100: number | undefined, minDist: number) => {
        if (per100 === undefined || per100 <= 0) return;
        const want = Math.max(1, Math.round((s.area / 100) * per100));
        let placed = 0;
        for (let i = 0; i < want * 30 && placed < want; i++) {
          const x = rng.range(s.bbox.min.x, s.bbox.max.x);
          const z = rng.range(s.bbox.min.y, s.bbox.max.y);
          if (s.edgeDistance(x, z) < inset) continue;
          if (fr.exclude?.(x, z) === true) continue;
          if (taken.some(t => Math.hypot(t.x - x, t.z - z) < Math.max(t.r, minDist))) continue;
          const g = groundAt(ground, x, z, y, y + 1.2);
          if (Math.abs(g.y - y) > 0.4) continue;
          taken.push({ x, z, r: minDist });
          this.addPlant({
            kind,
            position: new THREE.Vector3(x, g.y, z),
            rotation: rng.range(0, Math.PI * 2),
            scale: rng.range(0.85, 1.15),
          });
          placed++;
        }
      };
      place('broadleaf', fr.trees, 5.5);
      place('palm', fr.palms, 4);
      if (fr.bushes !== undefined && fr.bushes > 0) {
        place('bush', fr.bushes * 0.65, 1.6);
        place('flowerBush', fr.bushes * 0.35, 1.6);
      }
      if (fr.grass !== undefined && fr.grass > 0) {
        this.addGrass(fr.region, ground, y, fr.grass, (x, z) => {
          if (fr.exclude?.(x, z) === true) return true;
          // fewer tufts right under bushes
          return taken.some(t => t.r < 2 && Math.hypot(t.x - x, t.z - z) < 0.6);
        });
      }
      if (fr.flowers !== undefined && fr.flowers > 0) {
        this.addFlowers(fr.region, ground, y, fr.flowers, fr.exclude);
      }
    }
  }

  /** (Re)build all instanced meshes from the accumulated placements. */
  build(): THREE.Group {
    for (const o of this.built) {
      this.group.remove(o);
      if ((o as THREE.InstancedMesh).isInstancedMesh === true) (o as THREE.InstancedMesh).dispose();
    }
    this.built = [];
    this.grassChunks = [];
    const byKey = new Map<string, InstanceSpec[]>();
    const q = new THREE.Quaternion();
    const tint = new THREE.Color();
    const rng = new Rng(this.seed + 77);
    for (const p of this.placements) {
      const variant =
        p.variant ?? Math.abs(Math.floor(p.position.x * 13.1 + p.position.z * 7.7)) % VARIANTS;
      const key = `${p.kind}:${variant}`;
      let list = byKey.get(key);
      if (list === undefined) {
        list = [];
        byKey.set(key, list);
      }
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotation ?? 0);
      const s = p.scale ?? 1;
      tint.setRGB(rng.range(0.92, 1.06), rng.range(0.95, 1.05), rng.range(0.85, 1.05));
      list.push({
        matrix: new THREE.Matrix4().compose(p.position, q, new THREE.Vector3(s, s, s)),
        color: tint.clone(),
      });
    }
    const m = this.mats;
    const treeChunk = 48;
    for (const [key, list] of byKey) {
      const [kind, v] = key.split(':') as [PlantKind, string];
      const a = this.asset(kind, Number(v));
      const parts: [THREE.BufferGeometry | null, THREE.Material, THREE.Material, string][] =
        kind === 'palm'
          ? [
              [a.wood, m.palmBark, m.palmBarkDepth, 'palm-trunk'],
              [a.leaves, m.frond, m.frondDepth, 'palm-fronds'],
            ]
          : kind === 'broadleaf'
            ? [
                [a.wood, m.bark, m.barkDepth, 'tree-wood'],
                [a.leaves, m.leaf, m.leafDepth, 'tree-leaves'],
              ]
            : [
                [a.leaves, m.bush, m.bushDepth, 'bush-leaves'],
                [a.blossoms, m.blossom, m.blossomDepth, 'bush-blossoms'],
              ];
      for (const [geo, mat, depth, name] of parts) {
        if (geo === null) continue;
        const isWood = name.endsWith('trunk') || name.endsWith('wood');
        const chunks = buildInstancedChunks(
          geo,
          mat,
          isWood ? list.map(l => ({ matrix: l.matrix })) : list,
          {
            chunkSize: treeChunk,
            castShadow: kind !== 'bush' || this.quality !== 'low',
            receiveShadow: true,
            depthMaterial: depth,
            name: `nature-${name}`,
          },
        );
        for (const c of chunks) {
          this.group.add(c);
          this.built.push(c);
        }
      }
    }
    if (this.grassInst.length > 0) {
      const tuft = generateGrassTuft(this.seed, GRASS_BLADES[this.quality]);
      const chunks = buildInstancedChunks(tuft, m.grass, this.grassInst, {
        chunkSize: 10,
        castShadow: false,
        receiveShadow: true,
        name: 'nature-grass',
      });
      for (const c of chunks) {
        this.group.add(c);
        this.built.push(c);
        this.grassChunks.push(c);
      }
    }
    if (this.flowerInst.length > 0) {
      const chunks = buildInstancedChunks(generateFlowerSprite(), m.meadow, this.flowerInst, {
        chunkSize: 12,
        castShadow: false,
        receiveShadow: true,
        name: 'nature-flowers',
      });
      for (const c of chunks) {
        this.group.add(c);
        this.built.push(c);
        this.grassChunks.push(c);
      }
    }
    return this.group;
  }

  /** Hide grass/flower chunks beyond the fade radius. */
  update(camera: THREE.Camera) {
    const fadeEnd = (
      this.mats.grass.userData.nwUniforms as { grassFade: THREE.Uniform<THREE.Vector2> }
    ).grassFade.value.y;
    const cp = camera.position;
    for (const c of this.grassChunks) {
      const bs = c.boundingSphere;
      if (bs === null) continue;
      const d = Math.hypot(bs.center.x - cp.x, bs.center.z - cp.z) - bs.radius;
      c.visible = d < fadeEnd;
    }
  }

  stats() {
    let tris = 0;
    let instances = 0;
    for (const o of this.built) {
      const im = o as THREE.InstancedMesh;
      const idx = im.geometry.index;
      const t = idx !== null ? idx.count / 3 : im.geometry.attributes.position.count / 3;
      tris += t * im.count;
      instances += im.count;
    }
    return { meshes: this.built.length, instances, tris };
  }
}

/**
 * One-shot helper: scatter foliage over regions and add it to the scene.
 * Returns the system (call `.update(camera)` each frame for grass culling;
 * add `.collisionMeshes` to the collision world).
 */
export function scatterFoliage(
  scene: THREE.Object3D,
  ground: GroundQuery | null,
  regions: FoliageRegion[],
  opts: { quality?: NatureQuality; seed?: number } = {},
): FoliageSystem {
  const sys = new FoliageSystem(opts.quality ?? 'medium', opts.seed ?? 1);
  sys.scatter(ground, regions);
  sys.build();
  scene.add(sys.group);
  return sys;
}
