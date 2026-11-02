// ── CAMP's art: one canvas atlas for everything printed or painted ───────
//
// The MEME VALUE cover and the spreads lying open (the book's own page
// images, loaded after the room is up), the whiteboard's ice cream van
// plans, the sunset poster, the closure notice and the NOUNS CAMP tag.
// One texture, one material ('art' in the room's kit). 2048 × 1792, half on
// either texture diet (weak phones; every other phone / tablet on the light one).

import * as THREE from 'three';

import { paintEsportsRug } from '../../interiors/art';
import { textureDiet } from '../../render/textureDiet';

import { OPEN_PAGES } from './layout';

/** Atlas slots in 0–1 (u0, v0, u1, v1), v up (three.js), from 1024-px rects. */
type Slot = [number, number, number, number];
/** Atlas size in its 1-px-per-unit layout (scaled down on the texture diet). */
const AW = 2048;
const AH = 1792;
const px = (x0: number, y0: number, x1: number, y1: number): Slot => [
  x0 / AW,
  1 - y1 / AH,
  x1 / AW,
  1 - y0 / AH,
];
const RECT = {
  cover: [0, 0, 256, 256],
  whiteboard: [0, 384, 608, 784],
  poster: [768, 0, 1024, 370],
  notice: [768, 384, 1024, 725],
  tag: [0, 800, 608, 1024],
  edge: [640, 800, 704, 864],
  // The right half: three spreads as posters, and the esports rug
  eats: [1024, 0, 1280, 512],
  zebra: [1280, 0, 1536, 512],
  duna: [1024, 512, 2048, 1024],
  rug: [1536, 0, 2048, 341],
  // Along the bottom: every page at once (the crumpled floor poster)
  sheet: [16, 1072, 2032, 1720],
} as const;

/** All 252 pages as one contact sheet (scripts/books/meme-value-sheet.py). */
const SHEET_URL = '/world2/camp/meme-value-sheet.webp';

/**
 * Spreads up as posters (left page, right page), by the reader's spread
 * number: 4 NOUNS EATS EVERYTHING and the zebra turned upright, 83 DUNA
 * SEASON as it is.
 */
const PRINTS: { rect: keyof typeof RECT; pages: [number, number]; upright: boolean }[] = [
  { rect: 'eats', pages: [6, 7], upright: true },
  { rect: 'zebra', pages: [122, 123], upright: true },
  { rect: 'duna', pages: [164, 165], upright: false },
];
const SPREAD_AT: [number, number][] = [
  [256, 0],
  [512, 0],
  [256, 128],
  [512, 128],
  [256, 256],
  [512, 256],
];

export interface CampArt {
  texture: THREE.CanvasTexture;
  slot: {
    cover: Slot;
    whiteboard: Slot;
    poster: Slot;
    notice: Slot;
    tag: Slot;
    /** Page edges (cream lines) for the sides of the books. */
    edge: Slot;
    spread: Slot[];
    /** The posters: EATS EVERYTHING, the zebra (both upright), DUNA SEASON. */
    prints: Slot[];
    rug: Slot;
    /** Every page of the book, 28 × 9 (the floor poster). */
    sheet: Slot;
  };
  /** Fetch the cover and pages and paint them in (once; safe to call again). */
  loadPages(): void;
  dispose(): void;
}

const PAGE_URL = (n: number) => `/books/meme-value/sm/p${String(n).padStart(3, '0')}.webp`;

