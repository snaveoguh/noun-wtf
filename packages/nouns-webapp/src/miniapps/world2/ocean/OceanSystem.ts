// ── The ocean in Noun World: the glue between the engine and the game ────
//
// Owns:
// - the surface (OceanSurface, one draw), built once the camera is within
//   ~1.5 km of the coast, warmed hidden, and dropped when you've gone;
// - the water controller, hooked into skate/Player as `player.water`: once
//   you're knee deep it takes over (wading, swimming, paddling, surfing:
//   surf/sim.ts) and hands you back to the Player on the beach;
// - your rider's pose (view/SurfRig) and board (view/Surfboard), the chase
//   camera (SkateCamera.skyCam, the skydive's framing hook), the camera
//   kept out of the water;
// - the sim's events → the combo (tricks, bank, bail), sounds, spray;
// - the HUD (ui/SurfHud), the surf shop (ui/ShopPanel, E at the shop),
//   the sea's sound (audio.ts), life on the water (OceanLife);
// - the `sf` pose key, so others see you surf (and you see them).
// Nothing runs but a bounds check while you're far from Puerto Noun.

import type { NounCharacter } from '../character/NounCharacter';
import type { InputFrame } from '../core/Input';
import type { Game } from '../Game';
import type { SkyCam } from '../skydive/SkydiveSystem';

import * as THREE from 'three';

import { warmHidden } from '../render/shaderWarm';
import { addRunning, addTrick, bailCombo, bankCombo } from '../skate/Tricks';
import { townToWorld } from '../towns/site';
import { SEA_FRONT } from '../towns/beach';
import { terrainHeight } from '../world/mountain/terrain';

import { SeaSound } from './audio';
import { COAST, coastAt, coastFrame, coastFrameNow, type CoastFrame, type CoastPoint } from './coast';
import { decodeSf, encodeSf, NO_SURF, type SurfAnim } from './net/sf';
import { OceanLife, placeBoard } from './OceanLife';
import { OCEAN_HIGH, OCEAN_LOW, OceanSurface } from './OceanSurface';
import { blankSea, seaAt, seaClock, type SeaPoint } from './sea';
import { BOARDS, type BoardId } from './surf/boards';
import { buyBoard, coinOf, ownedBoards, savedBoard, saveBoard } from './surf/shop';
import {
  enterWater,
  newWater,
  stepWater,
  WATER,
  type SeaQuery,
  type WaterEvent,
  type WaterState,
} from './surf/sim';
import { ShopPanel } from './ui/ShopPanel';
import { SurfHud } from './ui/SurfHud';
import { Surfboard } from './view/Surfboard';
import { SurfRig } from './view/SurfRig';

/** Build the surface within this coast distance of the camera (m), drop it past DROP_AT. */
const SURFACE_AT = -1500;
const DROP_AT = -2200;
/** Shop: E within this far of its counter (m). */
const SHOP_R = 6.5;

const HINTS = {
  keyboard: {
    wade: '<b>WASD</b> wade in · deeper and you swim',
    swim: '<b>WASD</b> swim · <b>SHIFT</b> faster · <b>Q</b> dive under',
    paddle: '<b>W</b> paddle · <b>A/D</b> turn · <b>S</b> sit up · <b>Q</b> duck dive · <b>SHIFT</b> sprint',
    catch: '<b>W</b> keep paddling! · <b>SPACE</b> pop up',
    ride: '<b>A/D</b> carve · <b>W</b> pump · <b>S</b> stall · <b>SPACE</b> air off the lip',
    air: '<b>A/D</b> spin · <b>Q</b> grab · land it straight',
    wipe: 'hold your breath…',
    pop: 'SPACE',
  },
  gamepad: {
    wade: 'stick: wade in',
    swim: 'stick: swim · <b>B</b> dive under',
    paddle: 'stick: paddle + turn · <b>B</b> duck dive',
    catch: '<b>Ⓐ</b> pop up',
    ride: 'stick: carve · pump · stall · <b>Ⓐ</b> air',
    air: 'stick: spin · <b>B</b> grab',
    wipe: 'hold your breath…',
    pop: 'Ⓐ',
  },
  touch: {
    wade: 'stick: wade in',
    swim: 'stick: swim · <b>DUCK</b> dive under',
    paddle: 'stick: paddle + turn · <b>DUCK</b>',
    catch: 'tap <b>POP</b>',
    ride: 'stick: carve · pump · stall · <b>POP</b> air',
    air: 'stick: spin · land it straight',
    wipe: 'hold your breath…',
    pop: 'TAP POP',
  },
} as const;

