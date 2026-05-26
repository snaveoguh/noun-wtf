/**
 * Decode a Noun seed into per-layer 32x32 pixel grids.
 * Reuses RLE decoding logic from NounParallax.
 */
import { ImageData, getNounData } from '@noundry/nouns-assets';
import { ImageDataV2, getNounDataV2 } from '@nouns/assets';

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

export function seedToPixelLayers(seed: INounSeed, isV2 = false): NounPixelLayers {
  const data = isV2 ? ImageDataV2 : ImageData;
  const { parts, background } = isV2 ? getNounDataV2(seed) : getNounData(seed);
  const palette = data.palette;
  const bgIdx = Number(background);
  const bgColor = `#${(data.bgcolors as string[])[bgIdx] ?? 'e1d7d5'}`;

  // parts order: [body, accessory, head, glasses]
  // Guard against out-of-range seed indices. The V2 toggle path can pass a
  // V1-derived seed through this with `isV2=true` during the brief render
  // window between toggle click and the V2 auction data landing — V1 indices
  // (e.g. accessory up to 142, head up to 253) can exceed V2's smaller arrays
  // (144 accessories, 253 heads) by edge cases like founder-trait additions.
  // Previously this crashed the whole page with "undefined is not an object
  // (evaluating 'R[1].data')". Now missing parts render as transparent
  // 32x32 grids so the page reconciles once the right seed arrives.
  const emptyGrid = (): string[][] => Array.from({ length: 32 }, () => Array<string>(32).fill(''));
  const safePart = (i: number): string[][] =>
    parts[i]?.data != null ? decodePartToGrid(parts[i].data, palette) : emptyGrid();

  return {
    background: bgColor,
    body: safePart(0),
    accessory: safePart(1),
    head: safePart(2),
    glasses: safePart(3),
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
