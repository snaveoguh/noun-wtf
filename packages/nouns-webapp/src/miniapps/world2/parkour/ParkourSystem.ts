// ── Parkour in Noun World: the glue between the engine and the game ──────
//
// Owns the motor (sim/motor.ts) and hooks it into skate/Player as
// `player.parkour`: it runs first in every on-foot physics step. Each frame
// it poses the local rider (view/ParkourRig.ts) over the clip Game picked,
// feeds the camera its feel (wall-run tilt, gap-jump FOV, climb framing),
// turns move events into sound / dust / shake, and poses remote riders
// from the `pk` key in their pose blob. NOUN PARKOUR (game/) runs on top.

import type { NounCharacter } from '../character/NounCharacter';
import type { InputFrame } from '../core/Input';
import type { Game } from '../Game';
import type { Player } from '../skate/Player';

import * as THREE from 'three';

import { NO_ANIM, type PkAnim, type PkBody, type PkEvent, type PkInput } from './contract';
import { ParkourCourse } from './game/ParkourCourse';
import { decodePk, encodePk, PkSmoother } from './net/pk';
import { ParkourMotor } from './sim/motor';
import { ParkourRig } from './view/ParkourRig';
import { CollisionPkWorld } from './world';

const TAU = Math.PI * 2;
/** The Player's mantle time (skate/Player.ts MANTLE_TIME). */
const MANTLE_TIME = 0.55;

/** Camera feel the parkour layer asks of SkateCamera (see its `pkCam`). */
export interface PkCam {
  /** Extra vertical FOV (deg). */
  fov: number;
  /** Camera roll (rad): tilts into a wall run. */
  roll: number;
  /** Extra distance behind (m) and target height (m). */
  dist: number;
  lift: number;
  /** 0..1 climb framing (low, pulled back, looking up the wall). */
  climb: number;
  /** World yaw to settle behind (null: leave it to the player). */
  yaw: number | null;
  /** World offset of the camera itself (off the wall in a wall run). */
  ox: number;
  oz: number;
}

/** The clip under each parkour pose (what older clients see, and the blend base). */
const CLIP: Record<PkAnim['kind'], string> = {
  none: 'idle',
  wallrun: 'sprint',
  wallup: 'run',
  climb: 'walk',
  mantle: 'jump_air',
  hang: 'jump_air',
  pullup: 'jump_air',
  pole: 'jump_air',
  vault: 'jump_air',
  slide: 'fall',
  roll: 'jump_air',
  stumble: 'fall',
  flip: 'jump_air',
  balance: 'idle',
  leap: 'jump_air',
  stick: 'idle',
};

/** Player on foot → the engine's body. */
class PlayerBody implements PkBody {
  constructor(
    private p: Player,
    private onEvent: (e: PkEvent) => void,
  ) {}
  get pos() {
    return this.p.pos;
  }
  get vel() {
    return this.p.vel;
  }
  get yaw() {
    return this.p.footYaw;
  }
  set yaw(v: number) {
    this.p.footYaw = v;
  }
  get grounded() {
    return this.p.footGrounded;
  }
  set grounded(v: boolean) {
    this.p.footGrounded = v;
    if (v) {
      this.p.safePos.copy(this.p.pos);
      this.p.safeFwd.set(Math.sin(this.p.footYaw), 0, Math.cos(this.p.footYaw));
    }
  }
  get climbing() {
    return this.p.climb !== null;
  }
  get vaulting() {
    return this.p.vault !== null;
  }
  get respawns() {
    return this.p.respawns;
  }
  startClimb(nx: number, nz: number) {
    return this.p.tryStartClimb(new THREE.Vector3(nx, 0, nz));
  }
  startVault(nx: number, nz: number, carry: number) {
    return this.p.tryStartVault(new THREE.Vector3(nx, 0, nz), carry);
  }
  emit(e: PkEvent) {
    this.onEvent(e);
  }
}

interface RemotePk {
  rig: ParkourRig;
  smooth: PkSmoother;
  ch: NounCharacter;
}

