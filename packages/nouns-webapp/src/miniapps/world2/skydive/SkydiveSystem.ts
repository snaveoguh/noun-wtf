// ── Skydiving in Noun World: the glue between the engine and the game ────
//
// Owns the controller (SkyController: when a fall becomes a skydive, the
// physics, the parachute) hooked into skate/Player as `player.sky`. Each
// frame: turns it off where it doesn't belong (the Big Drop, vehicles,
// hoops / breaks / pool, rooms, cutscenes, replays), poses the rider
// (view/SkyRig), places the canopy, feeds the camera (SkateCamera.skyCam:
// pulled back and above, FOV with speed, a buffet near terminal), runs the
// wind and the streaks, the HUD (altimeter, PULL), and sends / draws the
// `sk` pose key so others see you fall and fly.

import type { NounCharacter } from '../character/NounCharacter';
import type { InputFrame } from '../core/Input';
import type { Game } from '../Game';

import * as THREE from 'three';

import { SkyWind } from './audio';
import { SKY } from './contract';
import { decodeSk, encodeSk, NO_SKY, type SkyAnim } from './net/sk';
import { SkyController } from './SkyController';
import { SkyHud } from './SkyHud';
import { Canopy } from './view/Canopy';
import { SkyRig } from './view/SkyRig';
import { Streaks } from './view/Streaks';

/** What SkateCamera reads (see its `skyCam`). */
export interface SkyCam {
  /** 0..1 blend into the skydive framing. */
  k: number;
  /** World yaw to settle behind. */
  yaw: number;
  dist: number;
  pitch: number;
  lift: number;
  fov: number;
}

interface RemoteSky {
  rig: SkyRig;
  canopy: Canopy | null;
  ch: NounCharacter;
  anim: SkyAnim;
  open: number;
}

const _f = new THREE.Vector3();

const HINTS = {
  keyboard: {
    freefall:
      '<b>W</b> track · <b>S</b> flare · <b>SHIFT</b> dive · <b>A/D</b> turn · <b>SPACE</b> pull',
    canopy: '<b>A/D</b> steer · <b>W</b> faster · <b>S</b> brake',
    pull: 'SPACE',
  },
  gamepad: {
    freefall: 'stick: track · flare · turn · <b>L3</b> dive · <b>A</b> pull',
    canopy: 'stick: steer · faster · brake',
    pull: 'Ⓐ',
  },
  touch: {
    freefall: 'stick: track · flare · turn · <b>RUN</b> dive · <b>PULL</b>',
    canopy: 'stick: steer · faster · brake',
    pull: 'TAP PULL',
  },
} as const;

export class SkydiveSystem {
  ctl: SkyController | null = null;
  /** The local rider's skydive anim this frame. */
  anim: SkyAnim = NO_SKY;
  private rig: SkyRig | null = null;
  private canopy: Canopy | null = null;
  private streaks: Streaks | null = null;
  private wind: SkyWind;
  private hud: SkyHud | null = null;
  private remotes = new Map<string, RemoteSky>();
  private cam: SkyCam = { k: 0, yaw: 0, dist: 0, pitch: 0, lift: 0, fov: 0 };
  private mode: InputFrame['mode'] = 'keyboard';
  private lowFlash = 0;

  constructor(private game: Game) {
    this.wind = new SkyWind(game.audio);
  }

  /** Hook into the Player (idempotent; the Player is made after this system). */
  private attach() {
    const g = this.game;
    if (g.player === undefined) return;
    if (this.ctl === null)
      this.ctl = new SkyController(g.world, g.parkour.world, g.player, () => g.parkour.motor.busy);
    this.ctl.attach();
  }

  /** Is freefall allowed right now (applies from the next physics step)? */
  private allowed(): boolean {
    const g = this.game;
    return !(
      g.missions.ud.active ||
      g.van2.driving ||
      g.cars.inCar ||
      g.dragon.riding ||
      g.hoops.active ||
      g.breaks.active ||
      g.pool.active ||
      g.freestyle.active ||
      g.interiors.inside ||
      g.cutscene.active ||
      g.replay.active
    );
  }

  /** The `sk` key for my pose blob (undefined: nothing to send). */
  netKey(): number[] | undefined {
    return encodeSk(this.anim) ?? undefined;
  }

  /** Once a frame, after the local character is updated (and parkour's frame). */
  frame(dt: number, input: InputFrame) {
    this.attach();
    const ctl = this.ctl;
    if (ctl === null) return;
    const g = this.game;
    const p = g.player;
    this.mode = input.mode;
    ctl.allowed = this.allowed();
    this.onEvents();
    const s = ctl.s;
    this.anim =
      s.phase === 'off'
        ? NO_SKY
        : { phase: s.phase, posture: s.posture, open: s.open, steer: s.steer };
    const board = p.mode === 'board';
    const yaw = board ? Math.atan2(p.fwd.x, p.fwd.z) : p.footYaw;

    // The rider
    const me = g.me;
    if (me !== null) {
      if (this.rig?.ch !== me) this.rig = new SkyRig(me);
      this.rig.update(dt, this.anim, board);
    }
    // The canopy
    if (s.phase === 'canopy' && this.canopy === null) this.canopy = new Canopy(g.gfx.scene);
    if (this.canopy !== null) {
      if (s.phase === 'canopy') this.canopy.place(dt, p.pos, yaw, s.open, s.steer);
      else this.canopy.hide();
    }

    const speed = p.vel.length();
    const fall = Math.max(0, -p.vel.y);
    const reduced = g.cam.shakeScale === 0;
    // Camera
    const c = this.cam;
    const on = s.phase !== 'off';
    c.k += ((on ? 1 : 0) - c.k) * (1 - Math.exp(-(on ? 2 : 4) * dt));
    if (on) {
      c.yaw = yaw;
      if (s.phase === 'freefall') {
        // Behind and a little above, like the fall camera today: the city
        // and the tower stay in the frame, the ground below too
        c.dist = 6.5;
        c.pitch = 0.4;
        c.lift = 0.5;
        c.fov = Math.min(20, fall * 0.26);
      } else {
        c.dist = 8.5;
        c.pitch = 0.12;
        c.lift = 2.4;
        c.fov = 4;
      }
    }
    g.cam.skyCam = c.k > 0.01 ? c : null;
    // Buffet near terminal (addShake is scaled to 0 under reduce motion)
    if (s.phase === 'freefall') {
      const near = fall / s.vt;
      if (near > 0.8) g.cam.addShake(0.025 * Math.min(1, (near - 0.8) / 0.2));
    }
    // Wind + streaks
    const windK = s.phase === 'freefall' ? Math.min(1, fall / 45) : s.phase === 'canopy' ? 0.12 : 0;
    this.wind.update(windK, speed);
    if (this.streaks === null && on && !reduced) this.streaks = new Streaks(g.gfx.scene);
    this.streaks?.update(
      s.phase === 'freefall' && !reduced ? Math.min(1, fall / 30) : 0,
      p.pos,
      p.vel,
    );
    this.updateHud(dt);
  }

