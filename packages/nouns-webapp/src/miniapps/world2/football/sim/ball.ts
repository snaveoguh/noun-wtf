// ── Noun Football: ball physics (pure) ──────────────────────────────────
//
// A size-5 ball over grass, in pitch-local metres (contract.ts):
//   air:    gravity, quadratic drag, Magnus (a = k · w × v: sidespin curls,
//           topspin dips, backspin floats), spin decaying slowly;
//   ground: bounces with restitution, friction at the contact point (so
//           topspin kicks on and backspin checks up), then rolling with
//           rolling resistance + a little linear drag, spin locked to the roll;
//   goals:  round posts and crossbar (sphere vs capsule, restitution ~0.7),
//           and the net: a box behind the line that soaks a ball up from
//           inside (entered through the mouth) and keeps it out from outside;
//   boards: ad boards round the grass stop a dead ball rolling into the stands.
// Fast balls are substepped so nothing tunnels through a post.

import type { BallState, PitchSpec } from '../contract';

import { GRASS } from '../contract';

export const BALL = {
  g: 9.81,
  /** Quadratic drag: a = −drag · |v| · v (1/m). */
  drag: 0.0125,
  /** Magnus: a = magnus · (w × v). */
  magnus: 0.0038,
  /** Spin decay in the air (1/s). */
  spinAir: 0.3,
  restitution: 0.6,
  /** Below this impact speed the ball stops bouncing and rolls (m/s). */
  rollBelow: 0.9,
  /** Share of contact-point slip removed by one bounce. */
  bounceGrip: 0.55,
  /** Rolling: constant deceleration + linear drag. */
  rollDecel: 0.55,
  rollDrag: 0.16,
  /** Restitution off the woodwork. */
  wood: 0.7,
  /** Speed kept per hit of the net. */
  netKeep: 0.22,
  /** Max substep length (m). */
  maxStep: 0.07,
  /** Ad boards round the grass: height (m). */
  boardH: 0.9,
} as const;

/** Physics scratch kept between steps (serialisable: plain JSON). */
export interface BallCtx {
  /** In a goal's net (entered through the mouth): +1 / −1 = which end, 0 = no. */
  inGoal: 0 | 1 | -1;
}

export interface BallHits {
  bounce: number;
  post: number;
  bar: number;
  net: number;
  board: number;
}

export const newHits = (): BallHits => ({ bounce: 0, post: 0, bar: 0, net: 0, board: 0 });

function capsule(
  b: BallState,
  r: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  pr: number,
): number {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const L2 = ux * ux + uy * uy + uz * uz;
  let t = ((b.x - ax) * ux + (b.y - ay) * uy + (b.z - az) * uz) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + ux * t;
  const qy = ay + uy * t;
  const qz = az + uz * t;
  const dx = b.x - qx;
  const dy = b.y - qy;
  const dz = b.z - qz;
  const d2 = dx * dx + dy * dy + dz * dz;
  const R = r + pr;
  if (d2 >= R * R || d2 < 1e-12) return 0;
  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  const nz = dz / d;
  b.x = qx + nx * R;
  b.y = qy + ny * R;
  b.z = qz + nz * R;
  const vn = b.vx * nx + b.vy * ny + b.vz * nz;
  if (vn >= 0) return 0;
  const k = (1 + BALL.wood) * vn;
  b.vx -= k * nx;
  b.vy -= k * ny;
  b.vz -= k * nz;
  // The woodwork scrubs spin
  b.wx *= 0.5;
  b.wy *= 0.5;
  b.wz *= 0.5;
  return -vn;
}

/** Woodwork at one end (s = ±1). Returns [post, bar] impact speeds. */
function woodwork(b: BallState, p: PitchSpec, s: number, hits: BallHits) {
  const r = p.ballRadius;
  const z0 = (s * p.length) / 2;
  const pr = p.postRadius;
  const px = p.goalWidth / 2 + pr;
  const top = p.goalHeight + pr;
  // Cheap reject: nowhere near this goal frame
  if (Math.abs(b.z - z0) > r + pr + 0.05 || Math.abs(b.x) > px + r + pr || b.y > top + r + pr)
    return;
  for (const sx of [-1, 1]) {
    const v = capsule(b, r, sx * px, 0, z0, sx * px, top, z0, pr);
    if (v > hits.post) hits.post = v;
  }
  const v = capsule(b, r, -px, top, z0, px, top, z0, pr);
  if (v > hits.bar) hits.bar = v;
}

