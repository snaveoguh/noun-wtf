// ── Island Tilemap — 64x64 ───────────────────────────────────────────

import { Tile, TILE_SIZE, MAP_SIZE } from './types';

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
};

// ── Procedural island generation ──────────────────────────────────────

// Simple seeded noise for stable per-tile variation
function stableNoise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function generateIslandMap(): Tile[][] {
  const map: Tile[][] = Array.from({ length: MAP_SIZE }, () =>
    Array(MAP_SIZE).fill(Tile.DeepWater),
  );

  const cx = MAP_SIZE / 2;
  const cy = MAP_SIZE / 2;
  const islandRadius = 18;
  const beachWidth = 2;

  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      // Slightly oval + noise for organic shape
      const noise = stableNoise(x, y) * 3;
      const d = Math.sqrt(dx * dx + dy * dy * 1.1) + noise;

      if (d > islandRadius + beachWidth + 2) {
        map[y][x] = Tile.DeepWater;
      } else if (d > islandRadius + beachWidth) {
        map[y][x] = Tile.Water;
      } else if (d > islandRadius) {
        map[y][x] = Tile.Sand;
      } else {
        map[y][x] = Tile.Grass;
      }
    }
  }

  // ── Paths: cross pattern connecting edges to center
  for (let i = -1; i <= 0; i++) {
    for (let t = cx - islandRadius + 2; t <= cx + islandRadius - 2; t++) {
      if (map[cy + i]?.[t] === Tile.Grass) map[cy + i][t] = Tile.Path;
      if (map[t]?.[cx + i] === Tile.Grass) map[t][cx + i] = Tile.Path;
    }
  }

  // ── Spawn point (center 3x3)
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      map[cy + dy][cx + dx] = Tile.Spawn;
    }
  }

  // ── Arena zone (fighting pit, northeast)
  const arenaX = cx + 8;
  const arenaY = cy - 8;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if (map[arenaY + dy]?.[arenaX + dx] === Tile.Grass) {
        map[arenaY + dy][arenaX + dx] = Tile.Arena;
      }
    }
  }

  // ── Trees: scattered clusters
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

  // ── Rocks: individual scattered
  const rockPositions = [
    [cx - 4, cy - 3],
    [cx + 5, cy + 2],
    [cx - 9, cy + 4],
    [cx + 2, cy + 6],
    [cx + 11, cy - 5],
    [cx - 6, cy - 10],
  ];
  for (const [rx, ry] of rockPositions) {
    if (map[ry]?.[rx] === Tile.Grass) {
      map[ry][rx] = Tile.Rock;
    }
  }

  // ── Flowers: patches near paths
  for (let y = 2; y < MAP_SIZE - 2; y++) {
    for (let x = 2; x < MAP_SIZE - 2; x++) {
      if (map[y][x] === Tile.Grass && stableNoise(x * 3, y * 3) > 0.82) {
        // Check if near a path
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

export const ISLAND_MAP = generateIslandMap();

// ── Spawn position (world coords) ─────────────────────────────────────

export const SPAWN_X = (MAP_SIZE / 2) * TILE_SIZE;
export const SPAWN_Y = (MAP_SIZE / 2) * TILE_SIZE;

// ── Arena center (world coords) ───────────────────────────────────────

export const ARENA_CENTER_X = (MAP_SIZE / 2 + 8) * TILE_SIZE;
export const ARENA_CENTER_Y = (MAP_SIZE / 2 - 8) * TILE_SIZE;

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
  const cols = 10; // one column per tile type
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
