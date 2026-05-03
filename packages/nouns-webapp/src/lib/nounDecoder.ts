/**
 * Decode a Noun seed into per-layer 32x32 pixel grids.
 * Reuses RLE decoding logic from NounParallax.
 */
import { ImageData, getNounData } from '@noundry/nouns-assets';

import { INounSeed } from '@/wrappers/nounToken';

export interface NounPixelLayers {
  background: string; // hex color e.g. '#e1d7d5'
  body: string[][];
  accessory: string[][];
  head: string[][];
  glasses: string[][];
}

export interface LayerVisibility {
  body: boolean;
  accessory: boolean;
  head: boolean;
  glasses: boolean;
}

export type VisibilityMask = boolean[][];

// ─── RLE decoder ─────────────────────────────────────────────────────────────

function decodeRLE(data: string) {
  const hex = data.replace(/^0x/, '');
  const bounds = {
    top: parseInt(hex.substring(2, 4), 16),
    right: parseInt(hex.substring(4, 6), 16),
    left: parseInt(hex.substring(8, 10), 16),
  };
  const pairs: [number, number][] =
    hex
      .substring(10)
      .match(/.{1,4}/g)
      ?.map(r => [parseInt(r.substring(0, 2), 16), parseInt(r.substring(2, 4), 16)]) ?? [];
  return { bounds, pairs };
}

function decodePartToGrid(partData: string, palette: string[]): string[][] {
  const grid: string[][] = Array.from({ length: 32 }, () => Array(32).fill(''));
  const { bounds, pairs } = decodeRLE(partData);
  let x = bounds.left,
    y = bounds.top;
  for (const [runLength, colorIndex] of pairs) {
    for (let i = 0; i < runLength; i++) {
      if (colorIndex !== 0 && y < 32 && x < 32) {
        grid[y][x] = `#${palette[colorIndex]}`;
      }
      x++;
      if (x >= bounds.right) {
        x = bounds.left;
        y++;
      }
    }
  }
  return grid;
}

// ─── Main API ────────────────────────────────────────────────────────────────

export function seedToPixelLayers(seed: INounSeed): NounPixelLayers {
  const { parts, background } = getNounData(seed);
  const palette = ImageData.palette;
  const bgIdx = Number(background);
  const bgColor = `#${(ImageData.bgcolors as string[])[bgIdx] ?? 'e1d7d5'}`;

  // parts order: [body, accessory, head, glasses]
  return {
    background: bgColor,
    body: decodePartToGrid(parts[0].data, palette),
    accessory: decodePartToGrid(parts[1].data, palette),
    head: decodePartToGrid(parts[2].data, palette),
    glasses: decodePartToGrid(parts[3].data, palette),
  };
}

export function mergeLayersToGrid(
  layers: NounPixelLayers,
  visibility: LayerVisibility,
): string[][] {
  const grid: string[][] = Array.from({ length: 32 }, () => Array(32).fill(''));
  const order: (keyof LayerVisibility)[] = ['body', 'accessory', 'head', 'glasses'];
  for (const layer of order) {
    if (!visibility[layer]) continue;
    const src = layers[layer];
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (src[y][x]) grid[y][x] = src[y][x];
      }
    }
  }
  return grid;
}

export function buildVisibilityMask(
  layers: NounPixelLayers,
  visibility: LayerVisibility,
): VisibilityMask {
  return mergeLayersToGrid(layers, visibility).map(row => row.map(color => Boolean(color)));
}

export function applyVisibilityMask(pixels: string[][], mask: VisibilityMask): string[][] {
  return pixels.map((row, y) => row.map((color, x) => (mask[y]?.[x] ? color : '')));
}

