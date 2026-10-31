// ── CAMP's art: one canvas atlas for everything printed or painted ───────
//
// The MEME VALUE cover and the spreads lying open (the book's own page
// images, loaded after the room is up), the whiteboard's ice cream van
// plans, the sunset poster, the closure notice and the NOUNS CAMP tag.
// One texture, one material ('art' in the room's kit). 1024 px, 512 on a
// weak phone's texture diet.

import * as THREE from 'three';

import { textureDiet } from '../../render/textureDiet';

import { OPEN_PAGES } from './layout';

/** Atlas slots in 0–1 (u0, v0, u1, v1), v up (three.js), from 1024-px rects. */
type Slot = [number, number, number, number];
const px = (x0: number, y0: number, x1: number, y1: number): Slot => [
  x0 / 1024,
  1 - y1 / 1024,
  x1 / 1024,
  1 - y0 / 1024,
];
const RECT = {
  cover: [0, 0, 256, 256],
  whiteboard: [0, 384, 608, 784],
  poster: [768, 0, 1024, 370],
  notice: [768, 384, 1024, 725],
  tag: [0, 800, 608, 1024],
  edge: [640, 800, 704, 864],
} as const;
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
  };
  /** Fetch the cover and pages and paint them in (once; safe to call again). */
  loadPages(): void;
  dispose(): void;
}

const PAGE_URL = (n: number) => `/books/meme-value/sm/p${String(n).padStart(3, '0')}.webp`;

export function buildCampArt(): CampArt {
  const S = textureDiet.on ? 512 : 1024;
  const k = S / 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const c = canvas.getContext('2d')!;
  c.scale(k, k);
  c.fillStyle = '#e9e4d8';
  c.fillRect(0, 0, 1024, 1024);
  paintCoverPlaceholder(c);
  SPREAD_AT.forEach(([x, y]) => paintSpreadPlaceholder(c, x, y));
  paintWhiteboard(c, ...RECT.whiteboard);
  paintPoster(c, ...RECT.poster);
  paintNotice(c, ...RECT.notice);
  paintTag(c, ...RECT.tag);
  paintEdge(c, ...RECT.edge);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  let loading = false;
  let disposed = false;
  const draw = (n: number, x: number, y: number, w: number, h: number) =>
    new Promise<void>(resolve => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (!disposed) {
          c.drawImage(img, x, y, w, h);
          texture.needsUpdate = true;
        }
        resolve();
      };
      img.onerror = () => resolve();
      img.src = PAGE_URL(n);
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
    },
    loadPages() {
      if (loading) return;
      loading = true;
      // The cover first (it's on the coffee table), then the spreads, one at a time
      void (async () => {
        await draw(1, ...(RECT.cover.slice(0, 2) as [number, number]), 256, 256);
        for (let i = 0; i < SPREAD_AT.length && !disposed; i++) {
          const [x, y] = SPREAD_AT[i]!;
          const n = OPEN_PAGES[i]!;
          await draw(n, x + 2, y + 2, 125, 124);
          await draw(n + 1, x + 129, y + 2, 125, 124);
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

function paintTag(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const W = x1 - x0;
  const H = y1 - y0;
  c.save();
  c.translate(x0, y0);
  // The wall colour behind (it's painted on the wall)
  c.fillStyle = '#d9d1c0';
  c.fillRect(0, 0, W, H);
  c.font = 'bold italic 84px Impact, "Arial Black", sans-serif';
  c.textAlign = 'center';
  c.lineJoin = 'round';
  c.lineWidth = 14;
  c.strokeStyle = '#1a1a1a';
  c.strokeText('NOUNS CAMP', W / 2, 140);
  c.fillStyle = '#f3322c';
  c.fillText('NOUNS CAMP', W / 2, 140);
  // Drips
  c.fillStyle = '#f3322c';
  for (let i = 0; i < 9; i++) c.fillRect(50 + i * 60 + (i % 3) * 7, 150, 5, 18 + ((i * 37) % 46));
  // Noggles under it
  c.fillStyle = '#1a1a1a';
  c.fillRect(W / 2 - 70, 178, 52, 34);
  c.fillRect(W / 2 + 6, 178, 52, 34);
  c.fillRect(W / 2 - 18, 190, 24, 8);
  c.fillStyle = '#fff';
  c.fillRect(W / 2 - 62, 186, 18, 18);
  c.fillRect(W / 2 + 14, 186, 18, 18);
  c.restore();
}

function paintEdge(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  c.fillStyle = '#efe9d9';
  c.fillRect(x0, y0, x1 - x0, y1 - y0);
  c.fillStyle = '#d6cfbd';
  for (let y = y0 + 2; y < y1; y += 4) c.fillRect(x0, y, x1 - x0, 1);
}
