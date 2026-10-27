// ── The ball texture atlas: all 16 balls on one canvas ──────────────────
//
// 4 × 4 tiles, each an equirectangular (2:1) wrap for a sphere's UVs:
// solids are their colour with a white number disc front and back,
// stripes are white with a colour band round the middle, the 8 is black,
// and the cue ball is white with a red spot (so you can see it spin).
// One canvas, one GPU upload: each ball's material shows its own tile via
// the texture's offset / repeat (clones share the image).

import * as THREE from 'three';

export const BALL_COLOURS = [
  '#f4f1e8', // cue
  '#f2c21b', // 1 yellow
  '#1f4fbf', // 2 blue
  '#d8291f', // 3 red
  '#5b2a86', // 4 purple
  '#f07a12', // 5 orange
  '#1c7a3c', // 6 green
  '#7a1f1c', // 7 maroon
  '#111111', // 8
] as const;

/** The colour of ball `id` (stripes share their solid's). */
export function ballColour(id: number): string {
  if (id === 0) return BALL_COLOURS[0];
  if (id === 8) return BALL_COLOURS[8];
  return BALL_COLOURS[id > 8 ? id - 8 : id]!;
}

const TW = 256;
const TH = 128;

function drawTile(c: CanvasRenderingContext2D, id: number, ox: number, oy: number) {
  const col = ballColour(id);
  const stripe = id >= 9;
  c.save();
  c.translate(ox, oy);
  c.beginPath();
  c.rect(0, 0, TW, TH);
  c.clip();
  if (id === 0) {
    c.fillStyle = col;
    c.fillRect(0, 0, TW, TH);
    // A red spot front and back, and a smaller one at each side
    c.fillStyle = '#d42a2a';
    for (const [u, r] of [
      [0.25, 13],
      [0.75, 13],
    ] as const) {
      c.beginPath();
      c.arc(u * TW, TH / 2, r, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    return;
  }
  c.fillStyle = stripe ? '#f4f1e8' : col;
  c.fillRect(0, 0, TW, TH);
  if (stripe) {
    c.fillStyle = col;
    c.fillRect(0, TH * 0.3, TW, TH * 0.4);
  }
  // Number discs at u = 0.25 and 0.75 (front / back)
  for (const u of [0.25, 0.75]) {
    const x = u * TW;
    const y = TH / 2;
    c.fillStyle = '#f8f6ee';
    c.beginPath();
    c.arc(x, y, 17, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#111';
    c.font = `bold ${id >= 10 ? 17 : 21}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(id), x, y + 1);
    if (id === 6 || id === 9) c.fillRect(x - 6, y + 11, 12, 2);
  }
  c.restore();
}

let shared: THREE.CanvasTexture | null = null;

/** The atlas (built once). */
export function ballAtlas(): THREE.CanvasTexture {
  if (shared !== null) return shared;
  const cv = document.createElement('canvas');
  cv.width = TW * 4;
  cv.height = TH * 4;
  const c = cv.getContext('2d')!;
  for (let id = 0; id < 16; id++) drawTile(c, id, (id % 4) * TW, Math.floor(id / 4) * TH);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  // No mipmaps: they'd bleed neighbouring tiles into each ball's seam
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  shared = t;
  return t;
}

/** Ball `id`'s view of the atlas (shares the image). */
export function ballTexture(id: number): THREE.Texture {
  const t = ballAtlas().clone();
  t.repeat.set(0.25, 0.25);
  t.offset.set((id % 4) * 0.25, 1 - (Math.floor(id / 4) + 1) * 0.25);
  t.needsUpdate = true;
  return t;
}

/** Ball colour + group icon for the HUD (CSS). */
export function ballCss(id: number): { bg: string; stripe: boolean } {
  return { bg: ballColour(id), stripe: id >= 9 };
}