export function resolveEditableVisibility(
  pixels: string[][],
  layers: NounPixelLayers,
  visibility: LayerVisibility,
): string[][] {
  const baseAll = mergeLayersToGrid(layers, DEFAULT_VISIBILITY);
  const baseVisible = mergeLayersToGrid(layers, visibility);

  return pixels.map((row, y) =>
    row.map((color, x) => {
      if (!color) return '';

      const originalTopColor = baseAll[y]?.[x] ?? '';
      const nextVisibleBaseColor = baseVisible[y]?.[x] ?? '';

      if (color === originalTopColor) {
        return nextVisibleBaseColor;
      }

      if (nextVisibleBaseColor !== originalTopColor) {
        return nextVisibleBaseColor;
      }

      return color;
    }),
  );
}

export const DEFAULT_VISIBILITY: LayerVisibility = {
  body: true,
  accessory: true,
  head: true,
  glasses: true,
};

export function createEmptyGrid(): string[][] {
  return Array.from({ length: 32 }, () => Array(32).fill(''));
}

// ─── Export helpers (pixel grid → SVG / PNG) ─────────────────────────────────
//
// These let the Save dropdown export whatever is on the 2D canvas — including
// edits AND layer-visibility toggles — instead of always falling back to the
// raw seed SVG. When `bgColor` is omitted (or empty) the SVG/PNG has a
// transparent background, so single-trait downloads (e.g. just the head with
// other layers hidden) come out cleanly.

const PIXEL_SCALE = 10;
const GRID_SIZE = 32;
const CANVAS_PX = GRID_SIZE * PIXEL_SCALE;

/**
 * Build an SVG string from a 32×32 pixel grid. Empty cells stay transparent.
 * Adjacent same-color cells in a row are merged into a single rect to keep
 * the file small (matches `buildSVG` from `@nouns/sdk`).
 */
export function pixelGridToSvg(pixels: string[][], bgColor?: string): string {
  const rects: string[] = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    let runStart = -1;
    let runColor = '';
    const flush = (endX: number) => {
      if (runStart < 0 || !runColor) return;
      const width = (endX - runStart) * PIXEL_SCALE;
      rects.push(
        `<rect width="${width}" height="${PIXEL_SCALE}" x="${runStart * PIXEL_SCALE}" y="${y * PIXEL_SCALE}" fill="${runColor}" />`,
      );
      runStart = -1;
      runColor = '';
    };
    for (let x = 0; x < GRID_SIZE; x++) {
      const color = pixels[y]?.[x] ?? '';
      if (!color) {
        flush(x);
        continue;
      }
      if (color !== runColor) {
        flush(x);
        runStart = x;
        runColor = color;
      }
    }
    flush(GRID_SIZE);
  }

  const bgRect = bgColor
    ? `<rect width="100%" height="100%" fill="${bgColor}" />`
    : '';
  return (
    `<svg width="${CANVAS_PX}" height="${CANVAS_PX}" viewBox="0 0 ${CANVAS_PX} ${CANVAS_PX}" ` +
    `xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">` +
    bgRect +
    rects.join('') +
    `</svg>`
  );
}

/**
 * Render a 32×32 pixel grid into a `HTMLCanvasElement` scaled up to 320×320
 * (one source pixel = 10×10 output). Background cells stay transparent unless
 * `bgColor` is provided. Returns `null` if document/canvas isn't available.
 */
export function pixelGridToCanvas(
  pixels: string[][],
  bgColor?: string,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_PX;
  canvas.height = CANVAS_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (bgColor) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);
  }
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const color = pixels[y]?.[x];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x * PIXEL_SCALE, y * PIXEL_SCALE, PIXEL_SCALE, PIXEL_SCALE);
    }
  }
  return canvas;
}

/**
 * Convert a pixel grid to a data URL of the requested raster format. Returns
 * an empty string when the canvas can't be created (SSR / no document).
 */
export function pixelGridToDataUrl(
  pixels: string[][],
  format: 'png' | 'webp' = 'png',
  bgColor?: string,
): string {
  const canvas = pixelGridToCanvas(pixels, bgColor);
  if (!canvas) return '';
  return canvas.toDataURL(format === 'webp' ? 'image/webp' : 'image/png');
}