export function buildCampArt(): CampArt {
  // Half size on either diet: 2048 × 1792 with mips was 25 MB of an iPad's GPU
  const S = textureDiet.on || textureDiet.light ? 512 : 1024;
  const k = S / 1024;
  const canvas = document.createElement('canvas');
  canvas.width = AW * k;
  canvas.height = AH * k;
  const c = canvas.getContext('2d')!;
  c.scale(k, k);
  c.fillStyle = '#e9e4d8';
  c.fillRect(0, 0, AW, AH);
  paintCoverPlaceholder(c);
  SPREAD_AT.forEach(([x, y]) => paintSpreadPlaceholder(c, x, y));
  paintWhiteboard(c, ...RECT.whiteboard);
  paintPoster(c, ...RECT.poster);
  paintNotice(c, ...RECT.notice);
  paintTag(c, ...RECT.tag);
  paintEdge(c, ...RECT.edge);
  paintEsportsRug(
    c,
    RECT.rug[0],
    RECT.rug[1],
    RECT.rug[2] - RECT.rug[0],
    RECT.rug[3] - RECT.rug[1],
  );
  for (const r of [...PRINTS.map(p => p.rect), 'sheet' as const]) {
    const [x0, y0, x1, y1] = RECT[r];
    c.fillStyle = '#f4f2ec';
    c.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  let loading = false;
  let disposed = false;
  /** A page into (x, y, w, h); `upright` turns it a quarter clockwise first. */
  const draw = (n: number | string, x: number, y: number, w: number, h: number, upright = false) =>
    new Promise<void>(resolve => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (!disposed) {
          if (upright) {
            c.save();
            c.translate(x + w, y);
            c.rotate(Math.PI / 2);
            c.drawImage(img, 0, 0, h, w);
            c.restore();
          } else c.drawImage(img, x, y, w, h);
          texture.needsUpdate = true;
        }
        resolve();
      };
      img.onerror = () => resolve();
      img.src = typeof n === 'string' ? n : PAGE_URL(n);
    });
  return {
    texture,
    slot: {
      cover: px(...RECT.cover),
      whiteboard: px(...RECT.whiteboard),
      poster: px(...RECT.poster),
      notice: px(...RECT.notice),
      tag: px(...RECT.tag),
      edge: px(...RECT.edge),
      spread: SPREAD_AT.map(([x, y]) => px(x, y, x + 256, y + 128)),
      prints: PRINTS.map(p => {
        const [x0, y0, x1, y1] = RECT[p.rect];
        return px(x0, y0, x1, y1);
      }),
      rug: px(...RECT.rug),
      sheet: px(...RECT.sheet),
    },
    loadPages() {
      if (loading) return;
      loading = true;
      // The cover first (it's on the coffee table), then the spreads, one at a time
      void (async () => {
        await draw(1, ...(RECT.cover.slice(0, 2) as [number, number]), 256, 256);
        {
          const [x0, y0, x1, y1] = RECT.sheet;
          await draw(SHEET_URL, x0, y0, x1 - x0, y1 - y0);
        }
        for (let i = 0; i < SPREAD_AT.length && !disposed; i++) {
          const [x, y] = SPREAD_AT[i]!;
          const n = OPEN_PAGES[i]!;
          await draw(n, x + 2, y + 2, 125, 124);
          await draw(n + 1, x + 129, y + 2, 125, 124);
        }
        // The posters: two pages side by side (top to bottom when upright)
        for (const pr of PRINTS) {
          if (disposed) break;
          const [x0, y0, x1, y1] = RECT[pr.rect];
          const w = x1 - x0;
          const h = y1 - y0;
          if (pr.upright) {
            await draw(pr.pages[0], x0, y0, w, h / 2, true);
            await draw(pr.pages[1], x0, y0 + h / 2, w, h / 2, true);
          } else {
            await draw(pr.pages[0], x0, y0, w / 2, h);
            await draw(pr.pages[1], x0 + w / 2, y0, w / 2, h);
          }
        }
      })();
    },
    dispose() {
      disposed = true;
      texture.dispose();
    },
  };
}

// ── Painters (procedural, no assets) ───────────────────────────────────

function paintCoverPlaceholder(c: CanvasRenderingContext2D) {
  c.fillStyle = '#fbfaf6';
  c.fillRect(0, 0, 256, 256);
  c.fillStyle = '#111';
  c.font = 'bold 30px Helvetica, Arial, sans-serif';
  c.textAlign = 'center';
  c.fillText('“MEME VALUE”', 128, 136);
  c.font = 'bold 12px Helvetica, Arial, sans-serif';
  c.fillText('LIL 67', 128, 230);
}

function paintSpreadPlaceholder(c: CanvasRenderingContext2D, x: number, y: number) {
  c.fillStyle = '#fbfaf6';
  c.fillRect(x, y, 256, 128);
  c.fillStyle = '#bdb7aa';
  for (let i = 0; i < 9; i++) {
    c.fillRect(x + 14, y + 16 + i * 11, 100 - (i % 3) * 14, 3);
    c.fillRect(x + 142, y + 16 + i * 11, 96 - (i % 4) * 10, 3);
  }
  c.fillStyle = '#d8d2c4';
  c.fillRect(x + 127, y, 2, 128);
}

