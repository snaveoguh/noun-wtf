// ── The facades' texture atlas: one canvas, painted a tile at a time ────
//
// 8 × 4 tiles. Rows 0–2: four tiles per style (a window bay, a blank bay,
// the ground-floor base, the parapet band), each one bay wide and one
// storey tall (the parapet tile is the 0.9 m band over the roof). Row 3:
// sign boards (four 4:1 strips per tile), lettered with the buildings'
// names. Brick, stone and glass are drawn in their own colours; walls
// that come in many paints (stucco, limestone) are drawn light and tinted
// per building by vertex colour.

import type { Tile } from './layout';
import type { FacadeStyle } from './styles';

import { mulberry32 } from '../../interiors/rng';
import { PARAPET, WINDOW } from './layout';
import { STOREY, STYLE_INFO, STYLES } from './styles';

export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;
const TILES: readonly Tile[] = ['win', 'blank', 'base', 'parapet'];
export const SIGN_SLOTS = ATLAS_COLS * 4;

/** Texture inset (in tile fractions) so mip filtering doesn't bleed neighbours in. */
const INSET = 0.012;

function cellUv(col: number, row: number): [number, number, number, number] {
  const u0 = col / ATLAS_COLS;
  const u1 = (col + 1) / ATLAS_COLS;
  // flipY: canvas row 0 is the top of the texture (v = 1)
  const v1 = 1 - row / ATLAS_ROWS;
  const v0 = 1 - (row + 1) / ATLAS_ROWS;
  const iu = INSET / ATLAS_COLS;
  const iv = INSET / ATLAS_ROWS;
  return [u0 + iu, v0 + iv, u1 - iu, v1 - iv];
}

export function tileIndex(style: FacadeStyle, tile: Tile): number {
  return STYLES.indexOf(style) * TILES.length + TILES.indexOf(tile);
}

/** [u0, v0, u1, v1] of a style tile (v0 = the bottom of the storey). */
export function tileUv(style: FacadeStyle, tile: Tile): [number, number, number, number] {
  const i = tileIndex(style, tile);
  return cellUv(i % ATLAS_COLS, Math.floor(i / ATLAS_COLS));
}

/** [u0, v0, u1, v1] of sign slot `i` (a 4:1 strip). */
export function signUv(i: number): [number, number, number, number] {
  const col = Math.floor(i / 4) % ATLAS_COLS;
  const strip = i % 4;
  const [u0, , u1] = cellUv(col, 3);
  const top = 1 - 3 / ATLAS_ROWS; // row 3's top edge in v
  const h = 1 / ATLAS_ROWS / 4;
  const iv = (INSET / ATLAS_ROWS) * 0.5;
  return [u0, top - (strip + 1) * h + iv, u1, top - strip * h - iv];
}

// ── Painting ────────────────────────────────────────────────────────────

type Ctx = CanvasRenderingContext2D;

/** Pen for one tile: metres (s across the bay, y up from the floor) → canvas px. */
interface Pen {
  ctx: Ctx;
  x0: number;
  y0: number;
  T: number;
  /** Bay width and row height (m) the tile stands for. */
  w: number;
  h: number;
  rnd: () => number;
}

const X = (p: Pen, s: number) => p.x0 + (s / p.w) * p.T;
const Y = (p: Pen, y: number) => p.y0 + p.T - (y / p.h) * p.T;

