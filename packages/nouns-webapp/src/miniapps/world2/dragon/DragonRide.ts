// ── Riding the Noun dragon: buy it, call it, fly it ──────────────────────
//
// Bought at the Dragon Roost in Noggle City (dragon/pay.ts; E at the shop
// door). Once you own one, Z (or the 🐉 button) calls it to you anywhere and
// you climb on; E gets you off (it lands you on the ground below).
//
// Flight is arcade, not physics: A/D turn (it banks), W/S speed up / slow
// down (10–60 m/s, Shift boosts to 95), Space climbs, Q dives; it never
// flies into the ground (keeps 1.5 m over whatever's under it) and tops out
// 400 m above it. Like the van, nothing counts toward stats while you fly
// (the tracker is suspended), drops don't pick up, and getting off starts a
// fresh ride. The chase camera is the van's.

import type { InputFrame } from '../core/Input';
import type { Game } from '../Game';

import * as THREE from 'three';

import { ROOST } from '../towns/noggle';
import { townCoords, townFrame } from '../towns/site';
import { VanCamera } from '../van/VanCamera';

import { dragonCourse } from './courseWorld';
import { buildDragonMesh, disposeDragonMeshes, flapRate, flapWings, type DragonMesh } from './mesh';
import { SADDLE } from './model';
import { buyDragon, coinOf, DRAGON_COST, dragonOwned } from './pay';
import { DragonRace, type RaceUi } from './race';
import { RemoteDragons } from './remote';

export const DRAGON = {
  minSpeed: 10,
  cruise: 34,
  maxSpeed: 60,
  boost: 95,
  accel: 14,
  turnRate: 1.25,
  climb: 16,
  dive: 26,
  clearance: 1.5,
  ceiling: 400,
} as const;

/** Shop door radius (m) at the Roost. */
const SHOP_R = 5;

export interface DragonUi {
  owned: boolean;
  riding: boolean;
  /** At the Roost's door, not owning one: BUY. */
  atShop: boolean;
  coin: number | null;
  kmh: number;
  alt: number;
  /** Last buy attempt's message. */
  notice: string | null;
  /** The Dragon Run (race.ts) while flying. */
  race: RaceUi | null;
}

const IDLE: DragonUi = {
  owned: false,
  riding: false,
  atShop: false,
  coin: null,
  kmh: 0,
  alt: 0,
  notice: null,
  race: null,
};

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const _from = new THREE.Vector3();

export class DragonRide {
  ui: DragonUi = IDLE;
  riding = false;
  /** Touch controls (DragonHud): climb / dive held, boost. */
  readonly touch = { up: false, down: false, boost: false };
  private listeners = new Set<() => void>();
  private mesh: DragonMesh | null = null;
  private camera: VanCamera;
  readonly pos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private heading = 0;
  private speed: number = DRAGON.cruise;
  private bank = 0;
  private pitch = 0;
  private flap = 0;
  private callQueued = false;
  private toggleQueued = false;
  private buying = false;
  private noticeAt = 0;
  private uiT = 0;

  /** Other riders' dragons (remote.ts). */
  private remotes: RemoteDragons;
  /** The Dragon Run: rings, clock, ghost (race.ts). */
  readonly race: DragonRace;

  constructor(private game: Game) {
    this.camera = new VanCamera(game.gfx.camera, game.world);
    this.remotes = new RemoteDragons({
      scene: game.gfx.scene,
      toon: game.gfx.toon,
      hidden: () => game.missions.ud.active || game.replay.active,
    });
    this.race = new DragonRace({
      scene: game.gfx.scene,
      notice: text => this.notice(text),
      sound: id => game.sfx.play(id, { gain: 0.7 }),
    });
    window.addEventListener('keydown', this.onKey);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyZ' || e.repeat || e.ctrlKey || e.metaKey) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    this.callQueued = true;
  };

  /** 🐉 button: call it (or get off). */
  requestCall() {
    if (this.riding) this.toggleQueued = true;
    else this.callQueued = true;
  }

  /** BUY button at the Roost. */
  requestBuy() {
    void this.buy();
  }

  private blocked(): boolean {
    const g = this.game;
    return (
      g.hoops.active ||
      g.replay.active ||
      g.showroom ||
      g.van2.driving ||
      g.cars.inCar ||
      g.cutscene.active
    );
  }

  /** Is the rider at the Roost's door (Noggle City)? */
  private atShop(): boolean {
    const f = townFrame('noggle');
    if (f === null) return false;
    const p = this.game.player.pos;
    const c = townCoords(f, p.x, p.z);
    return Math.hypot(c.u - ROOST.u, c.vp - ROOST.vp) < SHOP_R && Math.abs(p.y - f.P) < 3;
  }

