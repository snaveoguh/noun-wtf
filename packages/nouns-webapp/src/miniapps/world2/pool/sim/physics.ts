// ── Ball physics: sliding, rolling, spin, collisions, pockets ───────────
//
// Each ball has a velocity (vx, vy) and a spin (wx, wy, wz) about the
// table's axes (z up). The cloth acts through the contact point under the
// ball, whose slip is u = v + ω × (−R ẑ):
//   sliding (u ≠ 0): friction μs·g against u; u shrinks at 7/2·μs·g, so the
//     ball turns to rolling after 2|u| / (7 μs g) (solved exactly in-step);
//     this is what makes top spin follow and back spin draw after a hit.
//   rolling (u = 0): rolling resistance μr·g, spin locked to the speed.
//   side spin (wz) bleeds off at 5 μsp g / (2R) on its own.
// Collisions are impulses with restitution < 1 and a friction impulse that
// never more than stops the contact's slip, so the energy never goes up:
//   ball–ball (equal mass) + throw from cut / side spin (μb);
//   cushion + jaws (straight segments, round-tipped) + english throwing
//   the ball along the rail, and the cushion soaking up some roll.
// Fixed ticks of 1/120 s, cut into substeps so the fastest ball moves at
// most R/4 per substep: nothing can tunnel, at any power.
//
// Deterministic: only + − × ÷ sqrt (IEEE exact) in here, never Math.hypot /
// sin / cos / exp, so every client gets bit-identical results.

import type { BallId, PocketId } from '../contract';

import { POCKETS, R, SEGMENTS, L, W, type Segment } from './table';

export const G = 9.81;
export const MU_S = 0.2;
export const MU_R = 0.011;
export const MU_SP = 0.044;
export const E_BALL = 0.94;
export const MU_BALL = 0.055;
export const MU_RAIL = 0.2;
/** The cue ball's speed at full power (m/s): a hard break. */
export const V_MAX = 8.5;
/** The most the tip can be off centre (fraction of R) before a miscue. */
export const TIP_MAX = 0.5;
export const TICK = 1 / 120;
/** The longest a shot runs (s) before everything is stopped. */
export const MAX_T = 45;

const SLIDE_K = (5 * MU_S * G) / (2 * R);
const SPIN_K = (5 * MU_SP * G) / (2 * R);
const EPS_V = 1e-4;
const R2 = 2 * R;
const R2SQ = R2 * R2;
const RAIL_ROLL_KEEP = 0.35;
const OUT_X2 = (L / 2 + 0.06) * (L / 2 + 0.06);
const OUT_Y2 = (W / 2 + 0.06) * (W / 2 + 0.06);

export interface Ball {
  id: BallId;
  on: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  wx: number;
  wy: number;
  wz: number;
}

export type PhysEvent =
  | { k: 'cue'; t: number; v: number }
  | { k: 'ball'; t: number; a: BallId; b: BallId; j: number }
  | { k: 'rail'; t: number; a: BallId; j: number }
  | { k: 'pocket'; t: number; a: BallId; p: PocketId; v: number };

export function makeBall(id: BallId, x: number, y: number, on = true): Ball {
  return { id, on, x, y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0 };
}

export function cloneBalls(bs: readonly Ball[]): Ball[] {
  return bs.map(b => ({ ...b }));
}

export function moving(b: Ball): boolean {
  if (!b.on) return false;
  const ux = b.vx - R * b.wy;
  const uy = b.vy + R * b.wx;
  return b.vx * b.vx + b.vy * b.vy > EPS_V * EPS_V || ux * ux + uy * uy > EPS_V * EPS_V;
}

/** Kinetic energy (per unit mass): ½v² + ½(I/m)ω², I/m = 2R²/5. */
export function energy(bs: readonly Ball[]): number {
  let e = 0;
  const k = (2 * R * R) / 5;
  for (const b of bs) {
    if (!b.on) continue;
    e += 0.5 * (b.vx * b.vx + b.vy * b.vy) + 0.5 * k * (b.wx * b.wx + b.wy * b.wy + b.wz * b.wz);
  }
  return e;
}

