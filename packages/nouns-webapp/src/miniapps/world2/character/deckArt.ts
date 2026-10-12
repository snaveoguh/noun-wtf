// ── Custom deck art: Nouns trait stickers + design → pixels → texture ──
//
// Everything here is deterministic from the design JSON (integer maths, no
// canvas drawing ops), so a deck looks the same in the editor, on your board
// and on everyone else's screen.

import { ImageData } from '@noundry/nouns-assets';
import * as THREE from 'three';

import {
  DECK_H,
  DECK_W,
  decodePixels,
  type DecalKind,
  type DeckDecal,
  type DeckDesign,
} from './deckSchema';

const TRAIT_KEY: Record<DecalKind, 'heads' | 'glasses' | 'bodies' | 'accessories'> = {
  head: 'heads',
  glasses: 'glasses',
  body: 'bodies',
  accessory: 'accessories',
};

export function traitCount(k: DecalKind): number {
  return ImageData.images[TRAIT_KEY[k]].length;
}

export function traitLabel(k: DecalKind, i: number): string {
  const f = ImageData.images[TRAIT_KEY[k]][i]?.filename ?? '';
  return f.replace(/^(head|glasses|body|accessory)-/, '').replace(/-/g, ' ');
}

export interface TraitArt {
  w: number;
  h: number;
  /** RGBA, trimmed to the trait's opaque pixels. */
  px: Uint8ClampedArray;
}

const traitCache = new Map<string, TraitArt | null>();

/** Decode a trait's run-length data (32×32) and trim it to its pixels. */
export function traitArt(k: DecalKind, i: number): TraitArt | null {
  const key = `${k}:${i}`;
  const hit = traitCache.get(key);
  if (hit !== undefined) return hit;
  const part = ImageData.images[TRAIT_KEY[k]][i];
  if (part === undefined) {
    traitCache.set(key, null);
    return null;
  }
  const hex = part.data.replace(/^0x/, '');
  const top = parseInt(hex.slice(2, 4), 16);
  const right = parseInt(hex.slice(4, 6), 16);
  const left = parseInt(hex.slice(8, 10), 16);
  const grid = new Int16Array(32 * 32).fill(-1);
  let x = left;
  let y = top;
  for (let o = 10; o + 4 <= hex.length; o += 4) {
    const run = parseInt(hex.slice(o, o + 2), 16);
    const ci = parseInt(hex.slice(o + 2, o + 4), 16);
    for (let n = 0; n < run; n++) {
      if (ci !== 0 && x < 32 && y < 32) grid[y * 32 + x] = ci;
      x++;
      if (x >= right) {
        x = left;
        y++;
      }
    }
  }
  let x0 = 32;
  let y0 = 32;
  let x1 = -1;
  let y1 = -1;
  for (let yy = 0; yy < 32; yy++)
    for (let xx = 0; xx < 32; xx++)
      if (grid[yy * 32 + xx] >= 0) {
        x0 = Math.min(x0, xx);
        y0 = Math.min(y0, yy);
        x1 = Math.max(x1, xx);
        y1 = Math.max(y1, yy);
      }
  if (x1 < 0) {
    traitCache.set(key, null);
    return null;
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const ci = grid[(yy + y0) * 32 + xx + x0];
      if (ci < 0) continue;
      const c = ImageData.palette[ci] ?? '000000';
      const o = (yy * w + xx) * 4;
      px[o] = parseInt(c.slice(0, 2), 16);
      px[o + 1] = parseInt(c.slice(2, 4), 16);
      px[o + 2] = parseInt(c.slice(4, 6), 16);
      px[o + 3] = 255;
    }
  const art = { w, h, px };
  traitCache.set(key, art);
  return art;
}

