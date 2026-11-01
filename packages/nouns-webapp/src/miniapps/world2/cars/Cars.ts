// ── Noun World's cars: kerbside fleet, slow traffic, take any car (E) ──────
//
// The plaza's ring road gets the fleet (specs.ts): one of every car parked
// at the kerb where the level's old boxy cars stood, and a couple cruising
// the lanes (lanes.ts). Walk up to any parked or slow car, press E and it's
// yours: the AI driver hops out, the doors swing (the TORO's go up), and you
// drive it on the same raycast-vehicle physics as the ice cream van
// (van/physics.ts VanSim with the car's own numbers). The ROADSTAR flies:
// at speed X fires the thrusters (flight.ts). E again parks it where it is.
//
// Same shape as van/VanDrive.ts, generalised over a car:
//   parked   a static merged mesh (one draw call + glow) and a box collider
//            in the CollisionWorld, so you can bump into it, grind its roof;
//   cruising the rigged model follows its lane; its collider moves with it;
//   driven   the collider lifts out (the car is the player now), the sim
//            drives the rig, VanCamera chases it; stats are suspended;
//   exit     it parks where it stopped.
// Other riders see your car (net: vh 'car' + cr, see netCar.ts).
//
// Riding together (seats.ts): E beside a car someone else is driving puts
// you in their passenger seat. You ride in their car as other riders see it
// (its interpolated pose), the chase camera follows it, E gets you out at
// the next stop. Their client decides who sits where (`ps`), so a seat
// never holds two; if they get out or go, you're put out beside the car.
// Open cars show everyone in their seats; closed cars hide them.

import type { InputFrame } from '../core/Input';
import type { Game } from '../Game';
import type { CarModel } from './models';
import type { LevelData } from '../world/Level';

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { toonify } from '../render/Toon';
import { SURFACE_GRIP, WorldGround } from '../van/ground';
import { substeps, VanSim, type VanControls } from '../van/physics';
import { VanCamera } from '../van/VanCamera';
import { terrainSurface } from '../world/mountain/terrain';

import { CarAudio } from './CarAudio';
import { DOOR_OPEN, DoorAnim, enterDelay } from './doors';
import { canLiftOff, FlightSim } from './flight';
import { buildAnyCar, preloadKenney } from './kenneyModel';
import { carMaterials } from './kit';
import {
  followSpeed,
  laneLength,
  LANES,
  lanePoint,
  nearestS,
  parkSpot,
  planTraffic,
  type TrafficPlan,
  PARK_SPOTS,
  ROAD_Y,
  wrapAngle,
  type LanePoint,
} from './lanes';
import { poseDoors } from './models';
import {
  decodeCar,
  decodeParked,
  encodeCar,
  encodeCrew,
  encodeParked,
  encodeRide,
  type NetParked,
  parkedKey,
  takenFrom,
  type NetCar,
} from './netCar';
import { leaveSeat, poseInSeat } from './seatPose';
import {
  assignSeats,
  freeSeat,
  passengerSeats,
  RIDER_SCALE,
  rideCheck,
  riderShown,
  seatRoot,
  type RideCheck,
  type SeatAsk,
} from './seats';
import { CAR_IDS, CARS, simParams, type CarId, type CarSpec } from './specs';

/** CollisionWorld dynamic-body ids: `car|<n>|`. */
const COLLIDER = 'car|';
/** Above this speed E brakes to a stop first, then lets you out. */
const EXIT_SPEED = 4;
/** A cruising car this slow (or slower) can be taken. */
const TAKE_SPEED = 7.5;
/** Traffic further than this from the camera isn't drawn. */
const DRAW_DIST = 190;
/** Someone else's car this slow (m/s) or slower can be boarded. */
const BOARD_SPEED = 8;
/** A driver silent this long (ms) has gone (a frozen tab, a dropped line): passengers get out. */
const DRIVER_GONE_MS = 8000;

export interface CarUi {
  driving: boolean;
  /** On foot beside a car you could take. */
  near: { id: CarId; name: string; tagline: string; credit: string } | null;
  car: { id: CarId; name: string; credit: string; special: CarSpec['special'] } | null;
  kmh: number;
  gear: string;
  rpm: number;
  boost: number;
  boosting: boolean;
  air: boolean;
  drifting: boolean;
  stuck: boolean;
  stopping: boolean;
  flying: boolean;
  /** ROADSTAR on the ground, fast enough: show the X prompt. */
  canFly: boolean;
  /** Height above the ground while flying (m). */
  alt: number;
  /** A crash this moment (SMASH!). */
  smash: boolean;
  /** On foot beside someone else's car with a free seat: E rides along. */
  nearRide: { driver: string; who: string; car: string } | null;
  /** In someone's passenger seat. */
  ride: {
    who: string;
    car: string;
    seat: number;
    /** Their client hasn't confirmed the seat yet. */
    pending: boolean;
    /** E pressed while moving: out at the next stop. */
    leaving: boolean;
    flying: boolean;
  } | null;
  /** Driving: who's riding with you (names). */
  crew: string[];
  /** A one-off line (seat taken, the driver left…). */
  notice: string;
}

const IDLE_UI: CarUi = {
  driving: false,
  near: null,
  car: null,
  kmh: 0,
  gear: 'N',
  rpm: 0,
  boost: 1,
  boosting: false,
  air: false,
  drifting: false,
  stuck: false,
  stopping: false,
  flying: false,
  canFly: false,
  alt: 0,
  smash: false,
  nearRide: null,
  ride: null,
  crew: [],
  notice: '',
};

/** Who built a car's body (shown when you take it / drive it). */
export function carCredit(spec: CarSpec): string {
  return spec.source === 'procedural' ? '' : 'body: Kenney Car Kit (CC0)';
}

interface TCar {
  n: number;
  col: string;
  spec: CarSpec;
  paint: number;
  model: CarModel;
  /** Merged parked mesh (null until first parked). */
  still: THREE.Mesh | null;
  mode: 'parked' | 'cruise' | 'driven';
  /** An AI driver sits in it (cruisers). */
  ai: boolean;
  lane: number;
  s: number;
  base: number;
  v: number;
  /** Seconds stuck behind something that isn't moving. */
  blocked: number;
  /** Seconds left reeling from a knock. */
  bumped: number;
  /** Model origin + heading while parked / cruising. */
  pos: THREE.Vector3;
  yaw: number;
  doors: DoorAnim;
  colGeo: THREE.BufferGeometry | null;
  colYaw: number;
  colPos: THREE.Vector3;
  spin: number;
  /** Where it lives in the traffic plan (it goes back there if another rider takes it). */
  home: TrafficPlan | null;
}

interface Hopper {
  mesh: THREE.Object3D;
  t: number;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  yaw: number;
}

interface RemoteCar {
  key: string;
  model: CarModel;
  last: THREE.Vector3;
  spin: number;
  car: NetCar;
  /** Smoothed velocity (m/s) from the interpolated pose. */
  vel: THREE.Vector3;
  /** Seconds since this car appeared under them. */
  age: number;
}

interface ParkedRemote {
  key: string;
  model: CarModel;
  p: NetParked;
}

/** Me in someone else's car. */
interface Ride {
  driver: string;
  seat: number;
  /** Seconds since I asked. */
  waited: number;
  status: RideCheck;
  /** E pressed while it was moving: out once it stops. */
  leaving: boolean;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _lp: LanePoint = { x: 0, z: 0, yaw: 0 };
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

const staticCache = new Map<string, THREE.BufferGeometry>();

export class CarSystem {
  readonly touch = { steer: 0, gas: false, brake: false, handbrake: false, boost: false };
  ui: CarUi = IDLE_UI;
  /** Every car on the road (parked, cruising, driven). */
  readonly fleet: TCar[] = [];

  private driven: TCar | null = null;
  private sim: VanSim | null = null;
  private sims = new Map<CarId, VanSim>();
  private flight: FlightSim | null = null;
  private flying = false;
  /** X in the air: sinking until it lands. */
  private dropping = false;
  private entering = 0;
  private ground: WorldGround;
  private camera: VanCamera;
  private audio = new CarAudio();
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
  private specialQueued = false;
  private exitQueued = false;
  private hopSide = 0;
  private smashT = 0;
  private uiListeners = new Set<() => void>();
  private uiAcc = 0;
  private origin = new THREE.Vector3();
  private velV = new THREE.Vector3();
  private hoppers: Hopper[] = [];
  private remotes = new Map<string, RemoteCar>();
  /** Cars other riders got out of (their `lc`), parked where they left them. */
  private parkedRemotes = new Map<string, ParkedRemote>();
  /** Parked cars of other riders that I drove off in, by owner: their `lc` key then. */
  private claimed = new Map<string, string>();
  /** The car you last got out of, while it stays parked (your `lc`). */
  private left: TCar | null = null;
  private remotePool = new Map<string, CarModel[]>();
  private started = false;
  private hidden = false;
  private camPos = new THREE.Vector3();
  private gone = false;
  /** Driving: passengers by seat (seat i+1), '' = empty. */
  private crew: string[] = [];
  /** Driving: when each asker was first seen asking (ms). */
  private askedAt = new Map<string, number>();
  /** Riding in someone else's car, else null. */
  private ride: Ride | null = null;
  /** Remote riders posed in a car last frame (their scale comes back on leaving). */
  private seated = new Set<string>();
  private look = { x: 0, y: 0, now: 0 };
  private notice = '';
  private noticeT = 0;

