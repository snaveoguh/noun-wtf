// ── The drivable ice cream van (Noun Trade): get in, drive, get out ─────
//
// The van parked in the plaza (NOUN FM's station) is the one you drive.
// It is a single object the whole time:
//   parked   its walk-in collision (floor, walls, decks, ramp) is a dynamic
//            body in the CollisionWorld, so it can move; the decks prompt and
//            NOUN FM's speakers work as before;
//   driving  the collision body is lifted out (the van is the player now),
//            VanSim drives it on the world's rays, the group follows the sim
//            and NOUN FM's speakers + light show ride along (`game.van` keeps
//            working: same group, so atDecks()/animate() just follow), and
//            the decks prompt is off (nobody can stand at the decks);
//   exit     it parks where it stopped: collision rebuilt at the new pose,
//            the R respawn spot beside the hatch moves with it.
// While driving nothing counts toward skate stats (the tracker is suspended,
// like the Upside Down), drops don't pick up, and the rider is hidden in the
// cab. Other riders see the van: the pose blob carries `vh: 'van'`.

import type { InputFrame } from '../core/Input';
import type { Game } from '../Game';
import type { VanDriveApi } from '../trade/contract';

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { toonify } from '../render/Toon';
import { buildIceCreamVan, iceCreamVanStationCollision } from '../world/IceCreamVan';
import { terrainSurface } from '../world/mountain/terrain';

import { SURFACE_GRIP, WorldGround } from './ground';
import { substeps, VAN, VanSim, type VanControls } from './physics';
import { VanAudio } from './VanAudio';
import { VanCamera } from './VanCamera';

/** CollisionWorld dynamic-body id for the parked van. */
export const VAN_COLLIDER = 'icecream-van';
/** Cab doors (van-local, either side) where E gets you in. */
const DOOR_Z = 2.2;
const DOOR_X = 1.24;
const DOOR_R = 2.0;
/** Above this speed E brakes to a stop first, then lets you out. */
const EXIT_SPEED = 4;

/** What the HUD shows (a new object whenever something changes). */
export interface VanUi {
  driving: boolean;
  /** On foot at a cab door: GET IN. */
  near: boolean;
  kmh: number;
  /** 'R', 'N' or '1'..'6'. */
  gear: string;
  rpm: number;
  boost: number;
  boosting: boolean;
  air: boolean;
  drifting: boolean;
  /** On its roof / side and stopped: suggest R. */
  stuck: boolean;
  /** Braking to a stop before getting out. */
  stopping: boolean;
  horn: boolean;
}

const IDLE_UI: VanUi = {
  driving: false,
  near: false,
  kmh: 0,
  gear: 'N',
  rpm: 0,
  boost: 1,
  boosting: false,
  air: false,
  drifting: false,
  stuck: false,
  stopping: false,
  horn: false,
};

interface WheelVis {
  pivot: THREE.Object3D;
  spinner: THREE.Object3D;
  restY: number;
}

interface RemoteVan {
  group: THREE.Object3D;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

export class VanDrive implements VanDriveApi {
  readonly sim = new VanSim();
  driving = false;
  /** Van model origin (ground level, between the tyres), world space. */
  readonly pos = { x: 0, y: 0, z: 0 };
  /** Touch overlay → controls (VanHud writes these). */
  readonly touch = { steer: 0, gas: false, brake: false, handbrake: false, boost: false };
  ui: VanUi = IDLE_UI;

  private group: THREE.Object3D | null = null;
  private home: { pos: THREE.Vector3; yaw: number } | null = null;
  private wheels: WheelVis[] = [];
  private parkedOnly: THREE.Object3D[] = [];
  private parkGeo: THREE.BufferGeometry | null = null;
  private ground: WorldGround;
  private camera: VanCamera;
  private audio = new VanAudio();
  private controls: VanControls = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    boost: false,
  };
  private toggleQueued = false;
  private hornQueued = false;
  private flipQueued = false;
  private exitQueued = false;
  private listeners = { enter: new Set<() => void>(), exit: new Set<() => void>() };
  private uiListeners = new Set<() => void>();
  private uiAcc = 0;
  private remoteVans = new Map<string, RemoteVan>();
  private origin = new THREE.Vector3();
  private velV = new THREE.Vector3();
  private sinceEnter = 0;

  constructor(private game: Game) {
    this.ground = new WorldGround(game.world);
    this.camera = new VanCamera(game.gfx.camera, game.world);
  }

  // ── VanDriveApi ──

  private roofH: number | null = null;

