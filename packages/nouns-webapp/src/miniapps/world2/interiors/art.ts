// ── A room's canvas atlas: Noun posters, framed art, menus, neon, the view ─
//
// One canvas per interior (built on enter, freed on leave). Posters and
// gallery pieces are real Noun art (the on-chain pixel parts drawn from a
// seed); menu boards list the place's menu; neon spells its kind; windows
// show the street outside at the current time of day, in the style of the
// area you came in from.

import type { Decor, Layout } from './layout';

import { getNounData, ImageData } from '@noundry/nouns-assets';
import { decodeParts } from '@nouns/voxel-engine';
import * as THREE from 'three';

import { discounted, menuOf } from './dialogue';
import { askText, label, labelColor, type Exhibit } from './museum';
import { TRAITS } from './residents';
import { hash32, mulberry32, pick, type Rng } from './rng';

export type TimeOfDay = 'afternoon' | 'golden' | 'blue' | 'night';

const PX_PER_M = 110;

export interface ArtAtlas {
  texture: THREE.CanvasTexture;
  /** Decor index → uv rect (u0, v0, u1, v1). */
  slots: Map<number, [number, number, number, number]>;
  /** Extra slots by name (screens; the museum's plinth labels and rug). */
  named: Map<string, [number, number, number, number]>;
  /**
   * The Prop Museum: repaint its placards (wall decor, in order) and plinth
   * labels with these props (the API answered after the room was built).
   */
  paintExhibits?(walls: readonly Exhibit[], plinths: readonly Exhibit[]): void;
}

/** The Prop Museum's exhibits: the latest props on the walls, the famous ones on the plinths. */
export interface MuseumArt {
  walls: readonly Exhibit[];
  plinths: readonly Exhibit[];
}

/** Draw a whole Noun (background, body, accessory, head, glasses) into a square. */
export function drawNoun(
  g: CanvasRenderingContext2D,
  seed: readonly number[],
  x: number,
  y: number,
  size: number,
  background = true,
) {
  const s = {
    background: seed[0]!,
    body: seed[1]!,
    accessory: seed[2]!,
    head: seed[3]!,
    glasses: seed[4]!,
  };
  const { parts } = getNounData(s);
  const px = decodeParts(parts as { data: string }[], ImageData.palette, 1);
  if (background) {
    g.fillStyle = `#${ImageData.bgcolors[s.background] ?? 'd5d7e1'}`;
    g.fillRect(x, y, size, size);
  }
  const k = size / 32;
  for (const p of px) {
    g.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
    // VoxelPixel y runs bottom-up
    g.fillRect(Math.floor(x + p.x * k), Math.floor(y + (31 - p.y) * k), Math.ceil(k), Math.ceil(k));
  }
}

function randomSeed(rnd: Rng): number[] {
  return TRAITS.map(c => Math.floor(rnd() * c));
}

const POSTER_TITLES = [
  'NOUNS',
  '⌐◨-◨',
  'ONE NOUN',
  'EVERY DAY',
  'FOREVER',
  'CC0',
  'PROP 1000',
  'NOUN WORLD',
];
const NEON: Record<string, string[]> = {
  bar: ['BAR', 'OPEN', '⌐◨-◨', 'COCKTAILS'],
  arcade: ['PLAY', 'HI-SCORE', 'GAME ON', '⌐◨-◨'],
  studio: ['ON AIR', 'BEATS', 'NOUN FM', '⌐◨-◨'],
  cafe: ['COFFEE', 'OPEN'],
  shop: ['OPEN'],
  barber: ['CUTS'],
  gym: ['PUSH'],
  laundromat: ['WASH'],
  gallery: ['ART'],
  home: ['HOME'],
};
const NEON_COLS = ['#ff3d8b', '#2af0ff', '#ffe14d', '#9dff4a', '#b05cff', '#ff7a1a'];

interface Packer {
  x: number;
  y: number;
  row: number;
  /** Atlas size (px). */
  size: number;
}