  constructor(private game: Game) {
    this.ground = new WorldGround(game.world);
    this.camera = new VanCamera(game.gfx.camera, game.world);
  }

  get driving(): boolean {
    return this.driven !== null;
  }

  /** Driving, or riding in someone's passenger seat (the skater sits out). */
  get inCar(): boolean {
    return this.driven !== null || this.ride !== null;
  }

  /** Riding in someone's passenger seat (tests / dev). */
  get passenger(): { driver: string; seat: number; status: RideCheck } | null {
    const r = this.ride;
    return r === null ? null : { driver: r.driver, seat: r.seat, status: r.status };
  }

  /** The car in your hands (tests / dev), else null. */
  get current(): { spec: CarSpec; sim: VanSim; flying: boolean; model: CarModel } | null {
    const d = this.driven;
    if (d === null || this.sim === null) return null;
    return { spec: d.spec, sim: this.sim, flying: this.flying, model: d.model };
  }

  /** For the pose blob while driving (cars/netCar.ts), else undefined. */
  get netKey(): string | undefined {
    const d = this.driven;
    if (d === null) return undefined;
    return encodeCar({
      id: d.spec.id,
      paint: d.paint,
      flying: this.flying,
      doorsOpen: d.doors.k > 0.5,
      boosting: this.sim?.boosting === true || (this.flying && this.controls.boost),
    });
  }

  /** For the pose blob once you've got out of a car (cars/netCar.ts `lc`), else undefined. */
  get leftKey(): [string, number, number, number, number] | undefined {
    const t = this.left;
    if (t === null || this.driven !== null || t.mode !== 'parked') return undefined;
    return encodeParked({
      id: t.spec.id,
      paint: t.paint,
      x: t.pos.x,
      y: t.pos.y,
      z: t.pos.z,
      yaw: t.yaw,
    });
  }

  // ── HUD plumbing ──

  subscribe(fn: () => void) {
    this.uiListeners.add(fn);
    return () => this.uiListeners.delete(fn);
  }

  requestToggle() {
    this.toggleQueued = true;
  }

  horn() {
    if (this.driving) this.hornQueued = true;
  }

  flip() {
    if (this.driving) this.flipQueued = true;
  }

  /** X / SPECIAL: lift off (ROADSTAR), hydraulics (DIP), stomp (STOMPA). */
  special() {
    if (this.driving) this.specialQueued = true;
  }

  // ── Level ──

