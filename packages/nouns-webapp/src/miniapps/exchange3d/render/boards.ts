// ── 3D Grand Exchange: ticker boards (canvas textures) ──────────────────
//
// Each pit hangs a four-sided board with its good's price and move; the
// central tower carries every good, and a ticker band scrolls round it.
// Boards redraw only when their numbers change or while a fill flashes.

import type { GoodId } from '../../world2/trade/contract';

import { ImageData } from '@noundry/nouns-assets';
import * as THREE from 'three';

import { GOOD_INFO } from '../../exchange/engine/goods';
import { PIT_GOODS } from '../sim/layout';
import { rasterNoun, SPRITE } from '../sim/looks';

export const GOOD_COLOR: Record<GoodId, string> = {
  ICECREAM: '#ff7ac8',
  FRIES: '#ffd400',
  FISH: '#3fa9ff',
  DRIP: '#a66bff',
  NOGGLES: '#ff3b2f',
  PIZZA: '#ff8a1f',
  WATER: '#2fe0d6',
};

export interface BoardQuote {
  good: GoodId;
  last: number | null;
  /** Fraction (0.05 = +5%). */
  chg: number | null;
  bid: number | null;
  ask: number | null;
  vol: number;
}

const FONT = '"Arial Black", "Helvetica Neue", Impact, sans-serif';
const UP = '#3ddc84';
const DOWN = '#ff5a4f';

/** The canonical noggles (glasses-square-red from the Noun art, never redrawn by hand). */
let noggles: Uint8ClampedArray | null = null;
export function drawNoggles(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  if (noggles === null) {
    const g = (ImageData.images.glasses as { filename: string; data: string }[]).find(
      i => i.filename === 'glasses-square-red',
    );
    noggles = rasterNoun(g !== undefined ? [g.data] : [], ImageData.palette);
  }
  // The frame sits at x 7..23, y 11..17 of the 32 px art
  const p = w / 16;
  for (let j = 0; j < 6; j++)
    for (let i = 0; i < 16; i++) {
      const o = ((11 + j) * SPRITE + 7 + i) * 4;
      if (noggles[o + 3]! < 128) continue;
      ctx.fillStyle = `rgb(${noggles[o]},${noggles[o + 1]},${noggles[o + 2]})`;
      ctx.fillRect(x + i * p, y + j * p, Math.ceil(p), Math.ceil(p));
    }
}

export function drawGoodIcon(
  ctx: CanvasRenderingContext2D,
  good: GoodId,
  cx: number,
  cy: number,
  size: number,
) {
  if (good === 'NOGGLES') {
    drawNoggles(ctx, cx - size * 0.62, cy - size * 0.2, size * 1.3);
    return;
  }
  ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(GOOD_INFO[good].icon, cx, cy + size * 0.06);
}

const pct = (c: number | null) =>
  c === null ? '—' : `${c >= 0 ? '▲' : '▼'} ${Math.abs(c * 100).toFixed(1)}%`;

function canvasTex(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { c, ctx: c.getContext('2d')!, tex };
}

/** One pit's board: good, last price, move, bid / ask, volume; flashes on a fill. */
export class PitBoard {
  readonly tex: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private c: HTMLCanvasElement;
  private key = '';
  private flash = 0;
  private flashUp = true;

  constructor(readonly good: GoodId) {
    const t = canvasTex(512, 288);
    this.tex = t.tex;
    this.ctx = t.ctx;
    this.c = t.c;
  }

  /** A fill printed here (up = at or above the previous last). */
  ping(up: boolean, big = false) {
    this.flash = big ? 1.6 : 1;
    this.flashUp = up;
  }

  update(q: BoardQuote | null, dt: number) {
    this.flash = Math.max(0, this.flash - dt * 1.4);
    const f = Math.round(Math.min(1, this.flash) * 8);
    const key = `${q?.last}|${q?.chg?.toFixed(3)}|${q?.bid}|${q?.ask}|${q?.vol}|${f}`;
    if (key === this.key) return;
    this.key = key;
    this.draw(q, f / 8);
    this.tex.needsUpdate = true;
  }

  private draw(q: BoardQuote | null, flash: number) {
    const { ctx } = this;
    const W = this.c.width;
    const H = this.c.height;
    const col = GOOD_COLOR[this.good];
    ctx.fillStyle = '#07090c';
    ctx.fillRect(0, 0, W, H);
    if (flash > 0) {
      ctx.fillStyle = this.flashUp ? UP : DOWN;
      ctx.globalAlpha = flash * 0.55;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    // Header band in the good's colour
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, W, 70);
    drawGoodIcon(ctx, this.good, 46, 36, 46);
    ctx.fillStyle = '#000';
    ctx.font = `900 48px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.good, 92, 38);
    // Last price
    const up = (q?.chg ?? 0) >= 0;
    ctx.fillStyle = '#fff';
    ctx.font = `900 118px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(q?.last != null ? String(q.last) : '—', 22, 150);
    ctx.font = `900 40px ${FONT}`;
    ctx.fillStyle = q?.chg == null ? '#8a9' : up ? UP : DOWN;
    ctx.textAlign = 'right';
    ctx.fillText(pct(q?.chg ?? null), W - 18, 120);
    ctx.font = `700 26px ${FONT}`;
    ctx.fillStyle = '#9fb3a6';
    ctx.fillText('COIN', W - 18, 170);
    // Bid / ask / volume
    ctx.textAlign = 'left';
    ctx.font = `800 34px ${FONT}`;
    ctx.fillStyle = UP;
    ctx.fillText(`B ${q?.bid ?? '—'}`, 22, 250);
    ctx.fillStyle = '#ffcf4a';
    ctx.fillText(`A ${q?.ask ?? '—'}`, 180, 250);
    ctx.fillStyle = '#9fb3a6';
    ctx.font = `700 24px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${q?.vol ?? 0}/h`, W - 18, 250);
    ctx.strokeStyle = col;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);
  }
}