  private async buy() {
    if (this.buying || dragonOwned(this.game)) return;
    this.buying = true;
    const r = await buyDragon(this.game, 'noggle');
    this.buying = false;
    this.notice(
      r.ok ? '🐉 YOUR DRAGON! PRESS Z TO CALL IT' : `NO DRAGON: ${r.reason ?? 'try again'}`,
    );
    if (r.ok) this.callQueued = true;
  }

  private notice(text: string) {
    this.noticeAt = performance.now();
    this.ui = { ...this.ui, notice: text };
    this.emit();
  }

  // ── Frame hooks (Game.step) ──

  /** Before the skater: E buys at the Roost, Z calls, E gets off. Returns whether we're flying. */
  preStep(input: InputFrame): boolean {
    if (this.blocked()) {
      this.callQueued = this.toggleQueued = false;
      return this.riding;
    }
    const toggle = input.boardTogglePressed || this.toggleQueued;
    this.toggleQueued = false;
    if (!this.riding) {
      if (toggle && !dragonOwned(this.game) && this.atShop()) {
        input.boardTogglePressed = false;
        void this.buy();
      }
      if (this.callQueued && dragonOwned(this.game)) this.mount();
      this.callQueued = false;
    } else {
      this.callQueued = false;
      if (toggle) this.dismount();
    }
    if (!this.riding) return false;
    input.boardTogglePressed = false;
    input.respawnPressed = false;
    input.jumpPressed = false;
    input.spray = false;
    input.tricks.length = 0;
    input.emotePressed = 0;
    return true;
  }

  private build() {
    if (this.mesh !== null) return;
    this.mesh = buildDragonMesh(this.game.gfx.toon);
  }

  private mount() {
    const g = this.game;
    const p = g.player;
    this.build();
    if (p.mode === 'board') p.toggleBoard();
    this.heading = Math.atan2(p.fwd.x, p.fwd.z);
    this.pos.copy(p.pos);
    this.pos.y = Math.max(p.pos.y, p.floorAt(p.pos.x, p.pos.z)) + 2;
    this.speed = DRAGON.minSpeed + 4;
    this.vel.set(0, 0, 0);
    this.bank = this.pitch = 0;
    this.riding = true;
    g.gfx.scene.add(this.mesh!.group);
    const course = dragonCourse((x, z) => p.floorAt(x, z));
    if (course !== null) this.race.setCourse(course);
    g.stats.suspended = true;
    this.camera.snap(this.heading);
    this.sync();
    this.pushUi(true);
  }

  private dismount() {
    const g = this.game;
    const p = g.player;
    this.riding = false;
    this.race.stop();
    if (this.mesh !== null) g.gfx.scene.remove(this.mesh.group);
    // Off onto the ground under the dragon, facing its way
    const floor = p.floorAt(this.pos.x, this.pos.z);
    const spot = _v.set(this.pos.x, floor + 0.05, this.pos.z);
    p.pos.copy(spot);
    p.vel.set(0, 0, 0);
    p.footYaw = this.heading;
    p.footGrounded = true;
    p.fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    p.up.copy(UP);
    p.safePos.copy(spot);
    p.safeFwd.copy(p.fwd);
    // A fresh ride for the stats / drop proofs (nothing carried off the dragon)
    p.respawns++;
    p.run = 0;
    p.runTime = 0;
    g.stats.suspended = g.missions.ud.active;
    if (g.me !== null) {
      g.me.root.position.copy(spot);
      g.me.root.quaternion.identity();
    }
    g.cam.snap(p);
    this.pushUi(true);
  }