/**
 * The cue strikes: speed from power, spin from where the tip lands
 * (top / draw about the horizontal axis across the shot, english about z).
 */
export function strike(
  cue: Ball,
  dx: number,
  dy: number,
  power: number,
  side: number,
  top: number,
) {
  const n = Math.sqrt(dx * dx + dy * dy);
  const ux = n > 0 ? dx / n : 1;
  const uy = n > 0 ? dy / n : 0;
  const p = power < 0 ? 0 : power > 1 ? 1 : power;
  const v = 0.25 + p * (V_MAX - 0.25);
  let a = side * TIP_MAX;
  let b = top * TIP_MAX;
  const off = Math.sqrt(a * a + b * b);
  if (off > TIP_MAX) {
    a = (a / off) * TIP_MAX;
    b = (b / off) * TIP_MAX;
  }
  cue.vx = ux * v;
  cue.vy = uy * v;
  // ω for a tip b·R above centre: 5vb / 2R about (−uy, ux) (the rolling axis)
  const k = (5 * v) / (2 * R);
  cue.wx = -uy * k * b;
  cue.wy = ux * k * b;
  // Right english spins the ball clockwise seen from above
  cue.wz = -k * a;
  return v;
}

// ── One ball over the cloth for h seconds ──

function cloth(b: Ball, h: number) {
  let rem = h;
  for (let guard = 0; rem > 0 && guard < 4; guard++) {
    const ux = b.vx - R * b.wy;
    const uy = b.vy + R * b.wx;
    const us = Math.sqrt(ux * ux + uy * uy);
    if (us > EPS_V) {
      // Sliding: constant deceleration along −û until the slip is gone
      const tr = (2 * us) / (7 * MU_S * G);
      const dt = tr < rem ? tr : rem;
      const ex = ux / us;
      const ey = uy / us;
      const a = MU_S * G;
      b.x += b.vx * dt - 0.5 * a * ex * dt * dt;
      b.y += b.vy * dt - 0.5 * a * ey * dt * dt;
      b.vx -= a * ex * dt;
      b.vy -= a * ey * dt;
      b.wx -= SLIDE_K * ey * dt;
      b.wy += SLIDE_K * ex * dt;
      if (dt === tr) {
        // Exactly rolling now (fix the rounding)
        b.wx = -b.vy / R;
        b.wy = b.vx / R;
      }
      rem -= dt;
      continue;
    }
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (sp > EPS_V) {
      // Rolling: rolling resistance, spin tied to the speed
      const a = MU_R * G;
      const tr = sp / a;
      const dt = tr < rem ? tr : rem;
      const ex = b.vx / sp;
      const ey = b.vy / sp;
      b.x += b.vx * dt - 0.5 * a * ex * dt * dt;
      b.y += b.vy * dt - 0.5 * a * ey * dt * dt;
      const ns = dt === tr ? 0 : sp - a * dt;
      b.vx = ex * ns;
      b.vy = ey * ns;
      b.wx = -b.vy / R;
      b.wy = b.vx / R;
      rem -= dt;
      continue;
    }
    b.vx = 0;
    b.vy = 0;
    b.wx = 0;
    b.wy = 0;
    break;
  }
  // Side spin bleeds off by itself
  if (b.wz !== 0) {
    const d = SPIN_K * h;
    b.wz = b.wz > 0 ? (b.wz > d ? b.wz - d : 0) : b.wz < -d ? b.wz + d : 0;
  }
}

// ── Cushions ──

