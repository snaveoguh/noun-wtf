// ── Aiming geometry: where the cue ball meets something first ───────────
//
// A straight-line read of the shot (no friction, no spin): the cue ball's
// centre runs along the aim until it touches a ball (centres 2R apart:
// the ghost ball) or a cushion (its centre R from a segment). For a ball,
// the object ball heads off along the line of centres and the cue ball
// along the tangent line (a stun shot). The aiming guide draws this, the
// CPU builds its shots on it, and it picks the default called pocket.

import type { BallId, PocketId, Vec2 } from '../contract';

import { POCKETS, R, SEGMENTS, type Segment } from './table';

export type AimHit =
  | {
      kind: 'ball';
      id: BallId;
      t: number;
      ghost: Vec2;
      /** Where the object ball goes, and the cue ball after (unit vectors). */
      obj: Vec2;
      cue: Vec2;
      /** Cut angle (rad, 0 = full ball). */
      cut: number;
    }
  | { kind: 'rail'; t: number; at: Vec2; out: Vec2 };

/** Ball positions by id (null = off the table). */
export type Layout = readonly (Vec2 | null | undefined)[];

/** Distance along (dx, dy) before a circle of radius r at `from` touches the circle of radius rr at c. */
export function rayCircle(
  fx: number,
  fy: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  rr: number,
): number | null {
  const ox = fx - cx;
  const oy = fy - cy;
  const b = ox * dx + oy * dy;
  const c = ox * ox + oy * oy - rr * rr;
  if (c < 0) return b < 0 ? 0 : null; // already touching: only if heading in
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

/** Distance along the ray before a ball (radius R) touches this segment. */
export function raySegment(
  fx: number,
  fy: number,
  dx: number,
  dy: number,
  s: Segment,
): number | null {
  const ex = s.bx - s.ax;
  const ey = s.by - s.ay;
  const len = Math.sqrt(ex * ex + ey * ey);
  const nx = -ey / len;
  const ny = ex / len;
  let best: number | null = null;
  const s0 = (fx - s.ax) * nx + (fy - s.ay) * ny;
  const dn = dx * nx + dy * ny;
  if (dn !== 0) {
    const off = s0 > 0 ? R : -R;
    const t = (off - s0) / dn;
    if (t >= 0 && (s0 - off) * dn < 0) {
      const px = fx + dx * t;
      const py = fy + dy * t;
      const u = ((px - s.ax) * ex + (py - s.ay) * ey) / (len * len);
      if (u >= 0 && u <= 1) best = t;
    }
  }
  for (const [cx, cy] of [
    [s.ax, s.ay],
    [s.bx, s.by],
  ] as const) {
    const t = rayCircle(fx, fy, dx, dy, cx, cy, R);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

function norm(x: number, y: number): Vec2 {
  const n = Math.sqrt(x * x + y * y);
  return n > 0 ? { x: x / n, y: y / n } : { x: 1, y: 0 };
}

/** The first thing the cue ball meets along (dx, dy) from `from` (balls by id; `skip` ignored). */
export function firstHit(
  balls: Layout,
  from: Vec2,
  dx: number,
  dy: number,
  skip: BallId = 0,
): AimHit | null {
  const d = norm(dx, dy);
  let best: AimHit | null = null;
  balls.forEach((b, id) => {
    if (id === skip || b === null || b === undefined) return;
    const t = rayCircle(from.x, from.y, d.x, d.y, b.x, b.y, 2 * R);
    if (t === null || (best !== null && t >= best.t)) return;
    const ghost = { x: from.x + d.x * t, y: from.y + d.y * t };
    const obj = norm(b.x - ghost.x, b.y - ghost.y);
    const dot = d.x * obj.x + d.y * obj.y;
    const cue = norm(d.x - dot * obj.x, d.y - dot * obj.y);
    const cut = Math.acos(Math.max(-1, Math.min(1, dot)));
    best = { kind: 'ball', id, t, ghost, obj, cue: dot > 0.9999 ? { x: 0, y: 0 } : cue, cut };
  });
  for (const s of SEGMENTS) {
    const t = raySegment(from.x, from.y, d.x, d.y, s);
    if (t === null || (best !== null && t >= best.t)) continue;
    const at = { x: from.x + d.x * t, y: from.y + d.y * t };
    // Bounce off the segment's normal toward the ball
    const ex = s.bx - s.ax;
    const ey = s.by - s.ay;
    const n = norm(-ey, ex);
    const sgn = (at.x - s.ax) * n.x + (at.y - s.ay) * n.y > 0 ? 1 : -1;
    const nx = n.x * sgn;
    const ny = n.y * sgn;
    const vn = d.x * nx + d.y * ny;
    best = { kind: 'rail', t, at, out: norm(d.x - 2 * vn * nx, d.y - 2 * vn * ny) };
  }
  return best;
}

/** Does a ball rolling from `from` along `dir` reach a pocket before anything else? */
export function pocketAlong(balls: Layout, from: Vec2, dir: Vec2, skip: BallId): PocketId | null {
  const d = norm(dir.x, dir.y);
  const hit = firstHit(balls, from, d.x, d.y, skip);
  const reach = hit === null ? 3 : hit.t;
  let best: { id: PocketId; t: number } | null = null;
  for (const p of POCKETS) {
    const t = rayCircle(from.x, from.y, d.x, d.y, p.x, p.y, p.r * 0.85);
    if (t === null) continue;
    // The pocket's mouth must come before whatever the ball meets (a jaw
    // touched right at the mouth still counts)
    if (t <= reach + 0.03 && (best === null || t < best.t)) best = { id: p.id, t };
  }
  return best?.id ?? null;
}

/** Is the straight path from a to b clear for a ball (nothing within 2R but `skip`)? */
export function clearPath(balls: Layout, a: Vec2, b: Vec2, skip: readonly BallId[]): boolean {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len2 = ex * ex + ey * ey;
  if (len2 === 0) return true;
  for (let id = 0; id < balls.length; id++) {
    const p = balls[id];
    if (p === null || p === undefined || skip.includes(id)) continue;
    let t = ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = a.x + ex * t - p.x;
    const qy = a.y + ey * t - p.y;
    if (qx * qx + qy * qy < 4 * R * R * 0.98) return false;
  }
  return true;
}
