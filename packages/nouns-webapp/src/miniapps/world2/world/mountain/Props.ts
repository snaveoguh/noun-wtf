// ── Mountain dressing: smooth rocks + launch ramps (chunk decorators) ────
//
// Both are pure functions of the chunk coordinates + fixed seed, so every
// client sees the same rocks and ramps in the same places.

import type { ChunkContext, ChunkDecoration, ChunkDecorator } from './MountainStream';

import * as THREE from 'three';

import { generateBoulder, rockMaterial } from '../../nature/Rocks';
import { toonify } from '../../render/Toon';

import { MOUNTAIN, type TerrainSample } from './terrain';
import { tracks, type Ramp } from './tracks';

const _s: TerrainSample = { y: 0, track: 0, alley: 0, side: 0, dist: 0 };

// ── Rocks ───────────────────────────────────────────────────────────────

const ROCK_VARIANTS = 6;
let rockGeos: THREE.BufferGeometry[] | null = null;

/** Build the shared boulder shapes up front (during loading, not mid-ride). */
export function warmMountainProps() {
  rockVariants();
}

function rockVariants(): THREE.BufferGeometry[] {
  if (rockGeos === null) {
    rockGeos = [];
    for (let i = 0; i < ROCK_VARIANTS; i++)
      rockGeos.push(generateBoulder({ seed: 9001 + i * 17, detail: 2 }));
  }
  return rockGeos;
}

/** Scattered boulders off the track (never on the dirt line itself). */
export const rockDecorator: ChunkDecorator = {
  id: 'rocks',
  populate(ctx: ChunkContext): ChunkDecoration | null {
    const variants = rockVariants();
    const count = 3 + Math.floor(ctx.random() * 6);
    const parts: THREE.BufferGeometry[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const lx = ctx.random() * ctx.size;
      const lz = ctx.random() * ctx.size;
      const r0 = ctx.random();
      const r1 = ctx.random();
      const r2 = ctx.random();
      const wx = ctx.origin.x + lx;
      const wz = ctx.origin.z + lz;
      if (Math.max(Math.abs(wx), Math.abs(wz)) < MOUNTAIN.wallZ + 18) continue;
      const s = ctx.sample(wx, wz, _s);
      // Keep the lines (and their shoulders + landing hills) clear
      if (s.dist < MOUNTAIN.trackHalf + 14 || s.alley > 0) continue;
      // Mostly mid-size, the odd big boulder further out
      const far = s.dist > 40;
      const size = 0.7 + r0 * r0 * (far ? 3.4 : 1.8);
      // Sink by the local slope so the downhill side doesn't float
      const e = size * 0.8;
      const lo = Math.min(
        ctx.height(wx + e, wz),
        ctx.height(wx - e, wz),
        ctx.height(wx, wz + e),
        ctx.height(wx, wz - e),
      );
      const y = Math.min(s.y, lo) - size * 0.12;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r1 * Math.PI * 2);
      sc.set(size * (0.9 + r2 * 0.4), size * (0.75 + r1 * 0.35), size * (0.9 + r0 * 0.3));
      p.set(lx, y, lz);
      m.compose(p, q, sc);
      const g = variants[Math.floor(r2 * ROCK_VARIANTS) % ROCK_VARIANTS].clone();
      g.applyMatrix4(m);
      parts.push(g);
    }
    if (parts.length === 0) return null;
    const geo = mergeSimple(parts);
    for (const g of parts) g.dispose();
    const mesh = new THREE.Mesh(geo, rockMaterial());
    mesh.name = 'mountain-rocks';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return { object: mesh, collision: geo, dispose: () => geo.dispose() };
  },
};

// ── Launch ramps ────────────────────────────────────────────────────────
//
// Placed on the dirt lines by tracks.rampAt (small ~1 m kickers, medium
// ~2.5 m jumps, big 5 m launchers), each followed by a landing hill the
// terrain carves into the track. Wooden plank decks + bright painted sides.

let rampMat: THREE.MeshStandardMaterial | null = null;

