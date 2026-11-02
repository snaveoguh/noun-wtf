// ── Noun Golf view: the two little text atlases ─────────────────────────
//
// FLAGS (256 px, 128 on the texture diet): 4 × 6 cells, the 19 hole flags
// (noggle red, the number in white) + a plain yellow one for the range.
// SIGNS (512 px, 256 on the diet): 4 × 8 cells of 2:1, the 19 tee signs
// (hole, name, par, metres), the range's distance boards, the buildings'
// name boards and the NOUN LINKS entrance sign.
// Cell layout is pure (cellUv); painting needs a canvas (null in tests).

import type { CourseLayout } from '../contract';

import { textureDiet } from '../../render/textureDiet';

export const FLAG_GRID = { cols: 4, rows: 6 };
export const SIGN_GRID = { cols: 4, rows: 8 };

/** Sign atlas cells. */
export const SIGN_CELL = {
  hole: (n: number) => n - 1,
  board: (i: number) => 19 + i,
  building: (i: number) => 24 + i,
  entrance: 30,
  club: 31,
} as const;
/** The range's plain flag. */
export const FLAG_PLAIN = 19;

/** UV rect (u0, v0, u1, v1; v up, as CanvasTexture flips) of a cell. */
export function cellUv(
  cell: number,
  grid: { cols: number; rows: number },
): [number, number, number, number] {
  const c = cell % grid.cols;
  const r = Math.floor(cell / grid.cols);
  const e = 0.004;
  return [
    c / grid.cols + e,
    1 - (r + 1) / grid.rows + e,
    (c + 1) / grid.cols - e,
    1 - r / grid.rows - e,
  ];
}

const FONT = '"Arial Black", "Helvetica Neue", Arial, sans-serif';
const RED = '#e8322c';

function canvas(size: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  try {
    return c.getContext('2d');
  } catch {
    return null;
  }
}

function fit(g: CanvasRenderingContext2D, text: string, px: number, maxW: number, weight = '900') {
  let s = px;
  g.font = `${weight} ${s}px ${FONT}`;
  while (s > 6 && g.measureText(text).width > maxW) {
    s -= 1;
    g.font = `${weight} ${s}px ${FONT}`;
  }
}

/** The flags atlas canvas (null without a DOM). */
export function paintFlags(): HTMLCanvasElement | null {
  const size = textureDiet.on ? 128 : 256;
  const g = canvas(size);
  if (g === null) return null;
  const cw = size / FLAG_GRID.cols;
  const ch = size / FLAG_GRID.rows;
  for (let i = 0; i < FLAG_GRID.cols * FLAG_GRID.rows; i++) {
    const x = (i % FLAG_GRID.cols) * cw;
    const y = Math.floor(i / FLAG_GRID.cols) * ch;
    const plain = i >= 19;
    g.fillStyle = plain ? '#ffd23a' : i === 18 ? '#111' : RED;
    g.fillRect(x, y, cw, ch);
    if (plain) continue;
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fit(g, String(i + 1), ch * 0.78, cw * 0.8);
    g.fillText(String(i + 1), x + cw / 2, y + ch * 0.54);
  }
  return g.canvas;
}

const BUILDING_ORDER = ['clubhouse', 'proshop', 'starter', 'bar19', 'rangehut', 'barn'] as const;

export function buildingCell(id: (typeof BUILDING_ORDER)[number]): number {
  return SIGN_CELL.building(BUILDING_ORDER.indexOf(id));
}

