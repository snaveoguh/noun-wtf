// ── NOUN STADIUM's canvases: ad boards, the big screen + sign, the net ───
//
// Small, and smaller on the texture diet: the ad strip is 512 × 64 (256 ×
// 32), the screen sheet 512 × 256 (256 × 128: its top half is the big
// screen, redrawn ≤ 2 Hz, the bottom half the NOUN STADIUM sign over the
// entrance), the net's mesh pattern a 16 × 16 data texture.

import type { TeamKit } from '../../contract';

import * as THREE from 'three';

import { textureDiet } from '../../../render/textureDiet';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** Readable text colour on a kit colour. */
function ink(c: number): string {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#14161c' : '#ffffff';
}

const ADS_TEXT = ['NOUN.WTF', '⌐◨-◨', 'NOUN FM', 'ICE CREAM VAN', 'GRAND EXCHANGE', 'NOGGLES ON'];

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function adsTexture(): { tex: THREE.CanvasTexture; cv: HTMLCanvasElement } {
  const s = textureDiet.on ? 0.5 : 1;
  const cv = canvas(512 * s, 64 * s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 2;
  return { tex, cv };
}

/** Repaint the ad strip in the kits' colours. */
export function paintAds(
  cv: HTMLCanvasElement,
  tex: THREE.Texture,
  kits: [TeamKit, TeamKit],
  k: number,
) {
  const ctx = cv.getContext('2d');
  if (ctx === null) return;
  const w = cv.width;
  const h = cv.height;
  const cells = 4;
  const cw = w / cells;
  for (let i = 0; i < cells; i++) {
    const kit = kits[i % 2]!;
    const bg = i % 3 === 2 ? 0x14161c : kit.shirt;
    ctx.fillStyle = hex(bg);
    ctx.fillRect(i * cw, 0, cw, h);
    ctx.fillStyle = i % 3 === 2 ? '#f3c25b' : ink(bg);
    ctx.font = `900 ${Math.round(h * 0.52)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ADS_TEXT[(i + k) % ADS_TEXT.length]!, i * cw + cw / 2, h * 0.54, cw * 0.92);
  }
  tex.needsUpdate = true;
}

export function screenTexture(): { tex: THREE.CanvasTexture; cv: HTMLCanvasElement } {
  const s = textureDiet.on ? 0.5 : 1;
  const cv = canvas(512 * s, 256 * s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  paintSign(cv);
  return { tex, cv };
}

/** Bottom half: the sign over the main entrance. */
function paintSign(cv: HTMLCanvasElement) {
  const ctx = cv.getContext('2d');
  if (ctx === null) return;
  const w = cv.width;
  const h = cv.height / 2;
  const y = cv.height / 2;
  ctx.fillStyle = '#14161c';
  ctx.fillRect(0, y, w, h);
  ctx.fillStyle = '#f3c25b';
  ctx.font = `900 ${Math.round(h * 0.5)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('NOUN STADIUM', w / 2, y + h * 0.42, w * 0.94);
  ctx.fillStyle = '#e0362f';
  ctx.font = `900 ${Math.round(h * 0.22)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText('⌐◨-◨  HOME OF NOUN FOOTBALL  ⌐◨-◨', w / 2, y + h * 0.82, w * 0.9);
}

export interface BoardInfo {
  home: string;
  away: string;
  score: [number, number];
  clock: string;
  text?: string;
}

/** Top half: the big screen (score, clock, team shorts in their colours). */
export function paintBoard(
  cv: HTMLCanvasElement,
  b: BoardInfo,
  kits: [TeamKit, TeamKit],
  live: boolean,
) {
  const ctx = cv.getContext('2d');
  if (ctx === null) return;
  const w = cv.width;
  const h = cv.height / 2;
  ctx.fillStyle = live ? '#0b0d12' : '#05060a';
  ctx.fillRect(0, 0, w, h);
  if (!live && b.text === undefined) {
    ctx.fillStyle = '#f3c25b';
    ctx.font = `900 ${Math.round(h * 0.22)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NOUN STADIUM', w / 2, h * 0.4);
    ctx.fillStyle = '#9aa3b5';
    ctx.font = `700 ${Math.round(h * 0.12)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText('⌐◨-◨  NO MATCH TODAY', w / 2, h * 0.68);
    return;
  }
  const u = h / 128;
  // team blocks
  const blk = (x: number, kit: TeamKit, name: string) => {
    ctx.fillStyle = hex(kit.shirt);
    ctx.fillRect(x, 18 * u, 150 * u, 56 * u);
    ctx.fillStyle = ink(kit.shirt);
    ctx.font = `900 ${Math.round(34 * u)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name.slice(0, 3).toUpperCase(), x + 75 * u, 47 * u);
  };
  blk(14 * u, kits[0], b.home);
  blk(w - 164 * u, kits[1], b.away);
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 ${Math.round(56 * u)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${b.score[0]}-${b.score[1]}`, w / 2, 48 * u);
  ctx.fillStyle = '#f3c25b';
  ctx.font = `800 ${Math.round(26 * u)}px ui-monospace, monospace`;
  ctx.fillText(b.clock, w / 2, 96 * u);
  if (b.text !== undefined && b.text !== '') {
    ctx.fillStyle = '#e0362f';
    ctx.fillRect(0, 108 * u, w, 20 * u);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(15 * u)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(b.text.toUpperCase(), w / 2, 118.5 * u, w * 0.96);
  }
}

/** The net's mesh: thin bright lines on a 16 × 16 cell (alpha-tested). */
export function netTexture(): THREE.DataTexture {
  const n = 16;
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const on = x < 2 || y < 2;
      const i = (y * n + x) * 4;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = on ? 255 : 0;
    }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