/** The net (inside and outside), the goal at end s. */
function net(b: BallState, p: PitchSpec, ctx: BallCtx, hits: BallHits, h: number) {
  const r = p.ballRadius;
  const half = p.length / 2;
  const gw = p.goalWidth / 2;
  const gh = p.goalHeight;
  const back = half + p.goalDepth;
  const s = b.z >= 0 ? 1 : -1;
  const sz = b.z * s;
  // Crossing the mouth: in the goal
  if (ctx.inGoal === 0 && sz > half && Math.abs(b.x) < gw && b.y < gh && sz < half + r * 2 + 0.3)
    ctx.inGoal = s as 1 | -1;
  if (ctx.inGoal !== 0 && (sz < half - r || Math.sign(b.z) !== ctx.inGoal)) ctx.inGoal = 0;
  const keep = BALL.netKeep;
  if (ctx.inGoal === s) {
    let hit = 0;
    // Tangled in the net: it never rolls back out of the goal
    if (sz > half + r && b.vz * s < 0) b.vz *= Math.exp(-8 * h);
    if (sz + r > back) {
      b.z = s * (back - r);
      const vzOut = b.vz * s;
      if (vzOut > 0) {
        hit = Math.max(hit, vzOut);
        b.vz = -s * vzOut * 0.06;
        b.vx *= keep * 2;
        b.vy *= 0.6;
      }
    }
    if (Math.abs(b.x) + r > gw) {
      const sx = Math.sign(b.x);
      b.x = sx * (gw - r);
      const vo = b.vx * sx;
      if (vo > 0) {
        hit = Math.max(hit, vo);
        b.vx = -sx * vo * 0.15;
        b.vz *= keep * 2;
      }
    }
    if (b.y + r > gh) {
      b.y = gh - r;
      if (b.vy > 0) {
        hit = Math.max(hit, b.vy);
        b.vy *= -0.1;
        b.vz *= keep * 2;
        b.vx *= keep * 2;
      }
    }
    if (hit > hits.net) hits.net = hit;
    return;
  }
  // From outside: the side netting, roof and back keep it out
  if (sz <= half || sz > back + r || Math.abs(b.x) > gw + r || b.y > gh + r) return;
  // Penetrations past each outer face
  const pSide = gw + r - Math.abs(b.x);
  const pRoof = gh + r - b.y;
  const pBack = back + r - sz;
  const m = Math.min(pSide, pRoof, pBack);
  let hit = 0;
  if (m === pSide) {
    const sx = Math.sign(b.x) || 1;
    b.x = sx * (gw + r);
    if (b.vx * sx < 0) {
      hit = -b.vx * sx;
      b.vx = -b.vx * 0.15;
      b.vz *= 0.5;
    }
  } else if (m === pRoof) {
    b.y = gh + r;
    if (b.vy < 0) {
      hit = -b.vy;
      b.vy = -b.vy * 0.2;
      b.vx *= 0.6;
      b.vz *= 0.6;
    }
  } else {
    b.z = s * (back + r);
    if (b.vz * s < 0) {
      hit = -b.vz * s;
      b.vz = -b.vz * 0.15;
    }
  }
  if (hit > hits.net) hits.net = hit;
}

function ground(b: BallState, r: number, h: number, hits: BallHits) {
  if (b.y > r + 1e-4) return;
  b.y = r;
  if (b.vy < -BALL.rollBelow) {
    // A bounce: restitution + grip at the contact point
    if (-b.vy > hits.bounce) hits.bounce = -b.vy;
    b.vy = -b.vy * BALL.restitution;
    slip(b, r, BALL.bounceGrip);
    return;
  }
  // Rolling
  if (b.vy < 0) b.vy = 0;
  slip(b, r, Math.min(1, 10 * h));
  const sp = Math.hypot(b.vx, b.vz);
  if (sp > 1e-4) {
    const dec = BALL.rollDecel * h + BALL.rollDrag * sp * h;
    const k = sp > dec ? (sp - dec) / sp : 0;
    b.vx *= k;
    b.vz *= k;
  } else {
    b.vx = 0;
    b.vz = 0;
  }
  // Spin locked to the roll, sidespin dies on the grass
  b.wz = -b.vx / r;
  b.wx = b.vz / r;
  b.wy *= Math.exp(-4 * h);
}

/**
 * Friction at the contact point: removes share `k` of the slip, split
 * between the ball's velocity and its spin (a hollow sphere: I = ⅔ m r²).
 */
function slip(b: BallState, r: number, k: number) {
  // Contact point velocity: v + w × (0, −r, 0) = (vx + r wz, ·, vz − r wx)
  const cx = b.vx + r * b.wz;
  const cz = b.vz - r * b.wx;
  const jx = cx * k;
  const jz = cz * k;
  b.vx -= jx * 0.4;
  b.vz -= jz * 0.4;
  b.wz -= (jx * 0.6) / r;
  b.wx += (jz * 0.6) / r;
}

