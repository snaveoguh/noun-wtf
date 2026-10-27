// ── The parkour state machine ────────────────────────────────────────────
//
// `step` runs before the Player's own on-foot update every physics step.
// With no move on it watches for one to start (and returns false, so the
// Player walks / jumps / climbs as usual); with a move on it drives the
// body itself and returns true.
//
//   ground  ──jump at a wall, running──▶ wallup ──jump──▶ tic-tac (air)
//     │                                    │ top: ledge in reach ▶ hang
//     │                                    └ top, holding forward ▶ Player climb
//     ├──jump beside a wall, running──▶ wallrun ──jump──▶ wall jump (air)
//     ├──duck, sprinting──▶ slide ──jump──▶ slide jump
//     ├──duck at a drop-off──▶ hang (lowered over the edge)
//     ├──running at a low obstacle──▶ Player vault
//     └──jump at a roof edge, sprinting──▶ gap jump
//   air ──a lip in reach──▶ hang ──W──▶ pull-up │ jump+dir ▶ leap ▶ hang
//       ──a pole in reach──▶ pole ──jump──▶ launch │ bottom ▶ ground
//       ──wall alongside──▶ wallrun
//       ──lands──▶ roll │ stick │ stumble (see landing.ts)
//
// Pure: no three.js, no clock; the world through PkWorld.

import {
  NO_ANIM,
  PK,
  type Hang,
  type PkAnim,
  type PkBody,
  type PkInput,
  type PkMove,
  type PkWorld,
} from '../contract';

import {
  edgeBelow,
  findLeapTarget,
  findLedge,
  floorAt,
  frontWall,
  gapAhead,
  hangSpot,
  lipAt,
  lowObstacle,
  narrowUnder,
  poleAlong,
  sideWall,
  wallAt,
  type Ledge,
  type PoleHit,
} from './detect';
import { landing } from './landing';

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (k: number) => k * k * (3 - 2 * k);

export class ParkourMotor {
  move: PkMove | null = null;
  /** Off (Big Drop, interiors that don't want it…): plain Player movement. */
  enabled = true;
  /** What the rig should show this step (moves + the air / landing flourishes). */
  anim: PkAnim = NO_ANIM;

  private lastRespawns = -1;
  private wasGrounded = true;
  private prevVy = 0;
  private airT = 0;
  /** Seconds since the last jump off the ground (any kind). */
  private sinceJump = 10;
  private sinceDuck = Infinity;
  private regrab = 0;
  private poleCool = 0;
  private wallCool = 0;
  /** The wall last run on / jumped off: no re-run on it until we land. */
  private memoN: { nx: number; nz: number } | null = null;
  /** Flourish timers (anim only). */
  private flipT = 0;
  private flipSide: 1 | -1 = 1;
  /** 0 a twist (wall jump), 0.5 a front flip (pole launch), 1 a backflip (tic-tac). */
  private flipKind = 0;
  private flipDur = 0.55;
  private stickT = 0;
  private gapT = 0;
  private narrow = false;
  private narrowAcc = 0;
  private gait = 0;
  /** A pole found this airtime (cached: the top scan is the dear part). */
  private pole: PoleHit | null = null;
  private poleScanAcc = 0;

  constructor(private w: PkWorld) {}

  get busy() {
    return this.move !== null;
  }

  reset() {
    this.move = null;
    this.anim = NO_ANIM;
    this.flipT = this.stickT = this.gapT = 0;
    this.memoN = null;
    this.pole = null;
    this.regrab = this.poleCool = this.wallCool = 0;
  }

  /**
   * Pick up again after steps it didn't see (the rider was on the board):
   * whatever happened meanwhile isn't a landing to judge.
   */
  resync(b: PkBody) {
    this.reset();
    this.wasGrounded = b.grounded;
    this.prevVy = 0;
    this.airT = 0;
  }

  /** One physics step. True when the engine moved the body itself. */
  step(dt: number, b: PkBody, i: PkInput): boolean {
    if (b.respawns !== this.lastRespawns) {
      this.lastRespawns = b.respawns;
      this.reset();
      this.wasGrounded = b.grounded;
    }
    if (!this.enabled) {
      if (this.move !== null) this.reset();
      this.wasGrounded = b.grounded;
      return false;
    }
    this.regrab = Math.max(0, this.regrab - dt);
    this.poleCool = Math.max(0, this.poleCool - dt);
    this.wallCool = Math.max(0, this.wallCool - dt);
    this.flipT = Math.max(0, this.flipT - dt);
    this.stickT = Math.max(0, this.stickT - dt);
    this.sinceJump += dt;
    this.sinceDuck = i.duck ? 0 : this.sinceDuck + dt;
    if (i.duckPressed) this.sinceDuck = 0;

    // The Player's own climb / vault: hands off (the rig still animates them)
    if (b.climbing || b.vaulting) {
      this.move = null;
      this.anim = NO_ANIM;
      this.wasGrounded = false;
      this.airT = 0;
      this.prevVy = 0;
      return false;
    }

    let drove = false;
    if (this.move !== null) drove = this.drive(dt, b, i);
    else drove = this.watch(dt, b, i);

    if (!drove) {
      if (!b.grounded) this.airT += dt;
      else this.airT = 0;
    }
    this.wasGrounded = b.grounded;
    this.prevVy = b.vel.y;
    this.anim = this.pickAnim(dt, b);
    return drove;
  }

  // ── Watching for a move to start ──────────────────────────────────────