  /** The van's roof over its origin (m), measured off the model once (the CAMP pet rides up there). */
  get roofHeight(): number {
    if (this.roofH === null && this.group !== null) {
      this.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(this.group);
      if (!box.isEmpty())
        this.roofH = box.max.y - this.group.getWorldPosition(new THREE.Vector3()).y;
    }
    return this.roofH ?? 2.6;
  }

  get heading() {
    if (this.driving) return this.sim.heading;
    if (this.group === null) return 0;
    _v.set(0, 0, 1).applyQuaternion(this.group.quaternion);
    return Math.atan2(_v.x, _v.z);
  }

  get speed() {
    return this.driving ? this.sim.speed : 0;
  }

  on(ev: 'enter' | 'exit', fn: () => void): () => void {
    this.listeners[ev].add(fn);
    return () => this.listeners[ev].delete(fn);
  }

  // ── HUD plumbing ──

  subscribe(fn: () => void) {
    this.uiListeners.add(fn);
    return () => this.uiListeners.delete(fn);
  }

  private setUi(next: VanUi) {
    const u = this.ui;
    if (
      u.driving === next.driving &&
      u.near === next.near &&
      u.kmh === next.kmh &&
      u.gear === next.gear &&
      Math.abs(u.rpm - next.rpm) < 0.04 &&
      Math.abs(u.boost - next.boost) < 0.02 &&
      u.boosting === next.boosting &&
      u.air === next.air &&
      u.drifting === next.drifting &&
      u.stuck === next.stuck &&
      u.stopping === next.stopping &&
      u.horn === next.horn
    )
      return;
    this.ui = next;
    for (const l of this.uiListeners) l();
  }

  /** GET IN / GET OUT from a button (applied on the next frame). */
  requestToggle() {
    this.toggleQueued = true;
  }

  horn() {
    if (this.driving) this.hornQueued = true;
  }

  /** Back onto the wheels (the R key's button). */
  flip() {
    if (this.driving) this.flipQueued = true;
  }

  // ── Parking (called by Game once the station van is placed) ──

  attach(group: THREE.Object3D, home: { pos: THREE.Vector3; yaw: number }) {
    this.group = group;
    this.home = home;
    group.updateMatrixWorld(true);
    this.collectParts(group);
    this.park();
  }

  /** Wheel pivots (suspension + steer) and spinners, and the parked-only bits. */
  private collectParts(group: THREE.Object3D) {
    const tyres: THREE.Mesh[] = [];
    const hubs: THREE.Mesh[] = [];
    group.traverse(o => {
      if (o.name === 'van-tyre') tyres.push(o as THREE.Mesh);
      else if (o.name === 'van-hub') hubs.push(o as THREE.Mesh);
      if (o.userData.parkedOnly === true) this.parkedOnly.push(o);
    });
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const vis: { w: WheelVis; x: number; z: number }[] = [];
    for (const t of tyres) {
      const lp = t.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
      const pivot = new THREE.Object3D();
      pivot.position.copy(lp);
      const spinner = new THREE.Object3D();
      pivot.add(spinner);
      group.add(pivot);
      pivot.updateMatrixWorld(true);
      spinner.attach(t);
      const tw = t.getWorldPosition(new THREE.Vector3());
      let best: THREE.Mesh | null = null;
      for (const h of hubs) {
        if (
          best === null ||
          h.getWorldPosition(_v).distanceTo(tw) < best.getWorldPosition(_v2).distanceTo(tw)
        )
          best = h;
      }
      if (best !== null) spinner.attach(best);
      vis.push({ w: { pivot, spinner, restY: lp.y }, x: lp.x, z: lp.z });
    }
    // Same order as VanSim.wheels: front-left, front-right, rear-left, rear-right (+X = left)
    vis.sort((a, b) => b.z - a.z || b.x - a.x);
    const front = vis.slice(0, 2).sort((a, b) => b.x - a.x);
    const rear = vis.slice(2).sort((a, b) => b.x - a.x);
    this.wheels = [...front, ...rear].map(v => v.w);
  }