/** The ice cream van, planned in marker: rough, crossed out, arrowed. */
function paintWhiteboard(
  c: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  const W = x1 - x0;
  const H = y1 - y0;
  c.save();
  c.translate(x0, y0);
  c.fillStyle = '#f4f6f6';
  c.fillRect(0, 0, W, H);
  // Ghosts of old wiping
  c.strokeStyle = 'rgba(120,130,140,0.18)';
  c.lineWidth = 18;
  for (let i = 0; i < 5; i++) {
    c.beginPath();
    c.moveTo(30 + i * 110, 40 + (i % 2) * 200);
    c.bezierCurveTo(120 + i * 90, 10, 60 + i * 100, 300, 160 + i * 95, 360);
    c.stroke();
  }
  // Frame
  c.strokeStyle = '#9aa3aa';
  c.lineWidth = 10;
  c.strokeRect(5, 5, W - 10, H - 10);
  const pen = (col: string, w: number) => {
    c.strokeStyle = col;
    c.fillStyle = col;
    c.lineWidth = w;
    c.lineCap = 'round';
    c.lineJoin = 'round';
  };
  const wob = (pts: [number, number][]) => {
    c.beginPath();
    pts.forEach(([x, y], i) =>
      i === 0 ? c.moveTo(x, y) : c.lineTo(x + Math.sin(i * 7.3) * 1.6, y + Math.cos(i * 5.1) * 1.6),
    );
    c.stroke();
  };
  // The van: box body, cab, serving hatch, the cone on the roof, wheels
  pen('#1d3fa8', 5);
  wob([
    [60, 250],
    [60, 140],
    [300, 140],
    [300, 250],
    [60, 250],
  ]);
  wob([
    [300, 175],
    [365, 175],
    [392, 215],
    [392, 250],
    [300, 250],
  ]);
  wob([
    [318, 182],
    [356, 182],
    [376, 212],
    [318, 212],
    [318, 182],
  ]);
  wob([
    [100, 160],
    [230, 160],
    [230, 215],
    [100, 215],
    [100, 160],
  ]);
  wob([
    [100, 160],
    [120, 148],
    [210, 148],
    [230, 160],
  ]);
  c.beginPath();
  c.arc(115, 258, 22, 0, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.arc(330, 258, 22, 0, Math.PI * 2);
  c.stroke();
  // Cone + scoop on the roof
  wob([
    [160, 140],
    [180, 70],
    [200, 140],
  ]);
  c.beginPath();
  c.arc(180, 62, 20, Math.PI, 0);
  c.stroke();
  // Noggles on the hatch
  pen('#e8332a', 6);
  c.strokeRect(130, 176, 26, 20);
  c.strokeRect(172, 176, 26, 20);
  wob([
    [156, 186],
    [172, 186],
  ]);
  wob([
    [130, 186],
    [118, 186],
    [118, 196],
  ]);
  // Notes
  pen('#1a1a1a', 3);
  c.font = 'bold 30px "Comic Sans MS", "Marker Felt", cursive';
  c.fillText('NOUN VAN v2', 40, 50);
  c.font = '22px "Comic Sans MS", "Marker Felt", cursive';
  c.fillText('route: plaza → DOWNHILL → ???', 40, 320);
  c.fillText('jingle louder', 420, 120);
  c.fillText('free cones for', 420, 210);
  c.fillText('nounders?', 430, 236);
  pen('#e8332a', 4);
  wob([
    [410, 96],
    [372, 70],
    [205, 64],
  ]);
  wob([
    [415, 200],
    [300, 196],
  ]);
  c.font = 'bold 26px "Comic Sans MS", "Marker Felt", cursive';
  c.fillText('PROFIT??', 420, 300);
  wob([
    [416, 306],
    [560, 304],
  ]);
  // Crossed out
  pen('#1a1a1a', 3);
  c.font = '22px "Comic Sans MS", "Marker Felt", cursive';
  c.fillText('sprinkles budget', 40, 370);
  pen('#e8332a', 4);
  wob([
    [36, 362],
    [214, 362],
  ]);
  pen('#2a8a4a', 4);
  c.fillText('ASK TREASURY', 236, 372);
  c.restore();
}

/** A sunset: banded sun sinking into the sea, big letters. */
function paintPoster(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const W = x1 - x0;
  const H = y1 - y0;
  c.save();
  c.translate(x0, y0);
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2b1b4f');
  g.addColorStop(0.35, '#c0396b');
  g.addColorStop(0.62, '#f3853a');
  g.addColorStop(0.63, '#1b2a4a');
  g.addColorStop(1, '#0d1626');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  const sy = H * 0.62;
  c.save();
  c.beginPath();
  c.rect(0, 0, W, sy);
  c.clip();
  const sun = c.createLinearGradient(0, sy - 90, 0, sy);
  sun.addColorStop(0, '#ffe36e');
  sun.addColorStop(1, '#ff6a3d');
  c.fillStyle = sun;
  c.beginPath();
  c.arc(W / 2, sy, 86, Math.PI, 0);
  c.fill();
  c.fillStyle = '#c0396b';
  for (let i = 0; i < 6; i++) c.fillRect(0, sy - 12 - i * 13, W, 3 + i * 0.6);
  c.restore();
  // Reflections on the water
  c.fillStyle = '#ff9a4a';
  for (let i = 0; i < 9; i++) {
    const w = 120 - i * 11;
    c.fillRect(W / 2 - w / 2, sy + 10 + i * 13, w, 4);
  }
  c.fillStyle = '#fff3d6';
  c.font = 'bold 44px Helvetica, Arial, sans-serif';
  c.textAlign = 'center';
  c.fillText('SUNSET', W / 2, 62);
  c.font = 'bold 14px Helvetica, Arial, sans-serif';
  c.fillText('NOUN CITY · ALL DAY', W / 2, 86);
  // A torn corner and a tape strip
  c.fillStyle = '#e9e4d8';
  c.beginPath();
  c.moveTo(W, H);
  c.lineTo(W - 46, H);
  c.lineTo(W, H - 58);
  c.fill();
  c.fillStyle = 'rgba(240,232,200,0.85)';
  c.fillRect(W / 2 - 30, 0, 60, 16);
  c.restore();
}

function paintNotice(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const W = x1 - x0;
  const H = y1 - y0;
  c.save();
  c.translate(x0, y0);
  c.fillStyle = '#f2ead2';
  c.fillRect(0, 0, W, H);
  c.fillStyle = '#c3221c';
  c.fillRect(0, 0, W, 64);
  c.fillStyle = '#fff';
  c.textAlign = 'center';
  c.font = 'bold 30px Helvetica, Arial, sans-serif';
  c.fillText('CONDEMNED', W / 2, 44);
  c.fillStyle = '#1a1a1a';
  c.font = 'bold 17px Helvetica, Arial, sans-serif';
  const lines = [
    'UNFIT FOR',
    'HABITATION',
    '',
    'FORCED CLOSURE',
    'BY ORDER OF',
    'NOUN CITY',
    '',
    'DO NOT ENTER',
  ];
  lines.forEach((l, i) => c.fillText(l, W / 2, 96 + i * 26));
  c.font = '11px Helvetica, Arial, sans-serif';
  c.fillText('UNIT PH-1 · NOUNS CAMP', W / 2, H - 18);
  c.restore();
}

/**
 * Nouns Camp's own closure notice (nouns.camp, 30 September 2026), pinned
 * up as a print: the pixel tent, the line, the two links.
 */
function paintTag(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const W = x1 - x0;
  const H = y1 - y0;
  c.save();
  c.translate(x0, y0);
  c.fillStyle = '#faf8f4';
  c.fillRect(0, 0, W, H);
  // The tent: a stepped pixel ridge in green, orange and yellow bands
  const px = 7;
  const ox = 34;
  const oy = 46;
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const left = 3 - Math.floor(r / 2);
    const right = 6 + r;
    for (let x = left; x <= right; x++) {
      const k = x - left;
      c.fillStyle = k < 2 ? '#2f6b3a' : k < 4 ? '#ee7a2c' : '#f6c64a';
      c.fillRect(ox + x * px, oy + r * px, px, px);
    }
  }
  c.fillStyle = '#5e5b57';
  c.textAlign = 'left';
  c.font = '19px Helvetica, Arial, sans-serif';
  c.fillText('As of September 30, 2026, Nouns Camp is no longer active.', 34, 128);
  c.fillText('Thank you for being part of it.', 34, 160);
  c.fillStyle = '#2a2826';
  c.font = '18px Helvetica, Arial, sans-serif';
  const link = (t: string, x: number) => {
    c.fillText(t, x, 206);
    c.fillRect(x, 211, c.measureText(t).width, 2);
  };
  link('Visit nouns.wtf', 34);
  link('Read proposal 996', 190);
  void H;
  c.restore();
}

function paintEdge(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  c.fillStyle = '#efe9d9';
  c.fillRect(x0, y0, x1 - x0, y1 - y0);
  c.fillStyle = '#d6cfbd';
  for (let y = y0 + 2; y < y1; y += 4) c.fillRect(x0, y, x1 - x0, 1);
}
