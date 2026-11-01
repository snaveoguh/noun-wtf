// ── The mural bench in the game: build it, offer SIT, the shot, stand up ──
//
// start(level) runs in Game.start once the level's static collision is
// built: it finds the mural decal, places the bench from it (place.ts,
// static collision only, so every client agrees), adds the bench (1 draw)
// and its collider, and leaves Pipe (PipeHead.ts) to build himself when
// you're near. tick() runs right after input is read (sat: input is
// muted; a move or a jump stands you up), update() after the character
// is posed (offers a seat, puts you on it), camera() just before the
// render (the glide back to the game camera after standing up).

import type { NounCharacter } from '../../character/NounCharacter';
import type { InputFrame } from '../../core/Input';
import type { Game } from '../../Game';
import type { LevelData } from '../Level';

import * as THREE from 'three';

import { muteInput } from '../../graffiti/mural/MuralMode';
import { poseSit } from '../../interiors/pose';
import { toonify } from '../../render/Toon';
import { findMuralDecal, quadOf } from '../MuralBillboard';

import { benchCollider, buildBench } from './build';
import { PipeHead } from './PipeHead';
import { BENCH, type BenchSite, placeBench, probeOf, wallOf } from './place';
import { encodeBench, offerSeat, remoteSeat, seatSpot, standSpot, wantsStand } from './rules';
import { benchShot, blendPose, GLIDE_IN, GLIDE_OUT, type ShotPose, smooth } from './shot';

const COLLIDER_ID = 'bench:mural';
/** Easing onto / off the seat (s). */
const SIT_S = 0.55;
const STAND_S = 0.4;
/** Offers are rechecked this often (s). */
const OFFER_EVERY = 0.15;

export interface BenchView {
  /** A seat is in reach: SIT. */
  prompt: boolean;
  /** Sat (letterbox, the shot). */
  seated: boolean;
}

type Phase = 'off' | 'sitting' | 'sat' | 'standing';

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _look = new THREE.Vector3();

