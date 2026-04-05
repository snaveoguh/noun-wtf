// ── Noun Sprite Generator ────────────────────────────────────────────
//
// Converts a Noun seed into a 32x32 pixel sprite for the world.
// Caches generated sprites by seed key.

import {
  seedToPixelLayers,
  mergeLayersToGrid,
  DEFAULT_VISIBILITY,
} from '@/lib/nounDecoder';
import type { INounSeed } from '@/wrappers/nounToken';

const spriteCache = new Map<string, HTMLCanvasElement>();

/** Build a unique key from a noun seed */
export function seedToKey(seed: INounSeed): string {
  return `${seed.background}-${seed.body}-${seed.accessory}-${seed.head}-${seed.glasses}`;
}

/** Generate a 32x32 sprite canvas from a noun seed */
function generateSprite(seed: INounSeed): HTMLCanvasElement {
  const layers = seedToPixelLayers(seed);
  const grid = mergeLayersToGrid(layers, DEFAULT_VISIBILITY);

  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;

  // Fill background
  ctx.fillStyle = layers.background;
  ctx.fillRect(0, 0, 32, 32);

  // Draw pixels
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const color = grid[y][x];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  return canvas;
}

/** Get or create a cached sprite for a noun seed */
export function getSprite(seed: INounSeed): HTMLCanvasElement {
  const key = seedToKey(seed);
  let sprite = spriteCache.get(key);
  if (!sprite) {
    sprite = generateSprite(seed);
    spriteCache.set(key, sprite);
  }
  return sprite;
}

/** Parse a seed key back into an INounSeed */
export function keyToSeed(key: string): INounSeed {
  const [background, body, accessory, head, glasses] = key.split('-').map(Number);
  return { background, body, accessory, head, glasses };
}

/** Get sprite from a seed key (for remote players) */
export function getSpriteFromKey(key: string): HTMLCanvasElement {
  let sprite = spriteCache.get(key);
  if (!sprite) {
    sprite = generateSprite(keyToSeed(key));
    spriteCache.set(key, sprite);
  }
  return sprite;
}

/** Generate a random seed for players without a connected wallet */
export function randomSeed(): INounSeed {
  return {
    background: Math.floor(Math.random() * 2),
    body: Math.floor(Math.random() * 30),
    accessory: Math.floor(Math.random() * 140),
    head: Math.floor(Math.random() * 240),
    glasses: Math.floor(Math.random() * 20),
  };
}