function railHit(b: Ball, s: Segment): number {
  const ex = s.bx - s.ax;
  const ey = s.by - s.ay;
  const len2 = ex * ex + ey * ey;
  let t = ((b.x - s.ax) * ex + (b.y - s.ay) * ey) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = s.ax + ex * t;
  const qy = s.ay + ey * t;
  const dx = b.x - qx;
  const dy = b.y - qy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= R * R || d2 === 0) return 0;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  // Out of the cushion
  b.x = qx + nx * R;
  b.y = qy + ny * R;
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return 0;
  const e = railE(-vn);
  const jn = (1 + e) * -vn;
  b.vx += jn * nx;
  b.vy += jn * ny;
  // English throws the ball along the rail (friction at the contact, never past no-slip)
  const tx = -ny;
  const ty = nx;
  const s0 = b.vx * tx + b.vy * ty - R * b.wz;
  if (s0 !== 0) {
    const max = MU_RAIL * jn;
    const stop = (s0 < 0 ? -s0 : s0) / 3.5;
    const jt = stop < max ? stop : max;
    const sg = s0 > 0 ? 1 : -1;
    b.vx -= jt * sg * tx;
    b.vy -= jt * sg * ty;
    b.wz += ((5 * jt) / (2 * R)) * sg;
  }
  // The cushion soaks up most of the roll into it
  const wt = b.wx * tx + b.wy * ty;
  b.wx -= (1 - RAIL_ROLL_KEEP) * wt * tx;
  b.wy -= (1 - RAIL_ROLL_KEEP) * wt * ty;
  return jn;
}

/** Cushion restitution: livelier for soft hits. */
function railE(vn: number): number {
  const e = 0.86 - 0.035 * vn;
  return e < 0.6 ? 0.6 : e;
}

// ── Ball on ball ──

function ballHit(a: Ball, b: Ball): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= R2SQ) return -1;
  let nx = 1;
  let ny = 0;
  let d = 0;
  if (d2 > 0) {
    d = Math.sqrt(d2);
    nx = dx / d;
    ny = dy / d;
  }
  // Apart
  const push = (R2 - d) / 2;
  a.x -= nx * push;
  a.y -= ny * push;
  b.x += nx * push;
  b.y += ny * push;
  const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (vn <= 0) return 0;
  const j = ((1 + E_BALL) / 2) * vn;
  // Slip at the contact (from the cut and side spin) before the hit
  const tx = -ny;
  const ty = nx;
  const s0 = (a.vx - b.vx) * tx + (a.vy - b.vy) * ty + R * (a.wz + b.wz);
  a.vx -= j * nx;
  a.vy -= j * ny;
  b.vx += j * nx;
  b.vy += j * ny;
  if (s0 !== 0) {
    const max = MU_BALL * j;
    const stop = (s0 < 0 ? -s0 : s0) / 7;
    const jt = stop < max ? stop : max;
    const sg = s0 > 0 ? 1 : -1;
    a.vx -= jt * sg * tx;
    a.vy -= jt * sg * ty;
    b.vx += jt * sg * tx;
    b.vy += jt * sg * ty;
    const dw = ((5 * jt) / (2 * R)) * sg;
    a.wz -= dw;
    b.wz -= dw;
  }
  return j;
}

// ── A shot, run tick by tick ──

export interface ShotReport {
  /** The first ball the cue ball touched (null: none). */
  first: BallId | null;
  /** Everything that dropped, in order. */
  potted: { id: BallId; pocket: PocketId; t: number }[];
  /** A ball (any, the cue included) reached a cushion after the first contact. */
  railAfter: boolean;
  /** Distinct object balls that touched a cushion (a legal break needs 4). */
  railBalls: number;
  /** How long it ran (s). */
  t: number;
  /** Balls that got past a cushion and were caught by the safety net (should always be 0). */
  escaped: number;
}

/**
 * One shot from strike to rest. `advance(t)` simulates up to sim time t
 * (the view keeps it ahead of the playback), `finish()` runs it out.
 * `frames` holds every ball's x, y and on-flag per tick (TICK apart).
 */
export class ShotRun {
  readonly balls: Ball[];
  t = 0;
  done = false;
  readonly events: PhysEvent[] = [];
  /** Per tick: [x0, y0, on0, x1, y1, on1, …] (frame 0 = the moment of the strike). */
  readonly frames: Float32Array[] = [];
  readonly report: ShotReport = {
    first: null,
    potted: [],
    railAfter: false,
    railBalls: 0,
    t: 0,
    escaped: 0,
  };
  private railed = new Set<BallId>();
  /** Substeps run (for perf checks). */
  substeps = 0;

