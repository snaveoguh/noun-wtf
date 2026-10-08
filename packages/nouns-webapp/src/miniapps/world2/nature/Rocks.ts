// ── Rounded boulders + pebbles ──────────────────────────────────────────
//
// Displaced, Laplacian-smoothed low-detail icospheres (river-worn shapes),
// split into flat facets ("flat planes") and shaded with the shared toon
// ramp; creamy tint + cavity AO baked into vertex colours. Instanced per variant.

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import {
  NATURE_BED_LAYER,
  type GroundQuery,
  type InstanceSpec,
  type NatureQuality,
  Rng,
  buildInstancedChunks,
  fbm3,
  groundAt,
  toonMaterial,
} from './shared';

export interface BoulderOptions {
  seed?: number;
  /** Icosphere subdivision (3 ≈ 1.3k tris, 2 ≈ 320). */
  detail?: number;
  /** Vertical squash (0.5 = flat slab, 1 = round). */
  squash?: number;
  /** Shape irregularity. */
  lumpiness?: number;
}

/** Unit-ish boulder resting on y=0 (bottom flattened and sunk ~10%). */
export function generateBoulder(o: BoulderOptions = {}): THREE.BufferGeometry {
  const rng = new Rng(o.seed ?? 1);
  const detail = o.detail ?? 3;
  const squash = o.squash ?? rng.range(0.55, 0.85);
  const lump = o.lumpiness ?? rng.range(0.35, 0.6);
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo, 1e-4);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const sx = rng.range(0.9, 1.25);
  const sz = rng.range(0.8, 1.1);
  const off = new THREE.Vector3(rng.range(0, 100), rng.range(0, 100), rng.range(0, 100));
  const v = new THREE.Vector3();
  const radius = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const low = fbm3(v.x * 1.1 + off.x, v.y * 1.1 + off.y, v.z * 1.1 + off.z, 3, 3);
    const mid = fbm3(v.x * 3.2 + off.y, v.y * 3.2 + off.z, v.z * 3.2 + off.x, 9, 3);
    const r = 1 + (low - 0.5) * lump * 1.4 + (mid - 0.5) * 0.12;
    radius[i] = r;
    v.multiplyScalar(r);
    v.set(v.x * sx, v.y * squash, v.z * sz);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // Neighbour lists for smoothing / cavity
  const idx = geo.index;
  const nb: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  if (idx !== null) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      const b = idx.getX(i + 1);
      const c = idx.getX(i + 2);
      nb[a].add(b).add(c);
      nb[b].add(a).add(c);
      nb[c].add(a).add(b);
    }
  }
  const tmp = new Float32Array(n * 3);
  for (let it = 0; it < 2; it++) {
    for (let i = 0; i < n; i++) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (const j of nb[i]) {
        x += pos.getX(j);
        y += pos.getY(j);
        z += pos.getZ(j);
      }
      const k = nb[i].size;
      tmp[i * 3] = pos.getX(i) * 0.5 + (x / k) * 0.5;
      tmp[i * 3 + 1] = pos.getY(i) * 0.5 + (y / k) * 0.5;
      tmp[i * 3 + 2] = pos.getZ(i) * 0.5 + (z / k) * 0.5;
    }
    for (let i = 0; i < n; i++) pos.setXYZ(i, tmp[i * 3], tmp[i * 3 + 1], tmp[i * 3 + 2]);
  }
  // Flatten + sink the bottom so it sits on the ground
  let minY = Infinity;
  for (let i = 0; i < n; i++) minY = Math.min(minY, pos.getY(i));
  const cut = minY + (0 - minY) * 0.45;
  for (let i = 0; i < n; i++) {
    let y = pos.getY(i);
    if (y < cut) y = cut + (y - cut) * 0.2;
    pos.setY(i, y - cut - squash * 0.08);
  }
  geo.computeVertexNormals();
  // Cavity AO: vertices sitting below their neighbours' average (along the normal) get darker.
  const nrm = geo.attributes.normal;
  const colors = new Float32Array(n * 3);
  const avg = new THREE.Vector3();
  const nn = new THREE.Vector3();
  const tint = new THREE.Color();
  const base = new THREE.Color().setRGB(0.93, 0.9, 0.84, THREE.SRGBColorSpace);
  const hueShift = rng.range(-1, 1);
  for (let i = 0; i < n; i++) {
    avg.set(0, 0, 0);
    for (const j of nb[i]) avg.x += pos.getX(j);
    for (const j of nb[i]) avg.y += pos.getY(j);
    for (const j of nb[i]) avg.z += pos.getZ(j);
    avg.divideScalar(Math.max(1, nb[i].size));
    v.fromBufferAttribute(pos, i);
    nn.fromBufferAttribute(nrm, i);
    const cav = avg.sub(v).dot(nn); // >0 = concave
    const ao =
      Math.max(0.55, Math.min(1, 1 - cav * 9)) *
      (0.72 + 0.28 * Math.min(1, Math.max(0, (v.y + 0.05) / (squash * 0.6))));
    tint.copy(base).multiplyScalar(ao);
    tint.r *= 1 + hueShift * 0.03;
    tint.b *= 1 - hueShift * 0.04;
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // Faceted: split vertices so each triangle gets a flat normal ("flat planes").
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

let rockMatCache: THREE.MeshToonMaterial | null = null;

/**
 * Cel-shaded creamy stone: flat-shaded facets (low-detail icospheres give
 * the "flat planes" look) on the shared toon ramp, tint via vertex colours.
 * Pass `shared=false` for a fresh instance (e.g. to add caustics for one pond).
 */
export function rockMaterial(shared = true, color = 0xffffff): THREE.MeshToonMaterial {
  if (shared && rockMatCache !== null) return rockMatCache;
  const m = toonMaterial({ color, vertexColors: true });
  if (shared) rockMatCache = m;
  return m;
}

// ── Instanced rock field ────────────────────────────────────────────────

export interface RockPlacement {
  position: THREE.Vector3;
  /** Uniform size (m) or per-axis scale. */
  size: number | THREE.Vector3;
  rotation?: THREE.Euler;
  variant?: number;
  /** Small pebble geometry (lower detail). */
  pebble?: boolean;
  /** Add a collision proxy (big boulders only). */
  collide?: boolean;
}

const ROCK_VARIANTS = 5;
const DETAIL: Record<NatureQuality, [number, number]> = {
  low: [1, 0],
  medium: [2, 1],
  high: [2, 1],
};

export class RockField {
  readonly group = new THREE.Group();
  readonly collisionMeshes: THREE.Mesh[] = [];
  readonly material: THREE.MeshToonMaterial;
  private placements: RockPlacement[] = [];
  private quality: NatureQuality;
  private seed: number;
  private bedLayer: boolean;
  private built: THREE.InstancedMesh[] = [];
  private static geoCache = new Map<string, THREE.BufferGeometry>();

  /**
   * @param bedLayer also render into the water refraction pass (rocks in/near water)
   * @param material custom material (e.g. a rockMaterial(false) with caustics)
   */
  constructor(
    quality: NatureQuality = 'medium',
    opts: { seed?: number; bedLayer?: boolean; material?: THREE.MeshToonMaterial } = {},
  ) {
    this.quality = quality;
    this.seed = opts.seed ?? 1;
    this.bedLayer = opts.bedLayer ?? false;
    this.material = opts.material ?? rockMaterial();
    this.group.name = 'nature-rocks';
  }

  static geometry(quality: NatureQuality, variant: number, pebble: boolean): THREE.BufferGeometry {
    const key = `${quality}:${variant}:${pebble ? 1 : 0}`;
    let g = RockField.geoCache.get(key);
    if (g === undefined) {
      g = generateBoulder({
        seed: variant * 31 + (pebble ? 7 : 1),
        detail: DETAIL[quality][pebble ? 1 : 0],
        squash: pebble ? 0.5 + (variant % 3) * 0.08 : undefined,
      });
      RockField.geoCache.set(key, g);
    }
    return g;
  }

  add(p: RockPlacement) {
    this.placements.push(p);
    if (p.collide === true) {
      const s = typeof p.size === 'number' ? new THREE.Vector3(p.size, p.size, p.size) : p.size;
      const col = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1));
      col.position.copy(p.position);
      col.scale.copy(s);
      col.updateMatrixWorld(true);
      this.collisionMeshes.push(col);
    }
  }

  /**
   * Line boulders (and pebbles between them) along a polyline, offset
   * sideways by `offset` (e.g. a water shoreline).
   */
  addAlong(
    points: THREE.Vector3[],
    o: {
      spacing?: number;
      size?: [number, number];
      offset?: number;
      jitter?: number;
      closed?: boolean;
      pebbles?: number;
      ground?: GroundQuery | null;
      collide?: boolean;
      skip?: (t: number) => boolean;
    } = {},
  ) {
    const rng = new Rng(this.seed * 17 + this.placements.length);
    const curve = new THREE.CatmullRomCurve3(points, o.closed ?? false, 'centripetal');
    const len = curve.getLength();
    const spacing = o.spacing ?? 1.3;
    const [smin, smax] = o.size ?? [0.45, 1.1];
    const n = Math.max(2, Math.floor(len / spacing));
    for (let i = 0; i < n; i++) {
      const t = (i + rng.range(-0.3, 0.3)) / n;
      const tc = Math.min(1, Math.max(0, t));
      if (o.skip?.(tc) === true) continue;
      const p = curve.getPointAt(tc);
      const tan = curve.getTangentAt(tc);
      const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
      const big = rng.next() < 0.35;
      const s = rng.range(smin, smax) * (big ? 1.35 : 1);
      p.addScaledVector(side, (o.offset ?? 0) + rng.range(-1, 1) * (o.jitter ?? 0.25));
      const g = groundAt(o.ground, p.x, p.z, p.y, p.y + 1);
      this.add({
        position: new THREE.Vector3(p.x, Math.min(g.y, p.y + 0.3) - s * 0.08, p.z),
        size: new THREE.Vector3(
          s * rng.range(0.85, 1.2),
          s * rng.range(0.75, 1.1),
          s * rng.range(0.85, 1.2),
        ),
        rotation: new THREE.Euler(
          rng.range(-0.15, 0.15),
          rng.range(0, Math.PI * 2),
          rng.range(-0.15, 0.15),
        ),
        variant: rng.int(0, ROCK_VARIANTS - 1),
        collide: (o.collide ?? true) && s > 0.7,
      });
      const peb = o.pebbles ?? 3;
      for (let k = 0; k < peb; k++) {
        const q = p
          .clone()
          .addScaledVector(side, rng.range(-1.2, 1.2) * s)
          .addScaledVector(tan, rng.range(-1, 1) * spacing * 0.6);
        const ps = rng.range(0.08, 0.22);
        this.add({
          position: new THREE.Vector3(q.x, p.y - ps * 0.1, q.z),
          size: new THREE.Vector3(ps * rng.range(1, 1.5), ps, ps * rng.range(0.9, 1.3)),
          rotation: new THREE.Euler(0, rng.range(0, Math.PI * 2), 0),
          variant: rng.int(0, ROCK_VARIANTS - 1),
          pebble: true,
        });
      }
    }
  }

  build(): THREE.Group {
    for (const b of this.built) {
      this.group.remove(b);
      b.dispose();
    }
    this.built = [];
    const buckets = new Map<string, InstanceSpec[]>();
    const rng = new Rng(this.seed);
    for (const p of this.placements) {
      const variant = (p.variant ?? rng.int(0, ROCK_VARIANTS - 1)) % ROCK_VARIANTS;
      const key = `${variant}:${p.pebble === true ? 1 : 0}`;
      let list = buckets.get(key);
      if (list === undefined) {
        list = [];
        buckets.set(key, list);
      }
      const s = typeof p.size === 'number' ? new THREE.Vector3(p.size, p.size, p.size) : p.size;
      const q = new THREE.Quaternion().setFromEuler(
        p.rotation ?? new THREE.Euler(0, rng.range(0, 6.28), 0),
      );
      const tint = rng.range(0.94, 1.04);
      list.push({
        matrix: new THREE.Matrix4().compose(p.position, q, s),
        color: new THREE.Color(tint, tint * rng.range(0.98, 1.01), tint * rng.range(0.95, 1.0)),
      });
    }
    for (const [key, list] of buckets) {
      const [v, peb] = key.split(':').map(Number);
      const chunks = buildInstancedChunks(
        RockField.geometry(this.quality, v, peb === 1),
        this.material,
        list,
        {
          chunkSize: 40,
          castShadow: peb !== 1,
          receiveShadow: true,
          name: peb === 1 ? 'nature-pebbles' : 'nature-boulders',
        },
      );
      for (const c of chunks) {
        if (this.bedLayer) c.layers.enable(NATURE_BED_LAYER);
        this.group.add(c);
        this.built.push(c);
      }
    }
    return this.group;
  }
}

/** One standalone boulder mesh (shared material). */
export function createBoulder(size = 1, seed = 1, quality: NatureQuality = 'medium'): THREE.Mesh {
  const m = new THREE.Mesh(
    RockField.geometry(quality, seed % ROCK_VARIANTS, false),
    rockMaterial(),
  );
  m.scale.setScalar(size);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
