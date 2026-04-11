/**
 * Encode a 32x32 pixel image into the Nouns RLE format compatible
 * with NounsDescriptor's addHeads/addBodies/addAccessories/addGlasses.
 *
 * RLE format: 0x + paletteIndex(1B) + top(1B) + right(1B) + bottom(1B) + left(1B) + pairs(length, colorIndex)
 */

import { ImageData } from '@noundry/nouns-assets';

export interface EncodedTrait {
  /** Hex-encoded RLE data (0x-prefixed) */
  data: string;
  /** Filename for the trait */
  filename: string;
}

/** Convert a hex color string (no #) to a lookup key */
function colorKey(r: number, g: number, b: number, a: number): string {
  if (a === 0) return 'transparent';
  return `${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Find the closest matching palette index for a color.
 * Returns 0 for transparent pixels.
 */
function findPaletteIndex(r: number, g: number, b: number, a: number): number {
  if (a < 128) return 0; // transparent

  const hex = colorKey(r, g, b, a);

  // Exact match in palette
  for (let i = 0; i < ImageData.palette.length; i++) {
    if (ImageData.palette[i].toLowerCase() === hex.toLowerCase()) {
      return i;
    }
  }

  // Closest color by Euclidean distance
  let bestIdx = 1;
  let bestDist = Infinity;
  for (let i = 1; i < ImageData.palette.length; i++) {
    const ph = ImageData.palette[i];
    if (!ph) continue;
    const pr = parseInt(ph.slice(0, 2), 16);
    const pg = parseInt(ph.slice(2, 4), 16);
    const pb = parseInt(ph.slice(4, 6), 16);
    const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Compute the tight bounding box of non-transparent pixels.
 */
function computeBounds(pixels: number[], width: number, height: number) {
  let top = height, bottom = 0, left = width, right = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x] !== 0) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  if (top > bottom) {
    // Entirely transparent
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  return { top, right: right + 1, bottom: bottom + 1, left };
}

/**
 * RLE-encode a row of palette indices within bounds.
 */
function rleEncode(values: number[]): number[] {
  const runs: number[] = [];
  let i = 0;
  while (i < values.length) {
    const val = values[i];
    let count = 1;
    while (i + count < values.length && values[i + count] === val && count < 255) {
      count++;
    }
    runs.push(count, val);
    i += count;
  }
  return runs;
}

/**
 * Encode a 32x32 canvas ImageData into the Nouns RLE format.
 *
 * @param imageData - The ImageData from a 32x32 canvas
 * @param filename - Name for the trait (e.g., "head-custom")
 * @returns EncodedTrait with hex RLE data
 */
export function encodeImageToRLE(
  imageData: ImageData,
  filename: string,
): EncodedTrait {
  const { width, height, data } = imageData;

  if (width !== 32 || height !== 32) {
    throw new Error(`Image must be 32x32, got ${width}x${height}`);
  }

  // Map each pixel to a palette index
  const paletteIndices = new Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    paletteIndices[i] = findPaletteIndex(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      data[offset + 3],
    );
  }

  // Compute tight bounds
  const bounds = computeBounds(paletteIndices, width, height);

  // RLE encode within bounds
  const allRuns: number[] = [];
  for (let y = bounds.top; y < bounds.bottom; y++) {
    const row: number[] = [];
    for (let x = bounds.left; x < bounds.right; x++) {
      row.push(paletteIndices[y * width + x]);
    }
    allRuns.push(...rleEncode(row));
  }

  // Build hex string: paletteIndex(00) + bounds + rle pairs
  let hex = '00'; // palette index 0
  hex += bounds.top.toString(16).padStart(2, '0');
  hex += bounds.right.toString(16).padStart(2, '0');
  hex += bounds.bottom.toString(16).padStart(2, '0');
  hex += bounds.left.toString(16).padStart(2, '0');
  for (const val of allRuns) {
    hex += val.toString(16).padStart(2, '0');
  }

  return {
    data: `0x${hex}`,
    filename,
  };
}

/**
 * Load an image file and draw it onto a 32x32 canvas,
 * returning the ImageData for encoding.
 */
export function fileToImageData(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false; // nearest-neighbor for pixel art
      ctx.drawImage(img, 0, 0, 32, 32);
      resolve(ctx.getImageData(0, 0, 32, 32));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}