  private watch(dt: number, b: PkBody, i: PkInput): boolean {
    const w = this.w;
    const p = b.pos;
    const hs = Math.hypot(b.vel.x, b.vel.z);
    const fx = Math.sin(b.yaw);
    const fz = Math.cos(b.yaw);

    // Just landed (the Player put us down last step)
    if (b.grounded && !this.wasGrounded) {
      this.memoN = null;
      this.pole = null;
      this.gapT = 0;
      const narrow = narrowUnder(w, p.x, p.y, p.z);
      const out = landing({ impact: -this.prevVy, speed: hs, sinceDuck: this.sinceDuck, narrow });
      if (out === 'roll') {
        const d = hs > 0.5 ? 1 / hs : 0;
        const dx = d > 0 ? b.vel.x * d : fx;
        const dz = d > 0 ? b.vel.z * d : fz;
        this.move = { k: 'roll', dx, dz, speed: Math.max(hs, 4.2), t: 0 };
        b.yaw = Math.atan2(dx, dz);
        b.emit({ type: 'roll', power: clamp(-this.prevVy / 20, 0.3, 1) });
        return this.drive(dt, b, i);
      }
      if (out === 'stumble' || out === 'stumbleHard') {
        this.move = {
          k: 'stumble',
          t: 0,
          dur: out === 'stumbleHard' ? PK.stumbleHardTime : PK.stumbleTime,
        };
        b.emit({ type: 'stumble', power: clamp(-this.prevVy / 22, 0.5, 1) });
        return this.drive(dt, b, i);
      }
      if (out === 'stick') {
        this.stickT = 0.4;
        if (narrow) {
          b.vel.x = 0;
          b.vel.z = 0;
        }
        b.emit({ type: 'stick', power: 0.4 });
      }
    }

    if (b.grounded) {
      // Balance pose on narrow things (a cheap check, a few times a second)
      this.narrowAcc += dt;
      if (this.narrowAcc > 0.15) {
        this.narrowAcc = 0;
        this.narrow = narrowUnder(w, p.x, p.y, p.z);
      }
      // Slide: duck while running
      if (i.duckPressed && hs >= PK.slideMinSpeed) {
        const dx = b.vel.x / hs;
        const dz = b.vel.z / hs;
        this.move = { k: 'slide', dx, dz, speed: Math.max(hs * 1.08, 6.2), t: 0 };
        b.yaw = Math.atan2(dx, dz);
        b.emit({ type: 'slide', power: clamp(hs / 8, 0.3, 1) });
        return this.drive(dt, b, i);
      }
      // Duck at a drop-off: lower yourself over the edge and hang
      if (i.duckPressed && hs < 2.6) {
        const e = edgeBelow(w, p.x, p.y, p.z, fx, fz);
        if (e !== null) {
          this.startHang(b, e);
          b.emit({ type: 'drop', power: 0.3 });
          return true;
        }
      }
      if (i.jump) {
        this.sinceJump = 0;
        // Straight at a wall: run up it
        if (hs >= PK.wallUpMinSpeed) {
          const dx = b.vel.x / hs;
          const dz = b.vel.z / hs;
          const fw = frontWall(w, p.x, p.y, p.z, dx, dz, PK.wallUpReach);
          if (fw !== null && -(dx * fw.nx + dz * fw.nz) > 0.72) return this.startWallUp(b, fw);
          // Beside a wall: run along it
          if (hs >= PK.wallRunMinSpeed && this.wallCool <= 0) {
            const sw = sideWall(w, p.x, p.y, p.z, dx, dz);
            if (sw !== null) return this.startWallRun(b, sw, dx, dz, hs, true);
          }
          // Off a roof edge at a sprint: a gap jump (more height + carry)
          if (i.sprint && hs > 4.5 && gapAhead(w, p.x, p.y, p.z, dx, dz)) {
            const sp = Math.max(hs, PK.gapSpeed);
            b.vel.x = dx * sp;
            b.vel.z = dz * sp;
            b.vel.y = PK.gapJump;
            b.grounded = false;
            this.gapT = 1.4;
            b.emit({ type: 'gap', power: 1 });
            return false;
          }
        }
      }
      // From a standstill (a post, a wall top): a precision jump, a set
      // distance along the stick, so post-to-post lines can be judged
      if (i.jump && hs < PK.precisionSpeed) {
        const wl = Math.hypot(i.wishX, i.wishZ);
        if (wl > 0.5) {
          b.vel.x = (i.wishX / wl) * PK.precisionSpeed;
          b.vel.z = (i.wishZ / wl) * PK.precisionSpeed;
          b.vel.y = PK.precisionJump;
          b.grounded = false;
          b.yaw = Math.atan2(i.wishX, i.wishZ);
          b.emit({ type: 'leap', power: 0.4 });
          return false;
        }
      }
      // Running at a bench / low wall / railing: vault it
      const want = Math.hypot(i.wishX, i.wishZ);
      if (hs >= PK.autoVaultSpeed && want > 0.5) {
        const dx = b.vel.x / hs;
        const dz = b.vel.z / hs;
        const lo = lowObstacle(w, p.x, p.y, p.z, dx, dz, 0.55 + hs * 0.06);
        if (lo !== null && -(dx * lo.nx + dz * lo.nz) > 0.6 && b.startVault(lo.nx, lo.nz, hs)) {
          b.emit({ type: 'vault', power: 0.5 });
          return true;
        }
      }
      return false;
    }

    // ── In the air ──
    this.narrow = false;
    const vy = b.vel.y;
    if (vy < 0) this.landingAssist(dt, b);
    // A lip in front of the hands
    if (this.regrab <= 0 && vy < 3.2) {
      const fw =
        wallAt(w, p.x, p.y + 1.0, p.z, fx, fz, 0.95) ??
        wallAt(w, p.x, p.y + 1.6, p.z, fx, fz, 0.95);
      // Moving fast but glancing along the wall: that's a wall run, not a grab
      const into = hs > 3 ? -(b.vel.x * (fw?.nx ?? 0) + b.vel.z * (fw?.nz ?? 0)) / hs : 1;
      if (fw !== null && -(fx * fw.nx + fz * fw.nz) > 0.45 && into > 0.78) {
        const l = findLedge(w, p.x, p.y, p.z, fw.nx, fw.nz);
        if (l !== null) {
          this.startHang(b, l);
          b.emit({ type: 'grab', power: clamp(-vy / 10, 0.2, 1) });
          return true;
        }
      }
    }
    // A pole within reach (scan along the travel direction, a few times a second)
    if (this.poleCool <= 0) {
      this.poleScanAcc += dt;
      if (this.pole === null && this.poleScanAcc >= 1 / 30) {
        this.poleScanAcc = 0;
        this.pole = this.scanPole(b, hs);
      }
      const pl = this.pole;
      if (pl !== null) {
        const d = Math.hypot(p.x - pl.cx, p.z - pl.cz);
        const hands = p.y + 1.5;
        if (
          d < pl.r + PK.poleReach &&
          p.y > pl.base + 0.3 &&
          hands > pl.base + 1.2 &&
          p.y < pl.top - 0.6
        ) {
          this.startPole(b, pl);
          return true;
        }
        if (d > 4) this.pole = null;
      }
    }
    // Vertical run: just jumped, heading into a wall
    if (hs >= PK.wallUpMinSpeed && this.sinceJump < 0.45 && vy > -1) {
      const dx = b.vel.x / hs;
      const dz = b.vel.z / hs;
      const fw = frontWall(w, p.x, p.y, p.z, dx, dz, 0.9);
      if (fw !== null && -(dx * fw.nx + dz * fw.nz) > 0.72) return this.startWallUp(b, fw);
    }
    // Wall run: a wall alongside, still moving, pressing on
    if (
      hs >= PK.wallRunMinSpeed &&
      vy > -5 &&
      this.wallCool <= 0 &&
      Math.hypot(i.wishX, i.wishZ) > 0.3
    ) {
      const dx = b.vel.x / hs;
      const dz = b.vel.z / hs;
      const sw = sideWall(w, p.x, p.y, p.z, dx, dz, 0.9);
      if (sw !== null && !this.sameWall(sw.nx, sw.nz)) {
        // Along the wall, not straight into it (wall-to-wall bounces come in steep)
        if (Math.abs(dx * sw.nx + dz * sw.nz) < 0.8)
          return this.startWallRun(b, sw, dx, dz, hs, false);
      }
    }
    return false;
  }