  /** Make the van solid where it stands (walk-in collision as a dynamic body). */
  private park() {
    const g = this.group;
    if (g === null) return;
    g.updateMatrixWorld(true);
    this.origin.copy(g.position);
    this.pos.x = g.position.x;
    this.pos.y = g.position.y;
    this.pos.z = g.position.z;
    const meshes = iceCreamVanStationCollision(g);
    const geos = meshes.map(m => {
      const src = m.geometry;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', src.attributes.position.clone());
      if (src.index !== null) geo.setIndex(src.index.clone());
      geo.applyMatrix4(m.matrixWorld);
      geo.translate(-g.position.x, -g.position.y, -g.position.z);
      return geo.index !== null ? geo.toNonIndexed() : geo;
    });
    const merged = mergeGeometries(geos, false);
    for (const geo of geos) geo.dispose();
    for (const m of meshes) m.geometry.dispose();
    this.parkGeo?.dispose();
    this.parkGeo = merged;
    this.game.world.setDynamic(VAN_COLLIDER, merged, g.position);
    for (const o of this.parkedOnly) o.visible = true;
    // NOUN FM's speakers, and R's respawn spot beside the hatch, stay with it
    const st = this.game.van;
    if (st !== null) this.game.fm.vanPos = g.localToWorld(st.speakers.clone());
    if (this.home !== null) {
      const yaw = this.heading;
      this.home.pos.copy(g.position).add(_v.set(3.2, 0, 1).applyAxisAngle(UP, yaw));
      this.home.yaw = yaw + Math.PI / 2;
    }
  }

  // ── Frame hooks ──

  /**
   * Before the skater sees the frame: E at a cab door gets in, E / button
   * while driving gets out, R flips it back over, H honks. While driving the
   * skate-only intents are drained. Returns whether we're driving.
   */
  preStep(input: InputFrame): boolean {
    const g = this.game;
    if (g.hoops.active || g.replay.active || g.showroom) return this.driving;
    const toggle = input.boardTogglePressed || this.toggleQueued;
    this.toggleQueued = false;
    if (!this.driving) {
      if (toggle && this.nearDoor()) {
        input.boardTogglePressed = false;
        this.enter();
      }
    } else if (toggle) {
      if (this.sim.speed <= EXIT_SPEED) this.exit();
      else this.exitQueued = true;
    }
    if (!this.driving) return false;
    if (input.respawnPressed || this.flipQueued) this.sim.recover(this.ground);
    this.flipQueued = false;
    if (this.hornQueued) {
      this.audio.horn();
      this.hornQueued = false;
    }
    // Nothing skate / spray happens from the driver's seat
    input.boardTogglePressed = false;
    input.respawnPressed = false;
    input.jumpPressed = false;
    input.spray = false;
    input.tricks.length = 0;
    input.emotePressed = 0;
    return true;
  }

  /** Is the rider (on foot, or rolling slowly) at one of the cab doors? */
  nearDoor(): boolean {
    const g = this.game;
    const grp = this.group;
    const p = g.player;
    if (grp === null || this.driving || g.hoops.active || g.replay.active || g.showroom)
      return false;
    if (g.cars.inCar) return false;
    if (p.climb !== null || p.vault !== null) return false;
    if (p.mode === 'board' && (p.speed > 6 || p.state !== 'ground')) return false;
    for (const side of [-1, 1]) {
      grp.localToWorld(_v.set(side * (DOOR_X + 0.6), 0.5, DOOR_Z));
      if (Math.hypot(_v.x - p.pos.x, _v.z - p.pos.z) < DOOR_R && Math.abs(_v.y - p.pos.y) < 1.8)
        return true;
    }
    return false;
  }

  private enter() {
    const g = this.game;
    const grp = this.group;
    if (grp === null) return;
    const p = g.player;
    if (p.mode === 'board') p.toggleBoard(); // banks any combo, off the board
    g.world.setDynamic(VAN_COLLIDER, null);
    this.sim.placePose(grp.position.x, grp.position.y, grp.position.z, grp.quaternion);
    for (const o of this.parkedOnly) o.visible = false;
    this.driving = true;
    this.exitQueued = false;
    this.sinceEnter = 0;
    if (g.me !== null) g.me.root.visible = false;
    // Nothing counts while driving (exactly like the Upside Down)
    g.stats.suspended = true;
    this.camera.snap(this.sim.heading);
    g.audio.start();
    this.audio.start(g.audio.ctx, g.audio.master, g.audio.noise);
    for (const fn of this.listeners.enter) fn();
    this.pushUi(true);
  }

  private exit() {
    const g = this.game;
    const grp = this.group;
    if (grp === null || !this.driving) return;
    this.driving = false;
    this.exitQueued = false;
    this.syncGroup();
    this.park();
    this.audio.stop();
    const p = g.player;
    const spot = this.exitSpot(grp);
    const yaw = this.heading;
    p.pos.copy(spot);
    p.vel.set(0, 0, 0);
    p.footYaw = yaw;
    p.footGrounded = true;
    p.fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    p.up.copy(UP);
    p.safePos.copy(spot);
    p.safeFwd.copy(p.fwd);
    // A fresh ride for the stats / drop proofs (nothing carried out of the van)
    p.respawns++;
    p.run = 0;
    p.runTime = 0;
    g.stats.suspended = g.missions.ud.active;
    if (g.me !== null) {
      g.me.root.visible = true;
      g.me.root.position.copy(spot);
    }
    g.cam.snap(p);
    for (const fn of this.listeners.exit) fn();
    this.pushUi(true);
  }

