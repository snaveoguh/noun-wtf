// ── MOCHI's hip-rose noggles, from the Nouns art (pure) ───────────────────
//
// Decoded from the on-chain image data (the same RLE the descriptor draws),
// never redrawn: noggles.test.ts checks it against
// nouns-assets/images/v0/4-glasses/glasses-hip-rose.png pixel for pixel.

import { ImageData } from '@noundry/nouns-assets';
import { decodeRLE } from '@nouns/voxel-engine';

export interface NogPixel {
  /** Column / row in the cropped art (0, 0 top left). */
  x: number;
  y: number;
  /** 0xRRGGBB, exactly the palette colour. */
  hex: number;
}

export const HIP_ROSE = 'glasses-hip-rose';

let cache: { px: NogPixel[]; w: number; h: number } | null = null;

export function hipRoseNoggles(): { px: NogPixel[]; w: number; h: number } {
  if (cache !== null) return cache;
  const img = ImageData.images.glasses.find(g => g.filename === HIP_ROSE)!;
  const { bounds, pairs } = decodeRLE(img.data);
  const all: NogPixel[] = [];
  let x = bounds.left;
  let y = bounds.top;
  for (const [run, ci] of pairs)
    for (let i = 0; i < run; i++) {
      if (ci !== 0) all.push({ x, y, hex: parseInt(ImageData.palette[ci]!, 16) });
      x++;
      if (x >= bounds.right) {
        x = bounds.left;
        y++;
      }
    }
  const x0 = Math.min(...all.map(p => p.x));
  const y0 = Math.min(...all.map(p => p.y));
  const px = all.map(p => ({ x: p.x - x0, y: p.y - y0, hex: p.hex }));
  cache = { px, w: Math.max(...px.map(p => p.x)) + 1, h: Math.max(...px.map(p => p.y)) + 1 };
  return cache;
}