  private flip(dur: number, kind: number, side: 1 | -1) {
    this.flipT = this.flipDur = dur;
    this.flipKind = kind;
    this.flipSide = side;
  }

  /**
   * Precision assist: coming down onto something narrow (a post, a rail, a
   * wall top) that the jump would just miss, steer the last half metre so
   * the feet land on it. Checked a few times a second; never more than a
   * 2.5 m/s nudge, and only for tops within 0.65 m of the line.
   */
  private landingAssist(dt: number, b: PkBody) {
    this.assistAcc += dt;
    if (this.assistAcc < 1 / 30) return;
    this.assistAcc = 0;
    const p = b.pos;
    const hs = Math.hypot(b.vel.x, b.vel.z);
    if (hs < 0.5) return;
    const dx = b.vel.x / hs;
    const dz = b.vel.z / hs;
    // When do we come down to height h (ballistic)?
    const tAt = (h: number) => {
      const disc = b.vel.y * b.vel.y - 2 * PK.gravity * (h - p.y);
      return disc < 0 ? -1 : (b.vel.y + Math.sqrt(disc)) / PK.gravity;
    };
    // Around where we'd land on something a little below us
    const ahead = hs * Math.max(0, tAt(p.y - 0.4));
    for (const s of [0, -0.35, 0.35, -0.65, 0.65]) {
      const fx = p.x + dx * (ahead + s);
      const fz = p.z + dz * (ahead + s);
      const fy = floorAt(this.w, fx, p.y + 0.05, fz, 1.6);
      if (fy === null || !narrowUnder(this.w, fx, fy, fz)) continue;
      const t = tAt(fy);
      if (t <= 0.05) continue;
      // Velocity that lands on (fx, fz), nudged at most 2.5 m/s
      const ex = (fx - p.x) / t - b.vel.x;
      const ez = (fz - p.z) / t - b.vel.z;
      const el = Math.hypot(ex, ez);
      const k = el > 2.5 ? 2.5 / el : 1;
      b.vel.x += ex * k;
      b.vel.z += ez * k;
      return;
    }
  }

  private assistAcc = 0;

  private sameWall(nx: number, nz: number) {
    const m = this.memoN;
    return m !== null && m.nx * nx + m.nz * nz > 0.8;
  }

  /** A pole to launch at: along `yaw` ± 0.6 rad (~35°), up to 10 m out (once per launch). */
  private poleAhead(x: number, y: number, z: number, yaw: number): PoleHit | null {
    // Poles are thin (a 0.18 m lamp post is ~0.025 rad wide at 7 m): sweep
    // finer than that, nearest the aim first. Most rays miss outright, so
    // this is at most ~70 cheap rays a height, once per launch. Lower too:
    // high on a tall mast, a shorter pole's top is below your hips.
    for (const dy of [0, -1.5, -3]) {
      for (let k = 0; k <= 66; k++) {
        const off = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 0.018;
        const a = yaw + off;
        const pl = poleAlong(this.w, x, y + dy, z, Math.sin(a), Math.cos(a), 10);
        if (pl !== null && pl.top > y - 2.2) return pl;
      }
    }
    return null;
  }

  private scanPole(b: PkBody, hs: number): PoleHit | null {
    const base = hs > 0.8 ? Math.atan2(b.vel.x, b.vel.z) : b.yaw;
    for (const off of [0, 0.45, -0.45, 0.9, -0.9]) {
      const a = base + off;
      const pl = poleAlong(this.w, b.pos.x, b.pos.y, b.pos.z, Math.sin(a), Math.cos(a), 2.4);
      if (pl !== null) return pl;
    }
    return null;
  }

  // ── Starting moves ────────────────────────────────────────────────────

