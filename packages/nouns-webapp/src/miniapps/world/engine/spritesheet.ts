// ── Spritesheet Compositor ───────────────────────────────────────────
//
// Takes a Noun seed, maps traits to spritesheet layer PNGs from
// spritesheetcenter.vercel.app (CC0 by Kerimbonia), composites them
// into a single 768x384 spritesheet, and extracts animation frames.
//
// Spritesheet format: 16 cols x 8 rows of 48x48 frames
//   Row 0: Walk Right (0-7) + Jump Right (8-15)
//   Row 1: Walk Up (0-7) + Jump Up (8-15)
//   Row 2: Walk Left (0-7) + Jump Left (8-15)
//   Row 3: Walk Down (0-7) + Jump Down (8-15)
//   Row 4: Idle (0-15)

import { ImageData, getNounData } from '@noundry/nouns-assets';
import type { INounSeed } from '@/wrappers/nounToken';

// ── Constants ─────────────────────────────────────────────────────────

export const SHEET_WIDTH = 768;
export const SHEET_HEIGHT = 384;
export const FRAME_SIZE = 48; // each frame is 48x48
export const COLS = 16;
export const ROWS = 8;
export const WALK_FRAMES = 8;
export const IDLE_FRAMES = 16;

export type SpriteDirection = 'right' | 'up' | 'left' | 'down';
export type SpriteAction = 'walk' | 'jump' | 'idle' | 'attack';

const DIRECTION_ROW: Record<SpriteDirection, number> = {
  right: 0,
  up: 1,
  left: 2,
  down: 3,
};

// ── Trait name mapping ────────────────────────────────────────────────
// Map @noundry/nouns-assets part filenames to spritesheet filenames

// Body filenames indexed same as nouns-assets body order
const BODY_FILES = [
  'body-bege-bsod', 'body-bege-crt', 'body-blue-sky', 'body-bluegrey',
  'body-cold', 'body-computerblue', 'body-darkbrown', 'body-darkpink',
  'body-foggrey', 'body-gold', 'body-grayscale-1', 'body-grayscale-7',
  'body-grayscale-8', 'body-grayscale-9', 'body-green', 'body-gunk',
  'body-hotbrown', 'body-magenta', 'body-orange-yellow', 'body-orange',
  'body-peachy-a', 'body-peachy-b', 'body-purple', 'body-red',
  'body-redpinkish', 'body-rust', 'body-slimegreen', 'body-teal-light',
  'body-teal', 'body-yellow',
];

// Glasses now mapped by nouns-assets filename directly

// Background mapping (kept for reference, not used in 3D world compositing)
// const BG_FILES = ['bg-cool', 'bg-warm'];

// ── Asset loading ─────────────────────────────────────────────────────

const imageCache = new Map<string, HTMLImageElement>();
const loadingPromises = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached) return Promise.resolve(cached);

  const existing = loadingPromises.get(url);
  if (existing) return existing;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageCache.set(url, img);
      loadingPromises.delete(url);
      resolve(img);
    };
    img.onerror = () => {
      loadingPromises.delete(url);
      reject(new Error(`Failed to load: ${url}`));
    };
    img.src = url;
  });

  loadingPromises.set(url, promise);
  return promise;
}

// ── Spritesheet composition ───────────────────────────────────────────

const spritesheetCache = new Map<string, HTMLCanvasElement>();

/** Get the sprite asset base path */
function getAssetPath(type: string, filename: string): string {
  return `/sprites/${type}/${filename}.png`;
}