  constructor(balls: readonly Ball[]) {
    this.balls = cloneBalls(balls);
    this.record();
  }

  private record() {
    const f = new Float32Array(this.balls.length * 3);
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i]!;
      f[i * 3] = b.x;
      f[i * 3 + 1] = b.y;
      f[i * 3 + 2] = b.on ? 1 : 0;
    }
    this.frames.push(f);
  }

  advance(until: number) {
    while (!this.done && this.t < until) this.tick();
  }

  finish() {
    while (!this.done) this.tick();
    return this.report;
  }

  private tick() {
    const bs = this.balls;
    let vmax = 0;
    for (const b of bs) {
      if (!b.on) continue;
      const v2 = b.vx * b.vx + b.vy * b.vy;
      if (v2 > vmax) vmax = v2;
    }
    vmax = Math.sqrt(vmax);
    const n = Math.max(1, Math.ceil((vmax * TICK) / (R * 0.25)));
    const h = TICK / n;
    for (let s = 0; s < n; s++) this.substep(h, this.t + (s + 1) * h);
    this.substeps += n;
    this.t += TICK;
    this.record();
    let any = false;
    for (const b of bs) if (moving(b)) any = true;
    if (!any || this.t >= MAX_T) {
      for (const b of bs) {
        b.vx = b.vy = b.wx = b.wy = b.wz = 0;
      }
      this.done = true;
      this.report.t = this.t;
      this.report.railBalls = [...this.railed].filter(id => id !== 0).length;
    }
  }

  private substep(h: number, t: number) {
    const bs = this.balls;
    const rep = this.report;
    for (const b of bs) if (b.on) cloth(b, h);
    for (const b of bs) {
      if (!b.on) continue;
      // Cushions are only near the edge
      if (b.x > -L / 2 + 0.12 && b.x < L / 2 - 0.12 && b.y > -W / 2 + 0.12 && b.y < W / 2 - 0.12)
        continue;
      for (const s of SEGMENTS) {
        const j = railHit(b, s);
        if (j > 0) {
          this.events.push({ k: 'rail', t, a: b.id, j });
          if (rep.first !== null) rep.railAfter = true;
          this.railed.add(b.id);
        }
      }
    }
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i]!;
      if (!a.on) continue;
      for (let k = i + 1; k < bs.length; k++) {
        const b = bs[k]!;
        if (!b.on) continue;
        const dx = b.x - a.x;
        if (dx > R2 || dx < -R2) continue;
        const j = ballHit(a, b);
        if (j > 0) {
          this.events.push({ k: 'ball', t, a: a.id, b: b.id, j });
          if (rep.first === null && (a.id === 0 || b.id === 0))
            rep.first = a.id === 0 ? b.id : a.id;
        }
      }
    }
    for (const b of bs) {
      if (!b.on) continue;
      let p = pocketOf(b.x, b.y);
      // Never off the table: anything outside drops in the nearest pocket
      if (p === null && (b.x * b.x > OUT_X2 || b.y * b.y > OUT_Y2)) {
        p = nearestPocket(b.x, b.y);
        rep.escaped++;
      }
      if (p !== null) {
        const v = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        b.on = false;
        b.vx = b.vy = b.wx = b.wy = b.wz = 0;
        rep.potted.push({ id: b.id, pocket: p, t });
        this.events.push({ k: 'pocket', t, a: b.id, p, v });
      }
    }
  }
}

export function pocketOf(x: number, y: number): PocketId | null {
  for (const p of POCKETS) {
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx * dx + dy * dy < p.r * p.r) return p.id;
  }
  return null;
}

export function nearestPocket(x: number, y: number): PocketId {
  let best: PocketId = 0;
  let bd = Infinity;
  for (const p of POCKETS) {
    const d = (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y);
    if (d < bd) {
      bd = d;
      best = p.id;
    }
  }
  return best;
}
