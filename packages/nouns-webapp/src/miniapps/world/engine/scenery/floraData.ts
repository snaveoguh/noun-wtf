// ── Flora data — deterministic instance lists per 64×64-tile chunk ───
//
// Walks the tilemap ONCE and buckets every tree / bush / rock / grass tuft
// / flower into the chunk it lives in, so Flora.tsx can build one
// InstancedMesh per category per chunk (frustum + distance culled) and
// FallingLeaves can find canopies near the player without scanning 11k
// trees every frame.

import { Tile, MAP_SIZE, MAP_ORIGIN, TILE_UNITS, CORE_SIZE } from '../types';
import { ISLAND_MAP, HILL_FIELD, sampleTerrainY, forestNoise, CORE_RADIUS_TILES } from '../tilemap';
import { hash2 } from '../noise';

export const CHUNK_TILES = 64;
export const CHUNKS_PER_AXIS = MAP_SIZE / CHUNK_TILES; // 10
export const CHUNK_UNITS = CHUNK_TILES * TILE_UNITS; // 102.4

export interface InstanceRec {
  x: number;
  y: number;
  z: number;
  /** uniform scale */
  s: number;
  /** yaw (radians) */
  rot: number;
  /** 0..1 variant / colour seed */
  v: number;
}

export interface ChunkFlora {
  cx: number;
  cz: number;
  centerX: number;
  centerZ: number;
  conifers: InstanceRec[];
  broadleaf: InstanceRec[];
  bushes: InstanceRec[];
  rocks: InstanceRec[];
  grass: InstanceRec[];
  flowers: InstanceRec[];
}

/** Packed canopy tops (x, yTop, z) for every tree — leaf emitters. */
export interface TreeIndex {
  xyz: Float32Array;
  count: number;
  /** cell key → tree indices; cells are LEAF_CELL units wide. */
  cells: Map<string, number[]>;
}

export const LEAF_CELL = 32;

let cache: { chunks: ChunkFlora[]; trees: TreeIndex } | null = null;

const CX = CORE_SIZE / 2;
const CY = CORE_SIZE / 2;