export class ParkourSystem {
  readonly world: CollisionPkWorld;
  readonly motor: ParkourMotor;
  /** NOUN PARKOUR: routes, checkpoints, ghosts. */
  readonly course: ParkourCourse;
  /** The local rider's anim this frame (moves + the Player's climb / vault). */
  anim: PkAnim = NO_ANIM;
  /** Events this frame (the course reads them for its HUD). */
  readonly events: PkEvent[] = [];
  private body: PlayerBody | null = null;
  private rig: ParkourRig | null = null;
  private rigFor: NounCharacter | null = null;
  private remotes = new Map<string, RemotePk>();
  private cam: PkCam = { fov: 0, roll: 0, dist: 0, lift: 0, climb: 0, yaw: null, ox: 0, oz: 0 };
  private gapCam = 0;
  /** Did the hook run this frame / last frame (a gap means the rider was on the board). */
  private stepped = false;
  private steppedPrev = false;
  private input: PkInput = {
    moveX: 0,
    moveY: 0,
    wishX: 0,
    wishZ: 0,
    sprint: false,
    jump: false,
    jumpHeld: false,
    duck: false,
    duckPressed: false,
    release: false,
  };

  /** The hook skate/Player calls first in every on-foot step. */
  readonly hook = {
    step: (dt: number, f: InputFrame, camYaw: number) => this.stepPlayer(dt, f, camYaw),
    busy: () => this.motor.busy,
  };

  constructor(private game: Game) {
    this.world = new CollisionPkWorld(game.world);
    this.motor = new ParkourMotor(this.world);
    this.course = new ParkourCourse(game, this);
  }

  /** Hook into the Player (idempotent; the Player is made after this system). */
  private attach() {
    const p = this.game.player;
    if (p === undefined || p.parkour === this.hook) return;
    p.parkour = this.hook;
    this.body = new PlayerBody(p, e => this.onEvent(e));
  }

  private stepPlayer(dt: number, f: InputFrame, camYaw: number): boolean {
    const p = this.game.player;
    if (this.body === null) return false;
    if (!this.stepped && !this.steppedPrev) this.motor.resync(this.body);
    this.stepped = true;
    const i = this.input;
    i.moveX = f.moveX;
    i.moveY = f.moveY;
    const mag = Math.min(1, Math.hypot(f.moveX, f.moveY));
    if (f.mode === 'keyboard') {
      const s = Math.abs(f.moveY) > 0.05 ? Math.sign(f.moveY) : 0;
      i.wishX = Math.sin(p.footYaw) * s;
      i.wishZ = Math.cos(p.footYaw) * s;
    } else {
      const fx = Math.sin(camYaw);
      const fz = Math.cos(camYaw);
      i.wishX = fx * f.moveY - fz * f.moveX;
      i.wishZ = fz * f.moveY + fx * f.moveX;
    }
    i.sprint = f.sprint || (f.mode !== 'keyboard' && mag > 0.85);
    i.jump = f.jumpPressed;
    i.jumpHeld = f.crouch;
    i.duck = f.duck === true;
    i.duckPressed = f.duckPressed === true;
    i.release = f.boardTogglePressed;
    return this.motor.step(dt, this.body, i);
  }

  private onEvent(e: PkEvent) {
    this.events.push(e);
    const g = this.game;
    const p = g.player;
    switch (e.type) {
      case 'wallrun':
      case 'wallup':
      case 'grab':
      case 'pole':
      case 'pullup':
      case 'step':
        g.audio.footstep();
        break;
      case 'walljump':
      case 'tictac':
      case 'poleLaunch':
      case 'leap':
        g.audio.land(2 + e.power * 2);
        g.particles.dustAt(p.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0.3 * e.power);
        break;
      case 'slide':
        g.audio.land(2);
        g.particles.dustAt(p.pos, 0.5);
        break;
      case 'roll':
        g.audio.land(3 + e.power * 3);
        g.particles.dustAt(p.pos, 0.6 * e.power);
        g.cam.addShake(0.15 * e.power);
        break;
      case 'stumble':
        g.audio.land(6 + e.power * 4);
        g.particles.dustAt(p.pos, 1);
        g.cam.addShake(0.5 * e.power);
        break;
      case 'stick':
        g.audio.land(2.5);
        break;
      case 'gap':
        this.gapCam = 1;
        g.audio.footstep();
        break;
      default:
        break;
    }
  }

  /** The anim for the local rider: the motor's moves, else the Player's climb / vault. */
  private localAnim(): PkAnim {
    const p = this.game.player;
    const m = this.motor.anim;
    if (m.kind !== 'none') return m;
    if (p.mode !== 'foot') return NO_ANIM;
    if (p.climb !== null) {
      const c = p.climb;
      if (c.mantle !== null)
        return { kind: 'mantle', phase: Math.min(1, c.mantle.t / MANTLE_TIME), side: 1, amt: 0 };
      return {
        kind: 'climb',
        phase: (((c.phase / TAU) % 1) + 1) % 1,
        side: 1,
        amt: Math.min(1, c.moving),
      };
    }
    if (p.vault !== null) {
      const v = p.vault;
      const kong = v.kind === 'over' && v.far - v.near > 0.55;
      return { kind: 'vault', phase: v.k, side: v.kind === 'over' ? 1 : -1, amt: kong ? 1 : 0 };
    }
    return NO_ANIM;
  }

