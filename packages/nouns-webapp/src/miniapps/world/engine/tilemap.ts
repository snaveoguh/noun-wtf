// ── Island Tilemap — 640x640 big island grown around the legacy 64x64 core ──
//
// COORDINATE CONTRACT
//   • World tile coords are unchanged from the original 64×64 island: the
//     spawn is still tile (32,32), the arena is still (40,24), every
//     building / paint surface / build piece / billboard keeps its numbers.
//   • ISLAND_MAP is a MAP_SIZE×MAP_SIZE array whose [0][0] is world tile
//     (MAP_ORIGIN, MAP_ORIGIN) = (-288,-288). Always go through tileAt()
//     (or physics.getTileAt) rather than indexing by world tile directly.
//   • The legacy core interior (radius ≤ 18 tiles from spawn) is stamped
//     verbatim from the original generator so the old island is still
//     there, exactly as it was — the land simply carries on beyond the
//     old beach instead of dropping into the sea.
//
// The rest of the island is fully procedural + deterministic (see noise.ts):
// noisy coastline with beaches and wadeable shallows, rolling hills with
// three big peaks, four lakes, two meandering rivers with fords, four roads
// that continue the core's cross-paths out to the coast, forests, rocky
// hilltops and flower meadows.

import { Tile, TILE_SIZE, TILE_UNITS, MAP_SIZE, MAP_ORIGIN, CORE_SIZE } from './types';
import { fbm, hash2, smoothstep, clamp01 } from './noise';

// ── Tile colors ───────────────────────────────────────────────────────

const TILE_COLORS: Record<Tile, string> = {
  [Tile.Water]: '#3b7dd8',
  [Tile.Sand]: '#e8d5a3',
  [Tile.Grass]: '#5a8f3c',
  [Tile.Tree]: '#5a8f3c', // base is grass, tree drawn on top
  [Tile.Flower]: '#5a8f3c',
  [Tile.Path]: '#c4a56e',
  [Tile.Rock]: '#5a8f3c',
  [Tile.Spawn]: '#6aa84f',
  [Tile.DeepWater]: '#1a4f8a',
  [Tile.Arena]: '#8b6914',
  [Tile.Shallow]: '#7fb6e6',
};

// ── Geometry constants ────────────────────────────────────────────────

/** Spawn tile (centre of the legacy core AND of the big map). */
export const SPAWN_TILE = CORE_SIZE / 2; // 32
/** Legacy island radius — everything inside is stamped from the old map. */
export const CORE_RADIUS_TILES = 18;
/** Mean radius of the big island (noisy ±~35). ≈100× the old land area. */
export const ISLAND_RADIUS_TILES = 185;
export const BEACH_TILES = 3;
export const SHALLOW_TILES = 2.5;

// Base terrain height (Three.js units) per tile type. Legacy values ×0.8
// (the old HEIGHT_SCALE) so the core's buildings still sit on the ground.
const BASE_HEIGHT: Record<Tile, number> = {
  [Tile.DeepWater]: -1.6,
  [Tile.Water]: -0.8,
  [Tile.Shallow]: -0.08,
  [Tile.Sand]: 0.16,
  [Tile.Path]: 0.32,
  [Tile.Grass]: 0.4,
  [Tile.Flower]: 0.4,
  [Tile.Spawn]: 0.4,
  [Tile.Arena]: 0.4,
  [Tile.Tree]: 0.48,
  [Tile.Rock]: 0.64,
};

// ── Legacy core (verbatim from the original 64×64 generator) ──────────