const WIPE_TEXT: Record<string, string> = {
  lip: 'WIPEOUT!',
  pearl: 'PEARLED!',
  landing: 'WIPEOUT!',
  closeout: 'CAUGHT A RAIL!',
};

interface RemoteSurf {
  rig: SurfRig;
  board: Surfboard | null;
  ch: NounCharacter;
  state: WaterState;
}

const _v = new THREE.Vector3();

export class OceanSystem {
  surface: OceanSurface | null = null;
  life: OceanLife | null = null;
  /** The local rider in the sea (phase 'off' on land). */
  readonly water: WaterState = newWater(null);
  anim: SurfAnim = NO_SURF;
  /** The board you'll take in (null: swim). */
  board: BoardId | null;
  /** Sea clock (s). */
  t = 0;
  /** Camera's coast distance (m, < 0 inland), last frame. */
  dCam = -1e9;
  private ev: WaterEvent[] = [];
  private sp: SeaPoint = blankSea();
  private sp2: SeaPoint = blankSea();
  private cp: CoastPoint = { d: 0, a: 0, u: 0, vp: 0 };
  private rig: SurfRig | null = null;
  private boardMesh: Surfboard | null = null;
  private remotes = new Map<string, RemoteSurf>();
  private sound: SeaSound;
  private hud: SurfHud | null = null;
  private shop: ShopPanel | null = null;
  private shopBusy: BoardId | null = null;
  private shopMsg = '';
  private uncover: (() => void) | null = null;
  private nearShop = false;
  private cam: SkyCam = { k: 0, yaw: 0, dist: 0, pitch: 0, lift: 0, fov: 0 };
  private mode: InputFrame['mode'] = 'keyboard';
  private popQueued = false;
  private duckQueued = false;
  private wipeFlash = 0;
  private wipeWhy = 'lip';
  private suspendedStats = false;
  private warming = false;
  private farFor = 0;
  private keyBound = false;
  private readonly query: SeaQuery = {
    at: (x, z, out) => seaAt(x, z, this.t, out),
    ground: (x, z) => terrainHeight(x, z),
  };
  /** The Player hook (skate/Player `water`). */
  readonly hook = {
    step: (dt: number, input: InputFrame, camYaw: number) => this.step(dt, input, camYaw),
  };

  constructor(private game: Game) {
    this.sound = new SeaSound(game.audio);
    const saved = savedBoard();
    let v: string | null = null;
    try {
      v = localStorage.getItem('noun-surf-board-v1');
    } catch {
      /* fine */
    }
    this.board = v === 'none' ? null : (saved ?? 'foamie');
  }

  /** In the sea right now (any phase but 'off'). */
  get inWater() {
    return this.water.phase !== 'off';
  }

  /** Surfing (on a board, not just wading / swimming). */
  get surfing() {
    const p = this.water.phase;
    return p === 'paddle' || p === 'duck' || p === 'pop' || p === 'ride' || p === 'air';
  }