  private startWallRun(
    b: PkBody,
    sw: { nx: number; nz: number; x: number; z: number; side: 1 | -1 },
    dx: number,
    dz: number,
    hs: number,
    fromGround: boolean,
  ): boolean {
    // Run direction: the heading flattened onto the wall
    let tx = dx - sw.nx * (dx * sw.nx + dz * sw.nz);
    let tz = dz - sw.nz * (dx * sw.nx + dz * sw.nz);
    const l = Math.hypot(tx, tz);
    if (l < 1e-3) return false;
    tx /= l;
    tz /= l;
    const speed = clamp(hs * 1.05, 5.4, PK.wallRunMaxSpeed);
    this.move = {
      k: 'wallrun',
      side: sw.side,
      nx: sw.nx,
      nz: sw.nz,
      tx,
      tz,
      speed,
      t: 0,
      phase: 0,
    };
    b.vel.y = Math.max(fromGround ? PK.wallRunLift + 1.2 : PK.wallRunLift, b.vel.y);
    b.grounded = false;
    b.pos.x = sw.x + sw.nx * PK.wallRunDist;
    b.pos.z = sw.z + sw.nz * PK.wallRunDist;
    b.yaw = Math.atan2(tx, tz);
    this.memoN = { nx: sw.nx, nz: sw.nz };
    b.emit({ type: 'wallrun', power: clamp(speed / 8, 0.4, 1) });
    return true;
  }

  private startWallUp(b: PkBody, fw: { nx: number; nz: number; x: number; z: number }): boolean {
    this.move = { k: 'wallup', nx: fw.nx, nz: fw.nz, t: 0, phase: 0 };
    b.vel.x = 0;
    b.vel.z = 0;
    b.vel.y = PK.wallUpSpeed;
    b.grounded = false;
    b.yaw = Math.atan2(-fw.nx, -fw.nz);
    b.emit({ type: 'wallup', power: 0.7 });
    return true;
  }

  private startHang(b: PkBody, l: Ledge) {
    const s = hangSpot(l);
    this.move = {
      k: 'hang',
      nx: l.nx,
      nz: l.nz,
      lx: l.x,
      ly: l.y,
      lz: l.z,
      shimmy: 0,
      phase: 0,
      t: 0,
      top: l.top,
    };
    this.hangLedge = l;
    b.pos.x = s.x;
    b.pos.y = s.y;
    b.pos.z = s.z;
    b.vel.x = b.vel.y = b.vel.z = 0;
    b.grounded = false;
    b.yaw = Math.atan2(-l.nx, -l.nz);
    this.memoN = null;
  }

  private hangLedge: Ledge | null = null;

  private startPole(b: PkBody, pl: PoleHit) {
    const dx = b.pos.x - pl.cx;
    const dz = b.pos.z - pl.cz;
    const ang = Math.atan2(dx, dz);
    const R = pl.r + PK.poleGap;
    // Momentum becomes swing: the tangential part of the velocity
    const tx = Math.cos(ang);
    const tz = -Math.sin(ang);
    const vt = b.vel.x * tx + b.vel.z * tz;
    const spin = clamp(vt / R, -PK.poleSpinMax, PK.poleSpinMax);
    this.move = {
      k: 'pole',
      cx: pl.cx,
      cz: pl.cz,
      r: pl.r,
      top: pl.top,
      base: pl.base,
      ang,
      spin,
      // A jump's rise carries on up the pole a little; a fall is caught
      vy: b.vel.y > 0 ? b.vel.y * 0.75 : b.vel.y * 0.5,
      t: 0,
    };
    b.pos.y = Math.min(b.pos.y, pl.top - 1.45);
    b.grounded = false;
    this.pole = null;
    b.emit({ type: 'pole', power: clamp(Math.hypot(b.vel.x, b.vel.z) / 7, 0.3, 1) });
  }

  // ── Driving the move ──────────────────────────────────────────────────

  private end(b: PkBody, grounded: boolean) {
    this.move = null;
    b.grounded = grounded;
  }

  private drive(dt: number, b: PkBody, i: PkInput): boolean {
    const m = this.move!;
    switch (m.k) {
      case 'wallrun':
        return this.driveWallRun(dt, b, i, m);
      case 'wallup':
        return this.driveWallUp(dt, b, i, m);
      case 'hang':
        return this.driveHang(dt, b, i, m);
      case 'pullup': {
        m.t += dt;
        const k = Math.min(1, m.t / m.dur);
        const ky = smooth(Math.min(1, k / 0.62));
        const kh = smooth(Math.max(0, (k - 0.42) / 0.58));
        const px = b.pos.x;
        const py = b.pos.y;
        const pz = b.pos.z;
        b.pos.x = m.from.x + (m.to.x - m.from.x) * kh;
        b.pos.y = m.from.y + (m.to.y + 0.08 - m.from.y) * ky - (k > 0.9 ? (k - 0.9) * 0.8 : 0);
        b.pos.z = m.from.z + (m.to.z - m.from.z) * kh;
        b.vel.x = (b.pos.x - px) / dt;
        b.vel.y = (b.pos.y - py) / dt;
        b.vel.z = (b.pos.z - pz) / dt;
        if (k >= 1) {
          b.pos.x = m.to.x;
          b.pos.y = m.to.y;
          b.pos.z = m.to.z;
          b.vel.x = b.vel.y = b.vel.z = 0;
          this.end(b, true);
          this.wasGrounded = true;
        }
        return true;
      }
      case 'leap': {
        m.t += dt;
        const k = Math.min(1, m.t / m.dur);
        const to = hangSpot({ x: m.to.lx, y: m.to.ly, z: m.to.lz, nx: m.to.nx, nz: m.to.nz });
        const e = smooth(k);
        const px = b.pos.x;
        const py = b.pos.y;
        const pz = b.pos.z;
        b.pos.x = m.from.x + (to.x - m.from.x) * e;
        b.pos.y = m.from.y + (to.y - m.from.y) * e + Math.sin(k * Math.PI) * m.arc;
        b.pos.z = m.from.z + (to.z - m.from.z) * e;
        b.vel.x = (b.pos.x - px) / dt;
        b.vel.y = (b.pos.y - py) / dt;
        b.vel.z = (b.pos.z - pz) / dt;
        if (k >= 1) {
          this.move = m.to;
          b.vel.x = b.vel.y = b.vel.z = 0;
          b.emit({ type: 'grab', power: 0.6 });
        }
        return true;
      }
      case 'pole':
        return this.drivePole(dt, b, i, m);
      case 'slide':
      case 'roll':
        return this.driveLow(dt, b, i, m);
      case 'stumble': {
        m.t += dt;
        const k = Math.exp(-7 * dt);
        b.vel.x *= k;
        b.vel.z *= k;
        b.vel.y = 0;
        b.pos.x += b.vel.x * dt;
        b.pos.z += b.vel.z * dt;
        const fl = floorAt(this.w, b.pos.x, b.pos.y + 0.6, b.pos.z, 1.1);
        if (fl === null) {
          this.end(b, false);
          return true;
        }
        b.pos.y = fl;
        b.grounded = true;
        if (m.t >= m.dur) this.end(b, true);
        return true;
      }
    }
  }