const PAINT = {
  small: new THREE.Color(0xffd23f),
  medium: new THREE.Color(0x3ec7e8),
  big: new THREE.Color(0xff4f9a),
};

/** Ramps whose lip lies in this chunk. */
export const rampDecorator: ChunkDecorator = {
  id: 'ramps',
  populate(ctx: ChunkContext): ChunkDecoration | null {
    const list = tracks.rampsIn(
      ctx.origin.x,
      ctx.origin.z,
      ctx.origin.x + ctx.size,
      ctx.origin.z + ctx.size,
    );
    if (list.length === 0) return null;
    const geos = list.map(r => buildRamp(ctx, r));
    const geo = mergeSimple(geos);
    for (const g of geos) g.dispose();
    if (rampMat === null) {
      rampMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
      rampMat.name = 'MountainRamp';
    }
    const mesh = new THREE.Mesh(geo, rampMat);
    mesh.name = 'mountain-ramps';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (ctx.toon) toonify(mesh);
    return { object: mesh, collision: geo, dispose: () => geo.dispose() };
  },
};

/**
 * Terrain-following launch ramp: every deck point sits rise(t) above the
 * ground under it (seamless run-in at any slope), rising on a curved
 * transition to a vertical lip. Chunk-local coordinates.
 */
function buildRamp(ctx: ChunkContext, r: Ramp) {
  const sp = r.spec;
  const fx = Math.sin(r.heading);
  const fz = Math.cos(r.heading);
  const rx = fz;
  const rz = -fx;
  const SEG = sp.size === 'big' ? 18 : sp.size === 'medium' ? 12 : 8;
  const pos: number[] = [];
  const col: number[] = [];
  const ply = new THREE.Color(0xe7ad5c);
  const plyDark = new THREE.Color(0xc98a45);
  const paint = PAINT[sp.size];
  const coping = new THREE.Color(0x3a3550);
  const ox = ctx.origin.x;
  const oz = ctx.origin.z;
  const rise = (t: number) => sp.height * Math.pow(t, sp.power);
  const deck: THREE.Vector3[][] = [];
  const base: THREE.Vector3[][] = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const s = (t - 1) * sp.length;
    const row: THREE.Vector3[] = [];
    const brow: THREE.Vector3[] = [];
    for (const e of [-0.5, 0.5]) {
      const wx = r.x + fx * s + rx * e * sp.width;
      const wz = r.z + fz * s + rz * e * sp.width;
      const gy = ctx.height(wx, wz);
      row.push(new THREE.Vector3(wx - ox, gy + rise(t) + 0.02, wz - oz));
      brow.push(new THREE.Vector3(wx - ox, gy - 0.4, wz - oz));
    }
    deck.push(row);
    base.push(brow);
  }
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let k = 0; k < 3; k++) col.push(color.r, color.g, color.b);
  };
  const quad = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    color: THREE.Color,
  ) => {
    tri(a, b, c, color);
    tri(a, c, d, color);
  };
  for (let i = 0; i < SEG; i++) {
    const l0 = deck[i][0];
    const r0 = deck[i][1];
    const l1 = deck[i + 1][0];
    const r1 = deck[i + 1][1];
    const c = i === SEG - 1 ? coping : i % 2 === 0 ? ply : plyDark;
    quad(l0, l1, r1, r0, c);
    quad(base[i][0], base[i + 1][0], l1, l0, paint);
    quad(base[i + 1][1], base[i][1], r0, r1, paint);
  }
  // Lip face
  quad(base[SEG][0], base[SEG][1], deck[SEG][1], deck[SEG][0], paint);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Concatenate non-indexed geometries with the same attribute set. */
function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = geos.map(g => (g.index !== null ? g.toNonIndexed() : g));
  const names = Object.keys(list[0].attributes);
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const item = list[0].attributes[name].itemSize;
    let len = 0;
    for (const g of list) len += g.attributes[name]?.array.length ?? 0;
    const arr = new Float32Array(len);
    let o = 0;
    for (const g of list) {
      const a = g.attributes[name]?.array as Float32Array | undefined;
      if (a === undefined) continue;
      arr.set(a, o);
      o += a.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, item));
  }
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}
