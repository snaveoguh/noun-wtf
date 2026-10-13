// Ball physics: gravity, light quadratic drag, a little Magnus from spin,
// floor bounces, a torus rim, a box backboard and a net that slows the ball
// through the hoop. Pure functions over a plain body so the shot solver can
// run the exact same integrator to predict flights.

import { BOARD_THICK, type CourtGeo } from './court';

export interface BallBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  sx: number;
  sy: number;
  sz: number;
}

/** What one step touched (strengths are impact speeds, m/s). */
export interface Contacts {
  rim: number;
  board: number;
  floor: number;
  /** Rim index the ball passed down through this step, or -1. */
  through: number;
  /** In a net this step (rim index or -1). */
  net: number;
}

export const GRAVITY = 9.8;
export const BALL_PHYS = {
  drag: 0.015,
  magnus: 0.0006,
  eFloor: 0.76,
  eRim: 0.52,
  eBoard: 0.6,
  rimFriction: 0.86,
  boardFriction: 0.9,
  /** Rim tube radius (the ring's steel). */
  tube: 0.0095,
  /** Net depth below the rim plane. */
  netDepth: 0.45,
};

export function newContacts(): Contacts {
  return { rim: 0, board: 0, floor: 0, through: -1, net: -1 };
}

export function resetContacts(c: Contacts): void {
  c.rim = 0;
  c.board = 0;
  c.floor = 0;
  c.through = -1;
  c.net = -1;
}

function nearAnyRim(geo: CourtGeo, b: BallBody): boolean {
  for (const r of geo.rims) {
    const dx = b.x - r.x;
    const dy = b.y - r.y;
    const dz = b.z - r.z;
    if (dx * dx + dy * dy + dz * dz < 6.25) return true;
  }
  return false;
}

/**
 * Advance the ball by `dt` (sub-stepped near the rims so it can't tunnel
 * through the ring or the board). `noRim` skips ring collisions (the shot
 * solver uses it to get a smooth aim function).
 */
export function stepBall(b: BallBody, dt: number, geo: CourtGeo, c: Contacts, noRim = false): void {
  const n = nearAnyRim(geo, b) ? 6 : 1;
  const h = dt / n;
  for (let k = 0; k < n; k++) subStep(b, h, geo, c, noRim);
}

function subStep(b: BallBody, h: number, geo: CourtGeo, c: Contacts, noRim: boolean): void {
  const r = geo.spec.ballRadius;
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  // Drag + Magnus (w × v) + gravity, semi-implicit Euler.
  const dk = BALL_PHYS.drag * sp * h;
  const m = BALL_PHYS.magnus * h;
  const ax = m * (b.sy * b.vz - b.sz * b.vy);
  const ay = m * (b.sz * b.vx - b.sx * b.vz);
  const az = m * (b.sx * b.vy - b.sy * b.vx);
  b.vx += -b.vx * dk + ax;
  b.vy += -b.vy * dk + ay - GRAVITY * h;
  b.vz += -b.vz * dk + az;
  const py = b.y;
  b.x += b.vx * h;
  b.y += b.vy * h;
  b.z += b.vz * h;
  const spinDecay = 1 - 0.25 * h;
  b.sx *= spinDecay;
  b.sy *= spinDecay;
  b.sz *= spinDecay;

  for (let i = 0; i < 2; i++) {
    const rim = geo.rims[i];
    // Passing down through the rim plane inside the ring = through the hoop.
    if (py >= rim.y && b.y < rim.y && b.vy < 0) {
      const f = (py - rim.y) / Math.max(1e-9, py - b.y);
      const cx = b.x - b.vx * h * (1 - f);
      const cz = b.z - b.vz * h * (1 - f);
      if (Math.hypot(cx - rim.x, cz - rim.z) < geo.spec.rimRadius) c.through = i;
    }
    if (!noRim) collideRim(b, geo, i, c);
    collideBoard(b, geo, i, c);
    applyNet(b, geo, i, h, c);
  }

  // Floor.
  if (b.y < r) {
    b.y = r;
    if (b.vy < 0) {
      const imp = -b.vy;
      c.floor = Math.max(c.floor, imp);
      b.vy = imp > 0.45 ? imp * BALL_PHYS.eFloor : 0;
      b.vx *= 0.93;
      b.vz *= 0.93;
    }
  }
  if (b.y <= r + 1e-4 && b.vy === 0) {
    // Rolling: friction, roll spin, come to rest.
    const f = Math.max(0, 1 - 1.4 * h);
    b.vx *= f;
    b.vz *= f;
    if (Math.hypot(b.vx, b.vz) < 0.04) {
      b.vx = 0;
      b.vz = 0;
    }
    b.sx = b.vz / r;
    b.sy = 0;
    b.sz = -b.vx / r;
  }
}

