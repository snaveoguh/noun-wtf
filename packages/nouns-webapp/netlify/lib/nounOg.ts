// ── A Noun as a share-card PNG (pure) ──────────────────────────────────────
//
// X / Slack / Discord / iMessage cards want a PNG or JPEG (not SVG), ideally
// 1200 × 630. The Noun is drawn from its seed (read from the token) and the
// trait art the site already bundles: the on-chain renderers (`tokenURI`,
// the descriptor's `generateSVGImage`) revert over public RPCs, too heavy
// for their gas caps (2026-11-01). The 32 × 32 pixels are painted big and
// crisp (whole pixels, no smoothing) on the Noun's own background colour,
// then the PNG is encoded with node's zlib. No image libraries.

import { deflateSync } from 'node:zlib';

export const OG_W = 1200;
export const OG_H = 630;
/** Screen pixels per Noun pixel: 32 × 18 = 576, sitting on the card's bottom edge (like a Noun image, the body runs off it). */
const SCALE = 18;

export interface NounGrid {
  /** Background colour, [r, g, b]. */
  bg: [number, number, number];
  /** 32 × 32, row major; null where the background shows. */
  px: ([number, number, number] | null)[];
}

function hexRgb(h: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (m === null) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * A Noun's trait images (the descriptor's run-length encoding: a palette
 * byte, then top / right / bottom / left bounds, then (run, colour) pairs,
 * colour 0 = transparent) → its 32 × 32 pixels, layered in order.
 */
export function nounGrid(parts: { data: string }[], palette: string[], bgHex: string): NounGrid {
  const px: NounGrid['px'] = new Array(32 * 32).fill(null);
  for (const part of parts) {
    const hex = part.data.replace(/^0x/, '');
    const top = parseInt(hex.slice(2, 4), 16);
    const right = parseInt(hex.slice(4, 6), 16);
    const left = parseInt(hex.slice(8, 10), 16);
    let x = left;
    let y = top;
    for (let k = 10; k + 4 <= hex.length; k += 4) {
      const run = parseInt(hex.slice(k, k + 2), 16);
      const ci = parseInt(hex.slice(k + 2, k + 4), 16);
      const rgb = ci !== 0 ? hexRgb(palette[ci] ?? '') : null;
      for (let r = 0; r < run; r++) {
        if (rgb !== null && x < 32 && y < 32) px[y * 32 + x] = rgb;
        x++;
        if (x === right) {
          x = left;
          y++;
        }
      }
    }
  }
  return { bg: hexRgb(bgHex) ?? [213, 215, 225], px };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGB pixels (row major, w × h × 3) → a PNG file. */
export function encodePng(rgb: Uint8Array, w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** The share card: the Noun, big, centred and standing on the bottom edge, on its own background. */
export function renderNounCard(grid: NounGrid): Buffer {
  const rgb = new Uint8Array(OG_W * OG_H * 3);
  for (let i = 0; i < OG_W * OG_H; i++) rgb.set(grid.bg, i * 3);
  const ox = Math.floor((OG_W - 32 * SCALE) / 2);
  const oy = OG_H - 32 * SCALE;
  for (let j = 0; j < 32; j++)
    for (let i = 0; i < 32; i++) {
      const c = grid.px[j * 32 + i];
      if (c == null) continue;
      for (let y = 0; y < SCALE; y++) {
        const row = (oy + j * SCALE + y) * OG_W;
        for (let x = 0; x < SCALE; x++) rgb.set(c, (row + ox + i * SCALE + x) * 3);
      }
    }
  return encodePng(rgb, OG_W, OG_H);
}
