import type { VoxelMap } from './types';

// ─── Key helpers ────────────────────────────────────────────────────────────

export function voxelKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function parseKey(key: string): [number, number, number] {
  const [x, y, z] = key.split(',').map(Number);
  return [x, y, z];
}

// ─── Create from 2D pixel grid ──────────────────────────────────────────────

/** Convert a 32x32 hex color grid into a VoxelMap at z=0 (flat). */
export function pixelsToFlat(pixels: string[][]): VoxelMap {
  const map: VoxelMap = new Map();
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const c = pixels[y]?.[x];
      if (c) map.set(voxelKey(x, 31 - y, 0), c);
    }
  }
  return map;
}

/** Convert a 32x32 hex grid into a solid block with given depth. */
export function pixelsToSolidBlock(pixels: string[][], depth: number): VoxelMap {
  const map: VoxelMap = new Map();
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const c = pixels[y]?.[x];
      if (c) {
        for (let z = 0; z < depth; z++) {
          map.set(voxelKey(x, 31 - y, z), c);
        }
      }
    }
  }
  return map;
}

// ─── 3D flood fill ──────────────────────────────────────────────────────────

/** Flood fill in 3D (6-connected neighbors). Returns only changed voxels. */
export function floodFill3D(voxels: VoxelMap, startKey: string, fillColor: string): Map<string, string> {
  const targetColor = voxels.get(startKey) || '';
  if (targetColor === fillColor) return new Map();
  const changes = new Map<string, string>();
  const visited = new Set<string>();
  const queue = [startKey];
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (visited.has(key)) continue;
    const current = voxels.get(key);
    if (current !== targetColor) continue;
    visited.add(key);
    changes.set(key, fillColor);
    const [x, y, z] = parseKey(key);
    queue.push(
      voxelKey(x - 1, y, z), voxelKey(x + 1, y, z),
      voxelKey(x, y - 1, z), voxelKey(x, y + 1, z),
      voxelKey(x, y, z - 1), voxelKey(x, y, z + 1),
    );
  }
  return changes;
}

// ─── Face-based adjacent voxel placement ────────────────────────────────────

/** Get the position of a new voxel adjacent to the clicked face. */
export function getAdjacentPos(
  faceNormal: { x: number; y: number; z: number } | null,
  voxelPos: [number, number, number],
): [number, number, number] {
  if (!faceNormal) return [voxelPos[0], voxelPos[1], voxelPos[2] + 1];

  const ax = Math.abs(faceNormal.x);
  const ay = Math.abs(faceNormal.y);
  const az = Math.abs(faceNormal.z);

  let nx = 0, ny = 0, nz = 0;
  if (ax >= ay && ax >= az) {
    nx = faceNormal.x > 0 ? 1 : -1;
  } else if (ay >= ax && ay >= az) {
    ny = faceNormal.y > 0 ? 1 : -1;
  } else {
    nz = faceNormal.z > 0 ? 1 : -1;
  }

  return [voxelPos[0] + nx, voxelPos[1] + ny, voxelPos[2] + nz];
}

// ─── Serialization ──────────────────────────────────────────────────────────

/** Serialize VoxelMap to a plain object for JSON storage. */
export function serialize(map: VoxelMap): Record<string, string> {
  return Object.fromEntries(map);
}

/** Deserialize a plain object back to VoxelMap. */
export function deserialize(obj: Record<string, string>): VoxelMap {
  return new Map(Object.entries(obj));
}

// ─── Flatten to 2D ──────────────────────────────────────────────────────────

// ─── Fill interior (make hollow shell into solid block) ─────────────────────

/**
 * Fill the interior of a voxel map so that erasing surface voxels reveals
 * material underneath instead of empty space.
 *
 * Strategy: for each axis, scan along rows. Find the min and max coordinate
 * with voxels along that row, and fill any gaps between them with the
 * nearest-neighbor color. Apply across all 3 axes so the result is solid
 * regardless of which face the user chips into.
 *
 * Returns a NEW map — does not mutate the input.
 *
 * No-op for empty maps.
 */
export function fillVoxelMapInterior(map: VoxelMap): VoxelMap {
  if (map.size === 0) return new Map(map);

  // Compute bounding range for grouping
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const key of map.keys()) {
    const [x, y, z] = parseKey(key);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const out: VoxelMap = new Map(map);

  // Helper: scan a row of cells, find min/max with voxels, fill gaps between
  // them with the closest existing voxel's color.
  const fillRow = (cells: { coord: number; key: string }[]) => {
    const have: { coord: number; color: string }[] = [];
    for (const { coord, key } of cells) {
      const c = out.get(key);
      if (c) have.push({ coord, color: c });
    }
    if (have.length < 2) return;
    have.sort((a, b) => a.coord - b.coord);
    const lo = have[0].coord;
    const hi = have[have.length - 1].coord;
    for (const { coord, key } of cells) {
      if (coord <= lo || coord >= hi) continue;
      if (out.has(key)) continue;
      // Pick nearest existing voxel's color (linear scan; row is small).
      let bestColor = have[0].color;
      let bestDist = Infinity;
      for (const h of have) {
        const d = Math.abs(h.coord - coord);
        if (d < bestDist) {
          bestDist = d;
          bestColor = h.color;
        }
      }
      out.set(key, bestColor);
    }
  };

  // Pass 1: scan along X for each (y, z)
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      const cells: { coord: number; key: string }[] = [];
      for (let x = minX; x <= maxX; x++) {
        cells.push({ coord: x, key: voxelKey(x, y, z) });
      }
      fillRow(cells);
    }
  }
  // Pass 2: scan along Y for each (x, z)
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      const cells: { coord: number; key: string }[] = [];
      for (let y = minY; y <= maxY; y++) {
        cells.push({ coord: y, key: voxelKey(x, y, z) });
      }
      fillRow(cells);
    }
  }
  // Pass 3: scan along Z for each (x, y)
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const cells: { coord: number; key: string }[] = [];
      for (let z = minZ; z <= maxZ; z++) {
        cells.push({ coord: z, key: voxelKey(x, y, z) });
      }
      fillRow(cells);
    }
  }

  return out;
}

// ─── Flatten to 2D ──────────────────────────────────────────────────────────

/** Project voxels onto a 32x32 2D grid (keeps frontmost z per x,y). */
export function flattenTo2D(map: VoxelMap): string[][] {
  const grid: string[][] = Array.from({ length: 32 }, () => Array(32).fill(''));
  // Track max z per (x, y) to keep frontmost color
  const zMap = new Map<string, { z: number; color: string }>();
  for (const [key, color] of map) {
    const [x, y3d, z] = parseKey(key);
    const k2d = `${x},${y3d}`;
    const existing = zMap.get(k2d);
    if (!existing || z > existing.z) {
      zMap.set(k2d, { z, color });
    }
  }
  for (const [k2d, { color }] of zMap) {
    const [x, y3d] = k2d.split(',').map(Number);
    const gridY = 31 - y3d;
    if (x >= 0 && x < 32 && gridY >= 0 && gridY < 32) {
      grid[gridY][x] = color;
    }
  }
  return grid;
}