  private driveWallRun(dt: number, b: PkBody, i: PkInput, m: Extract<PkMove, { k: 'wallrun' }>) {
    const w = this.w;
    m.t += dt;
    m.phase = (m.phase + (dt * m.speed) / 2.6) % 1;
    const p = b.pos;
    // Jump off: out, up and on
    if (i.jump && m.t > 0.06) {
      this.memoN = { nx: m.nx, nz: m.nz };
      b.vel.x = m.tx * m.speed * 0.85 + m.nx * PK.wallJumpOut;
      b.vel.z = m.tz * m.speed * 0.85 + m.nz * PK.wallJumpOut;
      b.vel.y = PK.wallJumpUp;
      b.yaw = Math.atan2(b.vel.x, b.vel.z);
      this.flip(0.55, 0, m.side);
      this.sinceJump = 0;
      this.wallCool = 0.12;
      b.emit({ type: 'walljump', power: 0.8 });
      this.end(b, false);
      return true;
    }
    const peel = (out: number) => {
      b.vel.x = m.tx * m.speed * 0.8 + m.nx * out;
      b.vel.z = m.tz * m.speed * 0.8 + m.nz * out;
      this.wallCool = 0.35;
      this.end(b, false);
      return true;
    };
    if (i.duckPressed || i.release) return peel(2);
    // Gravity: light while the run is fresh
    const g = PK.gravity * (m.t < PK.wallRunFresh ? PK.wallRunGrav : PK.wallRunGravLate);
    b.vel.y -= g * dt;
    m.speed = Math.max(PK.wallRunMinSpeed, m.speed - 0.7 * dt);
    const nx = p.x + m.tx * m.speed * dt;
    const nz = p.z + m.tz * m.speed * dt;
    let ny = p.y + b.vel.y * dt;
    // Head on a ceiling / overhang
    if (b.vel.y > 0 && w.ray(p.x, p.y + 1.4, p.z, 0, 1, 0, 0.5 + b.vel.y * dt) !== null) {
      b.vel.y = 0;
      ny = p.y;
    }
    // Still a wall there (and just ahead)?
    const wall = wallAt(w, nx, ny + 1.0, nz, -m.nx, -m.nz, PK.wallRunDist + 0.6);
    const ahead = wallAt(
      w,
      nx + m.tx * 0.45,
      ny + 1.0,
      nz + m.tz * 0.45,
      -m.nx,
      -m.nz,
      PK.wallRunDist + 0.7,
    );
    if (wall === null || ahead === null) {
      p.x = nx;
      p.y = ny;
      p.z = nz;
      return peel(0.6);
    }
    // Blocked ahead (an inside corner): jump off it instead of through it
    if (wallAt(w, nx, ny + 1.0, nz, m.tx, m.tz, 0.55) !== null) return peel(1.5);
    // Follow a curving wall
    const k = 1 - Math.exp(-12 * dt);
    m.nx += (wall.nx - m.nx) * k;
    m.nz += (wall.nz - m.nz) * k;
    const nl = Math.hypot(m.nx, m.nz);
    m.nx /= nl;
    m.nz /= nl;
    const d = m.tx * m.nx + m.tz * m.nz;
    m.tx -= m.nx * d;
    m.tz -= m.nz * d;
    const tl = Math.hypot(m.tx, m.tz);
    m.tx /= tl;
    m.tz /= tl;
    p.x = wall.x + m.nx * PK.wallRunDist;
    p.z = wall.z + m.nz * PK.wallRunDist;
    p.y = ny;
    b.yaw = Math.atan2(m.tx, m.tz);
    b.vel.x = m.tx * m.speed;
    b.vel.z = m.tz * m.speed;
    // Ground under the feet: run off onto it
    const fl = floorAt(w, p.x, p.y + 0.5, p.z, 0.55);
    if (fl !== null && b.vel.y <= 0) {
      p.y = fl;
      b.vel.y = 0;
      this.end(b, true);
      this.wasGrounded = true;
      return true;
    }
    if (m.t >= PK.wallRunTime || b.vel.y < -7) return peel(1.2);
    return true;
  }