/** Compose a spritesheet from a Noun seed */
export async function composeSpritesheet(seed: INounSeed): Promise<HTMLCanvasElement> {
  const key = `${seed.background}-${seed.body}-${seed.accessory}-${seed.head}-${seed.glasses}`;
  const cached = spritesheetCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = SHEET_WIDTH;
  canvas.height = SHEET_HEIGHT;
  const ctx = canvas.getContext('2d')!;

  // Layer composition order: body, accessory, head, glasses, belowthebelt, shoes
  // NOTE: Skip background layer — in 3D world we need transparent sprites
  const layers: string[] = [];

  // Body — map by nouns-assets filename
  // Get noun data for filename lookups
  getNounData(seed); // validate seed
  const bodyName = ImageData.images.bodies[seed.body]?.filename ?? 'body-green';
  const bodyFile = BODY_FILES.find(f => f === bodyName) ?? BODY_FILES[seed.body % BODY_FILES.length] ?? 'body-green';
  layers.push(getAssetPath('body', bodyFile));

  // Accessory — map by nouns-assets filename, fall back to none
  const accName = ImageData.images.accessories[seed.accessory]?.filename;
  if (accName) {
    layers.push(getAssetPath('accessory', accName));
  } else {
    layers.push(getAssetPath('accessory', 'accessory-none'));
  }

  // Head — map by nouns-assets filename to find correct spritesheet file
  const headName = ImageData.images.heads[seed.head]?.filename ?? 'head-robot';
  layers.push(getAssetPath('head', headName));

  // Glasses — map by nouns-assets filename
  const glassesName = ImageData.images.glasses[seed.glasses]?.filename ?? 'glasses-square-black';
  layers.push(getAssetPath('glasses', glassesName));

  // Default pants + shoes
  layers.push(getAssetPath('belowthebelt', 'pants-denim'));
  layers.push(getAssetPath('shoes', 'shoes-black'));

  // Load and composite all layers
  for (const url of layers) {
    try {
      const img = await loadImage(url);
      ctx.drawImage(img, 0, 0, SHEET_WIDTH, SHEET_HEIGHT);
    } catch {
      // Skip missing layers silently
    }
  }

  spritesheetCache.set(key, canvas);
  return canvas;
}

// ── Head name list (lazy-loaded from assets.json) ─────────────────────

// Head names now resolved via nouns-assets ImageData.images.heads[i].filename

// ── Frame extraction ──────────────────────────────────────────────────

export interface SpriteFrame {
  sx: number; // source X on spritesheet
  sy: number; // source Y on spritesheet
  sw: number; // source width
  sh: number; // source height
}

/** Get the frame for a specific direction, action, and frame index */
export function getFrame(
  direction: SpriteDirection,
  action: SpriteAction,
  frameIndex: number,
): SpriteFrame {
  let row: number;
  let col: number;

  if (action === 'idle') {
    row = 4;
    col = frameIndex % IDLE_FRAMES;
  } else if (action === 'walk') {
    row = DIRECTION_ROW[direction];
    col = frameIndex % WALK_FRAMES;
  } else if (action === 'jump' || action === 'attack') {
    row = DIRECTION_ROW[direction];
    col = 8 + (frameIndex % WALK_FRAMES); // jump frames in right half
  } else {
    row = DIRECTION_ROW[direction];
    col = frameIndex % WALK_FRAMES;
  }

  return {
    sx: col * FRAME_SIZE,
    sy: row * FRAME_SIZE,
    sw: FRAME_SIZE,
    sh: FRAME_SIZE,
  };
}

/** Create a single-frame canvas from a spritesheet for use as a Three.js texture */
export function extractFrameCanvas(
  sheet: HTMLCanvasElement,
  frame: SpriteFrame,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_SIZE;
  canvas.height = FRAME_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(sheet, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, FRAME_SIZE, FRAME_SIZE);
  return canvas;
}

// ── Animated sprite texture strip ─────────────────────────────────────

/**
 * Pre-extract all walk frames for a direction into an array of canvases.
 * Used for Three.js texture animation.
 */
export function extractWalkFrames(
  sheet: HTMLCanvasElement,
  direction: SpriteDirection,
): HTMLCanvasElement[] {
  const frames: HTMLCanvasElement[] = [];
  for (let i = 0; i < WALK_FRAMES; i++) {
    frames.push(extractFrameCanvas(sheet, getFrame(direction, 'walk', i)));
  }
  return frames;
}

export function extractIdleFrames(sheet: HTMLCanvasElement): HTMLCanvasElement[] {
  const frames: HTMLCanvasElement[] = [];
  for (let i = 0; i < IDLE_FRAMES; i++) {
    frames.push(extractFrameCanvas(sheet, getFrame('down', 'idle', i)));
  }
  return frames;
}

export function extractAttackFrames(
  sheet: HTMLCanvasElement,
  direction: SpriteDirection,
): HTMLCanvasElement[] {
  const frames: HTMLCanvasElement[] = [];
  for (let i = 0; i < WALK_FRAMES; i++) {
    frames.push(extractFrameCanvas(sheet, getFrame(direction, 'attack', i)));
  }
  return frames;
}