function stableNoise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function generateLegacyCore(): Tile[][] {
  const map: Tile[][] = Array.from({ length: CORE_SIZE }, () =>
    Array(CORE_SIZE).fill(Tile.DeepWater),
  );

  const cx = CORE_SIZE / 2;
  const cy = CORE_SIZE / 2;
  const islandRadius = CORE_RADIUS_TILES;
  const beachWidth = 2;

  for (let y = 0; y < CORE_SIZE; y++) {
    for (let x = 0; x < CORE_SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const noise = stableNoise(x, y) * 3;
      const d = Math.sqrt(dx * dx + dy * dy * 1.1) + noise;
      if (d > islandRadius + beachWidth + 2) map[y][x] = Tile.DeepWater;
      else if (d > islandRadius + beachWidth) map[y][x] = Tile.Water;
      else if (d > islandRadius) map[y][x] = Tile.Sand;
      else map[y][x] = Tile.Grass;
    }
  }

  // Paths: cross pattern connecting edges to center
  for (let i = -1; i <= 0; i++) {
    for (let t = cx - islandRadius + 2; t <= cx + islandRadius - 2; t++) {
      if (map[cy + i]?.[t] === Tile.Grass) map[cy + i][t] = Tile.Path;
      if (map[t]?.[cx + i] === Tile.Grass) map[t][cx + i] = Tile.Path;
    }
  }

  // Spawn point (center 3x3)
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) map[cy + dy][cx + dx] = Tile.Spawn;
  }

  // Arena zone (fighting pit, northeast)
  const arenaX = cx + 8;
  const arenaY = cy - 8;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (map[arenaY + dy]?.[arenaX + dx] === Tile.Grass)
        map[arenaY + dy][arenaX + dx] = Tile.Arena;
    }
  }

  // Trees: scattered clusters
  const treeClusters = [
    [cx - 8, cy - 6],
    [cx + 6, cy - 4],
    [cx - 5, cy + 7],
    [cx + 9, cy + 5],
    [cx - 10, cy - 2],
    [cx + 3, cy - 10],
    [cx - 7, cy + 12],
    [cx + 12, cy - 1],
    [cx - 3, cy - 8],
    [cx + 7, cy + 9],
  ];
  for (const [tx, ty] of treeClusters) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (stableNoise(tx + dx, ty + dy) > 0.3 && map[ty + dy]?.[tx + dx] === Tile.Grass) {
          map[ty + dy][tx + dx] = Tile.Tree;
        }
      }
    }
  }

  // Clear trees around buildings (Caribbean Office at ~tile 39,39)
  const clearZones = [{ tx: 39, ty: 39, radius: 4 }];
  for (const zone of clearZones) {
    for (let dy = -zone.radius; dy <= zone.radius; dy++) {
      for (let dx = -zone.radius; dx <= zone.radius; dx++) {
        const ty = zone.ty + dy;
        const tx = zone.tx + dx;
        if (map[ty]?.[tx] === Tile.Tree) map[ty][tx] = Tile.Grass;
      }
    }
  }

  // Rocks: individual scattered
  const rockPositions = [
    [cx - 4, cy - 3],
    [cx + 5, cy + 2],
    [cx - 9, cy + 4],
    [cx + 2, cy + 6],
    [cx + 11, cy - 5],
    [cx - 6, cy - 10],
  ];
  for (const [rx, ry] of rockPositions) {
    if (map[ry]?.[rx] === Tile.Grass) map[ry][rx] = Tile.Rock;
  }

  // Flowers: patches near paths
  for (let y = 2; y < CORE_SIZE - 2; y++) {
    for (let x = 2; x < CORE_SIZE - 2; x++) {
      if (map[y][x] === Tile.Grass && stableNoise(x * 3, y * 3) > 0.82) {
        const nearPath =
          map[y - 1]?.[x] === Tile.Path ||
          map[y + 1]?.[x] === Tile.Path ||
          map[y]?.[x - 1] === Tile.Path ||
          map[y]?.[x + 1] === Tile.Path;
        if (nearPath) map[y][x] = Tile.Flower;
      }
    }
  }

  return map;
}

// ── Big island fields ─────────────────────────────────────────────────

const CX = SPAWN_TILE;
const CY = SPAWN_TILE;

/**
 * Noisy radial distance from the island centre. Compare against
 * ISLAND_RADIUS_TILES: negative margin = land, positive = sea.
 */