/** The signs atlas canvas (null without a DOM). */
export function paintSigns(L: CourseLayout): HTMLCanvasElement | null {
  const size = textureDiet.on ? 256 : 512;
  const g = canvas(size);
  if (g === null) return null;
  const cw = size / SIGN_GRID.cols;
  const ch = size / SIGN_GRID.rows;
  const at = (cell: number) => [
    (cell % SIGN_GRID.cols) * cw,
    Math.floor(cell / SIGN_GRID.cols) * ch,
  ];
  g.textBaseline = 'middle';
  // Tee signs: dark green board, white number in a red noggle lens, name, par, metres
  for (const h of L.holes) {
    const [x, y] = at(SIGN_CELL.hole(h.n));
    g.fillStyle = '#1f5e35';
    g.fillRect(x, y, cw, ch);
    g.strokeStyle = '#f4e9c8';
    g.lineWidth = Math.max(1, ch * 0.05);
    g.strokeRect(x + ch * 0.06, y + ch * 0.06, cw - ch * 0.12, ch - ch * 0.12);
    const lw = ch * 0.62;
    g.fillStyle = RED;
    g.fillRect(x + ch * 0.16, y + (ch - lw) / 2, lw, lw);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    fit(g, String(h.n), lw * 0.78, lw * 0.86);
    g.fillText(String(h.n), x + ch * 0.16 + lw / 2, y + ch * 0.53);
    g.textAlign = 'left';
    const tx = x + ch * 0.9;
    const tw = cw - ch * 1.0;
    g.fillStyle = '#f4e9c8';
    fit(g, h.name, ch * 0.2, tw);
    g.fillText(h.name, tx, y + ch * 0.3);
    g.fillStyle = '#fff';
    fit(g, `PAR ${h.par}`, ch * 0.24, tw);
    g.fillText(`PAR ${h.par}`, tx, y + ch * 0.55);
    fit(g, `${Math.round(h.length)} M`, ch * 0.22, tw);
    g.fillText(`${Math.round(h.length)} M`, tx, y + ch * 0.79);
  }
  // Distance boards
  [50, 100, 150, 200, 250].forEach((d, i) => {
    const [x, y] = at(SIGN_CELL.board(i));
    g.fillStyle = ['#e8322c', '#ffffff', '#2f6fe0', '#ffd23a', '#111111'][i];
    g.fillRect(x, y, cw, ch);
    g.fillStyle = i === 1 || i === 3 ? '#111' : '#fff';
    g.textAlign = 'center';
    fit(g, `${d}`, ch * 0.8, cw * 0.86);
    g.fillText(`${d}`, x + cw / 2, y + ch * 0.54);
  });
  // Building name boards
  BUILDING_ORDER.forEach((id, i) => {
    const b = L.buildings.find(q => q.id === id);
    const [x, y] = at(SIGN_CELL.building(i));
    g.fillStyle = id === 'bar19' ? RED : '#111';
    g.fillRect(x, y, cw, ch);
    g.fillStyle = id === 'bar19' ? '#fff' : '#ffd23a';
    g.textAlign = 'center';
    const text = id === 'clubhouse' ? 'CLUBHOUSE' : (b?.label ?? id.toUpperCase());
    fit(g, text, ch * 0.5, cw * 0.9);
    g.fillText(text, x + cw / 2, y + ch * 0.54);
  });
  // The entrance: NOUN LINKS on cream, a red noggle each side
  {
    const [x, y] = at(SIGN_CELL.entrance);
    g.fillStyle = '#f4e9c8';
    g.fillRect(x, y, cw, ch);
    g.fillStyle = '#1f5e35';
    g.textAlign = 'center';
    fit(g, 'NOUN LINKS', ch * 0.46, cw * 0.84);
    g.fillText('NOUN LINKS', x + cw / 2, y + ch * 0.4);
    g.fillStyle = RED;
    fit(g, 'GOLF CLUB · EST. 2026', ch * 0.17, cw * 0.84, '700');
    g.fillText('GOLF CLUB · EST. 2026', x + cw / 2, y + ch * 0.76);
  }
  {
    const [x, y] = at(SIGN_CELL.club);
    g.fillStyle = '#1f5e35';
    g.fillRect(x, y, cw, ch);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    fit(g, 'NOUN LINKS', ch * 0.5, cw * 0.88);
    g.fillText('NOUN LINKS', x + cw / 2, y + ch * 0.54);
  }
  return g.canvas;
}