  /** Flight + visuals + camera, instead of the skater, while riding. */
  fly(dt: number, input: InputFrame, now: number) {
    const g = this.game;
    const t = this.touch;
    const turn = THREE.MathUtils.clamp(input.moveX, -1, 1);
    const boost = input.sprint || t.boost;
    const top = boost ? DRAGON.boost : DRAGON.maxSpeed;
    // W / S: speed up / slow down; neither: drift back to cruise
    let want: number = DRAGON.cruise;
    if (input.moveY > 0.1) want = top;
    else if (input.moveY < -0.1) want = DRAGON.minSpeed;
    if (boost) want = DRAGON.boost;
    this.speed += THREE.MathUtils.clamp(
      want - this.speed,
      -DRAGON.accel * dt,
      DRAGON.accel * dt * (boost ? 2 : 1),
    );
    // Turn + bank
    this.heading -=
      turn *
      DRAGON.turnRate *
      dt *
      (0.6 + 0.4 * (DRAGON.maxSpeed / Math.max(20, this.speed)) ** 0.3);
    this.bank += (turn * 0.6 - this.bank) * Math.min(1, dt * 4);
    // Climb / dive
    const up = input.crouch || t.up ? 1 : 0;
    const down = input.noseManual || t.down ? 1 : 0;
    const vy = up * DRAGON.climb - down * DRAGON.dive;
    this.pitch += ((vy / 40) * 0.6 - this.pitch) * Math.min(1, dt * 3);
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    this.vel.set(fx * this.speed, vy, fz * this.speed);
    _from.copy(this.pos);
    this.pos.addScaledVector(this.vel, dt);
    // Ground + ceiling (sampled a little ahead too, so hills lift it early)
    const floor = Math.max(
      g.player.floorAt(this.pos.x, this.pos.z),
      g.player.floorAt(this.pos.x + fx * 12, this.pos.z + fz * 12),
    );
    if (this.pos.y < floor + DRAGON.clearance) {
      this.pos.y = floor + DRAGON.clearance;
      this.vel.y = Math.max(0, this.vel.y);
    }
    this.pos.y = Math.min(this.pos.y, floor + DRAGON.ceiling);
    // Wings: big slow beats climbing, a glide when diving
    this.flap += dt * flapRate(this.speed, vy);
    this.sync();
    this.race.step(dt, _from, this.pos, this.heading);
    // The rider sits in the saddle; the world streams and the network follow
    const p = g.player;
    const seat = this.mesh!.group.localToWorld(_v.copy(SADDLE));
    p.pos.copy(seat);
    p.vel.copy(this.vel);
    p.footYaw = this.heading;
    if (g.me !== null) {
      g.me.root.position.copy(seat);
      g.me.root.quaternion.copy(this.mesh!.group.quaternion);
    }
    g.stats.suspended = true;
    // Aimed at the saddle, so the chase camera looks over the rider's shoulder
    this.camera.update(
      dt,
      this.camTarget.copy(this.pos).setY(this.pos.y + 4),
      this.vel,
      this.heading,
      this.speed,
      'far',
      input.lookX,
      input.lookY,
      now,
      g.cam.shakeScale,
    );
    g.cam.yaw = this.camera.yaw;
    g.cam.orbitYaw = 0;
    this.uiT -= dt;
    if (this.uiT <= 0) {
      this.uiT = 0.2;
      this.pushUi();
    }
  }

  private sync() {
    const m = this.mesh;
    if (m === null) return;
    m.group.position.copy(this.pos);
    m.group.quaternion.setFromEuler(_e.set(-this.pitch, this.heading, this.bank, 'YXZ'));
    flapWings(m, this.flap);
    m.group.updateMatrixWorld(true);
  }

  /** Every frame: the BUY prompt at the Roost, notices fading, HUD numbers. */
  update(dt: number) {
    this.remotes.update(dt, this.game.net.players, this.game.gfx.camera.position);
    if (!this.riding) {
      const shop = !this.blocked() && !dragonOwned(this.game) && this.atShop();
      const owned = dragonOwned(this.game);
      if (shop !== this.ui.atShop || owned !== this.ui.owned) this.pushUi(true);
    }
    if (this.ui.notice !== null && performance.now() - this.noticeAt > 4000) {
      this.ui = { ...this.ui, notice: null };
      this.emit();
    }
  }

  private pushUi(force = false) {
    const g = this.game;
    const floor = this.riding ? g.player.floorAt(this.pos.x, this.pos.z) : 0;
    const next: DragonUi = {
      owned: dragonOwned(g),
      riding: this.riding,
      atShop: !this.riding && !this.blocked() && !dragonOwned(g) && this.atShop(),
      coin: coinOf(g),
      kmh: Math.round(this.riding ? this.speed * 3.6 : 0),
      alt: Math.round(this.riding ? this.pos.y - floor : 0),
      notice: this.ui.notice,
      race: this.riding ? this.race.ui : null,
    };
    const o = this.ui;
    if (
      !force &&
      o.owned === next.owned &&
      o.riding === next.riding &&
      o.atShop === next.atShop &&
      o.kmh === next.kmh &&
      o.alt === next.alt &&
      o.race?.ms === next.race?.ms &&
      o.race?.ring === next.race?.ring &&
      o.race?.dist === next.race?.dist
    )
      return;
    this.ui = next;
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    if (this.mesh !== null) this.game.gfx.scene.remove(this.mesh.group);
    this.remotes.dispose();
    this.race.dispose();
    disposeDragonMeshes();
  }
}

export { DRAGON_COST };