function islandDist(tx: number, ty: number): number {
  const dx = tx - CX;
  const dy = ty - CY;
  const r = Math.sqrt(dx * dx + dy * dy);
  const ang = Math.atan2(dy, dx);
  // Big coastline lobes (angular) + fine crinkle (spatial).
  const lobes = fbm(Math.cos(ang) * 2.2 + 7.3, Math.sin(ang) * 2.2 + 3.1, 3, 11) * 30;
  const crinkle = fbm(tx * 0.045, ty * 0.045, 3, 12) * 9;
  return r - lobes - crinkle;
}

interface Lake {
  x: number;
  y: number;
  r: number;
}
interface Peak {
  x: number;
  y: number;
  r: number;
  h: number;
}

function polar(angle: number, dist: number): [number, number] {
  return [CX + Math.cos(angle) * dist, CY + Math.sin(angle) * dist];
}

const LAKES: Lake[] = [
  { x: polar(0.55, 92)[0], y: polar(0.55, 92)[1], r: 11 },
  { x: polar(2.35, 118)[0], y: polar(2.35, 118)[1], r: 14 },
  { x: polar(3.95, 78)[0], y: polar(3.95, 78)[1], r: 9 },
  { x: polar(5.3, 128)[0], y: polar(5.3, 128)[1], r: 12 },
];

const PEAKS: Peak[] = [
  { x: polar(1.35, 110)[0], y: polar(1.35, 110)[1], r: 38, h: 13 },
  { x: polar(3.1, 125)[0], y: polar(3.1, 125)[1], r: 32, h: 10 },
  { x: polar(4.75, 95)[0], y: polar(4.75, 95)[1], r: 30, h: 11 },
  { x: polar(0.2, 150)[0], y: polar(0.2, 150)[1], r: 26, h: 7 },
];

/** Distance to the nearest lake edge (negative = inside the water). */
function lakeDist(tx: number, ty: number): number {
  let best = Infinity;
  for (const l of LAKES) {
    const d = Math.hypot(tx - l.x, ty - l.y) + fbm(tx * 0.12, ty * 0.12, 2, 21) * 3 - l.r;
    if (d < best) best = d;
  }
  return best;
}

/** Big-hill contribution (units) from the seeded peaks. */
function peakHeight(tx: number, ty: number): number {
  let best = 0;
  for (const p of PEAKS) {
    const d = Math.hypot(tx - p.x, ty - p.y);
    const t = smoothstep(p.r, 0, d);
    const h = Math.pow(t, 1.6) * p.h;
    if (h > best) best = h;
  }
  return best;
}

export function forestNoise(tx: number, ty: number): number {
  return fbm(tx * 0.028 + 50, ty * 0.028 + 20, 3, 51);
}
export function flowerNoise(tx: number, ty: number): number {
  return fbm(tx * 0.05 + 90, ty * 0.05 + 40, 2, 61);
}

// ── Generation ────────────────────────────────────────────────────────

interface Generated {
  map: Tile[][];
  /** Per-tile hill height (units) — 0 on water / beach. */
  hill: Float32Array;
  /** Per-vertex (MAP_SIZE+1)² terrain Y in Three.js units. */
  heights: Float32Array;
}

