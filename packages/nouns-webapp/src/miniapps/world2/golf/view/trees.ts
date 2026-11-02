// ── Noun Golf view: the course's trees (pure parts) ─────────────────────
//
// ~2700 trees in three kinds (pine, broadleaf, palm). Each kind is ONE
// unit geometry (trunk + canopy merged, coloured per vertex, toon-shaded
// like everything else), drawn as one InstancedMesh: three draws for every
// tree on the course. Which trees are in it is repacked (nearest tiles
// first) whenever the viewer has moved a few tens of metres, so only the
// ones within view range are drawn and the instanced bounds stay tight.
//
// Unit trees are 1 m tall with a canopy of radius 1 (scaled per tree by
// its r and h1); trunk proportions follow each kind's typical h0 / h1.

import type { Tree } from '../contract';

import { MeshBuf, type MeshData } from './kit';

/** Tiles for the range query (m). */
export const TREE_TILE = 100;

export interface TreeIndex {
  size: number;
  tiles: Map<number, number[]>;
  /** Tile keys with their centres (for nearest-first). */
  keys: { key: number; x: number; z: number }[];
}

const key = (i: number, k: number) => (i + 32768) * 65536 + (k + 32768);

/** Bucket trees (by index) into square tiles. */
export function tileTrees(trees: Tree[], size = TREE_TILE): TreeIndex {
  const tiles = new Map<number, number[]>();
  const keys: TreeIndex['keys'] = [];
  trees.forEach((t, n) => {
    const i = Math.floor(t.x / size);
    const k = Math.floor(t.z / size);
    const kk = key(i, k);
    let l = tiles.get(kk);
    if (l === undefined) {
      tiles.set(kk, (l = []));
      keys.push({ key: kk, x: (i + 0.5) * size, z: (k + 0.5) * size });
    }
    l.push(n);
  });
  return { size, tiles, keys };
}

/**
 * Indices of trees in tiles whose centre is within r (+ half a tile's
 * diagonal) of (x, z), nearest tile first, into `out`.
 */
export function treesWithin(ix: TreeIndex, x: number, z: number, r: number, out: number[]): number[] {
  out.length = 0;
  const reach = r + ix.size * 0.71;
  const near = ix.keys
    .map(k => ({ k, d: Math.hypot(k.x - x, k.z - z) }))
    .filter(e => e.d <= reach)
    .sort((a, b) => a.d - b.d);
  for (const e of near) for (const n of ix.tiles.get(e.k.key)!) out.push(n);
  return out;
}

const BARK = 0x7a5232;
const BARK_PALM = 0x9c7a4c;
const PINE = [0x2f7d46, 0x3a8f4f, 0x46a05a];
const LEAF = [0x4fa83c, 0x63bd45, 0x77cc4f];
const FROND = 0x5cb845;

/** The canopy bottom as a fraction of the height, per kind (layout.ts). */
export const H0_FRAC = [0.1, 0.24, 0.72];