  /** Is the sea allowed to take over right now? */
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
      g.replay.active ||
      (g.skydive.ctl?.s.phase ?? 'off') !== 'off'
    );
  }

  // ── Physics (the Player hook) ──

  private step(dt: number, input: InputFrame, camYaw: number): boolean {
    const g = this.game;
    const p = g.player;
    const c = coastFrame();
    if (c === null) return false;
    const s = this.water;
    if (!this.allowed()) {
      if (s.phase !== 'off') this.leave();
      return false;
    }
    this.t = seaClock();
    if (s.phase !== 'off' && Math.hypot(p.pos.x - s.x, p.pos.z - s.z) > 3) {
      // teleported (respawn, fast travel): out of the water
      this.leave();
      return false;
    }
    if (s.phase === 'off') {
      if (p.pos.x < c.x0 || p.pos.x > c.x1 || p.pos.z < c.z0 || p.pos.z > c.z1) return false;
      if (coastAt(c, p.pos.x, p.pos.z, this.cp).d < -12) return false;
      if (p.climb !== null || p.vault !== null || p.parkour?.busy() === true) return false;
      const sea = seaAt(p.pos.x, p.pos.z, this.t, this.sp);
      if (sea === null) return false;
      const ground = terrainHeight(p.pos.x, p.pos.z);
      const depth = sea.y - ground;
      if (depth < WATER.wadeIn || p.pos.y > sea.y + 0.3) return false;
      // in we go (off the skateboard if you rode in)
      const yaw = p.mode === 'board' ? Math.atan2(p.fwd.x, p.fwd.z) : p.footYaw;
      if (p.mode === 'board') {
        bankCombo(p.combo, performance.now());
        p.events.push({ type: 'boardOff' });
      }
      s.board = this.board;
      enterWater(s, p.pos.x, ground, p.pos.z, p.vel.x * 0.5, p.vel.z * 0.5, yaw);
      if (depth > WATER.swimIn) {
        // fell / jumped in deep
        s.phase = s.board !== null ? 'paddle' : 'swim';
        s.y = sea.y;
        s.lastSy = sea.y;
        this.ev.push({ type: 'splash', k: Math.min(1, Math.max(0.4, -p.vel.y / 8)) });
      }
      this.ev.push({ type: 'enter' });
    }
    const winp = {
      moveX: input.moveX,
      moveY: input.moveY,
      camYaw,
      jump: input.jumpPressed || this.popQueued,
      duck: input.duckPressed === true || this.duckQueued,
      duckHeld: input.duck === true,
      sprint: input.sprint || input.push,
    };
    this.popQueued = false;
    this.duckQueued = false;
    const still = stepWater(s, winp, this.query, dt, this.ev);
    p.pos.set(s.x, s.y, s.z);
    p.vel.set(s.vx, s.phase === 'air' ? s.vy : 0, s.vz);
    p.footYaw = s.yaw;
    p.fwd.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    p.up.set(0, 1, 0);
    p.mode = 'foot';
    p.state = 'ground';
    p.footGrounded = true;
    if (!still) {
      // back on the beach: the Player walks from here
      p.vel.y = 0;
      return false;
    }
    return true;
  }

  /** Out of the water now (teleports, a mode taking over). */
  private leave() {
    const s = this.water;
    if (s.phase === 'off') return;
    s.phase = 'off';
    s.t = 0;
    this.ev.push({ type: 'exit' });
  }

  // ── Once a frame (after the character update) ──

  frame(dt: number, input: InputFrame) {
    const g = this.game;
    const p = g.player;
    if (p === undefined) return;
    if (p.water !== this.hook) p.water = this.hook;
    const c = coastFrame();
    this.mode = input.mode;
    if (c === null) return;
    const cam = g.gfx.camera.position;
    this.t = seaClock();
    this.dCam =
      cam.x < c.x0 || cam.x > c.x1 || cam.z < c.z0 || cam.z > c.z1
        ? -1e9
        : coastAt(c, cam.x, cam.z, this.cp).d;
    this.updateSurface(c, dt);
    this.onEvents();
    const s = this.water;
    this.anim =
      s.phase === 'off'
        ? NO_SURF
        : { phase: s.phase, board: s.board, lean: s.lean, crouch: s.crouch, stroke: s.stroke, sit: s.sit, t: s.t };

    // the rider + their board
    const me = g.me;
    if (me !== null) {
      if (this.rig?.ch !== me) this.rig = new SurfRig(me);
      if (s.phase !== 'off') {
        me.root.position.set(s.x, s.y, s.z);
        me.root.quaternion.setFromAxisAngle(_v.set(0, 1, 0), s.yaw);
        me.board.visible = false;
      }
      this.rig.update(dt, this.anim);
      const showBoard = s.phase !== 'off' && s.board !== null && s.phase !== 'swim' && s.phase !== 'wipeout';
      if (showBoard && this.boardMesh === null)
        this.boardMesh = new Surfboard(g.gfx.scene, s.board!, g.gfx.toon);
      if (this.boardMesh !== null) {
        this.boardMesh.mesh.visible = showBoard && me.root.visible;
        if (showBoard) {
          this.boardMesh.setBoard(s.board!);
          placeBoard(this.boardMesh.mesh, s, this.query, this.sp2);
        }
      }
    }

    // camera: a surf chase (the skydive's framing hook), kept out of the water
    const cc = this.cam;
    const on = s.phase !== 'off' && s.phase !== 'wade';
    cc.k += ((on ? 1 : 0) - cc.k) * (1 - Math.exp(-(on ? 2.5 : 4) * dt));
    if (on) {
      cc.yaw = s.yaw;
      const ride = s.phase === 'ride' || s.phase === 'air' || s.phase === 'pop';
      const v = Math.hypot(s.vx, s.vz);
      cc.dist = ride ? 6.2 : s.phase === 'wipeout' ? 6.5 : 4.6;
      cc.pitch = ride ? 0.2 : 0.16;
      cc.lift = ride ? 0.9 : 0.5;
      cc.fov = ride ? Math.min(12, v * 0.7) : 0;
    }
    if (cc.k > 0.01 && g.cam.skyCam === null) g.cam.skyCam = cc;
    else if (cc.k <= 0.01 && g.cam.skyCam === cc) g.cam.skyCam = null;
    if (this.dCam > -40 && this.surface !== null) {
      const sea = seaAt(cam.x, cam.z, this.t, this.sp);
      if (sea !== null && cam.y < sea.y + 0.45) cam.y = sea.y + 0.45;
    }

    // stats: nothing in the sea is a record
    if (s.phase !== 'off' && !this.suspendedStats) {
      this.suspendedStats = true;
      g.stats.suspended = true;
    } else if (s.phase === 'off' && this.suspendedStats) {
      this.suspendedStats = false;
      if (!g.missions.ud.active) g.stats.suspended = false;
    }

    // sound
    const near = Math.max(0, Math.min(1, (this.dCam + 700) / 650));
    const atRider = s.phase !== 'off' ? (seaAt(s.x, s.z, this.t, this.sp)?.broken ?? 0) : 0;
    const v = Math.hypot(s.vx, s.vz);
    this.sound.update(
      dt,
      near,
      Math.max(atRider, near * 0.35),
      s.phase === 'ride' ? Math.min(1, v / 12) : s.phase === 'wipeout' ? 1 : 0,
    );

    // life on the water
    if (this.life === null && this.dCam > -1100 && g.assets) {
      this.life = new OceanLife(g, c);
      g.gfx.scene.add(this.life.group);
    }
    this.life?.update(dt, this.t, this.dCam, cam);

    // spray while riding
    if (s.phase === 'ride' && v > 6 && Math.random() < dt * 14) {
      _v.set(s.x - Math.sin(s.yaw) * 0.9, s.y + 0.1, s.z - Math.cos(s.yaw) * 0.9);
      g.particles.dustAt(_v, Math.min(1, v / 14), SPRAY);
    }

    this.updateShop(c);
    this.updateHud(dt);
  }

  private updateSurface(c: CoastFrame, dt: number) {
    const g = this.game;
    const want = this.dCam > SURFACE_AT && g.gfx.camera.position.y < c.sea + 900;
    if (want && this.surface === null && !this.warming) {
      const low = g.gfx.quality === 'low';
      const surf = new OceanSurface(c, low ? OCEAN_LOW : OCEAN_HIGH);
      this.surface = surf;
      g.gfx.scene.add(surf.mesh);
      surf.update(g.gfx.camera.position.x, g.gfx.camera.position.z, this.t);
      // link it hidden, then show (no first-sight hitch)
      this.warming = true;
      void warmHidden(g.gfx.renderer, surf.mesh, g.gfx.camera, g.gfx.scene, fn => g.gfx.asDrawn(fn)).then(() => {
        this.warming = false;
      });
    }
    if (this.surface !== null) {
      const cam = g.gfx.camera.position;
      this.surface.update(cam.x, cam.z, this.t);
      this.farFor = this.dCam < DROP_AT ? this.farFor + dt : 0;
      if (this.farFor > 8 && !this.inWater) {
        this.surface.dispose();
        this.surface = null;
        this.life?.dispose();
        this.life = null;
      }
    }
  }

  private onEvents() {
    const g = this.game;
    const p = g.player;
    const s = this.water;
    const now = performance.now();
    for (const e of this.ev) {
      switch (e.type) {
        case 'trick':
          addTrick(p.combo, e.name, e.points);
          break;
        case 'running':
          addRunning(p.combo, e.points);
          break;
        case 'bank':
          bankCombo(p.combo, now);
          break;
        case 'bail':
          bailCombo(p.combo, now);
          this.wipeFlash = 1.4;
          this.wipeWhy = e.why;
          g.cam.addShake(0.4);
          g.audio.land(3);
          break;
        case 'pop':
          g.sfx.play('whoosh', { gain: 0.6 });
          break;
        case 'catch':
          g.sfx.play('whoosh', { gain: 0.35 });
          break;
        case 'air':
          g.sfx.play('whoosh', { gain: 0.8 });
          break;
        case 'land':
          if (e.clean) g.audio.land(1.5);
          break;
        case 'splash':
          _v.set(s.x, (seaAt(s.x, s.z, this.t, this.sp)?.y ?? s.y) + 0.1, s.z);
          g.particles.dustAt(_v, e.k, SPRAY);
          break;
        case 'exit':
          if (this.boardMesh !== null) this.boardMesh.mesh.visible = false;
          break;
        default:
          break;
      }
    }
    this.ev.length = 0;
  }

  private updateHud(dt: number) {
    const g = this.game;
    const s = this.water;
    if (this.hud === null) {
      const parent = g.gfx.renderer.domElement.parentElement;
      if (parent === null || (s.phase === 'off' && !this.nearShop)) return;
      this.hud = new SurfHud(
        parent,
        b => {
          if (b === 'duck') this.duckQueued = true;
          else this.popQueued = true;
        },
        () => this.openShop(),
      );
    }
    this.wipeFlash = Math.max(0, this.wipeFlash - dt);
    const h = HINTS[this.mode] ?? HINTS.keyboard;
    const ph = s.phase;
    const hint =
      ph === 'off'
        ? ''
        : ph === 'paddle'
          ? s.ready
            ? h.catch
            : h.paddle
          : ph === 'duck'
            ? h.paddle
            : ph === 'ride' || ph === 'pop'
              ? h.ride
              : ph === 'air'
                ? h.air
                : ph === 'wipeout'
                  ? h.wipe
                  : ph === 'swim'
                    ? h.swim
                    : h.wade;
    const v = Math.hypot(s.vx, s.vz);
    this.hud.update({
      on: ph !== 'off',
      hint,
      prompt: this.wipeFlash > 0 ? 'wipe' : ph === 'paddle' && s.ready ? 'pop' : '',
      popKey: h.pop,
      wipeText: WIPE_TEXT[this.wipeWhy] ?? 'WIPEOUT!',
      ride: ph === 'ride' || ph === 'air',
      kmh: v * 3.6,
      touch: this.mode === 'touch',
      button:
        ph === 'paddle' && s.ready
          ? 'pop'
          : ph === 'ride'
            ? 'pop'
            : ph === 'paddle' || ph === 'swim'
              ? 'duck'
              : '',
      shop: this.nearShop && ph === 'off' && this.shop === null ? (this.mode === 'touch' ? 'SURF SHOP' : 'E · SURF SHOP') : '',
    });
  }

  // ── The shop ──

  /** The shop counter (world), or null before the town is placed. */
  shopSpot(): { x: number; y: number; z: number } | null {
    const c = coastFrame();
    if (c === null) return null;
    const w = townToWorld(c.town, SEA_FRONT.walk1 - 0.5, SEA_FRONT.shopU, { x: 0, z: 0 });
    return { x: w.x, y: c.town.P + SEA_FRONT.deck, z: w.z };
  }

  private updateShop(c: CoastFrame) {
    const p = this.game.player;
    const sp = this.shopSpot();
    this.nearShop =
      sp !== null &&
      this.water.phase === 'off' &&
      Math.hypot(p.pos.x - sp.x, p.pos.z - sp.z) < SHOP_R &&
      Math.abs(p.pos.y - sp.y) < 3;
    void c;
    if (this.nearShop && !this.keyBound) {
      document.addEventListener('keydown', this.onKey, true);
      this.keyBound = true;
    }
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyE' && e.code !== 'Escape') return;
    const el = e.target as HTMLElement | null;
    if (el !== null && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
    if (this.game.paused) return;
    if (e.code === 'Escape') {
      if (this.shop === null) return;
      e.stopImmediatePropagation();
      this.closeShop();
      return;
    }
    if (this.shop === null && !this.nearShop) return;
    // ours, not the board toggle's
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.repeat) return;
    if (this.shop !== null) this.closeShop();
    else this.openShop();
  };

  openShop() {
    const g = this.game;
    if (this.shop !== null) return;
    const parent = g.gfx.renderer.domElement.parentElement;
    if (parent === null) return;
    this.shopMsg = '';
    this.shop = new ShopPanel(parent, {
      pick: id => {
        this.board = id;
        saveBoard(id);
        this.renderShop();
      },
      buy: id => void this.buy(id),
      close: () => this.closeShop(),
    });
    this.uncover = g.coverGame('surfshop', false);
    this.renderShop();
  }

  closeShop() {
    this.shop?.dispose();
    this.shop = null;
    this.uncover?.();
    this.uncover = null;
  }

  private renderShop() {
    this.shop?.render({
      coin: coinOf(this.game),
      owned: ownedBoards(this.game),
      selected: this.board,
      busy: this.shopBusy,
      msg: this.shopMsg,
    });
  }

  private async buy(id: BoardId) {
    if (this.shopBusy !== null) return;
    this.shopBusy = id;
    this.shopMsg = '';
    this.renderShop();
    const r = await buyBoard(this.game, id);
    this.shopBusy = null;
    if (r.ok) {
      this.board = id;
      saveBoard(id);
      this.shopMsg = `${BOARDS[id].name}: it's yours. Paddle out!`;
    } else this.shopMsg = `Can't buy that: ${r.reason ?? 'try again'}`;
    this.renderShop();
  }

  // ── Launch ──

  /** `?play=surf`: on a board at the line-up, facing the beach. */
  arrive(): boolean {
    const g = this.game;
    if (g.me === null || g.level === null) return false;
    const c = coastFrameNow();
    if (c === null) return false;
    const w = townToWorld(c.town, COAST.shore + 165, c.uB - 30, { x: 0, z: 0 });
    const t = seaClock();
    const sea = seaAt(w.x, w.z, t, this.sp, c);
    if (sea === null) return false;
    if (this.board === null) this.board = 'foamie';
    const yaw = Math.atan2(sea.sx, sea.sz);
    g.player.spawn(new THREE.Vector3(w.x, sea.y, w.z), yaw);
    // spawn() settles onto the seabed: put the rider back on the water
    g.player.pos.set(w.x, sea.y, w.z);
    const s = this.water;
    s.board = this.board;
    enterWater(s, w.x, sea.y, w.z, 0, 0, yaw);
    s.phase = 'paddle';
    s.lastSy = sea.y;
    g.cam.snap(g.player);
    return true;
  }

  // ── Multiplayer ──

  /** The `sf` key for my pose blob (undefined: not in the sea). */
  netKey(): number[] | undefined {
    return encodeSf(this.anim) ?? undefined;
  }

  /** Pose a remote rider from their blob's `sf` (after their character update). */
  remote(id: string, ch: NounCharacter, sf: unknown, dt: number) {
    const a = decodeSf(sf);
    let r = this.remotes.get(id);
    if (r !== undefined && r.ch !== ch) {
      r.board?.dispose();
      this.remotes.delete(id);
      r = undefined;
    }
    if (r === undefined) {
      if (a === null) return;
      r = { rig: new SurfRig(ch), board: null, ch, state: newWater(a.board) };
      this.remotes.set(id, r);
    }
    const anim = a ?? NO_SURF;
    r.rig.update(dt, anim);
    const st = r.state;
    st.phase = anim.phase;
    st.board = anim.board;
    st.lean = anim.lean;
    st.t = anim.t;
    st.x = ch.root.position.x;
    st.y = ch.root.position.y;
    st.z = ch.root.position.z;
    _v.set(0, 0, 1).applyQuaternion(ch.root.quaternion);
    st.yaw = Math.atan2(_v.x, _v.z);
    const show =
      anim.phase !== 'off' && anim.board !== null && anim.phase !== 'swim' && anim.phase !== 'wipeout';
    if (show) ch.board.visible = false;
    if (show && r.board === null) r.board = new Surfboard(this.game.gfx.scene, anim.board!, this.game.gfx.toon);
    if (r.board !== null) {
      r.board.mesh.visible = show && ch.root.visible;
      if (show) {
        r.board.setBoard(anim.board!);
        placeBoard(r.board.mesh, st, this.query, this.sp2);
      }
    }
    if (a === null && !r.rig.active) {
      r.board?.dispose();
      this.remotes.delete(id);
    }
  }

  dropRemote(id: string) {
    this.remotes.get(id)?.board?.dispose();
    this.remotes.delete(id);
  }

  dispose() {
    for (const r of this.remotes.values()) r.board?.dispose();
    this.remotes.clear();
    this.surface?.dispose();
    this.surface = null;
    this.life?.dispose();
    this.life = null;
    this.boardMesh?.dispose();
    this.sound.dispose();
    this.hud?.dispose();
    this.shop?.dispose();
    if (this.keyBound) document.removeEventListener('keydown', this.onKey, true);
    if (this.game.player?.water === this.hook) this.game.player.water = null;
    if (this.game.cam.skyCam === this.cam) this.game.cam.skyCam = null;
  }
}

const SPRAY = new THREE.Color(0xffffff);