function generateIsland(): Generated {
  const N = MAP_SIZE;
  const map: Tile[][] = Array.from({ length: N }, () => Array(N).fill(Tile.DeepWater));
  // "flat" mask: 1 near water features (lakes/rivers) so hills don't lift them.
  const flat = new Float32Array(N * N);
  const idx = (ix: number, iy: number) => iy * N + ix;
  const inMap = (ix: number, iy: number) => ix >= 0 && iy >= 0 && ix < N && iy < N;
  const get = (ix: number, iy: number): Tile => (inMap(ix, iy) ? map[iy][ix] : Tile.DeepWater);
  const set = (ix: number, iy: number, t: Tile) => {
    if (inMap(ix, iy)) map[iy][ix] = t;
  };

  // 1. Land / sea from the noisy coastline
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const tx = ix + MAP_ORIGIN;
      const ty = iy + MAP_ORIGIN;
      const m = islandDist(tx, ty) - ISLAND_RADIUS_TILES;
      let t: Tile;
      if (m <= 0) t = Tile.Grass;
      else if (m <= BEACH_TILES) t = Tile.Sand;
      else if (m <= BEACH_TILES + SHALLOW_TILES) t = Tile.Shallow;
      else if (m <= BEACH_TILES + SHALLOW_TILES + 4) t = Tile.Water;
      else t = Tile.DeepWater;
      map[iy][ix] = t;
    }
  }

  // 2. Lakes (water, wadeable rim, sandy shore) + flatten mask
  for (const l of LAKES) {
    const R = Math.ceil(l.r + 16);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const tx = Math.round(l.x) + dx;
        const ty = Math.round(l.y) + dy;
        const ix = tx - MAP_ORIGIN;
        const iy = ty - MAP_ORIGIN;
        if (!inMap(ix, iy) || (map[iy][ix] !== Tile.Grass && map[iy][ix] !== Tile.Sand)) continue;
        const d = lakeDist(tx, ty);
        if (d < 0) map[iy][ix] = Tile.Water;
        else if (d < 1.2) map[iy][ix] = Tile.Shallow;
        else if (d < 2.6) map[iy][ix] = Tile.Sand;
        flat[idx(ix, iy)] = Math.max(flat[idx(ix, iy)], clamp01(1 - (d - 2) / 12));
      }
    }
  }

  // 3. Rivers — two meanders from lakes to the coast, with fords
  const stampRiver = (from: Lake, heading: number, phase: number) => {
    const dirx = Math.cos(heading);
    const diry = Math.sin(heading);
    const px = -diry;
    const py = dirx;
    let fordAt = 26;
    for (let s = from.r * 0.6; s < 400; s += 0.5) {
      const wob = Math.sin(s * 0.055 + phase) * 9 + Math.sin(s * 0.021 + phase * 1.7) * 6;
      const fx = from.x + dirx * s + px * wob;
      const fy = from.y + diry * s + py * wob;
      const tx = Math.round(fx);
      const ty = Math.round(fy);
      if (islandDist(tx, ty) - ISLAND_RADIUS_TILES > BEACH_TILES + 1) break; // reached the sea
      const ford = s > fordAt;
      if (ford) fordAt += 30;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const ix = tx + dx - MAP_ORIGIN;
          const iy = ty + dy - MAP_ORIGIN;
          if (!inMap(ix, iy)) continue;
          const d = Math.hypot(fx - (tx + dx), fy - (ty + dy));
          const cur = map[iy][ix];
          const isLand = cur === Tile.Grass || cur === Tile.Sand || cur === Tile.Shallow;
          if (!isLand) continue;
          if (d < 1.5) map[iy][ix] = ford ? Tile.Shallow : Tile.Water;
          else if (d < 2.4) map[iy][ix] = Tile.Shallow;
          else if (d < 3.3 && cur === Tile.Grass) map[iy][ix] = Tile.Sand;
          flat[idx(ix, iy)] = Math.max(flat[idx(ix, iy)], clamp01(1 - (d - 2) / 9));
        }
      }
    }
  };
  stampRiver(LAKES[1], 2.35 + 0.35, 1.3);
  stampRiver(LAKES[3], 5.3 - 0.4, 4.1);

  // 4. Roads — continue the core's cross paths out to the coast
  const roads: Array<[number, number, number]> = [
    [1, 0, 0.4],
    [-1, 0, 2.1],
    [0, 1, 3.7],
    [0, -1, 5.2],
  ];
  for (const [dirx, diry, phase] of roads) {
    const px = -diry;
    const py = dirx;
    // Core cross-paths sit on rows/cols CX-1 and CX → centre line at CX-0.5.
    const ox = CX - 0.5;
    const oy = CY - 0.5;
    for (let s = CORE_RADIUS_TILES - 1; s < 400; s += 0.5) {
      const ramp = smoothstep(CORE_RADIUS_TILES, CORE_RADIUS_TILES + 30, s);
      const wob = (Math.sin(s * 0.05 + phase) * 7 + Math.sin(s * 0.017 + phase * 2.3) * 5) * ramp;
      const fx = ox + dirx * s + px * wob;
      const fy = oy + diry * s + py * wob;
      const tx = Math.round(fx);
      const ty = Math.round(fy);
      if (islandDist(tx, ty) - ISLAND_RADIUS_TILES > -2) break; // stop at the beach
      for (let k = -1; k <= 0; k++) {
        const ix = Math.floor(fx + px * (k + 0.5) + 0.5) - MAP_ORIGIN;
        const iy = Math.floor(fy + py * (k + 0.5) + 0.5) - MAP_ORIGIN;
        if (!inMap(ix, iy)) continue;
        const cur = map[iy][ix];
        if (cur === Tile.DeepWater) continue;
        map[iy][ix] = Tile.Path; // over water = plank bridge / causeway
      }
    }
  }

  // 5. Stamp the legacy core interior verbatim (its old sea + beach become
  //    whatever the big island has there — normally grass).
  const core = generateLegacyCore();
  for (let y = 0; y < CORE_SIZE; y++) {
    for (let x = 0; x < CORE_SIZE; x++) {
      const t = core[y][x];
      if (t === Tile.Sand || t === Tile.Water || t === Tile.DeepWater) continue;
      set(x - MAP_ORIGIN, y - MAP_ORIGIN, t);
    }
  }

  // 6. Hills + rocky outcrops
  const hill = new Float32Array(N * N);
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const t = map[iy][ix];
      if (t === Tile.Water || t === Tile.DeepWater || t === Tile.Shallow) continue;
      const tx = ix + MAP_ORIGIN;
      const ty = iy + MAP_ORIGIN;
      const dCore = Math.hypot(tx - CX, ty - CY);
      const coreBlend = smoothstep(CORE_RADIUS_TILES + 5, CORE_RADIUS_TILES + 30, dCore);
      if (coreBlend <= 0) continue;
      const margin = ISLAND_RADIUS_TILES - islandDist(tx, ty); // tiles inland from coast
      const coastFade = clamp01((margin - 6) / 30);
      const rolling = Math.max(0, fbm(tx * 0.013 + 5, ty * 0.013 + 9, 4, 31)) * 7;
      const micro = (fbm(tx * 0.09, ty * 0.09, 2, 41) + 1) * 0.35;
      const h =
        (rolling + peakHeight(tx, ty) + micro) * coreBlend * coastFade * (1 - flat[idx(ix, iy)]);
      hill[idx(ix, iy)] = h;
      if (t === Tile.Grass) {
        const rnd = hash2(tx, ty, 77);
        if (h > 9 && rnd > 0.72) map[iy][ix] = Tile.Rock;
        else if (h > 4 && rnd > 0.955) map[iy][ix] = Tile.Rock;
      }
    }
  }

  // 7. Forests + flower meadows (outside the core only)
  const nearPath = (ix: number, iy: number): boolean => {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) if (get(ix + dx, iy + dy) === Tile.Path) return true;
    return false;
  };
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      if (map[iy][ix] !== Tile.Grass) continue;
      const tx = ix + MAP_ORIGIN;
      const ty = iy + MAP_ORIGIN;
      if (Math.hypot(tx - CX, ty - CY) < CORE_RADIUS_TILES + 3) continue;
      const f = forestNoise(tx, ty);
      const h = hill[idx(ix, iy)];
      if (f > 0.16 && h < 9.5) {
        // Denser in the heart of a forest; thinner at the fringe. ~35% max
        // so a forest is a slalom, not a wall.
        const density = 0.62 - Math.min(0.14, (f - 0.16) * 0.5);
        if (hash2(tx, ty, 7) > density && !nearPath(ix, iy)) {
          map[iy][ix] = Tile.Tree;
          continue;
        }
      }
      if (f < 0.08 && flowerNoise(tx, ty) > 0.2 && hash2(tx, ty, 9) > 0.42) {
        map[iy][ix] = Tile.Flower;
      }
    }
  }

  // 8. Vertex height field: mean of the 4 surrounding tiles (base + hill).
  const V = N + 1;
  const heights = new Float32Array(V * V);
  const tileY = (ix: number, iy: number): number => {
    const cx = Math.max(0, Math.min(N - 1, ix));
    const cy = Math.max(0, Math.min(N - 1, iy));
    return BASE_HEIGHT[map[cy][cx]] + hill[idx(cx, cy)];
  };
  for (let vy = 0; vy < V; vy++) {
    for (let vx = 0; vx < V; vx++) {
      heights[vy * V + vx] =
        (tileY(vx - 1, vy - 1) + tileY(vx, vy - 1) + tileY(vx - 1, vy) + tileY(vx, vy)) * 0.25;
    }
  }

  return { map, hill, heights };
}