  private driveWallUp(dt: number, b: PkBody, i: PkInput, m: Extract<PkMove, { k: 'wallup' }>) {
    const w = this.w;
    const p = b.pos;
    m.t += dt;
    b.vel.y -= PK.gravity * 0.92 * dt;
    m.phase = (m.phase + dt * Math.max(1.2, b.vel.y) * 0.62) % 1;
    // Tic-tac: kick off the wall (A / D aim it sideways)
    if (i.jump && m.t > 0.08) {
      const rx = m.nz;
      const rz = -m.nx;
      const s = clamp(i.moveX, -1, 1);
      let kx = m.nx + rx * s * 0.9;
      let kz = m.nz + rz * s * 0.9;
      const kl = Math.hypot(kx, kz);
      kx /= kl;
      kz /= kl;
      b.vel.x = kx * PK.ticTacOut;
      b.vel.z = kz * PK.ticTacOut;
      b.vel.y = PK.ticTacUp;
      b.yaw = Math.atan2(kx, kz);
      this.memoN = { nx: m.nx, nz: m.nz };
      this.flip(0.6, 1, s >= 0 ? 1 : -1);
      this.sinceJump = 0;
      this.regrab = 0.15;
      b.emit({ type: 'tictac', power: 0.9 });
      this.end(b, false);
      return true;
    }
    if (i.duckPressed || i.release) {
      b.vel.x = m.nx * 1.5;
      b.vel.z = m.nz * 1.5;
      this.regrab = PK.regrabDelay;
      this.end(b, false);
      return true;
    }
    // Hands find a lip: grab it
    const l = findLedge(w, p.x, p.y, p.z, m.nx, m.nz, PK.grabMin + 0.1, PK.grabMax);
    if (l !== null && b.vel.y < 2.6) {
      this.startHang(b, l);
      b.emit({ type: 'grab', power: 0.6 });
      return true;
    }
    let ny = p.y + b.vel.y * dt;
    if (b.vel.y > 0 && w.ray(p.x, p.y + 1.4, p.z, 0, 1, 0, 0.5 + b.vel.y * dt) !== null) {
      b.vel.y = 0;
      ny = p.y;
    }
    const wall = wallAt(w, p.x, ny + 1.0, p.z, -m.nx, -m.nz, PK.wallUpReach + 0.4);
    if (wall === null) {
      // Ran out of wall without a lip (rare: an open top): push on over
      p.y = ny;
      b.vel.x = -m.nx * 1.5;
      b.vel.z = -m.nz * 1.5;
      this.end(b, false);
      return true;
    }
    m.nx = wall.nx;
    m.nz = wall.nz;
    // Close in on the wall over the first steps (jumped from a metre out)
    const k = m.t < 0.2 ? 1 - Math.exp(-16 * dt) : 1;
    p.x += (wall.x + wall.nx * PK.wallUpDist - p.x) * k;
    p.z += (wall.z + wall.nz * PK.wallUpDist - p.z) * k;
    p.y = ny;
    b.vel.x = b.vel.z = 0;
    b.yaw = Math.atan2(-m.nx, -m.nz);
    if (m.t >= PK.wallUpTime || b.vel.y < 0.4) {
      // Top of the run: keep going as a climb, or fall back off
      if (i.moveY > 0.3 && b.startClimb(m.nx, m.nz)) {
        this.move = null;
        return true;
      }
      b.vel.x = m.nx * 1.2;
      b.vel.z = m.nz * 1.2;
      b.vel.y = Math.min(b.vel.y, 0);
      this.regrab = 0.2;
      this.end(b, false);
    }
    return true;
  }

  private driveHang(dt: number, b: PkBody, i: PkInput, m: Hang) {
    const w = this.w;
    const p = b.pos;
    m.t += dt;
    const l = this.hangLedge;
    const rx = m.nz;
    const rz = -m.nx;
    const drop = (vx: number, vy: number, vz: number) => {
      b.vel.x = vx;
      b.vel.y = vy;
      b.vel.z = vz;
      this.regrab = PK.regrabDelay;
      this.end(b, false);
      return true;
    };
    if (i.release || (i.duckPressed && m.t > 0.1)) {
      b.emit({ type: 'drop', power: 0.3 });
      return drop(m.nx * 1.2, 0, m.nz * 1.2);
    }
    if (i.jump && m.t > 0.1 && l !== null) {
      // Back eject: S + jump turns and leaps away from the wall
      if (i.moveY < -0.5) {
        b.yaw = Math.atan2(m.nx, m.nz);
        this.flip(0.6, 1, 1);
        this.sinceJump = 0;
        b.emit({ type: 'walljump', power: 0.7 });
        return drop(m.nx * 4.6, 5.2, m.nz * 4.6);
      }
      const side = Math.abs(i.moveX) > 0.4 ? Math.sign(i.moveX) : 0;
      if (side === 0 && m.top) return this.startPullUp(b, m, l, 0.5);
      const target = findLeapTarget(w, l, side, side === 0 || i.moveY > 0.3 ? 1 : 0);
      if (target !== null) {
        const to: Hang = {
          k: 'hang',
          nx: target.nx,
          nz: target.nz,
          lx: target.x,
          ly: target.y,
          lz: target.z,
          shimmy: 0,
          phase: 0,
          t: 0,
          top: target.top,
        };
        this.hangLedge = target;
        const dist = Math.hypot(target.x - l.x, target.y - l.y, target.z - l.z);
        this.move = {
          k: 'leap',
          from: { x: p.x, y: p.y, z: p.z },
          to,
          t: 0,
          dur: PK.leapTime + dist * 0.05,
          arc: 0.25 + dist * 0.12,
          dx: side,
          dy: target.y > l.y + 0.3 ? 1 : 0,
        };
        b.emit({ type: 'leap', power: 0.6 });
        return true;
      }
      // Nothing to leap to: climb on up the wall if it carries on
      if (b.startClimb(m.nx, m.nz)) {
        this.move = null;
        return true;
      }
    }
    // Pull up (W)
    if (i.moveY > 0.5 && m.t > 0.18 && l !== null) {
      if (m.top) return this.startPullUp(b, m, l, PK.pullUpTime);
      if (m.t > 0.45 && b.startClimb(m.nx, m.nz)) {
        this.move = null;
        return true;
      }
    }
    // Shimmy (A / D)
    const want = Math.abs(i.moveX) > 0.2 ? i.moveX * PK.shimmySpeed : 0;
    m.shimmy += (want - m.shimmy) * (1 - Math.exp(-10 * dt));
    if (Math.abs(m.shimmy) > 0.02 && l !== null) {
      const step = m.shimmy * dt;
      const nxp = m.lx + rx * step;
      const nzp = m.lz + rz * step;
      // Probe a hand-width ahead so we stop before the end, not past it
      const s = Math.sign(step);
      const next = lipAt(w, l, nxp + rx * s * 0.3, nzp + rz * s * 0.3);
      if (next !== null && Math.abs(next.y - m.ly) < 0.35) {
        m.lx = nxp;
        m.lz = nzp;
        m.ly += (next.y - m.ly) * 0.5;
        m.top = next.top;
        this.hangLedge = { ...next, x: nxp, z: nzp, y: m.ly };
      } else m.shimmy = 0;
    }
    m.phase = (m.phase + Math.abs(m.shimmy) * dt * 1.4) % 1;
    const s = hangSpot({ x: m.lx, y: m.ly, z: m.lz, nx: m.nx, nz: m.nz });
    b.vel.x = (s.x - p.x) / dt;
    b.vel.y = 0;
    b.vel.z = (s.z - p.z) / dt;
    p.x = s.x;
    p.y = s.y;
    p.z = s.z;
    b.yaw = Math.atan2(-m.nx, -m.nz);
    b.grounded = false;
    return true;
  }

