// ── Drop Party System — Items scattered on island at settlement ──────

import { TILE_SIZE, CORE_SIZE, WALKABLE } from './types';
import { tileAt } from './tilemap';

// ── Types ────────────────────────────────────────────────────────────

export interface DroppedItem {
  dropId: number;
  worldX: number; // game world coords
  worldY: number;
  itemType: 'eth' | 'erc20' | 'erc721';
  tokenAddress: string;
  amountOrId: string;
  claimed: boolean;
  claimedBy: string | null;
  droppedAt: number; // timestamp
}

// ── Generate random walkable positions ───────────────────────────────

/** Generate N random positions on walkable tiles */
export function generateDropPositions(count: number, seed: number): [number, number][] {
  const positions: [number, number][] = [];
  let hash = seed;

  // Simple hash function for deterministic randomness
  const nextRandom = () => {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    return hash / 0x7fffffff;
  };

  let attempts = 0;
  while (positions.length < count && attempts < count * 100) {
    attempts++;
    // Keep drops within reach of the core (a ring of ~48 tiles around
    // spawn) rather than scattering them across the whole 640-tile island.
    const ang = nextRandom() * Math.PI * 2;
    const rad = 6 + nextRandom() * 42;
    const tx = Math.floor(CORE_SIZE / 2 + Math.cos(ang) * rad);
    const ty = Math.floor(CORE_SIZE / 2 + Math.sin(ang) * rad);
    const tile = tileAt(tx, ty);
    if (WALKABLE.has(tile)) {
      const worldX = (tx + 0.5) * TILE_SIZE;
      const worldY = (ty + 0.5) * TILE_SIZE;
      // Don't place too close to existing positions
      const tooClose = positions.some(
        ([px, py]) =>
          Math.abs(px - worldX) < TILE_SIZE * 3 && Math.abs(py - worldY) < TILE_SIZE * 3,
      );
      if (!tooClose) {
        positions.push([worldX, worldY]);
      }
    }
  }

  return positions;
}

// ── Drop state management ────────────────────────────────────────────

let _activeDrops: DroppedItem[] = [];

export function getActiveDrops(): DroppedItem[] {
  return _activeDrops.filter(d => !d.claimed);
}

export function getAllDrops(): DroppedItem[] {
  return _activeDrops;
}

/** Called when settlement happens — scatter items */
export function triggerDropParty(items: DroppedItem[]) {
  _activeDrops = items;
}

/** Called when a player claims an item */
export function markClaimed(dropId: number, claimedBy: string) {
  const item = _activeDrops.find(d => d.dropId === dropId);
  if (item) {
    item.claimed = true;
    item.claimedBy = claimedBy;
  }
}

/** Clear all drops (e.g. after expiry) */
export function clearDrops() {
  _activeDrops = [];
}

/** Check if player is near a droppable item */
export function getNearbyDrop(
  playerX: number,
  playerY: number,
  pickupRadius = 24,
): DroppedItem | null {
  for (const item of _activeDrops) {
    if (item.claimed) continue;
    const dx = playerX - item.worldX;
    const dy = playerY - item.worldY;
    if (Math.sqrt(dx * dx + dy * dy) < pickupRadius) {
      return item;
    }
  }
  return null;
}