function alloc(p: Packer, w: number, h: number): [number, number] | null {
  const SIZE = p.size;
  const W = Math.min(SIZE - 8, Math.round(w));
  const H = Math.min(SIZE - 8, Math.round(h));
  if (p.x + W + 4 > SIZE) {
    p.x = 0;
    p.y += p.row + 4;
    p.row = 0;
  }
  if (p.y + H + 4 > SIZE) return null;
  const at: [number, number] = [p.x + 2, p.y + 2];
  p.x += W + 4;
  p.row = Math.max(p.row, H);
  return at;
}

function uvOf(
  x: number,
  y: number,
  w: number,
  h: number,
  SIZE: number,
): [number, number, number, number] {
  return [x / SIZE, 1 - (y + h) / SIZE, (x + w) / SIZE, 1 - y / SIZE];
}

/** Build the atlas for a layout (`area` styles the view out of the windows). */
export function buildArtAtlas(
  l: Layout,
  opts: {
    area: string;
    time: TimeOfDay;
    tier: Parameters<typeof discounted>[1];
    museum?: MuseumArt;
  },
): ArtAtlas {
  const museum = l.theme === 'prop-museum' ? opts.museum : undefined;
  const SIZE = l.theme === 'prop-museum' ? 2048 : 1024;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#777';
  g.fillRect(0, 0, SIZE, SIZE);
  const slots = new Map<number, [number, number, number, number]>();
  const named = new Map<string, [number, number, number, number]>();
  const pack: Packer = { x: 0, y: 0, row: 0, size: SIZE };
  const placards: { at: [number, number]; w: number; h: number }[] = [];
  // Windows first (biggest), then the rest
  const order = l.decor
    .map((d, i) => [d, i] as const)
    .sort((a, b) => b[0].w * b[0].h - a[0].w * a[0].h);
  for (const [d, i] of order) {
    if (d.type === 'upper_cabinets' || d.type === 'wall_shelf') continue;
    const scale = d.type === 'window' ? 70 : d.type === 'placard' ? PLACARD_PX_PER_M : PX_PER_M;
    const w = Math.max(24, d.w * scale);
    const h = Math.max(24, d.h * scale);
    const at = alloc(pack, w, h);
    if (at === null) continue;
    const rnd = mulberry32(d.seed);
    g.save();
    g.beginPath();
    g.rect(at[0], at[1], Math.round(w), Math.round(h));
    g.clip();
    if (d.type === 'placard') placards[i] = { at, w: Math.round(w), h: Math.round(h) };
    else paintDecor(g, d, at[0], at[1], Math.round(w), Math.round(h), rnd, l, opts);
    g.restore();
    slots.set(i, uvOf(at[0], at[1], Math.round(w), Math.round(h), SIZE));
  }
  // Screens (TVs, arcade cabinets): a few looping-looking stills
  for (let k = 0; k < 3; k++) {
    const at = alloc(pack, 96, 64);
    if (at === null) break;
    const rnd = mulberry32(hash32(`${l.id}:screen:${k}`));
    paintScreen(g, at[0], at[1], 96, 64, rnd, l.kind);
    named.set(`screen${k}`, uvOf(at[0], at[1], 96, 64, SIZE));
  }
  // The Prop Museum: plinth labels and the rug
  const labels: [number, number][] = [];
  if (l.theme === 'prop-museum') {
    const nPlinths = l.items.filter(it => it.type === 'plinth').length;
    for (let k = 0; k < nPlinths; k++) {
      const at = alloc(pack, LABEL_W, LABEL_H);
      if (at === null) break;
      labels.push(at);
      named.set(`plinth${k}`, uvOf(at[0], at[1], LABEL_W, LABEL_H, SIZE));
    }
    const at = alloc(pack, RUG_W, RUG_H);
    if (at !== null) {
      paintEsportsRug(g, at[0], at[1], RUG_W, RUG_H);
      named.set('esports', uvOf(at[0], at[1], RUG_W, RUG_H, SIZE));
    }
  }
  const paintExhibits = (walls: readonly Exhibit[], plinths: readonly Exhibit[]) => {
    let k = 0;
    placards.forEach(pl => {
      const e = walls.length > 0 ? walls[k++ % walls.length] : undefined;
      paintPlacard(g, pl.at[0], pl.at[1], pl.w, pl.h, e);
    });
    labels.forEach((at, i) =>
      paintPlinthLabel(
        g,
        at[0],
        at[1],
        LABEL_W,
        LABEL_H,
        plinths.length > 0 ? plinths[i % plinths.length] : undefined,
      ),
    );
  };
  if (l.theme === 'prop-museum') paintExhibits(museum?.walls ?? [], museum?.plinths ?? []);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  if (l.theme !== 'prop-museum') return { texture, slots, named };
  return {
    texture,
    slots,
    named,
    paintExhibits: (walls: readonly Exhibit[], plinths: readonly Exhibit[]) => {
      paintExhibits(walls, plinths);
      texture.needsUpdate = true;
    },
  };
}