function rect(p: Pen, s0: number, y0: number, s1: number, y1: number, fill: string) {
  p.ctx.fillStyle = fill;
  const x = X(p, s0);
  const y = Y(p, y1);
  p.ctx.fillRect(x, y, X(p, s1) - x, Y(p, y0) - y);
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** Running-bond brick over a rect (metres). */
function brick(
  p: Pen,
  s0: number,
  y0: number,
  s1: number,
  y1: number,
  base: string,
  mortar: string,
) {
  rect(p, s0, y0, s1, y1, mortar);
  const course = 0.085;
  const len = 0.23;
  let row = 0;
  for (let y = y0; y < y1 - 1e-6; y += course, row++) {
    const off = row % 2 === 0 ? 0 : len / 2;
    for (let s = s0 - off; s < s1; s += len) {
      const k = 0.84 + p.rnd() * 0.3;
      const a = Math.max(s0, s + 0.012);
      const b = Math.min(s1, s + len - 0.012);
      if (b > a) rect(p, a, y + 0.012, b, Math.min(y1, y + course - 0.004), shade(base, k));
    }
  }
}

/** Ashlar stone courses (brownstone, limestone). */
function ashlar(
  p: Pen,
  s0: number,
  y0: number,
  s1: number,
  y1: number,
  base: string,
  course: number,
  joint: string,
) {
  rect(p, s0, y0, s1, y1, base);
  let row = 0;
  for (let y = y0; y < y1; y += course, row++) {
    rect(p, s0, y, s1, y + 0.018, joint);
    const len = course * 2.4;
    for (let s = s0 + (row % 2) * len * 0.5; s < s1; s += len)
      rect(p, s, y, s + 0.018, y + course, joint);
    // a little tone per course
    rect(p, s0, y + 0.02, s1, y + course, `rgba(0,0,0,${(p.rnd() * 0.05).toFixed(3)})`);
  }
}

function glassPane(
  p: Pen,
  s0: number,
  y0: number,
  s1: number,
  y1: number,
  dark: string,
  light: string,
) {
  const ctx = p.ctx;
  const g = ctx.createLinearGradient(X(p, s0), Y(p, y1), X(p, s1), Y(p, y0));
  g.addColorStop(0, light);
  g.addColorStop(0.45, dark);
  g.addColorStop(1, shade(dark.startsWith('#') ? dark : '#223344', 0.8));
  ctx.fillStyle = g;
  ctx.fillRect(X(p, s0), Y(p, y1), X(p, s1) - X(p, s0), Y(p, y0) - Y(p, y1));
  // a diagonal sky streak
  ctx.save();
  ctx.beginPath();
  ctx.rect(X(p, s0), Y(p, y1), X(p, s1) - X(p, s0), Y(p, y0) - Y(p, y1));
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  const w = X(p, s1) - X(p, s0);
  ctx.beginPath();
  ctx.moveTo(X(p, s0) + w * 0.15, Y(p, y1));
  ctx.lineTo(X(p, s0) + w * 0.45, Y(p, y1));
  ctx.lineTo(X(p, s0) + w * 0.05, Y(p, y0));
  ctx.lineTo(X(p, s0) - w * 0.25, Y(p, y0));
  ctx.fill();
  ctx.restore();
}

/** Window with frame and glazing bars: `cols` × `rows` panes. */
function paintWindow(
  p: Pen,
  s0: number,
  y0: number,
  s1: number,
  y1: number,
  frame: string,
  glass: [string, string],
  cols: number,
  rows: number,
  bar = 0.045,
) {
  rect(p, s0, y0, s1, y1, frame);
  const f = 0.07;
  glassPane(p, s0 + f, y0 + f, s1 - f, y1 - f, glass[0], glass[1]);
  for (let i = 1; i < cols; i++) {
    const s = s0 + f + ((s1 - s0 - 2 * f) * i) / cols;
    rect(p, s - bar / 2, y0 + f, s + bar / 2, y1 - f, frame);
  }
  for (let j = 1; j < rows; j++) {
    const y = y0 + f + ((y1 - y0 - 2 * f) * j) / rows;
    rect(p, s0 + f, y - bar / 2, s1 - f, y + bar / 2, frame);
  }
  // a blind pulled part way down in some
  if (p.rnd() < 0.35)
    rect(
      p,
      s0 + f,
      y1 - f - (y1 - y0) * (0.15 + p.rnd() * 0.3),
      s1 - f,
      y1 - f,
      'rgba(240,226,190,0.85)',
    );
}

function paintTile(p: Pen, style: FacadeStyle, tile: Tile) {
  const w = p.w;
  const h = p.h;
  const win = WINDOW[style];
  const ws0 = (w * (1 - win.w)) / 2;
  const ws1 = w - ws0;
  switch (style) {
    case 'tenement': {
      const brickC = '#a4483a';
      brick(p, 0, 0, w, h, brickC, '#cdbfae');
      if (tile === 'win') {
        paintWindow(p, ws0, win.y0, ws1, win.y1, '#f1eadc', ['#22303f', '#6c8aa8'], 2, 2);
        // stone lintel with keystone + sill (the 3D ones sit on these)
        rect(p, ws0 - 0.1, win.y1, ws1 + 0.1, win.y1 + 0.2, '#e6dcc6');
        rect(p, w / 2 - 0.09, win.y1 - 0.02, w / 2 + 0.09, win.y1 + 0.26, '#d9cdb3');
        rect(p, ws0 - 0.06, win.y0 - 0.08, ws1 + 0.06, win.y0, '#e6dcc6');
      } else if (tile === 'base') {
        rect(p, 0, 0, w, 0.5, '#8e8a82');
        rect(p, 0, 0.5, w, 0.56, '#b4ada0');
      } else if (tile === 'parapet') {
        rect(p, 0, h * 0.55, w, h * 0.7, '#e6dcc6');
        for (let s = 0.05; s < w; s += 0.22) rect(p, s, h * 0.4, s + 0.11, h * 0.55, '#e6dcc6');
      }
      break;
    }
    case 'brownstone': {
      const stone = '#7d4f3c';
      ashlar(p, 0, 0, w, h, stone, tile === 'base' ? 0.42 : 0.55, shade(stone, 0.78));
      if (tile === 'win') {
        paintWindow(p, ws0, win.y0, ws1, win.y1, '#2c2420', ['#1d2530', '#5d7387'], 1, 2);
        // hood moulding + brackets
        rect(p, ws0 - 0.16, win.y1 + 0.02, ws1 + 0.16, win.y1 + 0.24, shade(stone, 1.18));
        rect(p, ws0 - 0.16, win.y1 - 0.2, ws0 - 0.06, win.y1 + 0.02, shade(stone, 1.1));
        rect(p, ws1 + 0.06, win.y1 - 0.2, ws1 + 0.16, win.y1 + 0.02, shade(stone, 1.1));
        rect(p, ws0 - 0.08, win.y0 - 0.1, ws1 + 0.08, win.y0, shade(stone, 1.15));
      } else if (tile === 'base') {
        for (let y = 0.42; y < h; y += 0.42) rect(p, 0, y - 0.05, w, y + 0.02, shade(stone, 0.6));
      } else if (tile === 'parapet') {
        rect(p, 0, h * 0.25, w, h * 0.42, shade(stone, 1.2));
        for (let s = 0.1; s < w; s += 0.45)
          rect(p, s, h * 0.42, s + 0.14, h * 0.7, shade(stone, 1.15));
        rect(p, 0, h * 0.7, w, h, shade(stone, 1.25));
      }
      break;
    }
    case 'modern': {
      if (tile === 'win' || tile === 'base') {
        // full-height glass with a spandrel at the slab
        rect(p, 0, 0, w, h, '#2a3a48');
        glassPane(p, 0.04, 0.42, w - 0.04, h - 0.04, '#21485e', '#9cc7d8');
        rect(p, 0, 0, w, 0.42, '#3a4752');
        rect(p, 0, 0.36, w, 0.42, '#c9d3da');
        rect(p, 0, 0, 0.04, h, '#c9d3da');
        rect(p, w - 0.04, 0, w, h, '#c9d3da');
      } else {
        // aluminium panels
        rect(p, 0, 0, w, h, '#c4ccd2');
        for (let y = 0; y < h; y += h / (tile === 'parapet' ? 1 : 3))
          rect(p, 0, y, w, y + 0.03, '#8e989f');
        rect(p, w / 2 - 0.015, 0, w / 2 + 0.015, h, '#8e989f');
      }
      break;
    }
    case 'deco': {
      const lime = '#efe6d2';
      ashlar(p, 0, 0, w, h, lime, 0.68, '#d8ccb2');
      // fluted pilaster strips at the bay edges
      for (const s of [0, w - 0.22]) {
        rect(p, s, 0, s + 0.22, h, '#e2d6bb');
        rect(p, s + 0.07, 0, s + 0.09, h, '#cbbd9e');
        rect(p, s + 0.13, 0, s + 0.15, h, '#cbbd9e');
      }
      if (tile === 'win') {
        paintWindow(p, ws0, win.y0, ws1, win.y1, '#2e3b36', ['#1c2a2c', '#6f9a95'], 1, 4, 0.03);
        // chevron spandrel under the window
        const ctx = p.ctx;
        rect(p, ws0, 0.12, ws1, win.y0 - 0.06, '#3d6b5f');
        ctx.strokeStyle = '#d6b24c';
        ctx.lineWidth = Math.max(1, p.T / 90);
        ctx.beginPath();
        const n = 4;
        for (let i = 0; i <= n * 2; i++) {
          const s = ws0 + ((ws1 - ws0) * i) / (n * 2);
          const y = i % 2 === 0 ? 0.25 : win.y0 - 0.2;
          if (i === 0) ctx.moveTo(X(p, s), Y(p, y));
          else ctx.lineTo(X(p, s), Y(p, y));
        }
        ctx.stroke();
      } else if (tile === 'base') {
        rect(p, 0, 0, w, 0.6, '#3d6b5f');
        rect(p, 0, 0.6, w, 0.68, '#d6b24c');
      } else if (tile === 'parapet') {
        rect(p, 0, 0, w, h, '#e2d6bb');
        const ctx = p.ctx;
        ctx.fillStyle = '#3d6b5f';
        for (let s = 0; s < w; s += 0.36) {
          ctx.beginPath();
          ctx.moveTo(X(p, s), Y(p, 0.15));
          ctx.lineTo(X(p, s + 0.18), Y(p, h - 0.15));
          ctx.lineTo(X(p, s + 0.36), Y(p, 0.15));
          ctx.fill();
        }
        rect(p, 0, h - 0.1, w, h, '#d6b24c');
      }
      break;
    }
    case 'loft': {
      brick(p, 0, 0, w, h, '#7a4a37', '#a99a88');
      if (tile === 'win') {
        // steel factory sash: many small panes
        paintWindow(p, ws0, win.y0, ws1, win.y1, '#2b2f33', ['#25313a', '#7f97a6'], 5, 6, 0.035);
        rect(p, ws0 - 0.08, win.y1, ws1 + 0.08, win.y1 + 0.14, '#3a3e42');
        rect(p, ws0 - 0.05, win.y0 - 0.1, ws1 + 0.05, win.y0, '#9c9384');
      } else if (tile === 'base') {
        rect(p, 0, 0, w, 0.7, '#5d5550');
      } else if (tile === 'parapet') {
        for (let s = 0; s < w; s += 0.46) rect(p, s, h * 0.5, s + 0.23, h * 0.62, '#5e3828');
        rect(p, 0, h * 0.85, w, h, '#9c9384');
      }
      break;
    }
    case 'shopfront': {
      // stucco: drawn light, tinted per building
      rect(p, 0, 0, w, h, '#f4f0ea');
      for (let i = 0; i < 40; i++) {
        const s = p.rnd() * w;
        const y = p.rnd() * h;
        rect(p, s, y, s + 0.25, y + 0.12, `rgba(0,0,0,${(p.rnd() * 0.03).toFixed(3)})`);
      }
      if (tile === 'win') {
        paintWindow(p, ws0, win.y0, ws1, win.y1, '#ffffff', ['#2a3646', '#7c98b4'], 2, 1);
        rect(p, ws0 - 0.08, win.y0 - 0.08, ws1 + 0.08, win.y0, '#e1dbd2');
      } else if (tile === 'base') {
        rect(p, 0, 0, w, 0.45, '#cfc8be');
      } else if (tile === 'parapet') {
        rect(p, 0, 0, w, 0.12, '#dcd5cb');
        rect(p, 0, h - 0.14, w, h, '#dcd5cb');
      }
      break;
    }
  }
}

const SIGN_COLOURS: [string, string][] = [
  ['#1f2a44', '#f6d365'],
  ['#7a1f2b', '#fff3d6'],
  ['#0f5257', '#f2e8cf'],
  ['#f2e8cf', '#20262e'],
  ['#2d2a26', '#ff6b5b'],
  ['#3d6b5f', '#f6e7b4'],
];

function paintSign(ctx: Ctx, x: number, y: number, w: number, h: number, text: string, k: number) {
  const [bg, fg] = SIGN_COLOURS[k % SIGN_COLOURS.length]!;
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = fg;
  ctx.lineWidth = Math.max(1, h * 0.06);
  ctx.strokeRect(x + h * 0.1, y + h * 0.1, w - h * 0.2, h - h * 0.2);
  ctx.fillStyle = fg;
  let size = h * 0.56;
  ctx.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
  const t = text.toUpperCase();
  const max = w - h * 0.5;
  const tw = ctx.measureText(t).width;
  if (tw > max) {
    size *= max / tw;
    ctx.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t, x + w / 2, y + h / 2 + size * 0.05);
}

/**
 * Paint the atlas a tile per step (a generator, so a caller can spread it
 * over frames). `tile` px per tile; `signs` fill the sign slots in order.
 */
export function* paintAtlas(
  canvas: HTMLCanvasElement,
  tile: number,
  signs: readonly string[],
): Generator<void, void, void> {
  canvas.width = tile * ATLAS_COLS;
  canvas.height = tile * ATLAS_ROWS;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#888';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const style of STYLES)
    for (const t of TILES) {
      const i = tileIndex(style, t);
      const col = i % ATLAS_COLS;
      const row = Math.floor(i / ATLAS_COLS);
      const p: Pen = {
        ctx,
        x0: col * tile,
        y0: row * tile,
        T: tile,
        w: STYLE_INFO[style].bay,
        h: t === 'parapet' ? PARAPET : STOREY,
        rnd: mulberry32(i * 7919 + 13),
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(col * tile, row * tile, tile, tile);
      ctx.clip();
      paintTile(p, style, t);
      ctx.restore();
      yield;
    }
  const sh = tile / 4;
  for (let i = 0; i < SIGN_SLOTS; i++) {
    const col = Math.floor(i / 4);
    const strip = i % 4;
    paintSign(ctx, col * tile, 3 * tile + strip * sh, tile, sh, signs[i] ?? 'NOUN', i);
    if (strip === 3) yield;
  }
}