  private startPullUp(b: PkBody, m: Hang, l: Ledge, dur: number) {
    this.move = {
      k: 'pullup',
      from: { x: b.pos.x, y: b.pos.y, z: b.pos.z },
      to: { x: l.sx + (m.lx - l.x), y: l.sy, z: l.sz + (m.lz - l.z) },
      nx: m.nx,
      nz: m.nz,
      t: 0,
      dur,
    };
    b.emit({ type: 'pullup', power: 0.5 });
    return true;
  }

  private drivePole(dt: number, b: PkBody, i: PkInput, m: Extract<PkMove, { k: 'pole' }>) {
    const p = b.pos;
    m.t += dt;
    const R = m.r + PK.poleGap;
    const ox = Math.sin(m.ang);
    const oz = Math.cos(m.ang);
    if (i.release) {
      b.vel.x = ox * 1.2;
      b.vel.z = oz * 1.2;
      b.vel.y = Math.min(0, m.vy);
      this.poleCool = 0.5;
      this.end(b, false);
      return true;
    }
    if (i.jump && m.t > 0.08) {
      // Launch: outward, carried round by the swing, or where the stick points
      const tx = Math.cos(m.ang) * Math.sign(m.spin || 1);
      const tz = -Math.sin(m.ang) * Math.sign(m.spin || 1);
      const sw = Math.min(0.45, Math.abs(m.spin) / 7);
      let dx = ox + tx * sw;
      let dz = oz + tz * sw;
      const wl = Math.hypot(i.wishX, i.wishZ);
      if (wl > 0.3 && (i.wishX * ox + i.wishZ * oz) / wl > -0.3) {
        dx = i.wishX / wl;
        dz = i.wishZ / wl;
      }
      const dl = Math.hypot(dx, dz);
      dx /= dl;
      dz /= dl;
      // Pole to pole: another pole within ~35° of the launch gets aimed at
      const lx = m.cx + ox * (R + 0.08);
      const lz = m.cz + oz * (R + 0.08);
      const next = this.poleAhead(lx, p.y, lz, Math.atan2(dx, dz));
      const sp = PK.poleLaunchOut + Math.abs(m.spin) * R * 0.9;
      let vy = PK.poleLaunchUp;
      if (next !== null) {
        const ax = next.cx - lx;
        const az = next.cz - lz;
        const al = Math.hypot(ax, az);
        dx = ax / al;
        dz = az / al;
        // Arrive with the hands under its top (a lower pole: a flatter arc)
        const t = Math.max(0.3, (al - next.r - PK.poleGap) / sp);
        const want = Math.min(p.y, next.top - 1.9);
        vy = clamp((want - p.y) / t + 0.5 * PK.gravity * t, -2, PK.poleLaunchUp);
      }
      b.vel.x = dx * sp;
      b.vel.z = dz * sp;
      b.vel.y = vy;
      b.yaw = Math.atan2(dx, dz);
      // Out of the pole's reach before anything else can catch it
      p.x = lx;
      p.z = lz;
      this.poleCool = 0.45;
      this.flip(0.55, Math.abs(m.spin) > 2 ? 0 : 0.5, m.spin >= 0 ? 1 : -1);
      this.sinceJump = 0;
      b.emit({ type: 'poleLaunch', power: clamp(sp / 8, 0.5, 1) });
      this.end(b, false);
      return true;
    }
    // Swing round (A / D), keeping what momentum there is
    if (Math.abs(i.moveX) > 0.2) {
      const want = i.moveX * PK.poleSpinMax * 0.75;
      m.spin += (want - m.spin) * (1 - Math.exp(-3 * dt));
    } else m.spin *= Math.exp(-0.7 * dt);
    m.ang = (m.ang + m.spin * dt) % TAU;
    // Up / down: W climbs, S / duck slides fast, otherwise a steady slide
    const vyWant =
      i.moveY > 0.3 ? PK.poleClimb : i.duck || i.moveY < -0.3 ? -PK.poleSlideFast : -PK.poleSlide;
    m.vy += (vyWant - m.vy) * (1 - Math.exp(-(m.t < 0.3 ? 3 : 6) * dt));
    let y = p.y + m.vy * dt;
    const maxY = m.top - 1.45;
    if (y > maxY) {
      y = maxY;
      m.vy = Math.min(0, m.vy);
    }
    const nx = m.cx + Math.sin(m.ang) * R;
    const nz = m.cz + Math.cos(m.ang) * R;
    b.vel.x = (nx - p.x) / dt;
    b.vel.y = m.vy;
    b.vel.z = (nz - p.z) / dt;
    p.x = nx;
    p.z = nz;
    p.y = y;
    // Face the pole, turned a touch into the swing
    b.yaw = Math.atan2(-Math.sin(m.ang), -Math.cos(m.ang)) - clamp(m.spin * 0.08, -0.4, 0.4);
    // Bottom: step off, carrying a little of the swing
    const fl = floorAt(this.w, p.x, p.y + 0.5, p.z, 0.55);
    if (fl !== null && m.vy <= 0) {
      p.y = fl;
      const tx = Math.cos(m.ang);
      const tz = -Math.sin(m.ang);
      b.vel.x = tx * m.spin * R * 0.5 + ox * 0.6;
      b.vel.z = tz * m.spin * R * 0.5 + oz * 0.6;
      b.vel.y = 0;
      this.poleCool = 0.6;
      this.end(b, true);
      this.wasGrounded = true;
      b.emit({ type: 'step', power: 0.4 });
    }
    return true;
  }