function collideRim(b: BallBody, geo: CourtGeo, i: number, c: Contacts): void {
  const rim = geo.rims[i];
  const R = geo.spec.rimRadius;
  const reach = geo.spec.ballRadius + BALL_PHYS.tube;
  const dx = b.x - rim.x;
  const dy = b.y - rim.y;
  const dz = b.z - rim.z;
  if (Math.abs(dy) > reach) return;
  const rho = Math.hypot(dx, dz);
  if (rho > R + reach || rho < R - reach) return;
  let ux = 1;
  let uz = 0;
  if (rho > 1e-6) {
    ux = dx / rho;
    uz = dz / rho;
  }
  // Nearest point on the ring's centre circle.
  const nx0 = dx - ux * R;
  const nz0 = dz - uz * R;
  const d = Math.hypot(nx0, dy, nz0);
  if (d >= reach || d < 1e-9) return;
  const nx = nx0 / d;
  const ny = dy / d;
  const nz = nz0 / d;
  const pen = reach - d;
  b.x += nx * pen;
  b.y += ny * pen;
  b.z += nz * pen;
  const vn = b.vx * nx + b.vy * ny + b.vz * nz;
  if (vn >= 0) return;
  c.rim = Math.max(c.rim, -vn);
  const tx = b.vx - vn * nx;
  const ty = b.vy - vn * ny;
  const tz = b.vz - vn * nz;
  const e = BALL_PHYS.eRim;
  const f = BALL_PHYS.rimFriction;
  b.vx = tx * f - e * vn * nx;
  b.vy = ty * f - e * vn * ny;
  b.vz = tz * f - e * vn * nz;
  // Rim contact scrubs spin into a roll along the ring.
  b.sx = (b.sx + (nz * ty - ny * tz) * 4) * 0.5;
  b.sz = (b.sz + (ny * tx - nx * ty) * 4) * 0.5;
}

function collideBoard(b: BallBody, geo: CourtGeo, i: number, c: Contacts): void {
  const s = geo.sign[i];
  const face = geo.boardFace[i];
  const r = geo.spec.ballRadius;
  const hw = geo.spec.boardWidth / 2;
  const y0 = geo.spec.boardBottom;
  const y1 = y0 + geo.spec.boardHeight;
  const z0 = s > 0 ? face : face - BOARD_THICK;
  const z1 = s > 0 ? face + BOARD_THICK : face;
  const cx = Math.min(hw, Math.max(-hw, b.x));
  const cy = Math.min(y1, Math.max(y0, b.y));
  const cz = Math.min(z1, Math.max(z0, b.z));
  let dx = b.x - cx;
  let dy = b.y - cy;
  let dz = b.z - cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= r * r) return;
  let d = Math.sqrt(d2);
  if (d < 1e-6) {
    // Centre inside the board: push out the face.
    dx = 0;
    dy = 0;
    dz = -s;
    d = 1;
    b.z = face - s * r;
  } else {
    const pen = r - d;
    b.x += (dx / d) * pen;
    b.y += (dy / d) * pen;
    b.z += (dz / d) * pen;
  }
  const nx = dx / d;
  const ny = dy / d;
  const nz = dz / d;
  const vn = b.vx * nx + b.vy * ny + b.vz * nz;
  if (vn >= 0) return;
  c.board = Math.max(c.board, -vn);
  const e = BALL_PHYS.eBoard;
  const f = BALL_PHYS.boardFriction;
  b.vx = (b.vx - vn * nx) * f - e * vn * nx;
  b.vy = (b.vy - vn * ny) * f - e * vn * ny;
  b.vz = (b.vz - vn * nz) * f - e * vn * nz;
}

function applyNet(b: BallBody, geo: CourtGeo, i: number, h: number, c: Contacts): void {
  const rim = geo.rims[i];
  if (b.y > rim.y || b.y < rim.y - BALL_PHYS.netDepth || b.vy > 0.5) return;
  const R = geo.spec.rimRadius;
  const dx = b.x - rim.x;
  const dz = b.z - rim.z;
  const rho = Math.hypot(dx, dz);
  if (rho > R) return;
  c.net = i;
  // The net grabs the ball: horizontal motion dies, the drop slows, and the
  // mesh funnels it to the middle.
  const k = Math.exp(-9 * h);
  b.vx *= k;
  b.vz *= k;
  if (b.vy < -2.6) b.vy += (-2.6 - b.vy) * (1 - Math.exp(-14 * h));
  const lim = R - geo.spec.ballRadius * 0.7;
  if (rho > lim && rho > 1e-6) {
    b.x = rim.x + (dx / rho) * lim;
    b.z = rim.z + (dz / rho) * lim;
  }
}