export interface TowerInfo {
  quotes: BoardQuote[];
  /** 'LIVE', 'OFFLINE SIM', … */
  status: string;
  live: boolean;
  /** Fills in the last minute (real + simulated) and how many traders. */
  fillsPerMin: number;
  realPerMin: number;
  traders: number;
}

/** The central tower's face: every good. */
export class TowerBoard {
  readonly tex: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private c: HTMLCanvasElement;
  private key = '';
  private flashes = new Map<GoodId, { k: number; up: boolean }>();

  constructor() {
    const t = canvasTex(512, 1024);
    this.tex = t.tex;
    this.ctx = t.ctx;
    this.c = t.c;
  }

  ping(good: GoodId, up: boolean) {
    this.flashes.set(good, { k: 1, up });
  }

  update(info: TowerInfo, dt: number) {
    let fk = '';
    for (const [g, f] of this.flashes) {
      f.k = Math.max(0, f.k - dt * 1.4);
      if (f.k <= 0) this.flashes.delete(g);
      else fk += `${g}${Math.round(f.k * 6)}`;
    }
    const key = `${info.status}|${info.fillsPerMin}|${info.realPerMin}|${info.traders}|${info.quotes
      .map(q => `${q.last}${q.chg?.toFixed(3)}`)
      .join(',')}|${fk}`;
    if (key === this.key) return;
    this.key = key;
    this.draw(info);
    this.tex.needsUpdate = true;
  }

  private draw(info: TowerInfo) {
    const { ctx } = this;
    const W = this.c.width;
    const H = this.c.height;
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffcf4a';
    ctx.font = `900 50px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('GRAND', W / 2, 54);
    ctx.fillText('EXCHANGE', W / 2, 110);
    drawNoggles(ctx, W / 2 - 64, 140, 128);
    ctx.font = `800 28px ${FONT}`;
    ctx.fillStyle = info.live ? '#3ddc84' : '#ffcf4a';
    ctx.fillText(`● ${info.status}`, W / 2, 210);
    const top = 250;
    const rowH = 92;
    const by = new Map(info.quotes.map(q => [q.good, q]));
    PIT_GOODS.forEach((g, i) => {
      const q = by.get(g) ?? null;
      const y = top + i * rowH;
      const f = this.flashes.get(g);
      if (f !== undefined) {
        ctx.fillStyle = f.up ? UP : DOWN;
        ctx.globalAlpha = f.k * 0.5;
        ctx.fillRect(10, y, W - 20, rowH - 8);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = GOOD_COLOR[g];
      ctx.fillRect(10, y, 12, rowH - 8);
      drawGoodIcon(ctx, g, 62, y + rowH / 2 - 4, 40);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.font = `900 30px ${FONT}`;
      ctx.fillText(g, 100, y + 28);
      ctx.font = `800 24px ${FONT}`;
      const up = (q?.chg ?? 0) >= 0;
      ctx.fillStyle = q?.chg == null ? '#8a9' : up ? UP : DOWN;
      ctx.fillText(pct(q?.chg ?? null), 100, y + 62);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fff';
      ctx.font = `900 54px ${FONT}`;
      ctx.fillText(q?.last != null ? String(q.last) : '—', W - 20, y + rowH / 2 - 4);
    });
    ctx.textAlign = 'center';
    ctx.font = `700 22px ${FONT}`;
    ctx.fillStyle = '#9fb3a6';
    ctx.fillText(
      `${info.traders} TRADERS · ${info.fillsPerMin} FILLS/MIN (${info.realPerMin} LIVE)`,
      W / 2,
      H - 70,
    );
    ctx.fillText('IN-GAME COIN · NOT REAL MONEY', W / 2, H - 36);
  }
}

/** A long strip of every price, scrolled round the tower by texture offset. */
export class TickerBand {
  readonly tex: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private c: HTMLCanvasElement;
  private key = '';

  constructor() {
    const t = canvasTex(2048, 64);
    this.tex = t.tex;
    this.ctx = t.ctx;
    this.c = t.c;
    this.tex.wrapS = THREE.RepeatWrapping;
  }

  update(quotes: BoardQuote[], dt: number) {
    this.tex.offset.x = (this.tex.offset.x + dt * 0.02) % 1;
    const key = quotes.map(q => `${q.last}${q.chg?.toFixed(3)}`).join(',');
    if (key === this.key) return;
    this.key = key;
    const { ctx } = this;
    const W = this.c.width;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, 64);
    ctx.textBaseline = 'middle';
    ctx.font = `900 34px ${FONT}`;
    let x = 10;
    const by = new Map(quotes.map(q => [q.good, q]));
    for (const g of PIT_GOODS) {
      const q = by.get(g);
      ctx.fillStyle = GOOD_COLOR[g];
      ctx.textAlign = 'left';
      ctx.fillText(g, x, 34);
      x += ctx.measureText(g).width + 14;
      ctx.fillStyle = '#fff';
      const p = q?.last != null ? String(q.last) : '—';
      ctx.fillText(p, x, 34);
      x += ctx.measureText(p).width + 12;
      const up = (q?.chg ?? 0) >= 0;
      ctx.fillStyle = up ? UP : DOWN;
      const c = pct(q?.chg ?? null);
      ctx.fillText(c, x, 34);
      x += ctx.measureText(c).width + 48;
    }
    this.tex.needsUpdate = true;
  }
}