// ── The Prop Museum ──────────────────────────────────────────────────────

/** Placards are read up close: drawn finer than other wall art. */
const PLACARD_PX_PER_M = 260;
const LABEL_W = 220;
const LABEL_H = 140;
const RUG_W = 600;
const RUG_H = 400;
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/** Words → lines that fit `maxW` px in the current font (at most `maxLines`, the last cut with …). */
export function wrapText(
  measure: (s: string) => number,
  text: string,
  maxW: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  let used = 0;
  for (const w of words) {
    const next = cur === '' ? w : `${cur} ${w}`;
    if (cur === '' || measure(next) <= maxW) {
      cur = next;
      used++;
      continue;
    }
    lines.push(cur);
    if (lines.length === maxLines) {
      cur = '';
      break;
    }
    cur = w;
    used++;
  }
  if (cur !== '' && lines.length < maxLines) lines.push(cur);
  if (used < words.length && lines.length > 0) {
    let last = lines[lines.length - 1]!;
    while (last.length > 1 && measure(`${last}…`) > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  return wrapText(s => g.measureText(s).width, text, maxW, maxLines);
}

/** A museum placard: PROP n, its outcome, its title, the votes, what it asked for. */
function paintPlacard(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  e: Exhibit | undefined,
) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  // Black frame, off-white card
  g.fillStyle = '#111';
  g.fillRect(x, y, w, h);
  const m = Math.round(w * 0.05);
  g.fillStyle = '#f4f1ea';
  g.fillRect(x + m, y + m, w - 2 * m, h - 2 * m);
  const px = x + m * 2;
  const iw = w - 4 * m;
  let py = y + m * 2;
  g.textBaseline = 'top';
  g.textAlign = 'left';
  if (e === undefined) {
    g.fillStyle = '#999';
    g.font = `700 ${Math.round(w * 0.08)}px ${SANS}`;
    g.fillText('ON LOAN', px, py);
    g.restore();
    return;
  }
  g.fillStyle = '#111';
  g.font = `900 ${Math.round(w * 0.16)}px ${SANS}`;
  g.fillText(`PROP ${e.id}`, px, py);
  py += w * 0.2;
  // Outcome pill
  const lab = label(e);
  g.font = `800 ${Math.round(w * 0.07)}px ${SANS}`;
  const tw = g.measureText(lab).width + w * 0.06;
  g.fillStyle = labelColor(lab);
  g.fillRect(px, py, tw, w * 0.1);
  g.fillStyle = '#fff';
  g.fillText(lab, px + w * 0.03, py + w * 0.018);
  py += w * 0.15;
  // Title
  g.fillStyle = '#111';
  const fs = Math.round(w * 0.075);
  g.font = `700 ${fs}px ${SANS}`;
  for (const line of wrap(g, e.title, iw, 6)) {
    g.fillText(line, px, py);
    py += fs * 1.2;
  }
  // Votes and money, along the bottom
  g.font = `600 ${Math.round(w * 0.055)}px ${SANS}`;
  g.fillStyle = '#444';
  const by = y + h - m * 2 - w * 0.2;
  g.fillText(`FOR ${e.forVotes} · AGAINST ${e.againstVotes}`, px, by);
  g.fillStyle = '#111';
  wrap(g, askText(e), iw, 2).forEach((line, i) => g.fillText(line, px, by + w * 0.07 * (i + 1)));
  g.restore();
}

/** The small card on a plinth's front. */
function paintPlinthLabel(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  e: Exhibit | undefined,
) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#f7f5ef';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#111';
  g.fillRect(x, y, w, 6);
  g.textBaseline = 'top';
  g.textAlign = 'left';
  if (e !== undefined) {
    g.font = `900 ${Math.round(h * 0.26)}px ${SANS}`;
    g.fillText(`PROP ${e.id}`, x + 10, y + 12);
    const lab = label(e);
    g.font = `800 ${Math.round(h * 0.11)}px ${SANS}`;
    g.fillStyle = labelColor(lab);
    g.fillText(lab, x + w - 10 - g.measureText(lab).width, y + 16);
    g.fillStyle = '#222';
    g.font = `700 ${Math.round(h * 0.12)}px ${SANS}`;
    wrap(g, e.title, w - 20, 3).forEach((line, i) =>
      g.fillText(line, x + 10, y + h * 0.5 + i * h * 0.15),
    );
  }
  g.restore();
}

