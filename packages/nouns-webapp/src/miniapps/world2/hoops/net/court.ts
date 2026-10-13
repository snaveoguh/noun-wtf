// ── Court placement: sim space (court-local metres) ↔ world ─────────────
//
// Sim space (contract.ts): origin at the centre of the floor, +y up, z
// along the length (park b), x across (park a). The Noun Jersey court sits
// at park a 46–72 × b 6–30 on the level pad (height f.P).

import { njFrame, njFrameNow, njToWorld, type NjFrame } from '../../world/mountain/nounJersey';
import { JERSEY_COURT_PARK } from '../contract';

const A_MID = (JERSEY_COURT_PARK.a0 + JERSEY_COURT_PARK.a1) / 2;
const B_MID = (JERSEY_COURT_PARK.b0 + JERSEY_COURT_PARK.b1) / 2;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export class CourtXform {
  /** World unit vectors of court +x (park +a × side) and +z (park +b). */
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
  /** World position of the court centre (floor). */
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;

  constructor(readonly f: NjFrame) {
    // Court +x = the frame's r (park +a times side): a pure rotation, the
    // same map as hoops/view's jerseyCourtToWorld (the court is symmetric
    // across x, so nothing depends on which side of the line the park is)
    this.ax = f.rx;
    this.az = f.rz;
    this.bx = f.fx;
    this.bz = f.fz;
    const c = njToWorld(f, A_MID, B_MID, { x: 0, z: 0 });
    this.cx = c.x;
    this.cz = c.z;
    // The court is a decal on the level pad
    this.cy = f.P + 0.02;
  }

  static current(): CourtXform | null {
    const f = njFrame();
    return f === null ? null : new CourtXform(f);
  }

  toWorld<T extends Vec3Like>(x: number, y: number, z: number, out: T): T {
    out.x = this.cx + this.ax * x + this.bx * z;
    out.y = this.cy + y;
    out.z = this.cz + this.az * x + this.bz * z;
    return out;
  }

  /** World x, z → court x, z (the axes are orthonormal: transpose). */
  toCourt(wx: number, wz: number, out: { x: number; z: number }) {
    const dx = wx - this.cx;
    const dz = wz - this.cz;
    out.x = dx * this.ax + dz * this.az;
    out.z = dx * this.bx + dz * this.bz;
    return out;
  }

  /** A world direction → court direction. */
  dirToCourt(wx: number, wz: number, out: { x: number; z: number }) {
    out.x = wx * this.ax + wz * this.az;
    out.z = wx * this.bx + wz * this.bz;
    return out;
  }

  /** Sim yaw (forward = (sin, cos) in court x / z) → world yaw. */
  yawToWorld(yaw: number) {
    const sx = Math.sin(yaw);
    const sz = Math.cos(yaw);
    return Math.atan2(this.ax * sx + this.bx * sz, this.az * sx + this.bz * sz);
  }

  /** Standing on (or right beside) the court, within `margin` metres of its lines. */
  onCourt(wx: number, wy: number, wz: number, margin = 2) {
    if (Math.abs(wy - this.cy) > 3) return false;
    const c = this.toCourt(wx, wz, { x: 0, z: 0 });
    const hw = (JERSEY_COURT_PARK.a1 - JERSEY_COURT_PARK.a0) / 2 + margin;
    const hl = (JERSEY_COURT_PARK.b1 - JERSEY_COURT_PARK.b0) / 2 + margin;
    return Math.abs(c.x) <= hw && Math.abs(c.z) <= hl;
  }

  /** Within `r` metres of the court centre (spectators, lobby discovery). */
  near(wx: number, wz: number, r = 45) {
    return Math.hypot(wx - this.cx, wz - this.cz) < r;
  }
}

/** `?play=hoops` spawn: on the court, near half court, facing the +z basket. */
export function courtSpawn(): { x: number; y: number; z: number; yaw: number } | null {
  const f = njFrameNow();
  if (f === null) return null;
  const c = new CourtXform(f);
  const p = c.toWorld(-2, 0.05, -4, { x: 0, y: 0, z: 0 });
  return { ...p, yaw: c.yawToWorld(0) };
}

/** `?play=hoops[&mode=1|2|3|5]`: the homescreen's hoops entrance (lobby opens on arrival). */
export function hoopsEntry(): { size: 1 | 2 | 3 | 5 } | null {
  const q = new URLSearchParams(window.location.search);
  if (q.get('play') !== 'hoops') return null;
  const m = Number(q.get('mode'));
  return { size: m === 2 || m === 3 || m === 5 ? m : 1 };
}

/** For tests (no terrain): a court at the world origin, axes = world axes. */
export function testCourt(): CourtXform {
  const f = {
    ox: 0,
    oz: 0,
    fx: 0,
    fz: 1,
    rx: 1,
    rz: 0,
    side: 1,
    P: 0,
  } as unknown as NjFrame;
  return new CourtXform(f);
}