  /** Slide + roll: low, fast along the ground. */
  private driveLow(dt: number, b: PkBody, i: PkInput, m: Extract<PkMove, { k: 'slide' | 'roll' }>) {
    const w = this.w;
    const p = b.pos;
    m.t += dt;
    const roll = m.k === 'roll';
    const headroom = w.ray(p.x, p.y + 0.5, p.z, 0, 1, 0, PK.height - 0.4) === null;
    if (!roll) {
      // Steer a little
      if (Math.abs(i.moveX) > 0.2) {
        const a = Math.atan2(m.dx, m.dz) - i.moveX * 0.9 * dt;
        m.dx = Math.sin(a);
        m.dz = Math.cos(a);
      }
      m.speed = Math.max(0, m.speed - PK.slideFriction * dt);
      if (!headroom) m.speed = Math.max(m.speed, 1.6);
      // Slide jump
      if (i.jump && m.t > 0.1 && headroom) {
        const sp = Math.max(m.speed, 5.8) * 1.04;
        b.vel.x = m.dx * sp;
        b.vel.z = m.dz * sp;
        b.vel.y = 5.3;
        this.sinceJump = 0;
        b.emit({ type: 'leap', power: 0.5 });
        this.end(b, false);
        return true;
      }
    } else m.speed *= Math.exp(-0.25 * dt);
    const nx = p.x + m.dx * m.speed * dt;
    const nz = p.z + m.dz * m.speed * dt;
    // Low body: only what's below the waist stops us
    const c = w.push(nx, p.y + 0.34, nz, nx, p.y + PK.slideHeight - 0.3, nz, 0.3);
    p.x = nx + c.x;
    p.z = nz + c.z;
    const ch = Math.hypot(c.x, c.z);
    if (ch > 1e-3 && (c.x * m.dx + c.z * m.dz) / ch < -0.7) m.speed *= 0.2;
    const fl = floorAt(w, p.x, p.y + 0.6, p.z, 1.05);
    if (fl === null) {
      // Off an edge: fly on
      b.vel.x = m.dx * m.speed;
      b.vel.z = m.dz * m.speed;
      b.vel.y = 0;
      this.end(b, false);
      return true;
    }
    p.y = fl;
    b.vel.x = m.dx * m.speed;
    b.vel.z = m.dz * m.speed;
    b.vel.y = 0;
    b.grounded = true;
    b.yaw = Math.atan2(m.dx, m.dz);
    const done = roll
      ? m.t >= PK.rollTime
      : (m.t >= PK.slideTime && !i.duck) || m.t > 1.8 || m.speed < 2.0;
    if (done && headroom) this.end(b, true);
    return true;
  }

  // ── What the rig shows ────────────────────────────────────────────────

  private pickAnim(dt: number, b: PkBody): PkAnim {
    const m = this.move;
    if (m !== null) {
      switch (m.k) {
        case 'wallrun':
          return { kind: 'wallrun', phase: m.phase, side: m.side, amt: clamp(m.speed / 8, 0, 1) };
        case 'wallup':
          return { kind: 'wallup', phase: m.phase, side: 1, amt: clamp(m.t / PK.wallUpTime, 0, 1) };
        case 'hang':
          return {
            kind: 'hang',
            phase: m.phase,
            side: m.shimmy >= 0 ? 1 : -1,
            amt: clamp(Math.abs(m.shimmy) / PK.shimmySpeed, 0, 1),
          };
        case 'pullup':
          return { kind: 'pullup', phase: clamp(m.t / m.dur, 0, 1), side: 1, amt: 0 };
        case 'leap':
          return {
            kind: 'leap',
            phase: clamp(m.t / m.dur, 0, 1),
            side: m.dx < 0 ? -1 : 1,
            amt: m.dy > 0 ? 1 : 0,
          };
        case 'pole':
          return {
            kind: 'pole',
            phase: (((m.ang / TAU) % 1) + 1) % 1,
            side: m.spin >= 0 ? 1 : -1,
            amt: clamp(-m.vy / PK.poleSlideFast, 0, 1),
          };
        case 'slide':
          return {
            kind: 'slide',
            phase: clamp(m.t / PK.slideTime, 0, 1),
            side: 1,
            amt: clamp(m.speed / 8, 0, 1),
          };
        case 'roll':
          return { kind: 'roll', phase: clamp(m.t / PK.rollTime, 0, 1), side: 1, amt: 0 };
        case 'stumble':
          return { kind: 'stumble', phase: clamp(m.t / m.dur, 0, 1), side: 1, amt: 0 };
      }
    }
    if (!b.grounded && this.flipT > 0)
      return {
        kind: 'flip',
        phase: 1 - this.flipT / this.flipDur,
        side: this.flipSide,
        amt: this.flipKind,
      };
    if (!b.grounded && this.gapT > 0) {
      this.gapT = Math.max(0, this.gapT - dt);
      this.gait = (this.gait + dt * 1.6) % 1;
      return { kind: 'leap', phase: this.gait, side: 1, amt: 0.5 };
    }
    if (b.grounded && this.stickT > 0)
      return { kind: 'stick', phase: 1 - this.stickT / 0.4, side: 1, amt: 0 };
    if (b.grounded && this.narrow) {
      this.gait = (this.gait + dt * 0.5) % 1;
      return {
        kind: 'balance',
        phase: this.gait,
        side: 1,
        amt: clamp(Math.hypot(b.vel.x, b.vel.z) / 2, 0, 1),
      };
    }
    return NO_ANIM;
  }
}
