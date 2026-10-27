// ── The table: a 7 ft bar box, in metres ────────────────────────────────
//
// Sim frame: origin at the centre of the cloth, x along the length (the
// head / kitchen at −x, the rack at +x), y across. The playing area is
// measured nose to nose of the cushions (78" × 39"). Each cushion is a
// straight nose line ending in angled jaws into its pocket; the ball's
// centre collides with those segments at one ball radius (so the jaw
// tips are rounded), and a ball is down once its centre is inside the
// pocket's drop circle, which sits just past the mouth.

import type { PocketId, Vec2 } from '../contract';

export const R = 0.028575; // 2¼" ball
export const L = 1.981; // 78"
export const W = 0.991; // 39"
/** The head string (kitchen line) and the spots. */
export const HEAD_X = -L / 4;
export const FOOT_X = L / 4;

/** Corner mouth (between the cushion noses) and side mouth widths. */
export const CORNER_MOUTH = 0.118;
export const SIDE_MOUTH = 0.132;
const CG = CORNER_MOUTH / Math.SQRT2; // how far each corner's noses stop short of the corner
const SG = SIDE_MOUTH / 2; // half the side mouth
const JAW = 0.075; // jaw length
/** Cushion width (nose to rail), for the view. */
export const CUSHION = 0.05;

export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface Pocket {
  id: PocketId;
  /** Drop circle. */
  x: number;
  y: number;
  r: number;
  /** Where to aim a ball at it (the middle of the mouth, a touch inside). */
  aim: Vec2;
  /** Unit vector from the table into the pocket. */
  nx: number;
  ny: number;
  corner: boolean;
}

function seg(ax: number, ay: number, bx: number, by: number): Segment {
  return { ax, ay, bx, by };
}

const hl = L / 2;
const hw = W / 2;

/** Jaws: from the nose point, back into the pocket, turned in a little. */
function jawTo(px: number, py: number, dx: number, dy: number): Segment {
  const n = Math.sqrt(dx * dx + dy * dy);
  return seg(px, py, px + (dx / n) * JAW, py + (dy / n) * JAW);
}

function buildSegments(): Segment[] {
  const s: Segment[] = [];
  for (const sy of [-1, 1]) {
    const y = sy * hw;
    // Long cushions: corner → side, side → corner
    s.push(seg(-hl + CG, y, -SG, y), seg(SG, y, hl - CG, y));
    // Side pocket jaws (turned in ~6°)
    s.push(jawTo(-SG, y, 0.1, sy * 1), jawTo(SG, y, -0.1, sy * 1));
    // Corner jaws on the long cushions: ~along the diagonal, turned in a touch (the throat narrows)
    s.push(jawTo(-hl + CG, y, -1, sy * 0.8), jawTo(hl - CG, y, 1, sy * 0.8));
  }
  for (const sx of [-1, 1]) {
    const x = sx * hl;
    // Short cushions
    s.push(seg(x, -hw + CG, x, hw - CG));
    s.push(jawTo(x, -hw + CG, sx * 0.8, -1), jawTo(x, hw - CG, sx * 0.8, 1));
  }
  return s;
}

function buildPockets(): Pocket[] {
  const k = Math.SQRT1_2;
  const corner = (id: PocketId, sx: number, sy: number): Pocket => ({
    id,
    x: sx * (hl + 0.004),
    y: sy * (hw + 0.004),
    r: 0.056,
    aim: { x: sx * (hl - CG / 2 + 0.006), y: sy * (hw - CG / 2 + 0.006) },
    nx: sx * k,
    ny: sy * k,
    corner: true,
  });
  const side = (id: PocketId, sy: number): Pocket => ({
    id,
    x: 0,
    y: sy * (hw + 0.032),
    r: 0.046,
    aim: { x: 0, y: sy * (hw + 0.004) },
    nx: 0,
    ny: sy,
    corner: false,
  });
  return [
    corner(0, -1, -1),
    side(1, -1),
    corner(2, 1, -1),
    corner(3, 1, 1),
    side(4, 1),
    corner(5, -1, 1),
  ];
}

export const SEGMENTS: readonly Segment[] = buildSegments();
export const POCKETS: readonly Pocket[] = buildPockets();

/** The diamonds (sights) on the rails, sim frame along each cushion line. */
export function diamonds(): Vec2[] {
  const out: Vec2[] = [];
  for (const i of [-3, -2, -1, 1, 2, 3]) {
    out.push({ x: (i * L) / 8, y: -hw }, { x: (i * L) / 8, y: hw });
  }
  for (const j of [-1, 0, 1]) out.push({ x: -hl, y: (j * W) / 4 }, { x: hl, y: (j * W) / 4 });
  return out;
}

/** Is this a spot the cue ball can sit on the cloth (not in a pocket mouth)? */
export function onCloth(x: number, y: number, pad = 0): boolean {
  return Math.abs(x) <= hl - R - pad && Math.abs(y) <= hw - R - pad;
}

/** In the kitchen (behind the head string). */
export function inKitchen(x: number): boolean {
  return x <= HEAD_X;
}

/**
 * The six cushions as polygons (sim frame) for the view: the nose line,
 * then back along each end's jaw to the rail, CUSHION behind the nose
 * (the same numbers as SEGMENTS).
 */
export function cushionPolys(): Vec2[][] {
  const out: Vec2[][] = [];
  const back = (p: Vec2, dx: number, dy: number, ox: number, oy: number): Vec2 => {
    const n = Math.sqrt(dx * dx + dy * dy);
    const ux = dx / n;
    const uy = dy / n;
    const k = CUSHION / (ux * ox + uy * oy);
    return { x: p.x + ux * k, y: p.y + uy * k };
  };
  for (const sy of [-1, 1]) {
    const y = sy * hw;
    const a1 = { x: -hl + CG, y };
    const b1 = { x: -SG, y };
    out.push([a1, b1, back(b1, 0.1, sy, 0, sy), back(a1, -1, sy * 0.8, 0, sy)]);
    const a2 = { x: SG, y };
    const b2 = { x: hl - CG, y };
    out.push([a2, b2, back(b2, 1, sy * 0.8, 0, sy), back(a2, -0.1, sy, 0, sy)]);
  }
  for (const sx of [-1, 1]) {
    const x = sx * hl;
    const a = { x, y: -hw + CG };
    const b = { x, y: hw - CG };
    out.push([a, b, back(b, sx * 0.8, 1, sx, 0), back(a, sx * 0.8, -1, sx, 0)]);
  }
  return out;
}