/** Sticker size in deck pixels once rotated and scaled. */
export function decalSize(d: DeckDecal): { w: number; h: number } {
  const a = traitArt(d.k, d.i);
  if (a === null) return { w: 0, h: 0 };
  const odd = d.r % 2 === 1;
  return { w: (odd ? a.h : a.w) * d.s, h: (odd ? a.w : a.h) * d.s };
}

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Draw one sticker into an RGBA deck buffer. */
function drawDecal(out: Uint8ClampedArray, d: DeckDecal) {
  const a = traitArt(d.k, d.i);
  if (a === null) return;
  const { w: dw, h: dh } = decalSize(d);
  const s = d.s;
  for (let dy = 0; dy < dh; dy++) {
    const py = d.y + dy;
    if (py < 0 || py >= DECK_H) continue;
    const ry = Math.floor(dy / s);
    for (let dx = 0; dx < dw; dx++) {
      const px = d.x + dx;
      if (px < 0 || px >= DECK_W) continue;
      const rx = Math.floor(dx / s);
      // Rotated cell → source cell (quarter turns clockwise)
      let sx: number;
      let sy: number;
      if (d.r === 0) [sx, sy] = [rx, ry];
      else if (d.r === 1) [sx, sy] = [ry, a.h - 1 - rx];
      else if (d.r === 2) [sx, sy] = [a.w - 1 - rx, a.h - 1 - ry];
      else [sx, sy] = [a.w - 1 - ry, rx];
      if (d.f === 1) sx = a.w - 1 - sx;
      const so = (sy * a.w + sx) * 4;
      if (a.px[so + 3] === 0) continue;
      const o = (py * DECK_W + px) * 4;
      out[o] = a.px[so];
      out[o + 1] = a.px[so + 1];
      out[o + 2] = a.px[so + 2];
      out[o + 3] = 255;
    }
  }
}

/** Compose background, painted pixels and stickers into RGBA (DECK_W × DECK_H). */
export function composeDeck(
  bg: string[],
  idx: Uint8Array,
  pal: string[],
  decals: DeckDecal[],
  out = new Uint8ClampedArray(DECK_W * DECK_H * 4),
): Uint8ClampedArray {
  const top = hexRgb(bg[0] ?? '#222222');
  const bot = hexRgb(bg[1] ?? bg[0] ?? '#222222');
  const palRgb = pal.map(hexRgb);
  for (let y = 0; y < DECK_H; y++) {
    const t = y / (DECK_H - 1);
    const r = Math.round(top[0] + (bot[0] - top[0]) * t);
    const g = Math.round(top[1] + (bot[1] - top[1]) * t);
    const b = Math.round(top[2] + (bot[2] - top[2]) * t);
    for (let x = 0; x < DECK_W; x++) {
      const i = y * DECK_W + x;
      const o = i * 4;
      const v = idx[i];
      const c = v > 0 ? palRgb[v - 1] : undefined;
      out[o] = c ? c[0] : r;
      out[o + 1] = c ? c[1] : g;
      out[o + 2] = c ? c[2] : b;
      out[o + 3] = 255;
    }
  }
  for (const d of decals) drawDecal(out, d);
  return out;
}

export function designPixels(design: DeckDesign): Uint8ClampedArray {
  const idx = decodePixels(design.px, design.pal.length) ?? new Uint8Array(DECK_W * DECK_H);
  return composeDeck(design.bg, idx, design.pal, design.decals);
}

/** Paint a design onto a canvas at 1 px per deck pixel. */
export function designCanvas(design: DeckDesign, canvas = document.createElement('canvas')) {
  canvas.width = DECK_W;
  canvas.height = DECK_H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(DECK_W, DECK_H);
  img.data.set(designPixels(design));
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Deck texture for NounCharacter.setDeckGraphic: crisp pixels up close
 * (nearest), mipmapped far away, UVs as the GLB has them (no flip).
 */
export function designTexture(design: DeckDesign): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(designCanvas(design));
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Starter design: the shop's house deck. */
export function defaultDesign(): DeckDesign {
  return {
    v: 1,
    name: 'MY DECK',
    bg: ['#ffd400', '#d22209'],
    pal: [],
    px: '',
    decals: [{ k: 'glasses', i: 0, x: 9, y: 80, s: 2, r: 0 }],
    grip: '#1b1b1b',
  };
}