/**
 * The ESPORTS rug, Off-White style: off-white pile, black condensed
 * capitals in quotation marks, a small label in the corner.
 */
export function paintEsportsRug(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#ece6d8';
  g.fillRect(x, y, w, h);
  // A little pile texture
  const rnd = mulberry32(0xe5);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.06)';
    g.fillRect(x + rnd() * w, y + rnd() * h, 2, 2);
  }
  // “ESPORTS”: squeezed heavy caps, centred
  g.fillStyle = '#111';
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  const fs = Math.round(h * 0.3);
  g.font = `900 ${fs}px ${SANS}`;
  const text = '“ESPORTS”';
  const squeeze = 0.72;
  const tw = g.measureText(text).width * squeeze;
  const k = Math.min(1, (w * 0.86) / tw);
  g.save();
  g.translate(x + w / 2, y + h * 0.52);
  g.scale(squeeze * k, k);
  g.fillText(text, 0, 0);
  g.restore();
  // Corner labels
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.font = `700 ${Math.round(h * 0.045)}px ${SANS}`;
  g.fillText('"RUG"', x + w * 0.04, y + h * 0.06);
  g.fillText('c/o NOUNS DAO', x + w * 0.04, y + h * 0.06 + h * 0.055);
  g.textAlign = 'right';
  g.textBaseline = 'bottom';
  g.fillText('PROP 466 · NOUNS ESPORTS', x + w * 0.96, y + h * 0.94);
  g.restore();
}