const GENERATED = generateIsland();

/** Origin-shifted tile grid. Index with tileAt() — not world tile coords. */
export const ISLAND_MAP: Tile[][] = GENERATED.map;
/** Per-tile hill height (units), origin-shifted like ISLAND_MAP. */
export const HILL_FIELD: Float32Array = GENERATED.hill;
/** Per-vertex terrain Y (units), (MAP_SIZE+1)² grid, origin-shifted. */
export const HEIGHT_FIELD: Float32Array = GENERATED.heights;

/** Tile at WORLD tile coords (spawn = 32,32). Off-map = deep water. */
export function tileAt(tx: number, ty: number): Tile {
  const ix = tx - MAP_ORIGIN;
  const iy = ty - MAP_ORIGIN;
  if (ix < 0 || iy < 0 || ix >= MAP_SIZE || iy >= MAP_SIZE) return Tile.DeepWater;
  return ISLAND_MAP[iy][ix];
}

/** Hill height (units) at WORLD tile coords. */
export function hillAt(tx: number, ty: number): number {
  const ix = tx - MAP_ORIGIN;
  const iy = ty - MAP_ORIGIN;
  if (ix < 0 || iy < 0 || ix >= MAP_SIZE || iy >= MAP_SIZE) return 0;
  return HILL_FIELD[iy * MAP_SIZE + ix];
}