function build(): { chunks: ChunkFlora[]; trees: TreeIndex } {
  const chunks: ChunkFlora[] = [];
  const grid: ChunkFlora[][] = [];
  for (let cz = 0; cz < CHUNKS_PER_AXIS; cz++) {
    grid[cz] = [];
    for (let cx = 0; cx < CHUNKS_PER_AXIS; cx++) {
      const c: ChunkFlora = {
        cx,
        cz,
        centerX: (cx + 0.5) * CHUNK_UNITS + MAP_ORIGIN * TILE_UNITS,
        centerZ: (cz + 0.5) * CHUNK_UNITS + MAP_ORIGIN * TILE_UNITS,
        conifers: [],
        broadleaf: [],
        bushes: [],
        rocks: [],
        grass: [],
        flowers: [],
      };
      grid[cz][cx] = c;
      chunks.push(c);
    }
  }

  const treeXYZ: number[] = [];
  const cells = new Map<string, number[]>();

  const place = (ix: number, iz: number, jitter: number, seed: number): InstanceRec => {
    const tx = ix + MAP_ORIGIN;
    const tz = iz + MAP_ORIGIN;
    const jx = (hash2(tx, tz, seed) - 0.5) * 2 * jitter;
    const jz = (hash2(tx, tz, seed + 1) - 0.5) * 2 * jitter;
    const x = (tx + 0.5 + jx) * TILE_UNITS;
    const z = (tz + 0.5 + jz) * TILE_UNITS;
    return {
      x,
      y: sampleTerrainY(x, z),
      z,
      s: 1,
      rot: hash2(tx, tz, seed + 2) * Math.PI * 2,
      v: hash2(tx, tz, seed + 3),
    };
  };

  for (let iz = 0; iz < MAP_SIZE; iz++) {
    const row = ISLAND_MAP[iz];
    const cz = Math.floor(iz / CHUNK_TILES);
    for (let ix = 0; ix < MAP_SIZE; ix++) {
      const t = row[ix];
      if (t === Tile.DeepWater || t === Tile.Water || t === Tile.Shallow || t === Tile.Path)
        continue;
      const chunk = grid[cz][Math.floor(ix / CHUNK_TILES)];
      const tx = ix + MAP_ORIGIN;
      const tz = iz + MAP_ORIGIN;
      const inCore = Math.hypot(tx - CX, tz - CY) < CORE_RADIUS_TILES + 4;
      const hill = HILL_FIELD[iz * MAP_SIZE + ix];

      if (t === Tile.Tree) {
        const rec = place(ix, iz, 0.28, 11);
        rec.s = 0.85 + hash2(tx, tz, 15) * 0.5;
        // Conifers take the high ground + the darker forest hearts.
        const f = forestNoise(tx, tz);
        const conifer = hill > 5.5 || (f > 0.45 && hash2(tx, tz, 16) > 0.35);
        (conifer ? chunk.conifers : chunk.broadleaf).push(rec);
        const top = rec.y + (conifer ? 2.3 : 1.9) * rec.s;
        const idx = treeXYZ.length / 3;
        treeXYZ.push(rec.x, top, rec.z);
        const key = `${Math.floor(rec.x / LEAF_CELL)},${Math.floor(rec.z / LEAF_CELL)}`;
        let bucket = cells.get(key);
        if (!bucket) cells.set(key, (bucket = []));
        bucket.push(idx);
        continue;
      }

      if (t === Tile.Rock) {
        const rec = place(ix, iz, 0.25, 21);
        rec.s = 0.7 + hash2(tx, tz, 25) * 0.8;
        chunk.rocks.push(rec);
        if (hash2(tx, tz, 26) > 0.5) {
          const rec2 = place(ix, iz, 0.42, 27);
          rec2.s = 0.35 + hash2(tx, tz, 28) * 0.4;
          chunk.rocks.push(rec2);
        }
        continue;
      }

      if (t === Tile.Sand) {
        // Sparse dune grass on beaches.
        if (!inCore && hash2(tx, tz, 31) > 0.9) {
          const rec = place(ix, iz, 0.4, 32);
          rec.s = 0.6 + hash2(tx, tz, 33) * 0.4;
          chunk.grass.push(rec);
        }
        continue;
      }

      // Grass / Flower / Spawn / Arena
      if (t === Tile.Spawn || t === Tile.Arena) continue;
      const isFlowerTile = t === Tile.Flower;
      // Grass tufts: thinner inside the core so nothing pokes through
      // building floors; thick out in the wild.
      const tuftChance = inCore ? 0.28 : isFlowerTile ? 0.9 : 0.6;
      if (hash2(tx, tz, 41) < tuftChance) {
        const rec = place(ix, iz, 0.45, 42);
        rec.s = 0.7 + hash2(tx, tz, 43) * 0.6;
        chunk.grass.push(rec);
        if (!inCore && hash2(tx, tz, 44) > 0.55) {
          const rec2 = place(ix, iz, 0.45, 45);
          rec2.s = 0.6 + hash2(tx, tz, 46) * 0.6;
          chunk.grass.push(rec2);
        }
      }
      if (isFlowerTile) {
        const n = 2 + Math.floor(hash2(tx, tz, 51) * 2);
        for (let k = 0; k < n; k++) {
          const rec = place(ix, iz, 0.45, 52 + k * 4);
          rec.s = 0.8 + hash2(tx, tz, 53 + k * 4) * 0.5;
          chunk.flowers.push(rec);
        }
      }
      // Bushes: near trees, outside the core.
      if (!inCore && hash2(tx, tz, 61) > 0.86) {
        const nearTree =
          row[ix - 1] === Tile.Tree ||
          row[ix + 1] === Tile.Tree ||
          ISLAND_MAP[iz - 1]?.[ix] === Tile.Tree ||
          ISLAND_MAP[iz + 1]?.[ix] === Tile.Tree;
        if (nearTree) {
          const rec = place(ix, iz, 0.35, 62);
          rec.s = 0.8 + hash2(tx, tz, 63) * 0.7;
          chunk.bushes.push(rec);
        }
      }
    }
  }

  const trees: TreeIndex = {
    xyz: Float32Array.from(treeXYZ),
    count: treeXYZ.length / 3,
    cells,
  };
  return { chunks, trees };
}

export function getFloraData(): { chunks: ChunkFlora[]; trees: TreeIndex } {
  if (!cache) cache = build();
  return cache;
}

/**
 * Pick a random tree canopy within `radius` units of (x, z). Returns the
 * packed index (×3 into TreeIndex.xyz) or -1 when none is close.
 */
export function pickTreeNear(x: number, z: number, radius: number): number {
  const { trees } = getFloraData();
  const cr = Math.ceil(radius / LEAF_CELL);
  const cx0 = Math.floor(x / LEAF_CELL);
  const cz0 = Math.floor(z / LEAF_CELL);
  const r2 = radius * radius;
  // Gather candidates from the surrounding cells (small: ≤ 25 cells).
  let total = 0;
  const buckets: number[][] = [];
  for (let dz = -cr; dz <= cr; dz++) {
    for (let dx = -cr; dx <= cr; dx++) {
      const b = trees.cells.get(`${cx0 + dx},${cz0 + dz}`);
      if (b && b.length) {
        buckets.push(b);
        total += b.length;
      }
    }
  }
  if (total === 0) return -1;
  // A few random draws — cheap, and "any tree nearby" is all we need.
  for (let attempt = 0; attempt < 6; attempt++) {
    let pick = Math.floor(Math.random() * total);
    for (const b of buckets) {
      if (pick < b.length) {
        const i = b[pick];
        const tx = trees.xyz[i * 3];
        const tz = trees.xyz[i * 3 + 2];
        const ddx = tx - x;
        const ddz = tz - z;
        if (ddx * ddx + ddz * ddz <= r2) return i;
        break;
      }
      pick -= b.length;
    }
  }
  return -1;
}