function paintDecor(
  g: CanvasRenderingContext2D,
  d: Decor,
  x: number,
  y: number,
  w: number,
  h: number,
  rnd: Rng,
  l: Layout,
  opts: { area: string; time: TimeOfDay; tier: Parameters<typeof discounted>[1] },
) {
  switch (d.type) {
    case 'poster': {
      const bg = pick(rnd, [
        '#f3322c',
        '#ffd400',
        '#2c6fb0',
        '#111111',
        '#f4f1ea',
        '#2fbf71',
        '#ff7ab6',
      ]);
      g.fillStyle = bg;
      g.fillRect(x, y, w, h);
      const s = Math.min(w * 0.82, h * 0.62);
      drawNoun(g, randomSeed(rnd), x + (w - s) / 2, y + h * 0.08, s);
      g.fillStyle =
        bg === '#111111' || bg === '#2c6fb0' || bg === '#f3322c' ? '#ffffff' : '#111111';
      g.font = `900 ${Math.round(h * 0.12)}px "Arial Black", Impact, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(pick(rnd, POSTER_TITLES), x + w / 2, y + h * 0.84, w * 0.9);
      break;
    }
    case 'frame': {
      // Gallery-style: a mat, then the art
      g.fillStyle = pick(rnd, ['#2b2118', '#c9a14a', '#111111', '#f4f1ea']);
      g.fillRect(x, y, w, h);
      const m = Math.round(Math.min(w, h) * 0.08);
      g.fillStyle = '#f7f5ef';
      g.fillRect(x + m, y + m, w - 2 * m, h - 2 * m);
      const ix = x + m * 2;
      const iy = y + m * 2;
      const iw = w - 4 * m;
      const ih = h - 4 * m;
      if (rnd() < 0.7) {
        const s = Math.min(iw, ih);
        g.fillStyle = `#${ImageData.bgcolors[Math.floor(rnd() * 2)]}`;
        g.fillRect(ix, iy, iw, ih);
        drawNoun(g, randomSeed(rnd), ix + (iw - s) / 2, iy + (ih - s) / 2, s, false);
      } else {
        // Square abstraction: noggle-red blocks
        const cols = ['#f3322c', '#111111', '#ffd400', '#2c6fb0', '#f4f1ea'];
        g.fillStyle = pick(rnd, cols);
        g.fillRect(ix, iy, iw, ih);
        for (let k = 0; k < 7; k++) {
          g.fillStyle = pick(rnd, cols);
          const bw = iw * (0.15 + rnd() * 0.45);
          const bh = ih * (0.15 + rnd() * 0.45);
          g.fillRect(ix + rnd() * (iw - bw), iy + rnd() * (ih - bh), bw, bh);
        }
      }
      break;
    }
    case 'menu': {
      g.fillStyle = '#1f2a24';
      g.fillRect(x, y, w, h);
      g.strokeStyle = '#c9a14a';
      g.lineWidth = 4;
      g.strokeRect(x + 3, y + 3, w - 6, h - 6);
      const items = menuOf(l.kind);
      g.fillStyle = '#f4f1ea';
      g.textBaseline = 'middle';
      const lines =
        items.length > 0
          ? items.map(m => [`${m.icon} ${m.name}`, `${discounted(m.price, opts.tier)}`] as const)
          : ([
              ['🍦 ICE CREAM', '↑'],
              ['🧢 DRIP', '↑'],
              ['⌐◨-◨ NOGGLES', '↑'],
            ] as const);
      g.font = `bold ${Math.round(h * 0.16)}px "Arial Black", sans-serif`;
      g.textAlign = 'center';
      g.fillStyle = '#ffd400';
      g.fillText(l.kind === 'shop' ? 'TODAY' : 'MENU', x + w / 2, y + h * 0.16);
      const fs = Math.round(Math.min(h * 0.13, (h * 0.7) / Math.max(1, lines.length)));
      g.font = `bold ${fs}px system-ui, sans-serif`;
      lines.slice(0, 5).forEach(([a, b], i) => {
        const yy = y + h * 0.36 + i * fs * 1.25;
        g.fillStyle = '#f4f1ea';
        g.textAlign = 'left';
        g.fillText(a, x + w * 0.06, yy, w * 0.7);
        g.textAlign = 'right';
        g.fillStyle = '#ffd400';
        g.fillText(b, x + w * 0.94, yy);
      });
      break;
    }
    case 'neon': {
      g.fillStyle = '#0b0b12';
      g.fillRect(x, y, w, h);
      const col = pick(rnd, NEON_COLS);
      const text = pick(rnd, NEON[l.kind] ?? ['OPEN']);
      g.font = `900 ${Math.round(h * 0.62)}px "Arial Black", Impact, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = col;
      g.shadowBlur = h * 0.25;
      g.fillStyle = col;
      g.fillText(text, x + w / 2, y + h * 0.55, w * 0.92);
      g.shadowBlur = 0;
      g.fillStyle = '#ffffff';
      g.globalAlpha = 0.55;
      g.fillText(text, x + w / 2, y + h * 0.55, w * 0.92);
      g.globalAlpha = 1;
      break;
    }
    case 'mirror': {
      const gr = g.createLinearGradient(x, y, x + w, y + h);
      gr.addColorStop(0, '#dbe9f2');
      gr.addColorStop(0.5, '#a9c4d6');
      gr.addColorStop(1, '#e8f2f8');
      g.fillStyle = gr;
      g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = Math.max(2, w * 0.03);
      g.beginPath();
      g.moveTo(x + w * 0.2, y + h * 0.15);
      g.lineTo(x + w * 0.45, y + h * 0.05);
      g.moveTo(x + w * 0.2, y + h * 0.35);
      g.lineTo(x + w * 0.65, y + h * 0.12);
      g.stroke();
      break;
    }
    case 'clock': {
      g.fillStyle = '#2b2b2b';
      g.fillRect(x, y, w, h);
      g.fillStyle = '#f7f5ef';
      g.beginPath();
      g.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.44, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#111';
      g.lineWidth = Math.max(2, w * 0.05);
      const cx = x + w / 2;
      const cy = y + h / 2;
      const a = rnd() * Math.PI * 2;
      const b = rnd() * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.sin(a) * w * 0.22, cy - Math.cos(a) * h * 0.22);
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.sin(b) * w * 0.34, cy - Math.cos(b) * h * 0.34);
      g.stroke();
      break;
    }
    case 'window':
      paintView(g, x, y, w, h, rnd, opts.area, opts.time);
      break;
    default:
      break;
  }
}

const SKY: Record<TimeOfDay, [string, string, string]> = {
  afternoon: ['#5fa8e8', '#bfe0f7', '#f2f7fb'],
  golden: ['#f08a4b', '#f7c46c', '#fde3b0'],
  blue: ['#1d3b72', '#3f6aa8', '#7fa6d6'],
  night: ['#060a1a', '#10183a', '#1f2a52'],
};

/** The view out of a window: sky, then the area's skyline, lit at night. */
function paintView(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rnd: Rng,
  area: string,
  time: TimeOfDay,
) {
  const [top, mid, low] = SKY[time];
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, top);
  gr.addColorStop(0.6, mid);
  gr.addColorStop(1, low);
  g.fillStyle = gr;
  g.fillRect(x, y, w, h);
  const dark = time === 'night' || time === 'blue';
  if (time === 'night')
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(255,255,255,${0.4 + rnd() * 0.6})`;
      g.fillRect(x + rnd() * w, y + rnd() * h * 0.5, 2, 2);
    }
  const town = area.startsWith('town:') ? area.slice(5) : area;
  const ground = y + h * 0.82;
  const sil = dark ? '#121626' : '#6d7f95';
  const near = dark ? '#0b0e18' : '#4d5d70';
  if (town === 'beach') {
    g.fillStyle = dark ? '#0c2340' : '#2f8fc4';
    g.fillRect(x, y + h * 0.62, w, h * 0.38);
    g.fillStyle = dark ? '#1e2a3a' : '#f0d9a0';
    g.fillRect(x, y + h * 0.84, w, h * 0.16);
    for (let k = 0; k < 3; k++)
      palm(g, x + w * (0.15 + k * 0.35 + rnd() * 0.1), y + h * 0.86, h * 0.5, near);
    return;
  }
  if (town === 'cowboy') {
    g.fillStyle = dark ? '#3a2018' : '#c9764a';
    for (let k = 0; k < 3; k++) {
      const mx = x + rnd() * w;
      const mw = w * (0.25 + rnd() * 0.3);
      const mh = h * (0.15 + rnd() * 0.15);
      g.fillRect(mx - mw / 2, y + h * 0.7 - mh, mw, mh + h * 0.1);
    }
    g.fillStyle = dark ? '#2a1a10' : '#e0b070';
    g.fillRect(x, y + h * 0.78, w, h * 0.22);
    return;
  }
  if (town === 'shroom') {
    for (let k = 0; k < 4; k++) {
      const mx = x + rnd() * w;
      const r = h * (0.15 + rnd() * 0.15);
      g.fillStyle = near;
      g.fillRect(mx - r * 0.18, ground - r * 1.5, r * 0.36, r * 1.5);
      g.fillStyle = dark ? '#5a1a3a' : pick(rnd, ['#d8322b', '#9f59ff', '#e8742b']);
      g.beginPath();
      g.ellipse(mx, ground - r * 1.5, r, r * 0.55, 0, Math.PI, 0);
      g.fill();
    }
    g.fillStyle = dark ? '#132015' : '#5f9f4f';
    g.fillRect(x, ground, w, y + h - ground);
    return;
  }
  if (town === 'crater') {
    g.fillStyle = dark ? '#d8d8e8' : '#f4e6c8';
    g.beginPath();
    g.arc(x + w * 0.78, y + h * 0.25, h * 0.16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = dark ? '#2a2a33' : '#9a8f86';
    g.beginPath();
    g.moveTo(x, ground);
    for (let k = 0; k <= 8; k++) g.lineTo(x + (w * k) / 8, ground - h * (0.05 + rnd() * 0.18));
    g.lineTo(x + w, y + h);
    g.lineTo(x, y + h);
    g.fill();
    return;
  }
  // City-ish (plaza, Noun Jersey, Noggle City, Neon Nouns): rows of blocks
  for (const [col, base, tall] of [
    [sil, ground - h * 0.1, 0.55],
    [near, ground, 0.35],
  ] as const) {
    let bx = x - rnd() * 20;
    while (bx < x + w) {
      const bw = w * (0.1 + rnd() * 0.16);
      const bh = h * (0.12 + rnd() * tall);
      g.fillStyle = col;
      g.fillRect(bx, base - bh, bw, bh + h);
      // Windows
      for (let wy = base - bh + 5; wy < base - 6; wy += 9)
        for (let wx = bx + 4; wx < bx + bw - 6; wx += 8)
          if (rnd() < (dark ? 0.45 : 0.25)) {
            g.fillStyle = dark ? (town === 'neon' ? pick(rnd, NEON_COLS) : '#ffd98a') : '#9fb8d0';
            g.fillRect(wx, wy, 4, 5);
          }
      bx += bw + 2;
    }
  }
  g.fillStyle = dark ? '#1a1a1a' : '#8a8a8a';
  g.fillRect(x, ground, w, y + h - ground);
}

function palm(g: CanvasRenderingContext2D, x: number, y: number, h: number, col: string) {
  g.strokeStyle = col;
  g.lineWidth = Math.max(2, h * 0.05);
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x + h * 0.1, y - h * 0.5, x + h * 0.05, y - h);
  g.stroke();
  g.fillStyle = col;
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k - 2) * 0.6;
    g.beginPath();
    g.ellipse(
      x + h * 0.05 + Math.cos(a) * h * 0.18,
      y - h + Math.sin(a) * h * 0.1,
      h * 0.2,
      h * 0.05,
      a,
      0,
      Math.PI * 2,
    );
    g.fill();
  }
}

function paintScreen(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rnd: Rng,
  kind: string,
) {
  g.fillStyle = pick(rnd, ['#14325e', '#0f3d2e', '#3b1f6b', '#5e1430']);
  g.fillRect(x, y, w, h);
  if (kind === 'arcade') {
    for (let k = 0; k < 14; k++) {
      g.fillStyle = pick(rnd, NEON_COLS);
      g.fillRect(x + rnd() * w, y + rnd() * h, 6, 6);
    }
    g.fillStyle = '#ffe14d';
    g.font = 'bold 12px monospace';
    g.fillText('HI 99999', x + 6, y + 14);
  } else {
    const s = h * 0.8;
    drawNoun(g, randomSeed(rnd), x + (w - s) / 2, y + (h - s) / 2, s);
  }
}