/** Unit tree for a kind (0 pine, 1 broadleaf, 2 palm). `low`: fewer sides. */
export function unitTree(kind: 0 | 1 | 2, low = false): MeshData {
  const b = new MeshBuf(0, 0);
  const s = low ? 5 : 7;
  if (kind === 0) {
    // Trunk + three stacked cones
    b.cyl(0, 0, 0, 0.09, 0.06, 0.3, s, BARK, false);
    const tiers = [
      [0.1, 1, 0.5],
      [0.36, 0.78, 0.42],
      [0.6, 0.52, 0.4],
    ];
    tiers.forEach(([y, r, h], i) => b.cyl(0, y, 0, r, 0.02, h, s + 1, PINE[i], false));
    // Close each cone's underside
    tiers.forEach(([y, r], i) => {
      const base = b.count;
      for (let k = 0; k <= s + 1; k++) {
        const a = (k / (s + 1)) * Math.PI * 2;
        b.vert(Math.cos(a) * r, y, Math.sin(a) * r, 0, -1, 0, rgbHex(PINE[i]));
      }
      const c = b.vert(0, y, 0, 0, -1, 0, rgbHex(PINE[i]));
      for (let k = 0; k < s + 1; k++) b.tri(c, base + k, base + k + 1);
    });
  } else if (kind === 1) {
    // Trunk + a lumpy canopy of three blobs
    b.cyl(0, 0, 0, 0.1, 0.07, 0.42, s, BARK, false);
    blob(b, 0, 0.6, 0, 0.82, 0.34, LEAF[1], s + 2);
    blob(b, 0.42, 0.52, 0.18, 0.55, 0.24, LEAF[0], s + 1);
    blob(b, -0.36, 0.55, -0.28, 0.58, 0.25, LEAF[2], s + 1);
  } else {
    // A leaning palm: trunk segments, then fronds drooping out of the top
    const segs = 4;
    let px = 0;
    for (let i = 0; i < segs; i++) {
      const y = (i / segs) * 0.74;
      const nx = 0.035 * (i + 1) * (i + 1) * 0.25;
      b.cyl(px, y, 0, 0.05 - i * 0.006, 0.045 - i * 0.006, 0.74 / segs + 0.01, s - 1, BARK_PALM, i === segs - 1);
      px = nx;
    }
    const top = { x: px, y: 0.74 };
    const fronds = low ? 6 : 8;
    for (let f = 0; f < fronds; f++) {
      const a = (f / fronds) * Math.PI * 2 + 0.3;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // A bent leaf: two quads, out and down
      const p0 = [top.x, top.y, 0];
      const p1 = [top.x + ca * 0.55, top.y + 0.12, sa * 0.55];
      const p2 = [top.x + ca * 1.0, top.y - 0.22, sa * 1.0];
      const w = 0.16;
      const sx = -sa * w;
      const sz = ca * w;
      const col = rgbHex(FROND);
      const v = (p: number[], k: number) => b.vert(p[0] + sx * k, p[1], p[2] + sz * k, 0, 1, 0, col);
      const a0 = v(p0, 0.2);
      const a1 = v(p0, -0.2);
      const b0 = v(p1, 1);
      const b1 = v(p1, -1);
      const c0 = v(p2, 0.3);
      const c1 = v(p2, -0.3);
      // Both sides (fronds are seen from below too)
      for (const [x, y, z] of [
        [a0, b0, b1],
        [a0, b1, a1],
        [b0, c0, c1],
        [b0, c1, b1],
      ]) {
        b.tri(x, y, z);
        b.tri(x, z, y);
      }
    }
    // A few coconuts
    blob(b, top.x + 0.06, top.y - 0.03, 0.04, 0.07, 0.07, 0x6b4a22, 5);
    blob(b, top.x - 0.05, top.y - 0.04, -0.03, 0.07, 0.07, 0x6b4a22, 5);
  }
  return b.data();
}

function rgbHex(h: number) {
  return { r: lin(((h >> 16) & 255) / 255), g: lin(((h >> 8) & 255) / 255), b: lin((h & 255) / 255) };
}

function lin(c: number) {
  return c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** A squashed low-poly sphere (lat/long), centred at (x, y, z). */
function blob(b: MeshBuf, x: number, y: number, z: number, r: number, ry: number, hex: number, sides: number) {
  const col = rgbHex(hex);
  const rows = Math.max(3, Math.floor(sides / 2));
  const base = b.count;
  for (let j = 0; j <= rows; j++) {
    const v = (j / rows) * Math.PI;
    const sy = Math.cos(v);
    const sr = Math.sin(v);
    for (let i = 0; i <= sides; i++) {
      const u = (i / sides) * Math.PI * 2;
      const nx = Math.cos(u) * sr;
      const nz = Math.sin(u) * sr;
      b.vert(x + nx * r, y + sy * ry, z + nz * r, nx, sy, nz, col);
    }
  }
  const W = sides + 1;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < sides; i++) {
      const a = base + j * W + i;
      const c = a + W;
      b.tri(a, a + 1, c);
      b.tri(a + 1, c + 1, c);
    }
}

/**
 * Instance transform for a tree as a column-major 4×4 into `m` at `o`:
 * yaw, scale (r across, h1 up), at its ground point.
 */
export function treeMatrix(t: Tree, yaw: number, m: Float32Array, o: number) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const sr = t.r;
  const sh = t.h1;
  // R_y(yaw) · S(sr, sh, sr)
  m[o] = c * sr;
  m[o + 1] = 0;
  m[o + 2] = -s * sr;
  m[o + 3] = 0;
  m[o + 4] = 0;
  m[o + 5] = sh;
  m[o + 6] = 0;
  m[o + 7] = 0;
  m[o + 8] = s * sr;
  m[o + 9] = 0;
  m[o + 10] = c * sr;
  m[o + 11] = 0;
  m[o + 12] = t.x;
  m[o + 13] = t.y - 0.15;
  m[o + 14] = t.z;
  m[o + 15] = 1;
}

/** Per-tree yaw and tint from its position (deterministic). */
export function treeVariety(t: Tree, out: { yaw: number; r: number; g: number; b: number }) {
  const h = Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453;
  const f = h - Math.floor(h);
  const h2 = Math.sin(t.x * 39.3468 + t.z * 11.135) * 24634.6345;
  const f2 = h2 - Math.floor(h2);
  out.yaw = f * Math.PI * 2;
  const k = 0.86 + f2 * 0.24;
  out.r = k * (0.95 + f * 0.1);
  out.g = k;
  out.b = k * (0.92 + f2 * 0.08);
  return out;
}