export class BenchSystem {
  site: BenchSite | null = null;
  mesh: THREE.Mesh | null = null;
  pipe: PipeHead | null = null;
  private view_: BenchView = { prompt: false, seated: false };
  private listeners = new Set<() => void>();
  private phase: Phase = 'off';
  private seat = -1;
  private offer: number | null = null;
  private offerClock = 0;
  /** Since sitting (the shot's clock). */
  private t = 0;
  /** Sit blend 0…1 and its clock. */
  private k = 0;
  private from = { x: 0, z: 0, yaw: 0 };
  private camFrom: ShotPose = { pos: [0, 0, 0], look: [0, 0, 0], fov: 62 };
  private readonly rig = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 38 };
  /** The glide back after standing (null: none running). */
  private out: { t: number; from: ShotPose } | null = null;
  private keyBound = false;
  private remoteK = new Map<string, number>();
  /** Candidates tried when placing (perf / tests). */
  tried = 0;

  constructor(private readonly game: Game) {}

  get view(): BenchView {
    return this.view_;
  }

  get seated(): boolean {
    return this.phase !== 'off';
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private set(patch: Partial<BenchView>) {
    const next = { ...this.view_, ...patch };
    if (next.prompt === this.view_.prompt && next.seated === this.view_.seated) return;
    this.view_ = next;
    for (const l of this.listeners) l();
  }

  /** Place and build the bench (after the level's static collision is built). */
  start(level: LevelData) {
    if (this.site !== null) return;
    const g = this.game;
    const decal = findMuralDecal(level.root);
    const quad = decal !== null ? quadOf(decal) : null;
    if (quad === null) return;
    const t0 = performance.now();
    const placed = placeBench(wallOf(quad), probeOf(g.world));
    if (placed === null) {
      console.warn('[bench] no clear spot facing the mural');
      return;
    }
    const site = placed.site;
    this.site = site;
    this.tried = placed.tried;
    const mesh = buildBench(site, g.gfx.quality !== 'low');
    if (g.gfx.toon) toonify(mesh);
    level.root.add(mesh);
    this.mesh = mesh;
    g.world.setDynamic(COLLIDER_ID, benchCollider(site));
    this.pipe = new PipeHead(site, {
      scene: g.gfx.scene,
      assets: () => g.assets,
      toon: g.gfx.toon,
      low: g.gfx.quality === 'low',
      labelLayer: g.labelLayer,
      camera: g.gfx.camera,
      canvas: g.gfx.renderer.domElement,
      particles: g.particles,
    });
    if (import.meta.env.DEV)
      console.info(
        `[bench] at ${site.x.toFixed(2)}, ${site.z.toFixed(2)} (${site.dist} m out, ${site.offset} m along), ${placed.tried} tried, ${(performance.now() - t0).toFixed(0)} ms`,
      );
    if (!this.keyBound && typeof document !== 'undefined') {
      document.addEventListener('keydown', this.onKey, true);
      this.keyBound = true;
    }
  }

  /** Nothing else owns the frame or the rider. */
  private allowed(): boolean {
    const g = this.game;
    return (
      !g.paused &&
      !g.interiors.inside &&
      !g.missions.ud.active &&
      !g.van2.driving &&
      !g.cars.inCar &&
      !g.dragon.riding &&
      !g.hoops.active &&
      !g.breaks.active &&
      !g.pool.active &&
      !g.freestyle.active &&
      !g.mural.active &&
      !g.cutscene.active &&
      !g.camp.view.intro
    );
  }

  /** Right after input is read: sat, the rider holds still; a move or a jump stands. */
  tick(dt: number, input: InputFrame) {
    if (this.phase === 'off') return;
    if (this.phase === 'sat' && this.t > 0.35 && wantsStand(input)) this.stand();
    muteInput(input);
    void dt;
  }

  /** E / a tap: sit if a seat's offered, stand if sat. */
  act() {
    if (this.phase === 'sat' || this.phase === 'sitting') this.stand();
    else if (this.phase === 'off' && this.offer !== null) this.sit(this.offer);
  }

  private sit(seat: number) {
    const g = this.game;
    const s = this.site;
    const me = g.me;
    if (s === null || me === null || !this.allowed()) return;
    const p = g.player;
    this.from = { x: me.root.position.x, z: me.root.position.z, yaw: p.footYaw };
    // The rider's own position: in front of the seat, facing the mural
    const st = standSpot(s, seat);
    p.pos.set(st.x, s.y, st.z);
    p.vel.set(0, 0, 0);
    p.footYaw = st.yaw;
    p.fwd.set(Math.sin(st.yaw), 0, Math.cos(st.yaw));
    // Where the camera starts the glide from
    const cam = g.gfx.camera;
    cam.getWorldDirection(_dir);
    this.camFrom = {
      pos: [cam.position.x, cam.position.y, cam.position.z],
      look: [
        cam.position.x + _dir.x * 10,
        cam.position.y + _dir.y * 10,
        cam.position.z + _dir.z * 10,
      ],
      fov: cam.fov,
    };
    this.out = null;
    this.phase = 'sitting';
    this.seat = seat;
    this.t = 0;
    this.k = 0;
    g.net.bench = encodeBench(seat);
    g.cam.rig = this.rig;
    this.placeRig(0);
    this.pipe?.say('sit');
    document.body.setAttribute('data-bench-shot', '');
    this.set({ prompt: false, seated: true });
  }

  private stand() {
    if (this.phase === 'off' || this.phase === 'standing') return;
    const g = this.game;
    this.phase = 'standing';
    g.net.bench = null;
    // Hand the camera back: the game camera settles behind the rider (facing
    // the mural, so it carries on from the shot) and we glide into it
    this.out = {
      t: 0,
      from: {
        pos: [this.rig.pos.x, this.rig.pos.y, this.rig.pos.z],
        look: [this.rig.look.x, this.rig.look.y, this.rig.look.z],
        fov: this.rig.fov,
      },
    };
    if (g.cam.rig === this.rig) g.cam.rig = null;
    g.cam.snap(g.player);
    document.body.removeAttribute('data-bench-shot');
    this.set({ seated: false });
  }

  /** After the rider's character is posed: offers, the seat, Pipe. */
  update(dt: number) {
    const s = this.site;
    if (s === null) return;
    const g = this.game;
    const p = g.player;
    this.pipe?.update(dt, p.pos, this.phase === 'sat' || this.phase === 'sitting');
    if (this.phase !== 'off' && !this.allowed()) {
      // Something else took over (a cutscene, the pause menu…): up at once
      if (this.phase !== 'standing') this.stand();
      this.finishStand();
    }
    if (this.phase === 'off') {
      this.offerClock -= dt;
      if (this.offerClock <= 0) {
        this.offerClock = OFFER_EVERY;
        this.offer = offerSeat(s, {
          free: this.allowed() && p.mode === 'foot' && p.footGrounded && p.climb === null,
          speed: p.speed,
          x: p.pos.x,
          z: p.pos.z,
          taken: this.takenSeats(),
        });
        this.set({ prompt: this.offer !== null });
      }
      return;
    }
    this.t += dt;
    if (this.phase === 'sitting') {
      this.k = Math.min(1, this.k + dt / SIT_S);
      if (this.k >= 1) this.phase = 'sat';
    } else if (this.phase === 'standing') {
      this.k = Math.max(0, this.k - dt / STAND_S);
      if (this.k <= 0) {
        this.finishStand();
        return;
      }
    }
    p.vel.set(0, 0, 0);
    const me = g.me;
    if (me !== null) this.poseOnSeat(me, this.seat, this.k, this.phase === 'standing');
    if (this.phase !== 'standing') this.placeRig(dt);
  }

  private finishStand() {
    this.phase = 'off';
    this.seat = -1;
    this.k = 0;
    this.game.net.bench = null;
    this.offerClock = 0.6;
  }

  /** Ease the rider from where they were onto the seat (k 0…1), sat. */
  private poseOnSeat(ch: NounCharacter, seat: number, k: number, standing: boolean) {
    const s = this.site!;
    const at = seatSpot(s, seat);
    const st = standSpot(s, seat);
    const e = smooth(k);
    const f = standing ? st : this.from;
    const x = f.x + (at.x - f.x) * e;
    const z = f.z + (at.z - f.z) * e;
    let dy = at.yaw - f.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    ch.root.position.set(x, s.y, z);
    ch.root.quaternion.setFromAxisAngle(UP, f.yaw + dy * Math.min(1, e * 1.6));
    ch.board.visible = false;
    poseSit(ch, s.y, s.y + BENCH.seatH, e);
  }

  /** The shot (glides in from the game camera first). */
  private placeRig(dt: number) {
    void dt;
    const s = this.site!;
    const cam = this.game.gfx.camera;
    const shot = benchShot(s, this.t, cam.aspect);
    const k = smooth(this.t / GLIDE_IN);
    const pose = k < 1 ? blendPose(this.camFrom, shot, k) : shot;
    this.rig.pos.set(...pose.pos);
    this.rig.look.set(...pose.look);
    this.rig.fov = pose.fov;
  }

  /** Just before the render: the glide back into the game camera after standing. */
  camera(dt: number) {
    const o = this.out;
    if (o === null) return;
    o.t += dt;
    const cam = this.game.gfx.camera;
    if (this.game.cam.rig !== null || o.t >= GLIDE_OUT) {
      this.out = null;
      return;
    }
    const e = smooth(o.t / GLIDE_OUT);
    cam.getWorldDirection(_dir);
    _look.copy(cam.position).addScaledVector(_dir, 10);
    const live: ShotPose = {
      pos: [cam.position.x, cam.position.y, cam.position.z],
      look: [_look.x, _look.y, _look.z],
      fov: cam.fov,
    };
    const p = blendPose(o.from, live, e);
    cam.position.set(...p.pos);
    cam.lookAt(p.look[0], p.look[1], p.look[2]);
    if (Math.abs(cam.fov - p.fov) > 0.01) {
      cam.fov = p.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  /** Seats other riders are on (their position backs it up). */
  private takenSeats(): Set<number> {
    const out = new Set<number>();
    const s = this.site;
    if (s === null) return out;
    for (const rp of this.game.net.players.values()) {
      const seat = remoteSeat(s, rp.bench, rp.current.pos.x, rp.current.pos.z);
      if (seat !== null) out.add(seat);
    }
    return out;
  }

  /** A remote rider on the bench, after their own update: on their seat, eased down. */
  poseRemote(id: string, ch: NounCharacter, wire: number | null, dt: number) {
    const s = this.site;
    const seat = s === null ? null : remoteSeat(s, wire, ch.root.position.x, ch.root.position.z);
    if (s === null || seat === null) {
      this.remoteK.delete(id);
      return;
    }
    const k = Math.min(1, (this.remoteK.get(id) ?? 0) + dt / SIT_S);
    this.remoteK.set(id, k);
    const at = seatSpot(s, seat);
    ch.root.position.set(at.x, s.y, at.z);
    ch.root.quaternion.setFromAxisAngle(UP, at.yaw);
    ch.board.visible = false;
    ch.play({ clip: 'idle', fade: 0.3 });
    poseSit(ch, s.y, s.y + BENCH.seatH, smooth(k));
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyE' && e.code !== 'Escape') return;
    const el = e.target as HTMLElement | null;
    if (el !== null && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable))
      return;
    const sat = this.phase === 'sat' || this.phase === 'sitting';
    if (e.code === 'Escape' ? !sat : !sat && !(this.view_.prompt && this.phase === 'off')) return;
    if (this.game.paused) return;
    // Ours, not the board toggle's (or the pause menu's)
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.repeat) return;
    this.act();
  };

  dispose() {
    if (this.phase !== 'off') {
      this.stand();
      this.finishStand();
    }
    if (this.game.cam.rig === this.rig) this.game.cam.rig = null;
    document.body.removeAttribute('data-bench-shot');
    if (this.keyBound) document.removeEventListener('keydown', this.onKey, true);
    this.keyBound = false;
    this.pipe?.dispose();
    this.pipe = null;
    if (this.mesh !== null) {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    this.game.world.setDynamic(COLLIDER_ID, null);
    this.listeners.clear();
  }
}
