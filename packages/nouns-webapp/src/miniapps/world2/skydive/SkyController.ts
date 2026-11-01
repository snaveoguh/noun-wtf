// ── Skydiving on the Player (no Game, no three.js scene) ─────────────────
//
// The hook skate/Player calls as `player.sky`, first in every step (on
// foot before parkour, so a parkour catch ends the skydive next step). It
// decides when a fall becomes a skydive (sim/freefall.ts `shouldEnter`,
// with the clear air under the rider from a ray down and "anything to
// catch" from parkour's own detection), shapes the velocity through the
// sim, and ends when the rider lands, grabs something, or the game turns
// it off (`allowed`). Kept apart from SkydiveSystem so tests can run it
// with the real Player and parkour motor.

import type { InputFrame } from '../core/Input';
import type { PkWorld } from '../parkour/contract';
import type { CollisionWorld } from '../physics/Collision';
import type { Player } from '../skate/Player';

import * as THREE from 'three';

import { PK } from '../parkour/contract';
import { wallAt } from '../parkour/sim/detect';

import { SKY, type SkyInput } from './contract';
import { canPull, end, enter, newSky, pull, shouldEnter, stepSky } from './sim/freefall';

export type SkyEvent =
  | { type: 'enter' }
  | { type: 'pull' }
  /** Pressed pull too low (or not falling yet). */
  | { type: 'tooLow' }
  /** Back on the ground (or a wall / ledge): `canopy` = under an open canopy. */
  | { type: 'land'; canopy: boolean; impact: number }
  /** Caught something on the way down (parkour, a climb). */
  | { type: 'caught' };

const DOWN = new THREE.Vector3(0, -1, 0);
const _o = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
/** How far down the clear-air probe looks (m). */
const PROBE = 2000;
/** Directions round the rider for the "anything to catch" check. */
const DIRS = Array.from({ length: 8 }, (_, k) => [
  Math.sin((k * Math.PI) / 4),
  Math.cos((k * Math.PI) / 4),
]);

export class SkyController {
  readonly s = newSky();
  /** The game turns freefall off here (Big Drop, vehicles, modes…). */
  allowed = true;
  /** Clear air under the feet at the last step (m; Infinity = nothing below). */
  clear = Infinity;
  /** Events since the owner last cleared them. */
  readonly events: SkyEvent[] = [];
  /** A touch PULL button press, consumed by the next step. */
  pullQueued = false;
  /** Seconds airborne (this fall). */
  private airT = 0;
  private lastRespawns = -1;
  private lastVy = 0;
  private input: SkyInput = { moveX: 0, moveY: 0, dive: false, pull: false };

  /** What skate/Player calls (`player.sky`). */
  readonly hook: { step(dt: number, f: InputFrame): void; readonly active: boolean };

  constructor(
    private world: CollisionWorld,
    private pk: PkWorld,
    private p: Player,
    /** A parkour move holds the rider (a hang, a wall run, a pole…). */
    private parkourBusy: () => boolean = () => false,
  ) {
    const s = this.s;
    this.hook = {
      step: (dt, f) => this.step(dt, f),
      get active() {
        return s.phase !== 'off';
      },
    };
  }

  /** Hook into the Player (idempotent). */
  attach() {
    if (this.p.sky !== this.hook) this.p.sky = this.hook;
  }

  get phase() {
    return this.s.phase;
  }

  /** Can freefall start here on a board? Not on the mountain or the mega ramps: their airs are records. */
  private boardOk() {
    const p = this.p;
    const t = p.terrain;
    if (t === null) return true;
    if (t.inDomain(p.pos.x, p.pos.z)) return false;
    return !Number.isFinite(t.speedLimit?.(p.pos.x, p.pos.y, p.pos.z) ?? Infinity);
  }

  /** Off the ground and free (not climbing, vaulting, hanging, on a parkour move). */
  private airborne() {
    const p = this.p;
    if (p.mode === 'board') return p.state === 'air';
    return !p.footGrounded && p.climb === null && p.vault === null && !this.parkourBusy();
  }

  private probeClear() {
    const p = this.p;
    const h = this.world.raycast(_o.copy(p.pos).addScaledVector(UP, 0.1), DOWN, PROBE);
    return h === null ? Infinity : Math.max(0, h.distance - 0.1);
  }

  /**
   * Anything parkour could catch within reach: a wall at the hands in any
   * direction (detect.ts wallAt, the motor's own ray), or anything at all
   * (a pole, a rail) round the body.
   */
  catchable() {
    const { x, y, z } = this.p.pos;
    const r = SKY.catchReach;
    for (const [dx, dz] of DIRS) {
      if (wallAt(this.pk, x, y + 1.0, z, dx, dz, r) !== null) return true;
      if (wallAt(this.pk, x, y + 1.6, z, dx, dz, r) !== null) return true;
    }
    const c = this.pk.push(x, y + 0.2, z, x, y + PK.height + 0.8, z, r);
    return c.x * c.x + c.y * c.y + c.z * c.z > 1e-6;
  }

  private get yaw() {
    const p = this.p;
    return p.mode === 'foot' ? p.footYaw : Math.atan2(p.fwd.x, p.fwd.z);
  }

  private set yaw(v: number) {
    const p = this.p;
    if (p.mode === 'foot') {
      p.footYaw = v;
      return;
    }
    const d = v - Math.atan2(p.fwd.x, p.fwd.z);
    if (Math.abs(d) < 1e-9) return;
    p.fwd.applyQuaternion(_q.setFromAxisAngle(UP, d));
  }

  private stop(landed: boolean) {
    const s = this.s;
    if (s.phase === 'off') return;
    if (landed)
      this.events.push({ type: 'land', canopy: s.phase === 'canopy', impact: -this.lastVy });
    else this.events.push({ type: 'caught' });
    end(s);
  }

  step(dt: number, f: InputFrame) {
    const p = this.p;
    const s = this.s;
    if (p.respawns !== this.lastRespawns) {
      this.lastRespawns = p.respawns;
      if (s.phase !== 'off') end(s);
      this.airT = 0;
    }
    if (!this.allowed) {
      if (s.phase !== 'off') end(s);
      this.airT = 0;
      this.pullQueued = false;
      return;
    }
    if (!this.airborne()) {
      const grounded = p.mode === 'board' ? p.state !== 'air' : p.footGrounded;
      this.stop(grounded);
      this.airT = 0;
      this.clear = this.probeClear();
      this.pullQueued = false;
      return;
    }
    this.airT += dt;
    this.clear = this.probeClear();
    const queued = this.pullQueued;
    this.pullQueued = false;
    if (s.phase === 'off') {
      if (p.mode === 'board' && !this.boardOk()) return;
      const go = shouldEnter({
        airborne: true,
        vy: p.vel.y,
        airT: this.airT,
        clear: this.clear,
        catchable: false,
      });
      // The rays only once everything else says yes
      if (!go || this.catchable()) return;
      enter(s, p.vel.y);
      this.events.push({ type: 'enter' });
    }
    const i = this.input;
    i.moveX = f.moveX;
    i.moveY = f.moveY;
    i.dive = f.sprint;
    i.pull = f.jumpPressed || queued;
    if (i.pull && s.phase === 'freefall') {
      if (canPull(s, this.clear)) {
        pull(s);
        this.events.push({ type: 'pull' });
      } else this.events.push({ type: 'tooLow' });
    }
    this.yaw = stepSky(s, p.vel, this.yaw, i, dt);
    this.lastVy = p.vel.y - SKY.gravity * dt;
  }
}