/**
 * Bilinear terrain height (Three.js Y) at Three.js world X/Z. Continuous —
 * no per-tile steps — so walking never "pops". The same field builds the
 * terrain chunks, so feet always meet the mesh.
 */
export function sampleTerrainY(wx: number, wz: number): number {
  const V = MAP_SIZE + 1;
  const gx = wx / TILE_UNITS - MAP_ORIGIN;
  const gz = wz / TILE_UNITS - MAP_ORIGIN;
  if (gx < 0 || gz < 0 || gx >= MAP_SIZE || gz >= MAP_SIZE) return BASE_HEIGHT[Tile.DeepWater];
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const fx = gx - x0;
  const fz = gz - z0;
  const h00 = HEIGHT_FIELD[z0 * V + x0];
  const h10 = HEIGHT_FIELD[z0 * V + x0 + 1];
  const h01 = HEIGHT_FIELD[(z0 + 1) * V + x0];
  const h11 = HEIGHT_FIELD[(z0 + 1) * V + x0 + 1];
  const top = h00 + (h10 - h00) * fx;
  const bot = h01 + (h11 - h01) * fx;
  return top + (bot - top) * fz;
}

// ── Coast sampling (boats, dolphins, foam, raid spawns) ───────────────

export interface CoastPoint {
  /** World tile coords of the first sea tile along this bearing. */
  tx: number;
  ty: number;
  angle: number;
}

function sampleCoast(): CoastPoint[] {
  const pts: CoastPoint[] = [];
  const steps = 180;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    for (let r = ISLAND_RADIUS_TILES - 45; r < ISLAND_RADIUS_TILES + 60; r += 1) {
      const tx = Math.round(CX + cx * r);
      const ty = Math.round(CY + cy * r);
      const t = tileAt(tx, ty);
      if (t === Tile.Water || t === Tile.DeepWater) {
        pts.push({ tx, ty, angle: a });
        break;
      }
    }
  }
  return pts;
}

export const COAST_POINTS: CoastPoint[] = sampleCoast();

// ── Spawn position (world coords) ─────────────────────────────────────

export const SPAWN_X = SPAWN_TILE * TILE_SIZE;
export const SPAWN_Y = SPAWN_TILE * TILE_SIZE;

