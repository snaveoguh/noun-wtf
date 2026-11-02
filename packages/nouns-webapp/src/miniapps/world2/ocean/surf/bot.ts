// ── A surfer who knows what they're doing (pure): the line-up's locals ───
//
// Waits at their spot in the line-up sat on the board facing the beach,
// watches the next crest come (its phase says how far off it is), paddles
// for the bigger ones, pops, rides down the line (+a) high on the face
// when they're low and down it when they're near the lip, then paddles
// back out to their spot, duck-diving the whitewater. Only the sea at
// their own position is used, so the same code runs every NPC surfer.

import type { SeaPoint } from '../sea';

import { OMEGA, setSize, wrap } from '../waves';

import { blankInput, type SeaQuery, type WaterInput, type WaterState } from './sim';

const TAU = Math.PI * 2;
const angleDiff = (a: number, b: number) => {
  let d = a - b;
  d -= TAU * Math.round(d / TAU);
  return d;
};

export class SurfBot {
  private going = false;
  /** Seconds before they kick out over the back and paddle home. */
  private rideFor: number;
  private patience: number;
  private sp: SeaPoint;
  private ahead: SeaPoint;

  constructor(
    /** Their spot in the line-up (world x, z). */
    readonly homeX: number,
    readonly homeZ: number,
    seed = 1,
    blank: () => SeaPoint,
  ) {
    this.patience = 0.85 + ((seed * 0.618) % 0.3);
    this.rideFor = 10 + ((seed * 3.7) % 6);
    this.sp = blank();
    this.ahead = blank();
  }

  input(s: WaterState, q: SeaQuery): WaterInput {
    const inp = blankInput();
    const p = q.at(s.x, s.z, this.sp);
    if (p === null) return inp;
    const steerTo = (want: number, k = 2.2) =>
      Math.max(-1, Math.min(1, -angleDiff(want, s.yaw) * k));
    const shoreYaw = Math.atan2(p.sx, p.sz);
    if (s.phase === 'ride' || s.phase === 'pop' || s.phase === 'air') {
      this.going = false;
      const pm = wrap(p.phi);
      // kick out: up and over the back of it
      const theta = s.rideT > this.rideFor ? 2.7 : pm < 4.3 ? 1.75 : pm > 5.8 ? 0.9 : 1.3;
      const dx = p.sx * Math.cos(theta) + p.ax * Math.sin(theta);
      const dz = p.sz * Math.cos(theta) + p.az * Math.sin(theta);
      inp.moveX = steerTo(Math.atan2(dx, dz), 2.5);
      return inp;
    }
    if (s.phase === 'wade' || s.phase === 'swim') {
      // back out to the spot
      inp.moveY = 1;
      inp.camYaw = Math.atan2(this.homeX - s.x, this.homeZ - s.z);
      return inp;
    }
    if (s.phase !== 'paddle') return inp;
    const hx = this.homeX - s.x;
    const hz = this.homeZ - s.z;
    const far = Math.hypot(hx, hz);
    const pm = wrap(p.phi);
    // seconds until the next crest is here, and how big it is
    const tCrest = (TAU - pm) / OMEGA;
    const big = setSize(p.phi + (TAU - pm)) > this.patience;
    if (!this.going && big && tCrest < 2.3 && tCrest > 1.1 && far < 30) this.going = true;
    if (this.going) {
      inp.moveX = steerTo(shoreYaw);
      inp.moveY = 1;
      inp.sprint = true;
      if (s.ready) inp.jump = true;
      // missed it: it rolled past
      if (pm < 2.5 && pm > 1 && !s.ready) this.going = false;
      return inp;
    }
    if (far > 10) {
      // paddle home, ducking what's breaking in front
      const want = Math.atan2(hx, hz);
      inp.moveX = steerTo(want);
      inp.moveY = Math.abs(angleDiff(want, s.yaw)) < 0.8 ? 1 : 0.3;
      const a = q.at(s.x + Math.sin(s.yaw) * 7, s.z + Math.cos(s.yaw) * 7, this.ahead);
      if (a !== null && a.broken > 0.5 && a.foam > 0.5) inp.duck = true;
      return inp;
    }
    // sit and wait facing in
    inp.moveX = steerTo(shoreYaw, 1.2);
    inp.moveY = -0.5;
    return inp;
  }
}