  private onEvents() {
    const ctl = this.ctl!;
    const g = this.game;
    const p = g.player;
    for (const e of ctl.events) {
      switch (e.type) {
        case 'pull':
          g.sfx.play('whoosh', { gain: 0.8 });
          g.cam.addShake(0.35);
          break;
        case 'tooLow':
          this.lowFlash = 1.2;
          break;
        case 'land':
          if (e.canopy) {
            g.audio.land(2);
            g.particles.dustAt(p.pos, 0.4);
          }
          break;
        default:
          break;
      }
    }
    ctl.events.length = 0;
  }

  private updateHud(dt: number) {
    const ctl = this.ctl!;
    const s = ctl.s;
    const p = this.game.player;
    if (this.hud === null) {
      const parent = this.game.gfx.renderer.domElement.parentElement;
      if (parent === null || s.phase === 'off') return;
      this.hud = new SkyHud(
        parent,
        () => (ctl.pullQueued = true),
        HINTS.keyboard.pull,
        'DUCK TO ROLL',
      );
    }
    this.lowFlash = Math.max(0, this.lowFlash - dt);
    const on = s.phase !== 'off';
    const alt = Number.isFinite(ctl.clear) ? ctl.clear : p.pos.y;
    const scale = 160;
    const ff = s.phase === 'freefall';
    const canPull = ff && alt >= SKY.pullMin;
    const h = HINTS[this.mode] ?? HINTS.keyboard;
    let prompt: '' | 'pull' | 'low' = '';
    if (ff && canPull && alt < SKY.pullPrompt) prompt = 'pull';
    else if (ff && (this.lowFlash > 0 || alt < SKY.pullMin)) prompt = 'low';
    this.hud.update({
      on,
      freefall: ff,
      alt,
      kmh: Math.max(0, -p.vel.y) * 3.6,
      bar: Math.min(1, alt / scale),
      floor: SKY.pullMin / scale,
      hint: !on ? '' : ff ? h.freefall : h.canopy,
      prompt,
      touch: this.mode === 'touch',
      ready: canPull,
    });
    if (this.hud !== null) {
      const pk = this.hud.root.querySelector('.w2sky-pull small');
      if (pk !== null && prompt === 'pull' && pk.textContent !== h.pull) pk.textContent = h.pull;
    }
  }

  /** Pose a remote rider from their blob's `sk` (after their character update). */
  remote(id: string, ch: NounCharacter, sk: unknown, board: boolean, dt: number) {
    const a = decodeSk(sk);
    let r = this.remotes.get(id);
    if (r !== undefined && r.ch !== ch) {
      r.canopy?.dispose();
      this.remotes.delete(id);
      r = undefined;
    }
    if (r === undefined) {
      if (a === null) return;
      r = { rig: new SkyRig(ch), canopy: null, ch, anim: a, open: a.open };
      this.remotes.set(id, r);
    }
    const anim = a ?? NO_SKY;
    // The canopy keeps opening between blobs (they come ~10 a second)
    r.open =
      anim.phase === 'canopy' ? Math.max(anim.open, Math.min(1, r.open + dt / SKY.openTime)) : 0;
    r.anim = anim.phase === 'canopy' ? { ...anim, open: r.open } : anim;
    r.rig.update(dt, r.anim, board);
    if (r.anim.phase === 'canopy') {
      r.canopy ??= new Canopy(this.game.gfx.scene);
      const f = _f.set(0, 0, 1).applyQuaternion(ch.root.quaternion);
      r.canopy.place(dt, ch.root.position, Math.atan2(f.x, f.z), r.open, r.anim.steer);
      r.canopy.root.visible = r.canopy.root.visible && ch.root.visible;
    } else r.canopy?.hide();
    if (a === null && !r.rig.active) {
      r.canopy?.dispose();
      this.remotes.delete(id);
    }
  }

  dropRemote(id: string) {
    this.remotes.get(id)?.canopy?.dispose();
    this.remotes.delete(id);
  }

  dispose() {
    for (const r of this.remotes.values()) r.canopy?.dispose();
    this.remotes.clear();
    this.canopy?.dispose();
    this.streaks?.dispose();
    this.wind.dispose();
    this.hud?.dispose();
    if (this.ctl !== null && this.game.player?.sky === this.ctl.hook) this.game.player.sky = null;
  }
}