function boards(b: BallState, hits: BallHits) {
  const hx = GRASS.width / 2 + 1.5;
  const hz = GRASS.length / 2 + 1.5;
  if (b.y > BALL.boardH) return;
  if (Math.abs(b.x) > hx) {
    const s = Math.sign(b.x);
    b.x = s * hx;
    if (b.vx * s > 0) {
      hits.board = Math.max(hits.board, Math.abs(b.vx));
      b.vx = -b.vx * 0.3;
    }
  }
  // Behind the goals the boards stand further back (the nets are in between)
  if (Math.abs(b.z) > hz) {
    const s = Math.sign(b.z);
    b.z = s * hz;
    if (b.vz * s > 0) {
      hits.board = Math.max(hits.board, Math.abs(b.vz));
      b.vz = -b.vz * 0.3;
    }
  }
}

/** One substep of free flight / rolling. */
function sub(b: BallState, p: PitchSpec, ctx: BallCtx, h: number, hits: BallHits) {
  const r = p.ballRadius;
  const airborne = b.y > r + 0.002 || b.vy > 0.01;
  if (airborne) {
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    const d = BALL.drag * sp;
    const mx = BALL.magnus * (b.wy * b.vz - b.wz * b.vy);
    const my = BALL.magnus * (b.wz * b.vx - b.wx * b.vz);
    const mz = BALL.magnus * (b.wx * b.vy - b.wy * b.vx);
    b.vx += (-d * b.vx + mx) * h;
    b.vy += (-d * b.vy + my - BALL.g) * h;
    b.vz += (-d * b.vz + mz) * h;
    const decay = Math.exp(-BALL.spinAir * h);
    b.wx *= decay;
    b.wy *= decay;
    b.wz *= decay;
  }
  b.x += b.vx * h;
  b.y += b.vy * h;
  b.z += b.vz * h;
  ground(b, r, h, hits);
  woodwork(b, p, 1, hits);
  woodwork(b, p, -1, hits);
  net(b, p, ctx, hits, h);
  boards(b, hits);
}

/** Advance a free ball by dt (substepped). Hits get the biggest impact speeds. */
export function stepBall(b: BallState, p: PitchSpec, ctx: BallCtx, dt: number, hits: BallHits) {
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  const n = Math.min(12, Math.max(1, Math.ceil((sp * dt) / BALL.maxStep)));
  const h = dt / n;
  for (let i = 0; i < n; i++) sub(b, p, ctx, h, hits);
}

/** Where a free ball will be: samples every `dt` for `T` seconds (no events). */
export function predictBall(
  from: BallState,
  p: PitchSpec,
  ctx: BallCtx,
  T: number,
  dt: number,
  out: { x: number; y: number; z: number; t: number }[] = [],
) {
  const b: BallState = { ...from };
  const c: BallCtx = { ...ctx };
  const hits = newHits();
  out.length = 0;
  const n = Math.ceil(T / dt);
  for (let i = 1; i <= n; i++) {
    stepBall(b, p, c, dt, hits);
    out.push({ x: b.x, y: b.y, z: b.z, t: i * dt });
  }
  return out;
}

// ── Kick solving (shared by the sim's kicks, the AI and the keeper) ──────

/** Ground pass speed that rolls `d` metres and arrives at `arrive` m/s (no drag in the air: it's rolling). */
export function rollSpeedFor(d: number, arrive: number): number {
  // v dv/dx = −(a + c v)  ⇒  integrate numerically, cheap closed-ish form
  let v = Math.max(0, arrive);
  const a = BALL.rollDecel;
  const c = BALL.rollDrag;
  const n = 24;
  const dx = d / n;
  for (let i = 0; i < n; i++) v += ((a + c * v) / Math.max(v, 0.5)) * dx;
  return v;
}

/**
 * Launch velocity for a lofted ball from (x, z) to land at (tx, tz) with
 * apex `apex` metres above the start (drag compensated ~empirically).
 */
export function lobVelocity(
  x: number,
  y: number,
  z: number,
  tx: number,
  tz: number,
  apex: number,
  out: { vx: number; vy: number; vz: number },
) {
  const g = BALL.g;
  const vy = Math.sqrt(2 * g * Math.max(0.3, apex));
  // Time up + time down to the ground (from apex height + y)
  const tUp = vy / g;
  const tDown = Math.sqrt((2 * Math.max(0.05, apex + y - 0.11)) / g);
  const T = tUp + tDown;
  const dx = tx - x;
  const dz = tz - z;
  const d = Math.hypot(dx, dz);
  // Drag shortens the flight: lengthen with speed
  const vh = (d / T) * (1 + 0.006 * d);
  out.vx = d > 1e-6 ? (dx / d) * vh : 0;
  out.vz = d > 1e-6 ? (dz / d) * vh : 0;
  out.vy = vy * (1 + 0.0025 * d);
  return out;
}