  /** Beside the driver's door if it's clear, else the other door, the back, the front, the roof. */
  private exitSpot(grp: THREE.Object3D): THREE.Vector3 {
    const w = this.game.world;
    const spots: [number, number, number][] = [
      [DOOR_X + 1.0, 0, DOOR_Z - 0.4],
      [-(DOOR_X + 1.0), 0, DOOR_Z - 0.4],
      [0, 0, -4.4],
      [0, 0, 4.2],
    ];
    const n = new THREE.Vector3();
    for (const [x, y, z] of spots) {
      const s = grp.localToWorld(new THREE.Vector3(x, y, z));
      const hit = w.raycast(_v.copy(s).setY(s.y + 2.5), DOWN, 6);
      if (hit === null || hit.normal.y < 0.6) continue;
      s.y = hit.point.y;
      const corr = w.capsulePushout(
        _v.copy(s).setY(s.y + 0.45),
        _v2.copy(s).setY(s.y + 1.55),
        0.32,
        n,
      );
      if (corr.length() < 0.05) return s;
    }
    return grp.localToWorld(new THREE.Vector3(0, 4.2, 0));
  }

  /** The physics + visuals + camera + audio frame while driving (instead of the skater). */
  drive(dt: number, input: InputFrame, now: number) {
    const g = this.game;
    const sim = this.sim;
    this.sinceEnter += dt;
    // Surface grip under the van, once a frame
    const s =
      g.player.terrain?.inDomain(sim.pos.x, sim.pos.z) === true
        ? terrainSurface(sim.pos.x, sim.pos.z)
        : null;
    this.ground.grip = SURFACE_GRIP[s ?? 'city'];

    const c = this.controls;
    const t = this.touch;
    const pad = input.mode === 'gamepad';
    c.steer = Math.max(-1, Math.min(1, input.moveX + t.steer));
    c.throttle = Math.max(
      input.moveY > 0 ? input.moveY : 0,
      t.gas ? 1 : 0,
      pad && input.grabR ? 1 : 0,
    );
    c.brake = Math.max(
      input.moveY < 0 ? -input.moveY : 0,
      input.brake ? 1 : 0,
      t.brake ? 1 : 0,
      pad && input.grabL ? 1 : 0,
    );
    c.handbrake = input.crouch || t.handbrake || (pad && input.push);
    c.boost = input.sprint || t.boost;
    if (this.exitQueued) {
      c.throttle = 0;
      c.brake = 1;
      c.boost = false;
      if (sim.speed <= EXIT_SPEED) {
        this.exit();
        return;
      }
    }

    const n = substeps(dt, sim.speed);
    const h = dt / n;
    sim.impact = 0;
    sim.landing = 0;
    for (let i = 0; i < n; i++) sim.step(h, c, this.ground);
    if (sim.pos.y < g.player.floorAt(sim.pos.x, sim.pos.z) - 40) sim.recover(this.ground);
    // Auto-flip after a few seconds stuck on the roof
    if (sim.stuck > 4) sim.recover(this.ground);

    this.syncGroup();
    // The rider rides along: the world streams, the network and missions follow the van
    const p = g.player;
    p.pos.copy(this.origin);
    p.vel.set(sim.vel.x, sim.vel.y, sim.vel.z);
    p.footYaw = sim.heading;
    if (g.me !== null) {
      g.me.root.position.copy(this.origin);
      g.me.root.quaternion.copy(_q.set(sim.q.x, sim.q.y, sim.q.z, sim.q.w));
    }
    g.stats.suspended = true;
    // NOUN FM's speakers ride along
    const st = g.van;
    if (st !== null && g.fm.vanPos !== null) {
      g.fm.vanPos.copy(st.speakers);
      this.group?.localToWorld(g.fm.vanPos);
    }

    // Camera (the skate camera's yaw follows, so the compass + exit view line up)
    this.velV.set(sim.vel.x, sim.vel.y, sim.vel.z);
    if (sim.impact > 3) this.camera.addShake(Math.min(0.8, sim.impact / 25));
    if (sim.landing > 5) this.camera.addShake(Math.min(0.5, sim.landing / 30));
    this.camera.update(
      dt,
      this.origin,
      this.velV,
      sim.heading,
      sim.forwardSpeed,
      g.cam.mode,
      input.lookX,
      input.lookY,
      now,
      g.cam.shakeScale,
    );
    g.cam.yaw = this.camera.yaw;
    g.cam.orbitYaw = 0;

    // Audio
    let slip = 0;
    for (const wh of sim.wheels) slip = Math.max(slip, wh.slip);
    this.audio.update(sim.rpm, sim.gear, c.throttle, slip, sim.boosting, sim.grounded === 0);
    if (sim.impact > 3) this.audio.thud(Math.min(1, sim.impact / 20));
    else if (sim.landing > 6) this.audio.thud(Math.min(1, sim.landing / 25));
    if (sim.landing > 6) g.particles.dustAt(this.origin, Math.min(1, sim.landing / 18));
  }