// ── Arena center (world coords) ───────────────────────────────────────

export const ARENA_CENTER_X = (SPAWN_TILE + 8) * TILE_SIZE;
export const ARENA_CENTER_Y = (SPAWN_TILE - 8) * TILE_SIZE;

// ── Tile rendering ────────────────────────────────────────────────────

const FLOWER_COLORS = ['#ff69b4', '#ffdd44', '#ffffff', '#ff4466'];
const TREE_TRUNK_COLOR = '#6b4226';
const TREE_CANOPY_COLOR = '#2d6b1e';
const TREE_CANOPY_DARK = '#1e5214';
const ROCK_COLOR = '#888888';
const ROCK_DARK = '#666666';

/** Pre-render a full tile sheet to an offscreen canvas for fast blitting */
let _tileSheet: HTMLCanvasElement | null = null;

function buildTileSheet(): HTMLCanvasElement {
  const cols = 11; // one column per tile type
  const canvas = document.createElement('canvas');
  canvas.width = TILE_SIZE * cols;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext('2d')!;

  for (let t = 0; t < cols; t++) {
    const ox = t * TILE_SIZE;
    // Fill base color
    ctx.fillStyle = TILE_COLORS[t as Tile] ?? '#000';
    ctx.fillRect(ox, 0, TILE_SIZE, TILE_SIZE);

    if (t === Tile.Tree) {
      // Trunk
      ctx.fillStyle = TREE_TRUNK_COLOR;
      ctx.fillRect(ox + 6, 8, 4, 8);
      // Canopy
      ctx.fillStyle = TREE_CANOPY_COLOR;
      ctx.beginPath();
      ctx.arc(ox + 8, 6, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = TREE_CANOPY_DARK;
      ctx.beginPath();
      ctx.arc(ox + 7, 5, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (t === Tile.Rock) {
      ctx.fillStyle = ROCK_COLOR;
      ctx.beginPath();
      ctx.ellipse(ox + 8, 10, 6, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ROCK_DARK;
      ctx.beginPath();
      ctx.ellipse(ox + 7, 9, 4, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (t === Tile.Flower) {
      // Draw small colored dots
      for (let i = 0; i < 3; i++) {
        const fx = ox + 3 + i * 5;
        const fy = 4 + (i % 2) * 7;
        ctx.fillStyle = FLOWER_COLORS[i % FLOWER_COLORS.length];
        ctx.fillRect(fx, fy, 2, 2);
      }
    }

    if (t === Tile.Arena) {
      // Arena floor has a subtle cross pattern
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.strokeRect(ox + 1, 1, TILE_SIZE - 2, TILE_SIZE - 2);
    }

    if (t === Tile.Spawn) {
      // Spawn has a subtle glow indicator
      ctx.fillStyle = 'rgba(255,255,200,0.15)';
      ctx.fillRect(ox, 0, TILE_SIZE, TILE_SIZE);
    }
  }

  return canvas;
}

function getTileSheet(): HTMLCanvasElement {
  if (!_tileSheet) _tileSheet = buildTileSheet();
  return _tileSheet;
}

/** Draw a single tile from the prebuilt sheet */
export function drawTile(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  screenX: number,
  screenY: number,
  frame: number,
) {
  const sheet = getTileSheet();

  // Water shimmer: offset color slightly based on frame
  if (tile === Tile.Water || tile === Tile.DeepWater) {
    const shimmer = Math.sin(screenX * 0.05 + frame * 0.03) * 15;
    const base = tile === Tile.DeepWater ? [26, 79, 138] : [59, 125, 216];
    ctx.fillStyle = `rgb(${base[0] + shimmer}, ${base[1] + shimmer}, ${base[2]})`;
    ctx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
    return;
  }

  // Blit from tile sheet
  ctx.drawImage(
    sheet,
    tile * TILE_SIZE,
    0,
    TILE_SIZE,
    TILE_SIZE,
    screenX,
    screenY,
    TILE_SIZE,
    TILE_SIZE,
  );
}
