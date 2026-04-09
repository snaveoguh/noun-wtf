// ── Smooth Follow Camera ─────────────────────────────────────────────

import type { Camera, ScreenShake } from './types';
import { TILE_SIZE, MAP_SIZE } from './types';

const LERP_SPEED = 0.1;

export function createCamera(x: number, y: number): Camera {
  return { x, y };
}

export function updateCamera(cam: Camera, targetX: number, targetY: number) {
  cam.x += (targetX - cam.x) * LERP_SPEED;
  cam.y += (targetY - cam.y) * LERP_SPEED;
}

/** Convert world coordinates to screen pixel coordinates */
export function worldToScreen(
  worldX: number,
  worldY: number,
  cam: Camera,
  screenW: number,
  screenH: number,
  shake?: ScreenShake | null,
): { sx: number; sy: number } {
  let sx = worldX - cam.x + screenW / 2;
  let sy = worldY - cam.y + screenH / 2;
  if (shake && shake.timer > 0) {
    const intensity = shake.intensity * (shake.timer / shake.duration);
    sx += (Math.random() - 0.5) * intensity * 2;
    sy += (Math.random() - 0.5) * intensity * 2;
  }
  return { sx, sy };
}

/** Screen coords back to world coords */
export function screenToWorld(
  screenX: number,
  screenY: number,
  cam: Camera,
  screenW: number,
  screenH: number,
): { wx: number; wy: number } {
  return {
    wx: screenX + cam.x - screenW / 2,
    wy: screenY + cam.y - screenH / 2,
  };
}

/** Get visible tile range for culling */
export function getVisibleTileRange(
  cam: Camera,
  screenW: number,
  screenH: number,
): { minTX: number; maxTX: number; minTY: number; maxTY: number } {
  const halfW = screenW / 2;
  const halfH = screenH / 2;
  const pad = 2; // extra tiles for smooth scrolling
  return {
    minTX: Math.max(0, Math.floor((cam.x - halfW) / TILE_SIZE) - pad),
    maxTX: Math.min(MAP_SIZE - 1, Math.floor((cam.x + halfW) / TILE_SIZE) + pad),
    minTY: Math.max(0, Math.floor((cam.y - halfH) / TILE_SIZE) - pad),
    maxTY: Math.min(MAP_SIZE - 1, Math.floor((cam.y + halfH) / TILE_SIZE) + pad),
  };
}