  /**
   * Before the world's collision is built: hide the level's own boxy cars
   * (plaza.glb Props, materials car_* / tire) and cut their boxes out of
   * COL_Props, so the fleet can park in their spots.
   */
  stripBaked(level: LevelData) {
    if (!carsOn()) return;
    let hiddenMeshes = 0;
    level.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.every(x => /^(car_|tire)/.test(x.name))) {
        m.visible = false;
        hiddenMeshes++;
      }
    });
    if (hiddenMeshes === 0) return;
    const boxes = PARK_SPOTS.map(([x, z]) => {
      const along = Math.abs(z) > Math.abs(x) ? 'x' : 'z';
      const hx = along === 'x' ? 2.6 : 1.25;
      const hz = along === 'x' ? 1.25 : 2.6;
      return new THREE.Box3(
        new THREE.Vector3(x - hx, 0.02, z - hz),
        new THREE.Vector3(x + hx, 2.5, z + hz),
      );
    });
    for (const m of level.collisionMeshes) {
      if (!/^col_props/i.test(m.name)) continue;
      cutInside(m, boxes);
    }
  }

  /** After the world is built: park the fleet and start the traffic. */
  start(level: LevelData) {
    if (!level.baked || this.started || !carsOn()) return;
    this.started = true;
    const low = this.game.gfx.quality === 'low';
    const specs = CAR_IDS.map(id => CARS[id]);
    void preloadKenney(specs).then(() => {
      if (this.gone) return;
      const plan = planTraffic(CAR_IDS, {
        seed: 4217,
        cruisers: low ? 2 : 3,
        paints: id => CARS[id].paints.length,
      });
      for (const p of plan) {
        const t = this.spawn(CARS[p.car], p.paint);
        t.home = p;
        this.placeHome(t, p);
      }
      console.info('[cars] fleet out', plan.length);
    });
  }

  /** Put a fleet car where the traffic plan has it: at its kerb spot, or cruising its lane. */
  private placeHome(t: TCar, p: TrafficPlan) {
    if (p.kind === 'parked') {
      const sp = parkSpot(p.spot);
      t.pos.set(sp.x, this.groundY(sp.x, sp.z, ROAD_Y), sp.z);
      t.yaw = sp.yaw;
      this.park(t);
    } else {
      t.mode = 'cruise';
      t.ai = true;
      t.lane = p.lane;
      t.s = p.s;
      t.base = p.speed;
      t.v = p.speed;
      t.model.driver.visible = true;
      this.placeOnLane(t);
      t.model.group.visible = !this.hidden;
      this.setCollider(t, !this.hidden);
    }
  }

  private spawn(spec: CarSpec, paint: number): TCar {
    const model = buildAnyCar(spec, paint);
    if (this.game.gfx.toon) toonify(model.group);
    model.group.visible = false;
    this.game.gfx.scene.add(model.group);
    const n = this.fleet.length;
    const t: TCar = {
      n,
      col: `${COLLIDER}${n}|`,
      spec,
      paint,
      model,
      still: null,
      mode: 'parked',
      ai: false,
      lane: 0,
      s: 0,
      base: 6,
      v: 0,
      blocked: 0,
      bumped: 0,
      pos: new THREE.Vector3(),
      yaw: 0,
      doors: new DoorAnim(spec.doors),
      colGeo: null,
      colYaw: NaN,
      colPos: new THREE.Vector3(),
      spin: 0,
      home: null,
    };
    this.fleet.push(t);
    return t;
  }

  /** Ground height under (x, z) (the level's rays), or `fallback`. */
  private groundY(x: number, z: number, fallback: number): number {
    const hit = this.game.world.raycast(_v.set(x, 6, z), DOWN, 14);
    return hit !== null && hit.normal.y > 0.6 ? hit.point.y : fallback;
  }

  // ── Parked: one merged mesh + a box collider ──

  private park(t: TCar) {
    t.mode = 'parked';
    t.ai = false;
    t.v = 0;
    const m = t.model;
    m.driver.visible = false;
    m.group.position.copy(t.pos);
    m.group.quaternion.setFromAxisAngle(UP, t.yaw);
    m.group.updateMatrixWorld(true);
    if (t.still === null) {
      const key = `${t.spec.id}:${t.paint}`;
      let geo = staticCache.get(key);
      if (geo === undefined) {
        geo = bakeStatic(m);
        staticCache.set(key, geo);
      }
      const [pm, gm] = carMaterials();
      const mesh = new THREE.Mesh(geo, [pm, gm]);
      mesh.name = `car-parked-${t.spec.id}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (this.game.gfx.toon) toonify(mesh);
      this.game.gfx.scene.add(mesh);
      t.still = mesh;
    }
    t.still.position.copy(t.pos);
    t.still.quaternion.copy(m.group.quaternion);
    t.still.updateMatrixWorld(true);
    // Doors still swinging (just got out): keep the rig until they're shut
    const moving = t.doors.phase !== 'shut';
    t.still.visible = !moving && !this.hidden;
    m.group.visible = moving && !this.hidden;
    this.setCollider(t, true);
  }

  /** The car's box in the CollisionWorld at its pose (null = lift it out). */
  private setCollider(t: TCar, on: boolean) {
    const w = this.game.world;
    if (!on) {
      w.setDynamic(t.col, null);
      t.colYaw = NaN;
      return;
    }
    if (Math.abs(wrapAngle(t.yaw - t.colYaw)) < 0.04) {
      // Same heading: slide it (no BVH rebuild)
      _v.copy(t.pos).sub(t.colPos);
      if (_v.lengthSq() > 1e-8) {
        w.shiftDynamic(t.col, _v);
        t.colPos.copy(t.pos);
      }
      return;
    }
    t.colGeo?.dispose();
    const g = t.spec.geo;
    const h = g.height * (t.spec.open ? 0.66 : 0.82);
    const geo = new THREE.BoxGeometry(g.width * 0.9, h - 0.15, g.length * 0.94);
    geo.translate(0, 0.15 + (h - 0.15) / 2, 0);
    geo.rotateY(t.yaw);
    t.colGeo = geo;
    t.colYaw = t.yaw;
    t.colPos.copy(t.pos);
    w.setDynamic(t.col, geo, t.pos);
  }

  // ── Cruising ──

  private placeOnLane(t: TCar) {
    const lane = LANES[t.lane];
    lanePoint(lane, t.s, _lp);
    t.pos.set(_lp.x, ROAD_Y, _lp.z);
    t.yaw = _lp.yaw;
    const g = t.model.group;
    g.position.copy(t.pos);
    g.quaternion.setFromAxisAngle(UP, t.yaw);
  }

  /** How far ahead (m, bumper to bumper) the lane is clear for a cruiser. */
  private clearAhead(t: TCar): { gap: number; still: boolean } {
    const fx = Math.sin(t.yaw);
    const fz = Math.cos(t.yaw);
    const half = t.spec.geo.length / 2;
    let gap = Infinity;
    let still = true;
    const consider = (x: number, z: number, len: number, moving: boolean, wide = 1.4) => {
      const dx = x - t.pos.x;
      const dz = z - t.pos.z;
      const along = dx * fx + dz * fz;
      const side = Math.abs(dx * fz - dz * fx);
      if (along <= 0 || along > 30 || side > wide) return;
      const d = along - half - len / 2;
      if (d < gap) {
        gap = d;
        still = !moving;
      }
    };
    for (const o of this.fleet) {
      if (o === t) continue;
      const p = o.mode === 'driven' ? this.origin : o.pos;
      consider(p.x, p.z, o.spec.geo.length, o.mode !== 'parked', o.spec.geo.width / 2 + 0.9);
    }
    const g = this.game;
    if (!this.driving) consider(g.player.pos.x, g.player.pos.z, 0.6, true, 1.6);
    const van = g.van2.pos;
    consider(van.x, van.z, 6.5, g.van2.driving, 2.2);
    return { gap, still };
  }

  private cruise(t: TCar, dt: number) {
    if (t.bumped > 0) {
      t.bumped -= dt;
      t.v = Math.max(0, t.v - 12 * dt);
    } else {
      const { gap, still } = this.clearAhead(t);
      const want = followSpeed(t.base, gap);
      t.v += THREE.MathUtils.clamp(want - t.v, -9 * dt, 2.2 * dt);
      // Stuck behind something parked in the lane: change lanes
      t.blocked = want < 0.5 && still ? t.blocked + dt : 0;
      if (t.blocked > 3.5) {
        t.blocked = 0;
        const other = (t.lane + 1) % LANES.length;
        t.lane = other;
        t.s = nearestS(LANES[other], t.pos.x, t.pos.z).s + 6;
      }
    }
    t.s = (t.s + t.v * dt) % laneLength(LANES[t.lane]);
    this.placeOnLane(t);
    t.spin = (t.spin + (t.v / t.spec.geo.wheelR) * dt) % (Math.PI * 2);
    for (const w of t.model.wheels) {
      w.spinner.rotation.x = t.spin;
      w.pivot.position.y = w.restY;
    }
    this.setCollider(t, true);
  }

  // ── Frame hooks ──

  /**
   * Before the skater: E beside a car takes it, E while driving gets out
   * (after braking), R flips it, X its special. Returns whether we're driving.
   */
  preStep(input: InputFrame): boolean {
    const g = this.game;
    if (g.hoops.active || g.replay.active || g.showroom) return this.inCar;
    const toggle = input.boardTogglePressed || this.toggleQueued;
    this.toggleQueued = false;
    if (this.ride !== null) {
      // A passenger: E gets out (at the next stop); nothing else is yours
      if (toggle) this.askOut();
      input.boardTogglePressed = false;
      input.respawnPressed = false;
      input.jumpPressed = false;
      input.spray = false;
      input.tricks.length = 0;
      input.emotePressed = 0;
      this.look.x = input.lookX;
      this.look.y = input.lookY;
      return this.ride !== null;
    }
    if (!this.driving) {
      if (toggle) {
        // Someone's free seat beats an empty car (each client parks its own
        // fleet, so the car they took may still sit at the kerb here)
        const r = this.nearestRide();
        const pick = r === null ? this.nearestCar() : null;
        const t = pick?.t ?? null;
        if (r !== null) {
          input.boardTogglePressed = false;
          this.joinRide(r.driver, r.seat);
          return true;
        }
        if (pick?.parked !== undefined) {
          input.boardTogglePressed = false;
          this.takeParked(pick.parked.owner);
        } else if (t !== null) {
          input.boardTogglePressed = false;
          this.enter(t);
        }
      }
    } else if (toggle && this.entering <= 0) {
      if (this.flying || (this.sim !== null && this.sim.speed > EXIT_SPEED)) this.exitQueued = true;
      else this.exit();
    }
    if (!this.driving) return false;
    if ((input.respawnPressed || this.flipQueued) && !this.flying && this.sim !== null)
      this.sim.recover(this.ground);
    this.flipQueued = false;
    if (this.hornQueued) {
      this.audio.horn();
      this.hornQueued = false;
    }
    if (input.mode === 'gamepad' && input.jumpPressed) this.specialQueued = true;
    input.boardTogglePressed = false;
    input.respawnPressed = false;
    input.jumpPressed = false;
    input.spray = false;
    input.tricks.length = 0;
    input.emotePressed = 0;
    return true;
  }

  /**
   * `?play=drive` (the homepage's NOUN DRIVE card): put the rider beside a
   * parked car (the ROADSTAR if it's at the kerb) and in it. False until the
   * fleet is out.
   */
  arrive(id: CarId = 'roadstar'): boolean {
    if (this.driving) return true;
    const t =
      this.fleet.find(x => x.spec.id === id && x.mode === 'parked') ??
      this.fleet.find(x => x.mode === 'parked');
    if (t === undefined || this.hidden) return false;
    const p = this.game.player;
    const side = t.spec.geo.width / 2 + 0.8;
    p.pos.set(t.pos.x + Math.cos(t.yaw) * side, t.pos.y + 0.05, t.pos.z - Math.sin(t.yaw) * side);
    p.vel.set(0, 0, 0);
    this.enter(t);
    return true;
  }

  /** The car you'd take with E right now (on foot / slow board, beside it), or null. */
  nearestTakeable(): TCar | null {
    return this.nearestCar()?.t ?? null;
  }

  /** Could the rider get into a car at all right now (on foot / slow board, nothing else on)? */
  private canTake(): boolean {
    const g = this.game;
    const p = g.player;
    if (this.driving || this.hidden || g.hoops.active || g.replay.active || g.showroom)
      return false;
    if (g.van2.driving || g.dragon.riding) return false;
    if (p.climb !== null || p.vault !== null) return false;
    if (p.mode === 'board' && (p.speed > 6 || p.state !== 'ground')) return false;
    return true;
  }

  /** How far the rider is from a car's side at this pose (its frame), or null if not beside it. */
  private besideAt(x: number, y: number, z: number, yaw: number, spec: CarSpec): number | null {
    const p = this.game.player;
    const dx = p.pos.x - x;
    const dz = p.pos.z - z;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // into the car's frame (+X left, +Z forward)
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    const g2 = spec.geo;
    if (Math.abs(lx) > g2.width / 2 + 1.5 || Math.abs(lz) > g2.length / 2 + 0.9) return null;
    if (Math.abs(p.pos.y - y) > g2.height + 1.2) return null;
    return Math.hypot(lx, lz);
  }

  /**
   * The car E would take: one of the fleet, or one another rider got out of
   * (their `lc`, which we only draw: taking it drives our fleet's copy of
   * that model off from its spot, in its paint). Nearest wins.
   */
  private nearestCar(): { t: TCar | null; parked?: { owner: string; spec: CarSpec } } | null {
    if (!this.canTake()) return null;
    let best: { t: TCar | null; parked?: { owner: string; spec: CarSpec } } | null = null;
    let bestD = Infinity;
    for (const t of this.fleet) {
      if (t.mode === 'driven') continue;
      if (t.mode === 'cruise' && t.v > TAKE_SPEED) continue;
      const d = this.besideAt(t.pos.x, t.pos.y, t.pos.z, t.yaw, t.spec);
      if (d !== null && d < bestD) {
        bestD = d;
        best = { t };
      }
    }
    for (const [owner, pr] of this.parkedRemotes) {
      const p = pr.p;
      const spec = CARS[p.id];
      if (!this.fleet.some(t => t.spec.id === p.id)) continue;
      const d = this.besideAt(p.x, p.y, p.z, p.yaw, spec);
      if (d !== null && d < bestD) {
        bestD = d;
        best = { t: null, parked: { owner, spec } };
      }
    }
    return best;
  }

  /** Get into the car `owner` left parked: our copy of it goes there, in their paint, and we drive. */
  private takeParked(owner: string) {
    const pr = this.parkedRemotes.get(owner);
    if (pr === undefined) return;
    const p = pr.p;
    const t =
      this.fleet.find(x => x.spec.id === p.id && x.mode === 'parked') ??
      this.fleet.find(x => x.spec.id === p.id && x.mode !== 'driven');
    if (t === undefined) return;
    if (t.paint !== p.paint) this.repaint(t, p.paint);
    if (t.ai) {
      // its cruising driver just isn't there any more (it's somewhere else now)
      t.ai = false;
      t.model.driver.visible = false;
    }
    t.mode = 'parked';
    t.v = 0;
    t.pos.set(p.x, p.y, p.z);
    t.yaw = p.yaw;
    this.claimed.set(owner, parkedKey(p));
    this.releaseRemote(pr);
    this.parkedRemotes.delete(owner);
    this.enter(t);
  }

  /** Rebuild a fleet car in another paint. */
  private repaint(t: TCar, paint: number) {
    const g = this.game;
    g.gfx.scene.remove(t.model.group);
    const model = buildAnyCar(t.spec, paint);
    if (g.gfx.toon) toonify(model.group);
    model.group.visible = false;
    g.gfx.scene.add(model.group);
    t.model = model;
    t.paint = paint;
    if (t.still !== null) {
      g.gfx.scene.remove(t.still);
      t.still = null;
    }
  }

  /**
   * The car I left parked: once another rider drives off in it (their copy
   * of it turns up right where it stood), mine goes back home so there
   * aren't two of it, and my `lc` stops.
   */
  private checkLeftTaken() {
    const t = this.left;
    if (t === null || this.driven !== null || t.mode !== 'parked') return;
    for (const [id, rc] of this.remotes) {
      const pos = rc.model.group.position;
      const one = [{ id: rc.car.id, paint: rc.car.paint, x: pos.x, z: pos.z, age: rc.age }];
      if (!takenFrom({ id: t.spec.id, paint: t.paint, x: t.pos.x, z: t.pos.z }, one)) continue;
      this.left = null;
      this.rehome(t);
      const who = this.game.net.players.get(id)?.name || 'SOMEONE';
      this.say(`${who.toUpperCase()} TOOK YOUR ${t.spec.name.toUpperCase()}`);
      return;
    }
  }

  /** Back to its place in the traffic plan (or just off the road, if it never had one). */
  private rehome(t: TCar) {
    if (t.home === null) return;
    if (t.home.kind === 'cruise' && t.still !== null) t.still.visible = false;
    this.placeHome(t, t.home);
  }

  // ── Riding in someone else's car ──

  /** Someone's car you could ride in with E right now (on foot, beside it, a seat free), or null. */
  private nearestRide(): { driver: string; seat: number; d: number } | null {
    const g = this.game;
    const p = g.player;
    if (this.inCar || this.hidden || g.hoops.active || g.replay.active || g.showroom) return null;
    if (g.van2.driving || g.dragon.riding || g.net.myId === '') return null;
    if (p.climb !== null || p.vault !== null) return null;
    if (p.mode === 'board' && (p.speed > 6 || p.state !== 'ground')) return null;
    let best: { driver: string; seat: number; d: number } | null = null;
    for (const [id, rc] of this.remotes) {
      const rp = g.net.players.get(id);
      const crew = rp?.crew ?? null;
      if (crew === null || rc.car.flying || rc.vel.length() > BOARD_SPEED) continue;
      const spec = CARS[rc.car.id];
      const grp = rc.model.group;
      const yaw = yawOf(grp.quaternion);
      const dx = p.pos.x - grp.position.x;
      const dz = p.pos.z - grp.position.z;
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      const lx = dx * c - dz * sn;
      const lz = dx * sn + dz * c;
      const geo = spec.geo;
      if (Math.abs(lx) > geo.width / 2 + 1.5 || Math.abs(lz) > geo.length / 2 + 0.9) continue;
      if (Math.abs(p.pos.y - grp.position.y) > geo.height + 1.2) continue;
      // Seats someone else is already asking for count as taken
      const asking = new Set<number>();
      for (const [oid, op] of g.net.players)
        if (oid !== id && op.ride?.driver === id) asking.add(op.ride.seat);
      const seat = freeSeat(spec.id, crew, asking);
      if (seat === null) continue;
      const d = Math.hypot(lx, lz);
      if (best === null || d < best.d) best = { driver: id, seat, d };
    }
    return best;
  }

  /** Climb into `driver`'s passenger seat (ours once their client lists us). */
  private joinRide(driver: string, seat: number) {
    const g = this.game;
    const p = g.player;
    if (p.mode === 'board') p.toggleBoard();
    this.ride = { driver, seat, waited: 0, status: 'pending', leaving: false };
    g.net.ride = encodeRide({ driver, seat });
    if (g.me !== null) g.me.board.visible = false;
    g.stats.suspended = true;
    const rc = this.remotes.get(driver);
    if (rc !== undefined) this.camera.snap(yawOf(rc.model.group.quaternion));
    g.audio.start();
    this.pushUi();
  }

  /** E as a passenger: out now if the car's stopped, else at the next stop. */
  private askOut() {
    const r = this.ride;
    if (r === null) return;
    const rc = this.remotes.get(r.driver);
    if (r.leaving || rc === undefined || (!rc.car.flying && rc.vel.length() <= EXIT_SPEED))
      this.leaveRide('');
    else r.leaving = true;
    this.pushUi();
  }

  /** Out of the passenger seat, onto the ground beside the car. */
  private leaveRide(notice: string) {
    const g = this.game;
    const r = this.ride;
    if (r === null) return;
    this.ride = null;
    g.net.ride = null;
    const rc = this.remotes.get(r.driver);
    const p = g.player;
    let spot: THREE.Vector3;
    let yaw = p.footYaw;
    if (rc !== undefined) {
      const grp = rc.model.group;
      yaw = yawOf(grp.quaternion);
      const side = (seatRoot(rc.car.id, r.seat)?.[0] ?? -1) >= 0 ? 1 : -1;
      spot = rc.car.flying
        ? this.groundUnder(grp.position)
        : this.exitSpotAt(grp, CARS[rc.car.id], side);
    } else spot = p.pos.clone();
    this.placeOnFoot(spot, yaw);
    if (notice !== '') this.say(notice);
    this.pushUi();
  }

  /** The ground straight below a point (flying cars), else the level's floor. */
  private groundUnder(at: THREE.Vector3): THREE.Vector3 {
    const hit = this.game.world.raycast(_v.copy(at).setY(at.y + 2), DOWN, 400);
    const y = hit !== null ? hit.point.y : this.game.player.floorAt(at.x, at.z);
    return new THREE.Vector3(at.x, y, at.z);
  }

  /** The rider on foot at `spot` facing `yaw`: a fresh ride, the camera behind. */
  private placeOnFoot(spot: THREE.Vector3, yaw: number) {
    const g = this.game;
    const p = g.player;
    p.pos.copy(spot);
    p.vel.set(0, 0, 0);
    p.footYaw = yaw;
    p.footGrounded = true;
    p.fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    p.up.copy(UP);
    p.safePos.copy(spot);
    p.safeFwd.copy(p.fwd);
    // A fresh ride for the stats / drop proofs (nothing carried out of the car)
    p.respawns++;
    p.run = 0;
    p.runTime = 0;
    g.stats.suspended = g.missions.ud.active;
    if (g.me !== null) {
      g.me.root.visible = true;
      leaveSeat(g.me);
      g.me.root.position.copy(spot);
      g.me.root.quaternion.setFromAxisAngle(UP, yaw);
    }
    g.cam.snap(p);
  }

  private say(text: string) {
    this.notice = text;
    this.noticeT = 2.8;
  }

  /**
   * The passenger's frame (after the remote cars moved): check the seat
   * with the driver, sit in their car, follow it with the camera.
   */
  private rideAlong(dt: number) {
    const g = this.game;
    const r = this.ride;
    if (r === null) return;
    r.waited += dt;
    const rp = g.net.players.get(r.driver);
    const rc = this.remotes.get(r.driver);
    const alive = rp !== undefined && performance.now() - rp.lastSeen < DRIVER_GONE_MS;
    r.status = rideCheck(
      g.net.myId,
      r.seat,
      alive ? { inCar: rc !== undefined, crew: rp.crew ?? null } : null,
      r.waited,
    );
    const who = rp?.name || 'THE DRIVER';
    if (r.status === 'gone' || rc === undefined) return this.leaveRide(`${who} GOT OUT`);
    if (r.status === 'refused') return this.leaveRide('SEAT TAKEN');
    if (r.leaving && !rc.car.flying && rc.vel.length() <= EXIT_SPEED) return this.leaveRide('');
    const grp = rc.model.group;
    const spec = CARS[rc.car.id];
    // Where I am: the seat (the world streams round it, my name tag rides on the car)
    const at = seatRoot(spec.id, r.seat) ?? [0, 0, 0];
    grp.updateMatrixWorld(true);
    const p = g.player;
    p.pos.copy(grp.localToWorld(_v.set(at[0], at[1], at[2])));
    p.vel.copy(rc.vel);
    const heading = yawOf(grp.quaternion);
    p.footYaw = heading;
    g.stats.suspended = true;
    const me = g.me;
    if (me !== null) {
      me.root.visible = riderShown(spec, r.seat);
      me.play({ clip: 'idle', fade: 0.25 });
      me.update(dt, { lean: 0, travelled: 0, riding: false });
      poseInSeat(me, grp, spec.id, r.seat, { driver: false });
    }
    this.velV.copy(rc.vel);
    const fwd = rc.vel.dot(_v2.set(Math.sin(heading), 0, Math.cos(heading)));
    this.camera.update(
      dt,
      grp.position,
      this.velV,
      heading,
      fwd,
      rc.car.flying ? 'far' : g.cam.mode,
      this.look.x,
      this.look.y,
      performance.now(),
      g.cam.shakeScale,
    );
    g.cam.yaw = this.camera.yaw;
    g.cam.orbitYaw = 0;
  }

  /** Driving: give out the seats people are asking for (the driver decides), publish the list. */
  private seatCrew() {
    const g = this.game;
    const t = this.driven;
    if (t === null || passengerSeats(t.spec.id) === 0) {
      this.crew = [];
      this.askedAt.clear();
      g.net.crew = null;
      return;
    }
    const me = g.net.myId;
    const now = performance.now();
    const asks: SeatAsk[] = [];
    for (const [id, rp] of g.net.players) {
      const r = rp.ride;
      if (r === null || r === undefined || r.driver !== me || me === '') {
        this.askedAt.delete(id);
        continue;
      }
      let since = this.askedAt.get(id);
      if (since === undefined) {
        since = now;
        this.askedAt.set(id, since);
      }
      asks.push({ id, seat: r.seat, since });
    }
    for (const id of this.askedAt.keys()) if (!g.net.players.has(id)) this.askedAt.delete(id);
    this.crew = assignSeats(t.spec.id, this.crew, asks);
    g.net.crew = encodeCrew(this.crew);
  }

  private enter(t: TCar) {
    const g = this.game;
    const p = g.player;
    if (p.mode === 'board') p.toggleBoard();
    if (t.ai) this.hopOut(t);
    t.ai = false;
    t.mode = 'driven';
    this.setCollider(t, false);
    if (t.still !== null) t.still.visible = false;
    const m = t.model;
    m.group.visible = true;
    m.group.position.copy(t.pos);
    m.group.quaternion.setFromAxisAngle(UP, t.yaw);
    m.group.updateMatrixWorld(true);
    let sim = this.sims.get(t.spec.id);
    if (sim === undefined) {
      sim = new VanSim(simParams(t.spec));
      this.sims.set(t.spec.id, sim);
    }
    sim.placePose(t.pos.x, t.pos.y, t.pos.z, m.group.quaternion);
    // A cruiser keeps rolling
    if (t.v > 0) {
      sim.vel.x = Math.sin(t.yaw) * t.v;
      sim.vel.z = Math.cos(t.yaw) * t.v;
    }
    sim.boostTank = 1;
    this.sim = sim;
    this.driven = t;
    this.left = null;
    this.flying = false;
    this.flight = null;
    this.exitQueued = false;
    this.hopSide = 0;
    this.entering = enterDelay(t.spec.doors);
    t.doors.open();
    if (g.me !== null) g.me.board.visible = false;
    g.stats.suspended = true;
    this.camera.snap(t.yaw);
    g.audio.start();
    this.audio.setCar(t.spec);
    this.audio.start(g.audio.ctx, g.audio.master, g.audio.noise);
    this.seatRider();
    this.pushUi();
  }

  /** Sit the rider in an open car (scaled down), or hide them in a closed one. */
  private seatRider() {
    const me = this.game.me;
    const t = this.driven;
    if (me === null || t === null) return;
    me.root.visible = riderShown(t.spec, 0);
    me.root.scale.setScalar(RIDER_SCALE);
  }

  private exit() {
    const g = this.game;
    const t = this.driven;
    const sim = this.sim;
    if (t === null || sim === null) return;
    this.driven = null;
    this.sim = null;
    this.flying = false;
    this.flight = null;
    this.exitQueued = false;
    this.audio.stop();
    // Park it where it stopped, upright on its heading
    this.syncModel(t, sim);
    t.yaw = sim.heading;
    sim.origin(_v);
    t.pos.set(_v.x, this.groundY(_v.x, _v.z, _v.y), _v.z);
    t.v = 0;
    poseWheelsFlat(t.model, 0);
    for (const w of t.model.wheels) {
      w.pivot.rotation.set(0, 0, 0);
      w.pivot.position.y = w.restY;
    }
    if (t.model.thrusters !== null) t.model.thrusters.visible = false;
    t.doors.openThenClose();
    this.park(t);
    this.left = t;
    // Passengers see the car parked (no `ps`) and climb out themselves
    this.crew = [];
    this.askedAt.clear();
    g.net.crew = null;
    const grp = t.model.group;
    grp.position.copy(t.pos);
    grp.quaternion.setFromAxisAngle(UP, t.yaw);
    this.placeOnFoot(this.exitSpotAt(grp, t.spec, 1), t.yaw);
    this.pushUi();
  }

  /**
   * Beside the door on `side` (+1 the car's left, the driver's) if clear,
   * else the other side, behind, in front, the roof.
   */
  private exitSpotAt(grp: THREE.Object3D, spec: CarSpec, side: number): THREE.Vector3 {
    const w = this.game.world;
    const g = spec.geo;
    grp.updateMatrixWorld(true);
    const spots: [number, number, number][] = [
      [side * (g.width / 2 + 0.75), 0, g.seat[2]],
      [-side * (g.width / 2 + 0.75), 0, g.seat[2]],
      [0, 0, -g.length / 2 - 1],
      [0, 0, g.length / 2 + 1],
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
    return grp.localToWorld(new THREE.Vector3(0, g.height + 0.3, 0));
  }

  /** The AI driver jumps out the far side and legs it. */
  private hopOut(t: TCar) {
    const d = t.model.driver;
    d.visible = false;
    const m = d.clone() as THREE.Mesh;
    m.visible = true;
    const g = t.model.group;
    g.updateMatrixWorld(true);
    const from = d.getWorldPosition(new THREE.Vector3());
    // away from the rider, toward the kerb side
    const side = new THREE.Vector3(-1, 0, 0).applyAxisAngle(UP, t.yaw);
    const p = this.game.player.pos;
    if (side.dot(_v.copy(p).sub(t.pos)) > 0) side.negate();
    m.position.copy(from);
    m.quaternion.setFromAxisAngle(UP, t.yaw);
    m.scale.setScalar(1);
    this.game.gfx.scene.add(m);
    this.hoppers.push({ mesh: m, t: 0, from, dir: side, yaw: Math.atan2(side.x, side.z) });
  }

  private updateHoppers(dt: number) {
    for (let i = this.hoppers.length - 1; i >= 0; i--) {
      const h = this.hoppers[i];
      h.t += dt;
      const m = h.mesh;
      if (h.t < 0.55) {
        // Up and over the door
        const k = h.t / 0.55;
        m.position.copy(h.from).addScaledVector(h.dir, k * 2.0);
        m.position.y =
          h.from.y + Math.sin(k * Math.PI) * 1.1 - k * Math.max(0, h.from.y - ROAD_Y - 0.1);
        m.rotation.set(-k * 0.6, h.yaw, 0);
      } else {
        // Then a little run away
        const k = h.t - 0.55;
        m.position.addScaledVector(h.dir, dt * 4.5);
        m.position.y = Math.max(ROAD_Y, m.position.y) + Math.abs(Math.sin(k * 14)) * 0.02;
        m.rotation.set(0.2, h.yaw, Math.sin(k * 14) * 0.15);
      }
      if (h.t > 2.6) {
        this.game.gfx.scene.remove(m);
        this.hoppers.splice(i, 1);
      }
    }
  }

  /** The physics + visuals + camera + audio frame while driving (instead of the skater). */
  drive(dt: number, input: InputFrame, now: number) {
    const g = this.game;
    const t = this.driven;
    const sim = this.sim;
    if (t === null || sim === null) return;
    const s =
      g.player.terrain?.inDomain(sim.pos.x, sim.pos.z) === true
        ? terrainSurface(sim.pos.x, sim.pos.z)
        : null;
    this.ground.grip = SURFACE_GRIP[s ?? 'city'];

    const c = this.controls;
    const tc = this.touch;
    const pad = input.mode === 'gamepad';
    c.steer = Math.max(-1, Math.min(1, input.moveX + tc.steer));
    c.throttle = Math.max(
      input.moveY > 0 ? input.moveY : 0,
      tc.gas ? 1 : 0,
      pad && input.grabR ? 1 : 0,
    );
    c.brake = Math.max(
      input.moveY < 0 ? -input.moveY : 0,
      input.brake ? 1 : 0,
      tc.brake ? 1 : 0,
      pad && input.grabL ? 1 : 0,
    );
    c.handbrake = input.crouch || tc.handbrake || (pad && input.push);
    c.boost = input.sprint || tc.boost;
    if (this.entering > 0) {
      this.entering -= dt;
      c.throttle = c.brake = 0;
      c.handbrake = true;
      c.boost = false;
      if (this.entering <= 0) t.doors.close();
    }
    if (this.exitQueued && !this.flying) {
      c.throttle = 0;
      c.brake = 1;
      c.boost = false;
      if (sim.speed <= EXIT_SPEED) {
        this.exit();
        return;
      }
    }
    const special = this.specialQueued;
    this.specialQueued = false;
    let landing = 0;
    let impact = 0;
    if (this.flying && this.flight !== null) {
      const f = this.flight;
      // Down: Q, or S / BRAKE (slow down and sink: land by descending)
      const down =
        (input.noseManual && !input.sprint) || c.brake > 0.5 || this.exitQueued || this.dropping;
      let landed = false;
      const n = Math.max(1, Math.ceil(dt * 90));
      for (let i = 0; i < n && !landed; i++)
        landed = f.step(
          dt / n,
          {
            throttle: c.throttle,
            brake: c.brake,
            steer: c.steer,
            up: c.handbrake && !down,
            down,
            boost: c.boost,
          },
          (x, z) => this.flightGround(x, z, f.y),
        );
      // X again: thrusters down, sink to the ground
      if (special && f.airTime > 0.5) this.dropping = true;
      if (landed) this.land(t, sim, f);
      else this.syncFlight(t, f);
    } else {
      if (special) this.doSpecial(t, sim);
      const n = substeps(dt, sim.speed);
      const h = dt / n;
      sim.impact = 0;
      sim.landing = 0;
      for (let i = 0; i < n; i++) sim.step(h, c, this.ground);
      if (sim.pos.y < g.player.floorAt(sim.pos.x, sim.pos.z) - 40) sim.recover(this.ground);
      if (sim.stuck > 4) sim.recover(this.ground);
      landing = sim.landing;
      impact = sim.impact;
      this.syncModel(t, sim);
    }
    // Doors (the TORO's come down as you pull away)
    if (t.doors.step(dt)) poseDoors(t.model, t.doors.angle);

    // The rider rides along: the world streams, the network and missions follow the car
    const p = g.player;
    const grp = t.model.group;
    p.pos.copy(this.origin);
    if (this.flying && this.flight !== null)
      p.vel.set(this.flight.vx, this.flight.vy, this.flight.vz);
    else p.vel.set(sim.vel.x, sim.vel.y, sim.vel.z);
    const heading = this.flying && this.flight !== null ? this.flight.yaw : sim.heading;
    p.footYaw = heading;
    const me = g.me;
    if (me !== null) {
      if (me.root.visible) {
        me.play({ clip: 'idle', fade: 0.25 });
        me.update(dt, { lean: 0, travelled: 0, riding: false });
      }
      poseInSeat(me, grp, t.spec.id, 0, { driver: true, steer: -c.steer });
    }
    g.stats.suspended = true;

    // Bumping traffic: they stop and reel
    for (const o of this.fleet) {
      if (o.mode !== 'cruise') continue;
      const d = Math.hypot(o.pos.x - this.origin.x, o.pos.z - this.origin.z);
      if (d < (o.spec.geo.length + t.spec.geo.length) / 2 + 0.2 && p.vel.length() > 2.5) {
        o.bumped = 3;
        impact = Math.max(impact, Math.min(12, p.vel.length() * 0.6));
      }
    }

    // Camera
    this.velV.copy(p.vel);
    if (impact > 3) this.camera.addShake(Math.min(0.8, impact / 25));
    if (landing > 5) this.camera.addShake(Math.min(0.5, landing / 30));
    const fwd = this.flying && this.flight !== null ? this.flight.forwardSpeed : sim.forwardSpeed;
    this.camera.update(
      dt,
      this.origin,
      this.velV,
      heading,
      fwd,
      this.flying ? 'far' : g.cam.mode,
      input.lookX,
      input.lookY,
      now,
      g.cam.shakeScale,
    );
    g.cam.yaw = this.camera.yaw;
    g.cam.orbitYaw = 0;

    // Audio + crash fun
    let slip = 0;
    for (const wh of sim.wheels) slip = Math.max(slip, wh.slip);
    if (this.flying && this.flight !== null)
      this.audio.update(0.4 + this.flight.thrust * 0.6, 3, this.flight.thrust, 0, c.boost, true);
    else this.audio.update(sim.rpm, sim.gear, c.throttle, slip, sim.boosting, sim.grounded === 0);
    if (impact > 3) this.audio.thud(Math.min(1, impact / 20));
    else if (landing > 6) this.audio.thud(Math.min(1, landing / 25));
    if (landing > 6) g.particles.dustAt(this.origin, Math.min(1, landing / 18));
    if (impact > 9) {
      this.smashT = 0.9;
      g.particles.sparksAt(_v.copy(this.origin).setY(this.origin.y + 0.6), p.vel, 24);
    }
    this.smashT = Math.max(0, this.smashT - dt);
  }

  /** X on the ground: lift off / hop / stomp. */
  private doSpecial(t: TCar, sim: VanSim) {
    const sp = t.spec.special;
    if (sp === 'fly' && t.spec.flight !== undefined) {
      if (!canLiftOff(t.spec.flight, Math.abs(sim.forwardSpeed), sim.grounded)) return;
      const f = this.flight ?? new FlightSim(t.spec.flight);
      sim.origin(_v);
      f.takeOff(_v.x, _v.y, _v.z, sim.vel.x, sim.vel.z, sim.heading);
      this.flight = f;
      this.flying = true;
      this.audio.pssh(1);
      this.game.particles.dustAt(this.origin, 0.8);
      if (t.model.thrusters !== null) t.model.thrusters.visible = true;
      return;
    }
    if (sim.grounded < 2) return;
    if (sp === 'hop') {
      // Hydraulics: front, back, left, right in turn
      const axes: [number, number, number][] = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],
      ];
      const [ax, ay, az] = axes[this.hopSide++ % 4];
      sim.vel.y += 4.2;
      const k = 3.2;
      // body axis → world: a quick pitch / roll kick
      _v.set(ax, ay, az).applyQuaternion(_q.set(sim.q.x, sim.q.y, sim.q.z, sim.q.w));
      sim.w.x -= _v.x * k;
      sim.w.y -= _v.y * k;
      sim.w.z -= _v.z * k;
      this.audio.pssh(0.8);
    } else if (sp === 'stomp') {
      sim.vel.y += 9.5;
      this.audio.pssh(1);
      this.game.particles.dustAt(this.origin, 1);
    }
  }

  /** Flight → wheels: on the ground at its heading, carrying the speed. */
  private land(t: TCar, sim: VanSim, f: FlightSim) {
    _q.setFromAxisAngle(UP, f.yaw);
    sim.placePose(f.x, f.y + 0.05, f.z, _q);
    sim.vel.x = f.vx;
    sim.vel.z = f.vz;
    sim.vel.y = Math.min(0, f.vy);
    this.flying = false;
    this.dropping = false;
    if (t.model.thrusters !== null) t.model.thrusters.visible = false;
    poseWheelsFlat(t.model, 0);
    this.game.particles.dustAt(this.origin, 0.7);
    this.audio.thud(0.4);
    this.syncModel(t, sim);
  }

  /** Highest surface under a point near height y (roofs count: it hops over buildings). */
  private flightGround(x: number, z: number, y: number): number {
    const w = this.game.world;
    const hit = w.raycast(_v2.set(x, y + 30, z), DOWN, 80);
    if (hit !== null) return hit.point.y;
    return this.game.player.floorAt(x, z);
  }

  private syncFlight(t: TCar, f: FlightSim) {
    const grp = t.model.group;
    this.origin.set(f.x, f.y, f.z);
    grp.position.copy(this.origin);
    grp.quaternion.setFromEuler(_e.set(f.pitch, f.yaw, f.roll, 'YXZ'));
    poseWheelsFlat(t.model, Math.min(1, f.airTime * 2.5));
    const th = t.model.thrusters;
    if (th !== null) {
      th.visible = true;
      const s = 0.55 + f.thrust * 0.7 + Math.sin(f.airTime * 40) * 0.06;
      th.scale.set(1, 1, s);
    }
    grp.updateMatrixWorld(true);
  }

  /** Model follows the sim; wheels show suspension, steering and spin. */
  private syncModel(t: TCar, sim: VanSim) {
    const grp = t.model.group;
    sim.origin(this.origin);
    grp.position.copy(this.origin);
    grp.quaternion.set(sim.q.x, sim.q.y, sim.q.z, sim.q.w);
    const S = sim.S;
    const sag = (S.mass * S.gravity) / 4 / S.spring;
    const wheels = t.model.wheels;
    for (let i = 0; i < wheels.length && i < 4; i++) {
      const w = wheels[i];
      const ws = sim.wheels[i];
      const off = ws.contact ? Math.min(S.travel * 0.9, ws.x - sag) : -sag - 0.04;
      w.pivot.position.y = w.restY + off;
      w.pivot.rotation.set(0, ws.front ? -sim.steerAngle : 0, 0);
      w.spinner.rotation.x = ws.spin;
    }
    grp.updateMatrixWorld(true);
  }

  /** Every frame (after the network): traffic, doors, other riders' cars, HUD. */
  update(dt: number) {
    const g = this.game;
    const away = g.missions.ud.active || g.interiors.inside;
    if (away !== this.hidden) this.setHidden(away);
    if (!away) {
      const cam = g.gfx.camera.position;
      this.camPos.copy(cam);
      for (const t of this.fleet) {
        if (t.mode === 'cruise') this.cruise(t, dt);
        if (t.mode !== 'driven' && t.doors.phase !== 'shut') {
          t.doors.step(dt);
          poseDoors(t.model, t.doors.angle);
          if (t.mode === 'parked' && t.doors.shut) this.park(t);
        }
        // Distance cull (the rig or the parked mesh)
        const far = t.mode !== 'driven' && cam.distanceToSquared(t.pos) > DRAW_DIST * DRAW_DIST;
        if (t.mode === 'parked' && t.still !== null && t.doors.phase === 'shut') {
          t.still.visible = !far;
          t.model.group.visible = false;
        } else t.model.group.visible = !far;
      }
      this.updateHoppers(dt);
    }
    this.seatCrew();
    this.updateRemotes(dt);
    this.rideAlong(dt);
    if (this.noticeT > 0) {
      this.noticeT -= dt;
      if (this.noticeT <= 0) this.notice = '';
    }
    this.uiAcc += dt;
    if (this.inCar) {
      if (this.uiAcc >= 1 / 12) this.pushUi();
    } else if (this.uiAcc >= 1 / 8) this.pushUi();
  }

  private setHidden(h: boolean) {
    this.hidden = h;
    for (const t of this.fleet) {
      if (t.mode === 'driven') continue;
      t.model.group.visible = !h && t.mode !== 'parked';
      if (t.still !== null) t.still.visible = !h && t.mode === 'parked';
      this.setCollider(t, !h);
      if (!h) t.colYaw = NaN;
    }
    if (!h) for (const t of this.fleet) if (t.mode !== 'driven') this.setCollider(t, true);
  }

  private pushUi() {
    this.uiAcc = 0;
    const t = this.driven;
    const sim = this.sim;
    const notice = this.notice;
    const name = (id: string) => this.game.net.players.get(id)?.name || 'NOUN';
    const r = this.ride;
    if (r !== null) {
      const rc = this.remotes.get(r.driver);
      this.setUi({
        ...IDLE_UI,
        notice,
        kmh: rc !== undefined ? Math.round(rc.vel.length() * 3.6) : 0,
        ride: {
          who: name(r.driver),
          car: rc !== undefined ? CARS[rc.car.id].name : '',
          seat: r.seat,
          pending: r.status === 'pending',
          leaving: r.leaving,
          flying: rc?.car.flying === true,
        },
      });
      return;
    }
    if (t === null || sim === null) {
      const nr = this.nearestRide();
      const pick = nr === null ? this.nearestCar() : null;
      const n = pick?.t?.spec ?? pick?.parked?.spec ?? null;
      const near =
        n === null
          ? null
          : {
              id: n.id,
              name: n.name,
              tagline: n.tagline,
              credit: carCredit(n),
            };
      const rc = nr !== null ? this.remotes.get(nr.driver) : undefined;
      const nearRide =
        nr === null || rc === undefined
          ? null
          : { driver: nr.driver, who: name(nr.driver), car: CARS[rc.car.id].name };
      this.setUi({ ...IDLE_UI, near, nearRide, notice });
      return;
    }
    const f = this.flight;
    const flying = this.flying && f !== null;
    const fs = flying ? f.forwardSpeed : sim.forwardSpeed;
    const fl = t.spec.flight;
    this.setUi({
      driving: true,
      near: null,
      car: { id: t.spec.id, name: t.spec.name, credit: carCredit(t.spec), special: t.spec.special },
      kmh: Math.round(Math.abs(fs) * 3.6),
      gear: flying
        ? 'F'
        : sim.gear < 0
          ? 'R'
          : Math.abs(fs) < 0.5 && this.controls.throttle === 0
            ? 'N'
            : String(sim.gear),
      rpm: flying ? f.thrust : sim.rpm,
      boost: sim.boostTank,
      boosting: flying ? this.controls.boost : sim.boosting,
      air: !flying && sim.grounded === 0 && sim.airTime > 0.25,
      drifting: !flying && sim.drifting,
      stuck: !flying && sim.stuck > 1,
      stopping: this.exitQueued,
      flying,
      canFly:
        !flying && fl !== undefined && canLiftOff(fl, Math.abs(sim.forwardSpeed), sim.grounded),
      alt: flying ? Math.max(0, Math.round(f.y - this.flightGround(f.x, f.z, f.y))) : 0,
      smash: this.smashT > 0,
      nearRide: null,
      ride: null,
      crew: this.crew.filter(x => x !== '').map(name),
      notice,
    });
  }

  private setUi(next: CarUi) {
    const u = this.ui;
    if (
      u.driving === next.driving &&
      u.near?.id === next.near?.id &&
      u.car?.id === next.car?.id &&
      u.kmh === next.kmh &&
      u.gear === next.gear &&
      Math.abs(u.rpm - next.rpm) < 0.04 &&
      Math.abs(u.boost - next.boost) < 0.02 &&
      u.boosting === next.boosting &&
      u.air === next.air &&
      u.drifting === next.drifting &&
      u.stuck === next.stuck &&
      u.stopping === next.stopping &&
      u.flying === next.flying &&
      u.canFly === next.canFly &&
      u.alt === next.alt &&
      u.smash === next.smash &&
      u.nearRide?.driver === next.nearRide?.driver &&
      u.nearRide?.who === next.nearRide?.who &&
      JSON.stringify(u.ride) === JSON.stringify(next.ride) &&
      u.crew.join('\n') === next.crew.join('\n') &&
      u.notice === next.notice
    )
      return;
    this.ui = next;
    for (const l of this.uiListeners) l();
  }

  // ── Other riders' cars ──

  private updateRemotes(dt: number) {
    const g = this.game;
    const hideAll = g.missions.ud.active;
    const seatedNow = new Set<string>();
    for (const [id, rp] of g.net.players) {
      const c = rp.current;
      const nc = c.vehicle === 'car' ? decodeCar(c.car) : null;
      let rc = this.remotes.get(id);
      const r = g.remotes.get(id);
      const key = nc !== null ? `${nc.id}:${nc.paint}` : '';
      if (nc === null || hideAll || (rc !== undefined && rc.key !== key)) {
        if (rc !== undefined) {
          this.releaseRemote(rc);
          this.remotes.delete(id);
          rc = undefined;
          // out of the car: the rider shows again (the van hides its own)
          if (r !== undefined && !hideAll && c.vehicle !== 'van') r.character.root.visible = true;
        }
        if (nc === null || hideAll) continue;
      }
      if (rc === undefined) {
        rc = {
          key,
          model: this.takeRemote(nc.id, nc.paint),
          last: c.pos.clone(),
          spin: 0,
          car: nc,
          vel: new THREE.Vector3(),
          age: 0,
        };
        this.remotes.set(id, rc);
      }
      rc.car = nc;
      rc.age += dt;
      const m = rc.model;
      const grp = m.group;
      grp.position.copy(c.pos);
      grp.quaternion.copy(c.quat);
      grp.updateMatrixWorld(true);
      const moved = rc.last.distanceTo(c.pos);
      if (dt > 0) {
        _v.copy(c.pos).sub(rc.last).divideScalar(dt);
        // a teleport (respawn, a new car) isn't speed
        if (_v.lengthSq() < 150 * 150) rc.vel.lerp(_v, 1 - Math.exp(-8 * dt));
      }
      rc.last.copy(c.pos);
      rc.spin = (rc.spin + moved / m.spec.geo.wheelR) % (Math.PI * 2);
      poseWheelsFlat(m, nc.flying ? 1 : 0);
      if (!nc.flying) for (const w of m.wheels) w.spinner.rotation.x = rc.spin;
      if (m.thrusters !== null) {
        m.thrusters.visible = nc.flying;
        m.thrusters.scale.set(1, 1, nc.boosting ? 1.3 : 0.8);
      }
      poseDoors(m, nc.doorsOpen ? DOOR_OPEN[m.spec.doors] : 0);
      // The driver: in the seat in an open car, hidden in a closed one
      if (r !== undefined) {
        const shown = riderShown(m.spec, 0);
        r.character.root.visible = shown;
        if (shown) {
          poseInSeat(r.character, grp, m.spec.id, 0, { driver: true });
          seatedNow.add(id);
        }
      }
    }
    // Passengers, in whichever car their driver's list puts them
    for (const [id, rp] of g.net.players) {
      const ride = rp.ride;
      const r = g.remotes.get(id);
      if (ride === null || ride === undefined || r === undefined || hideAll) continue;
      let car: THREE.Object3D | null = null;
      let spec: CarSpec | null = null;
      if (ride.driver === g.net.myId && this.driven !== null) {
        if (this.crew[ride.seat - 1] === id) {
          car = this.driven.model.group;
          spec = this.driven.spec;
        }
      } else {
        const rc = this.remotes.get(ride.driver);
        const crew = g.net.players.get(ride.driver)?.crew;
        if (rc !== undefined && crew?.[ride.seat - 1] === id) {
          car = rc.model.group;
          spec = rc.model.spec;
        }
      }
      if (car === null || spec === null) continue;
      r.character.root.visible = riderShown(spec, ride.seat);
      poseInSeat(r.character, car, spec.id, ride.seat, { driver: false });
      seatedNow.add(id);
    }
    // Out of a seat: full size again
    for (const id of this.seated) {
      if (seatedNow.has(id)) continue;
      const r = g.remotes.get(id);
      if (r === undefined) continue;
      leaveSeat(r.character);
      // (a closed car hid them; the van hides its own driver)
      r.character.root.visible =
        !hideAll && g.net.players.get(id)?.current.vehicle !== 'van' && !this.remotes.has(id);
    }
    this.seated = seatedNow;
    for (const [id, rc] of this.remotes) {
      if (g.net.players.has(id)) continue;
      this.releaseRemote(rc);
      this.remotes.delete(id);
    }
    this.updateParkedRemotes(hideAll);
    this.checkLeftTaken();
  }

  /** Cars other riders got out of stay where they left them (`lc`), doors shut, wheels down. */
  private updateParkedRemotes(hideAll: boolean) {
    const g = this.game;
    for (const [id, rp] of g.net.players) {
      const c = rp.current;
      let p = hideAll || c.vehicle === 'car' ? null : decodeParked(c.lc);
      // The one I drove off in: theirs stops drawing once their client sees it gone
      const claim = this.claimed.get(id);
      if (claim !== undefined) {
        if (p !== null && parkedKey(p) === claim) p = null;
        else if (!hideAll) this.claimed.delete(id);
      }
      const key = p !== null ? `${p.id}:${p.paint}` : '';
      let pr = this.parkedRemotes.get(id);
      if (pr !== undefined && pr.key !== key) {
        this.releaseRemote(pr);
        this.parkedRemotes.delete(id);
        pr = undefined;
      }
      if (p === null) continue;
      if (pr === undefined) {
        const m = this.takeRemote(p.id, p.paint);
        poseWheelsFlat(m, 0);
        for (const w of m.wheels) {
          w.pivot.rotation.set(0, 0, 0);
          w.pivot.position.y = w.restY;
          w.spinner.rotation.x = 0;
        }
        if (m.thrusters !== null) m.thrusters.visible = false;
        poseDoors(m, 0);
        m.driver.visible = false;
        pr = { key, model: m, p };
        this.parkedRemotes.set(id, pr);
      }
      pr.p = p;
      const grp = pr.model.group;
      if (grp.position.x !== p.x || grp.position.y !== p.y || grp.position.z !== p.z) {
        grp.position.set(p.x, p.y, p.z);
        grp.quaternion.setFromAxisAngle(UP, p.yaw);
        grp.updateMatrixWorld(true);
      }
    }
    for (const [id, pr] of this.parkedRemotes) {
      if (g.net.players.has(id)) continue;
      this.releaseRemote(pr);
      this.parkedRemotes.delete(id);
    }
    for (const id of this.claimed.keys()) if (!g.net.players.has(id)) this.claimed.delete(id);
  }

  private takeRemote(id: CarId, paint: number): CarModel {
    const k = `${id}:${paint}`;
    const pool = this.remotePool.get(k);
    const m = pool?.pop() ?? buildAnyCar(CARS[id], paint);
    if (pool === undefined && this.game.gfx.toon) toonify(m.group);
    m.group.visible = true;
    this.game.gfx.scene.add(m.group);
    return m;
  }

  private releaseRemote(rc: { key: string; model: CarModel }) {
    this.game.gfx.scene.remove(rc.model.group);
    const k = rc.key;
    let pool = this.remotePool.get(k);
    if (pool === undefined) {
      pool = [];
      this.remotePool.set(k, pool);
    }
    if (pool.length < 4) pool.push(rc.model);
  }

  dispose() {
    this.gone = true;
    this.audio.stop();
    const g = this.game;
    for (const t of this.fleet) {
      g.gfx.scene.remove(t.model.group);
      if (t.still !== null) g.gfx.scene.remove(t.still);
      g.world.setDynamic(t.col, null);
      t.colGeo?.dispose();
    }
    this.fleet.length = 0;
    for (const h of this.hoppers) g.gfx.scene.remove(h.mesh);
    this.hoppers.length = 0;
    for (const rc of this.remotes.values()) g.gfx.scene.remove(rc.model.group);
    this.remotes.clear();
    this.ride = null;
    g.net.ride = null;
    g.net.crew = null;
    this.uiListeners.clear();
  }
}

/** `?cars=0` leaves the level's own parked cars and no traffic (A/B perf checks). */
function carsOn(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('cars') !== '0';
  } catch {
    return true;
  }
}

/** Heading (rad, 0 = +Z) of an orientation. */
function yawOf(q: THREE.Quaternion): number {
  _v2.set(0, 0, 1).applyQuaternion(q);
  return Math.atan2(_v2.x, _v2.z);
}

/** Wheels turned flat under the body (ROADSTAR in hover), 0..1. */
function poseWheelsFlat(m: CarModel, k: number) {
  if (m.spec.special !== 'fly') return;
  for (const w of m.wheels) {
    w.pivot.rotation.z = (w.left ? -1 : 1) * (Math.PI / 2) * k;
    w.pivot.position.y = w.restY + 0.12 * k;
  }
}

/** A parked car as one mesh: body, wheels and doors at rest, merged (no driver / flames). */
function bakeStatic(m: CarModel): THREE.BufferGeometry {
  const grp = m.group;
  const savedP = grp.position.clone();
  const savedQ = grp.quaternion.clone();
  grp.position.set(0, 0, 0);
  grp.quaternion.identity();
  grp.updateMatrixWorld(true);
  const paint: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  grp.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o === m.driver || o === m.thrusters) return;
    const src = mesh.geometry;
    const groups =
      src.groups.length > 0
        ? src.groups
        : [{ start: 0, count: src.attributes.position.count, materialIndex: 0 }];
    for (const gr of groups) {
      if (gr.count === 0) continue;
      const part = sliceGeo(src, gr.start, gr.count);
      part.applyMatrix4(mesh.matrixWorld);
      ((gr.materialIndex ?? 0) === 1 ? glow : paint).push(part);
    }
  });
  grp.position.copy(savedP);
  grp.quaternion.copy(savedQ);
  grp.updateMatrixWorld(true);
  const pg = paint.length > 0 ? mergeGeometries(paint, false) : new THREE.BufferGeometry();
  const gg = glow.length > 0 ? mergeGeometries(glow, false) : null;
  const out = gg !== null ? mergeGeometries([pg, gg], false) : pg;
  out.clearGroups();
  const np = pg.attributes.position?.count ?? 0;
  out.addGroup(0, np, 0);
  out.addGroup(np, gg?.attributes.position.count ?? 0, 1);
  for (const g of [...paint, ...glow]) g.dispose();
  out.computeBoundingSphere();
  return out;
}

/** Vertices [start, start+count) of a non-indexed geometry (position, normal, color). */
function sliceGeo(src: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const g = src.index !== null ? src.toNonIndexed() : src;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const a = g.attributes[name] as THREE.BufferAttribute | undefined;
    if (a === undefined) continue;
    const arr = new Float32Array(count * a.itemSize);
    for (let i = 0; i < count; i++)
      for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(start + i, k);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (out.attributes.color === undefined) {
    const arr = new Float32Array(count * 3).fill(1);
    out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  if (g !== src) g.dispose();
  return out;
}

/**
 * Drop the triangles of a collision mesh whose centroids sit inside any of
 * the boxes (the level's own parked cars), in place.
 */
function cutInside(mesh: THREE.Mesh, boxes: THREE.Box3[]) {
  mesh.updateMatrixWorld(true);
  const src = mesh.geometry.index !== null ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = src.attributes.position as THREE.BufferAttribute;
  const keep: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let dropped = 0;
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, i + 1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, i + 2).applyMatrix4(mesh.matrixWorld);
    const m = a
      .clone()
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3);
    if (boxes.some(bx => bx.containsPoint(m))) {
      dropped++;
      continue;
    }
    for (let k = 0; k < 3; k++) keep.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
  }
  if (dropped === 0) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(keep), 3));
  geo.computeVertexNormals();
  mesh.geometry = geo;
  console.info('[cars] cut', dropped, 'baked car triangles from', mesh.name);
}