  /** Clip for Game.pickAnim while a motor move shows (null: Game picks as usual). */
  clip(): { clip: string; fade: number } | null {
    const k = this.motor.anim.kind;
    if (k === 'none' || this.game.player.mode !== 'foot') return null;
    return { clip: CLIP[k], fade: 0.12 };
  }

  /** The `pk` key for my pose blob (undefined: nothing to send). */
  netKey(): number[] | undefined {
    return encodePk(this.anim) ?? undefined;
  }

  /**
   * Once a frame, after the local character is updated: pose it, set the
   * camera feel, run the course. Remote riders are posed in `remote`.
   */
  frame(dt: number, input: InputFrame) {
    this.attach();
    this.steppedPrev = this.stepped;
    this.stepped = false;
    const g = this.game;
    this.motor.enabled = !g.missions.ud.active;
    this.anim = this.localAnim();
    const me = g.me;
    if (me !== null) {
      if (this.rigFor !== me) {
        this.rig = new ParkourRig(me);
        this.rigFor = me;
      }
      this.rig!.update(dt, this.anim);
    }
    this.updateCam(dt);
    this.course.update(dt, input);
    this.events.length = 0;
  }

  private updateCam(dt: number) {
    const p = this.game.player;
    const a = this.anim;
    const m = this.motor.move;
    const want: PkCam = { fov: 0, roll: 0, dist: 0, lift: 0, climb: 0, yaw: null, ox: 0, oz: 0 };
    this.gapCam = Math.max(0, this.gapCam - dt / 1.3);
    if (this.gapCam > 0 && !p.footGrounded) {
      want.fov += 11 * this.gapCam;
      want.dist += 1.4 * this.gapCam;
      want.lift += 0.6 * this.gapCam;
    }
    switch (a.kind) {
      case 'wallrun':
        want.roll = -a.side * 0.13;
        want.fov += 7;
        want.dist += 0.5;
        // Swing the camera out off the wall so the runner reads against it
        if (m !== null && m.k === 'wallrun') {
          want.ox = m.nx * 1.6;
          want.oz = m.nz * 1.6;
        }
        break;
      case 'wallup':
      case 'hang':
      case 'pullup':
      case 'leap':
        want.climb = a.kind === 'leap' && a.amt === 0.5 ? 0 : 1;
        if (m !== null && m.k === 'hang') want.yaw = Math.atan2(-m.nx, -m.nz) + 0.42;
        if (m !== null && m.k === 'wallup') want.yaw = Math.atan2(-m.nx, -m.nz) + 0.3;
        break;
      case 'pole':
        want.dist += 0.9;
        want.fov += 4;
        want.lift += 0.3;
        break;
      case 'slide':
        want.fov += 9;
        want.lift -= 0.4;
        break;
      case 'flip':
        want.fov += 5;
        want.dist += 0.5;
        break;
      default:
        break;
    }
    const k = 1 - Math.exp(-6 * dt);
    const c = this.cam;
    c.fov += (want.fov - c.fov) * k;
    c.roll += (want.roll - c.roll) * (1 - Math.exp(-4 * dt));
    c.dist += (want.dist - c.dist) * k;
    c.lift += (want.lift - c.lift) * k;
    c.ox += (want.ox - c.ox) * k;
    c.oz += (want.oz - c.oz) * k;
    c.climb = want.climb;
    c.yaw = want.yaw;
    this.game.cam.pkCam = c;
  }

  /** Pose a remote rider from their blob's `pk` (call after their character update). */
  remote(id: string, ch: NounCharacter, pk: unknown, dt: number) {
    const a = decodePk(pk);
    let r = this.remotes.get(id);
    if (r !== undefined && r.ch !== ch) {
      this.remotes.delete(id);
      r = undefined;
    }
    if (r === undefined) {
      if (a === null) return;
      r = { rig: new ParkourRig(ch), smooth: new PkSmoother(), ch };
      this.remotes.set(id, r);
    }
    r.smooth.feed(a, performance.now());
    const s = r.smooth.step(dt);
    r.rig.update(dt, s ?? NO_ANIM);
    if (s === null && !r.rig.active) this.remotes.delete(id);
  }

  dropRemote(id: string) {
    this.remotes.delete(id);
  }

  dispose() {
    this.course.dispose();
    this.remotes.clear();
  }
}