  /** Model follows the sim; wheels show suspension, steering and spin. */
  private syncGroup() {
    const grp = this.group;
    const sim = this.sim;
    if (grp === null) return;
    sim.origin(this.origin);
    grp.position.copy(this.origin);
    grp.quaternion.set(sim.q.x, sim.q.y, sim.q.z, sim.q.w);
    this.pos.x = this.origin.x;
    this.pos.y = this.origin.y;
    this.pos.z = this.origin.z;
    const sag = (VAN.mass * VAN.gravity) / 4 / VAN.spring;
    for (let i = 0; i < this.wheels.length && i < 4; i++) {
      const w = this.wheels[i];
      const ws = sim.wheels[i];
      const off = ws.contact ? Math.min(0.26, ws.x - sag) : -sag - 0.04;
      w.pivot.position.y = w.restY + off;
      w.pivot.rotation.y = ws.front ? -sim.steerAngle : 0;
      w.spinner.rotation.x = ws.spin;
    }
    grp.updateMatrixWorld(true);
  }

  /** Every frame (after the network): GET IN prompt, other riders' vans, HUD. */
  update(dt: number) {
    this.updateRemotes();
    this.uiAcc += dt;
    if (this.driving) {
      if (this.uiAcc >= 1 / 12) this.pushUi(false);
    } else if (this.uiAcc >= 1 / 8) this.pushUi(false);
  }

  private pushUi(force: boolean) {
    this.uiAcc = 0;
    if (!this.driving) {
      const near = this.nearDoor();
      if (force || near !== this.ui.near || this.ui.driving) this.setUi({ ...IDLE_UI, near });
      return;
    }
    const sim = this.sim;
    const fs = sim.forwardSpeed;
    this.setUi({
      driving: true,
      near: false,
      kmh: Math.round(Math.abs(fs) * 3.6),
      gear:
        sim.gear < 0
          ? 'R'
          : Math.abs(fs) < 0.5 && this.controls.throttle === 0
            ? 'N'
            : String(sim.gear),
      rpm: sim.rpm,
      boost: sim.boostTank,
      boosting: sim.boosting,
      air: sim.grounded === 0 && sim.airTime > 0.25,
      drifting: sim.drifting,
      stuck: sim.stuck > 1,
      stopping: this.exitQueued,
      horn: this.audio.hornPlaying,
    });
  }

  /** Riders driving a van show as one (their avatar hidden inside). */
  private updateRemotes() {
    const g = this.game;
    const hideAll = g.missions.ud.active;
    for (const [id, rp] of g.net.players) {
      const inVan = rp.current.vehicle === 'van';
      let rv = this.remoteVans.get(id);
      const r = g.remotes.get(id);
      if (!inVan || hideAll) {
        if (rv !== undefined) {
          g.gfx.scene.remove(rv.group);
          this.remoteVans.delete(id);
          if (r !== undefined && !hideAll) r.character.root.visible = true;
        }
        continue;
      }
      if (rv === undefined) {
        const grp = buildIceCreamVan();
        grp.traverse(o => {
          if (o.userData.parkedOnly === true) o.visible = false;
        });
        if (g.gfx.toon) toonify(grp);
        g.gfx.scene.add(grp);
        rv = { group: grp };
        this.remoteVans.set(id, rv);
      }
      rv.group.position.copy(rp.current.pos);
      rv.group.quaternion.copy(rp.current.quat);
      if (r !== undefined) r.character.root.visible = false;
    }
    for (const [id, rv] of this.remoteVans) {
      if (g.net.players.has(id)) continue;
      g.gfx.scene.remove(rv.group);
      this.remoteVans.delete(id);
    }
  }

  dispose() {
    this.audio.stop();
    for (const rv of this.remoteVans.values()) this.game.gfx.scene.remove(rv.group);
    this.remoteVans.clear();
    this.parkGeo?.dispose();
    this.listeners.enter.clear();
    this.listeners.exit.clear();
    this.uiListeners.clear();
  }
}
