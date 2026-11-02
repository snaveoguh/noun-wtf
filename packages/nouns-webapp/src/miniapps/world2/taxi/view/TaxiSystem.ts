// ── NOUN TAXI in the world: fares, hitchhikers, the guide, the meter ──────
//
// Runs after the cars each frame (Game: `taxi.update(dt)`), reading the car
// you drive through `game.cars.current` and never stepping it:
//   in the NOUN CAB   up to FARES.waiting fares wait at the kerb near you,
//                     waving; stop beside one (SHIFT.pickupR, under
//                     SHIFT.pickupSpeed) and they get in, the shift starts,
//                     the route is planned (sim/route.ts) and the guide
//                     shows: an arrow over the cab, a glowing path along
//                     the road ahead, a beacon over the stop;
//   in any car        hitchhikers stand by the long roads (sim/hitch.ts);
//                     stop beside one with a seat free and they ride along.
// Style tips come from the car sim (airTime, drifting, impact) and near
// misses with the traffic, other riders and the people at the roadside.
// Drop-offs pay through the trade ledger (`fare`) and earn respect.
//
// Cheap: people are built one a frame, only near you, and freed when far
// or done; the guide is 3 meshes (arrow, path ribbon, instanced beacons)
// with unlit materials, warmed hidden before first use.

import type { NounCharacter as NounCharacterT } from '../../character/NounCharacter';
import type { Game } from '../../Game';
import type { InteriorsApi } from '../../interiors/contract';
import type { TownId } from '../../trade/contract';
import type { MapScene } from '../../ui/mapDraw';
import type { ChatterUi } from '../chatter/ChatterSystem';
import type { TaxiWire } from '../net/wire';
import type { Destination } from '../sim/destinations';
import type { LineEvent } from '../sim/lines';
import type { DropPay } from '../sim/pay';
import type { StuntEvent, MissTarget } from '../sim/style';

import * as THREE from 'three';

import { seedVoice } from '../../audio/voice/cast';
import { ROAD_Y, nearestS } from '../../cars/lanes';
import { poseInSeat, leaveSeat } from '../../cars/seatPose';
import { passengerSeats, riderShown } from '../../cars/seats';
import { NounCharacter } from '../../character/NounCharacter';
import { warmHidden } from '../../render/shaderWarm';
import { inkExcluded, toonify } from '../../render/Toon';
import { TOWN_SPECS } from '../../trade/towns';
import { terrainHeight, terrainInDomain } from '../../world/mountain/terrain';
import { tracks } from '../../world/mountain/tracks';
import { ChatterSystem } from '../chatter/ChatterSystem';
import { chatterHost } from '../chatter/gameHost';
import { encodeTaxi } from '../net/wire';
import { growSome, mainTrack, onLine, registerBuiltins, setGrowAllowed } from '../sim/builtin';
import { allDestinations, registerDestinations, payTown } from '../sim/destinations';
import {
  FARES,
  KERB,
  kerbLength,
  kerbSpot,
  mulberry,
  nameFrom,
  pickDestination,
  seedFrom,
  type FareSpec,
} from '../sim/fares';
import { canPickUp, HITCH, slotId, slotsNear, type HitchSlot } from '../sim/hitch';
import { LineGate, lineFor, thanksFor } from '../sim/lines';
import { GRADE_LINE } from '../sim/pay';
import { RING, RouteCursor, locate, needsReroute, routeTo, type Route } from '../sim/route';
import {
  BESTS_KEY,
  foldBests,
  makeRide,
  parseBests,
  Shift,
  SHIFT,
  type Ride,
  type ShiftTotals,
  type TaxiBests,
} from '../sim/shift';
import { nearMisses } from '../sim/style';

// ── UI state (TaxiUi.tsx renders it) ──

export interface TaxiPop {
  text: string;
  good: boolean;
  at: number;
}

export interface TaxiUi {
  /** In the cab (the meter shows), or carrying a hitchhiker in any car. */
  cab: boolean;
  onShift: boolean;
  shiftClock: number;
  /** Aboard: who, where, the fare's clock, metres left, tips so far, the combo. */
  ride: {
    kind: 'fare' | 'hitch';
    name: string;
    dest: string;
    icon: string;
    clock: number;
    allow: number;
    left: number;
    tips: number;
    mult: number;
    /** Screen-space bearing of the next stretch of road (rad, 0 = straight ahead). */
    bearing: number;
    arriving: boolean;
  } | null;
  /** Fares waiting (cab empty), nearest first. */
  waiting: { name: string; dest: string; icon: string; d: number; bearing: number }[];
  /** A hitchhiker near the road, when there's no one aboard. */
  hitch: { name: string; dest: string; d: number } | null;
  /** The passenger's last line. */
  said: { name: string; text: string; at: number } | null;
  pops: TaxiPop[];
  /** Drop-off receipt (shown a few seconds). */
  receipt: (DropPay & { at: number; name: string; dest: string; kind: 'fare' | 'hitch' }) | null;
  /** Shift over: totals + bests. */
  results: { totals: ShiftTotals; bests: TaxiBests; beat: string[] } | null;
  coin: number | null;
  /** Taxi chatter (chatter/): who's talking and what they're saying, mute, radio hold. */
  chat: ChatterUi | null;
  chatMuted: boolean;
}

const IDLE: TaxiUi = {
  cab: false,
  onShift: false,
  shiftClock: SHIFT.start,
  ride: null,
  waiting: [],
  hitch: null,
  said: null,
  pops: [],
  receipt: null,
  results: null,
  coin: null,
  chat: null,
  chatMuted: false,
};

// ── People at the roadside ──

interface Person {
  id: string;
  name: string;
  seed: [number, number, number, number, number];
  pos: THREE.Vector3;
  yaw: number;
  ch: NounCharacterT | null;
  bubble: HTMLDivElement | null;
  bubbleKey: string;
  /** Seconds since spawned (fares leave after FARES.patience). */
  age: number;
  wave: number;
  dest: Destination;
  /** Hitchhikers: their slot. */
  slot: HitchSlot | null;
}

interface Aboard {
  person: Person;
  ride: Ride;
  seat: number;
  /** Getting in (s left) — the car waits, they walk to the door. */
  boarding: number;
  from: THREE.Vector3;
}

interface Leaving {
  person: Person;
  t: number;
  dir: THREE.Vector3;
}

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pt = { x: 0, z: 0 };

const PATH_N = 90;
const PATH_STEP = 6;
const PATH_W = 1.6;
const BEACONS = 5;
const DRAW_PEOPLE = 160;

export class TaxiSystem {
  ui: TaxiUi = IDLE;
  readonly shift = new Shift();
  /** Off shift: a hitchhiker in whatever you drive. */
  private solo: Aboard | null = null;
  /** On shift: who's in the cab. */
  private cabRider: Aboard | null = null;
  private waiting: Person[] = [];
  private hitchers = new Map<string, Person>();
  /** Hitch slots already ridden this visit (they don't come back). */
  private ridden = new Set<string>();
  private leaving: Leaving[] = [];
  private buildQueue: Person[] = [];
  private route: Route | null = null;
  private cursor: RouteCursor | null = null;
  private routeFor = '';
  private offFor = 0;
  private rand = mulberry((Date.now() & 0xffff) ^ 0x7a71);
  private gate = new LineGate();
  private t = 0;
  private uiAcc = 0;
  private scanAcc = 0;
  private growDone = false;
  private listeners = new Set<() => void>();
  private pops: TaxiPop[] = [];
  private said: TaxiUi['said'] = null;
  private receipt: TaxiUi['receipt'] = null;
  private results: TaxiUi['results'] = null;
  private missCool = new Map<string, number>();
  private airWas = 0;
  private driftT = 0;
  private wasCab = false;
  private chatAcc = 0;
  private fastSaid = 0;
  private group = new THREE.Group();
  private arrow: THREE.Mesh;
  private path: THREE.Mesh;
  private pathPos: Float32Array;
  private beacons: THREE.InstancedMesh;
  private warmed = false;
  private registered = false;
  private bests: TaxiBests;
  private gone = false;
  /** Endless cab talk (chatter/): `game.taxi.chatter.start(...)` / `stop()`. */
  readonly chatter: ChatterSystem;
  /** The person this system started the chatter for (others, e.g. a hired cab, run their own). */
  private chatFor: string | null = null;

  constructor(private game: Game) {
    this.bests = parseBests(load(BESTS_KEY));
    this.chatter = new ChatterSystem(chatterHost(game));
    this.chatter.subscribe(() => this.push(true));
    this.group.name = 'taxi-guide';
    // Arrow: a chunky chevron, pointing +Z
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.1);
    shape.lineTo(0.9, -0.2);
    shape.lineTo(0.38, -0.2);
    shape.lineTo(0.38, -1.0);
    shape.lineTo(-0.38, -1.0);
    shape.lineTo(-0.38, -0.2);
    shape.lineTo(-0.9, -0.2);
    shape.closePath();
    const ag = new THREE.ExtrudeGeometry(shape, { depth: 0.28, bevelEnabled: false });
    ag.rotateX(Math.PI / 2);
    ag.translate(0, 0.14, 0);
    this.arrow = new THREE.Mesh(
      ag,
      new THREE.MeshBasicMaterial({
        color: 0x3ee86a,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    this.arrow.scale.setScalar(1.3);
    this.arrow.renderOrder = 10;
    this.arrow.name = 'taxi-arrow';
    // Path: a ribbon along the road ahead
    this.pathPos = new Float32Array(PATH_N * 2 * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute(
      'position',
      new THREE.BufferAttribute(this.pathPos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    const alpha = new Float32Array(PATH_N * 2);
    for (let i = 0; i < PATH_N; i++) {
      const a = Math.min(1, i / 4) * (1 - i / PATH_N);
      alpha[i * 2] = alpha[i * 2 + 1] = a;
    }
    pg.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    const seg = new Float32Array(PATH_N * 2);
    for (let i = 0; i < PATH_N; i++) seg[i * 2] = seg[i * 2 + 1] = i;
    pg.setAttribute('seg', new THREE.BufferAttribute(seg, 1));
    const idx: number[] = [];
    for (let i = 0; i < PATH_N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    pg.setIndex(idx);
    pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.path = new THREE.Mesh(
      pg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color(0x3ee86a) }, uT: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute float alpha;
          attribute float seg;
          varying float vA;
          varying float vS;
          void main() {
            vA = alpha;
            vS = seg;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uT;
          varying float vA;
          varying float vS;
          void main() {
            float dash = 0.55 + 0.45 * step(0.5, fract(vS * 0.5 - uT * 1.5));
            gl_FragColor = vec4(uColor, vA * 0.7 * dash);
          }`,
      }),
    );
    this.path.frustumCulled = false;
    this.path.name = 'taxi-path';
    this.path.renderOrder = 5;
    // Beacons: tall soft columns over the stop / the waiting fares
    const bg = new THREE.CylinderGeometry(1.4, 1.4, 70, 12, 1, true);
    bg.translate(0, 35, 0);
    this.beacons = new THREE.InstancedMesh(
      bg,
      new THREE.MeshBasicMaterial({
        color: 0xffd400,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      BEACONS,
    );
    this.beacons.count = 0;
    this.beacons.frustumCulled = false;
    this.beacons.name = 'taxi-beacons';
    this.group.add(this.arrow, this.path, this.beacons);
    for (const m of [this.arrow, this.path, this.beacons]) inkExcluded.add(m);
    this.group.visible = false;
    for (const m of [this.arrow, this.path, this.beacons]) m.castShadow = m.receiveShadow = false;
    game.gfx.scene.add(this.group);
  }

  // ── Plumbing ──

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** For the pose blob (`tx`), or undefined when there's nothing to say. */
  netKey(): [number, string] | undefined {
    const w = this.wire();
    return w === null ? undefined : encodeTaxi(w);
  }

  private wire(): TaxiWire | null {
    const a = this.cabRider ?? this.solo;
    if (a !== null && a.boarding <= 0)
      return { state: a.ride.kind === 'fare' ? 1 : 2, dest: a.ride.dest.name };
    if (this.inCab()) return { state: 0, dest: '' };
    return null;
  }

  /** Close the results card. */
  dismiss() {
    this.results = null;
    this.push(true);
  }

  private inCab(): boolean {
    return this.game.cars.current?.spec.id === 'cab';
  }

  private registerSources() {
    if (this.registered) return;
    this.registered = true;
    registerBuiltins();
    setGrowAllowed(false);
    // Building doors (interiors/): the kerb in front of each, named by what's inside
    registerDestinations('doors', () => {
      const ints = this.game.interiors as unknown as InteriorsApi;
      const out: Destination[] = [];
      for (const d of ints.doors()) {
        if (d.area !== 'plaza') continue;
        const kind = d.kind ?? ints.kindOf?.(d.id) ?? null;
        const x = d.x + Math.sin(d.yaw) * 3.5;
        const z = d.z + Math.cos(d.yaw) * 3.5;
        // only doors on the ring road (the cab can stop outside)
        const m = Math.max(Math.abs(x), Math.abs(z));
        if (m < 56 || m > 76) continue;
        out.push({
          id: `door:${d.id}`,
          name: (d.name ?? KIND_NAME[kind ?? ''] ?? 'A DOOR').toUpperCase(),
          icon: KIND_ICON[kind ?? ''] ?? '🚪',
          kind: 'door',
          x,
          z,
          area: 'city',
          track: null,
          s: null,
          r: 11,
        });
      }
      return out;
    });
  }

  // ── The frame ──

  update(dt: number) {
    if (this.gone) return;
    this.t += dt;
    const g = this.game;
    this.registerSources();
    if (g.cars.driving && !this.growDone) this.growDone = growSome(240);

    const cur = g.cars.current;
    const cab = cur?.spec.id === 'cab';
    const sim = cur?.sim ?? null;
    const pos = g.player.pos;
    const speed = sim !== null ? sim.speed : 0;
    const kmh = speed * 3.6;

    // Out of the cab: the shift ends (results), the fare gets out
    if (this.wasCab && !cab) {
      if (this.shift.on) this.finishShift(this.shift.end());
      if (this.cabRider !== null) this.letOut(this.cabRider, false);
      this.cabRider = null;
      this.clearWaiting();
    }
    this.wasCab = cab;
    if (!g.cars.driving && this.solo !== null) {
      this.letOut(this.solo, false);
      this.solo = null;
    }

    // People: build one a frame
    const next = this.buildQueue.shift();
    if (next !== undefined) this.build(next);

    if (cab) {
      this.fillWaiting(pos);
      for (const ev of this.shift.tick(dt, kmh)) {
        if (ev.t === 'bail' && this.cabRider !== null) {
          this.say(this.cabRider.person, 'bail', true);
          this.pop('FARE LOST', false);
          this.letOut(this.cabRider, true);
          this.cabRider = null;
          this.clearRoute();
        } else if (ev.t === 'over') this.finishShift(ev.totals);
        else if (ev.t === 'warn') this.game.sfx.play('beep', { gain: 0.6 });
      }
    }
    // Hitchhikers (any car)
    this.scanAcc -= dt;
    if (this.scanAcc <= 0) {
      this.scanAcc = 0.5;
      this.scanHitchers(pos, g.cars.driving);
    }

    const aboard = this.cabRider ?? this.solo;
    // Pick-ups
    if (sim !== null && aboard === null && cur !== null) {
      const free = passengerSeats(cur.spec.id) > 0;
      let best: Person | null = null;
      let bd = Infinity;
      const pool = cab ? [...this.waiting, ...this.hitchers.values()] : [...this.hitchers.values()];
      for (const p of pool) {
        const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best !== null && best.ch !== null) {
        const ok =
          best.slot !== null
            ? canPickUp(bd, speed, free, false)
            : bd < SHIFT.pickupR && speed < SHIFT.pickupSpeed;
        if (ok) this.pickUp(best, cab, cur.spec.id);
      }
    }
    // Riding
    const a = this.cabRider ?? this.solo;
    if (a !== null && sim !== null && cur !== null) this.rideAlong(a, dt, cur, sim, cab);
    else this.clearRoute();
    // Chatter: theirs ends when they're out
    if (this.chatFor !== null && (a === null || a.person.id !== this.chatFor)) {
      this.chatter.stop();
      this.chatFor = null;
    }
    this.chatter.tick();

    this.stepPeople(dt, pos);
    this.stepLeaving(dt);
    this.updateGuide(dt, pos, cab);

    this.uiAcc -= dt;
    if (this.uiAcc <= 0) {
      this.uiAcc = 0.1;
      this.push(false);
    }
  }

  // ── Fares at the kerb ──

  private fillWaiting(pos: THREE.Vector3) {
    // drop the ones who gave up / are far behind
    for (let i = this.waiting.length - 1; i >= 0; i--) {
      const p = this.waiting[i];
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (d > FARES.goneDist || p.age > FARES.patience) {
        this.free(p);
        this.waiting.splice(i, 1);
      }
    }
    if (this.cabRider !== null || this.waiting.length >= FARES.waiting) return;
    const here = locate(pos.x, pos.z);
    const all = allDestinations();
    let at: {
      x: number;
      z: number;
      yaw: number;
      area: string;
      along: { track: number; s: number } | null;
    } | null = null;
    if (here.kind === 'city') {
      const P = kerbLength();
      const s0 = nearestS(KERB, pos.x, pos.z).s;
      const sign = this.rand() < 0.5 ? -1 : 1;
      const k = kerbSpot(
        s0 + sign * (FARES.nearMin + this.rand() * (FARES.nearMax - FARES.nearMin)) + P,
      );
      at = { ...k, area: 'city', along: null };
    } else if (here.kind === 'line' && here.track !== null && here.track.depth === 0) {
      // In a town's stretch: on main street's edge
      const town = Object.values(TOWN_SPECS).find(
        t => t.track === here.track!.id && here.s > t.s - 40 && here.s < t.s + 280,
      );
      if (town !== undefined) {
        const s = Math.max(
          town.s + 10,
          Math.min(town.s + 230, here.s + (this.rand() < 0.3 ? -1 : 1) * (40 + this.rand() * 100)),
        );
        const p = onLine(town.track, s);
        if (p !== null) {
          const side = this.rand() < 0.5 ? 1 : -1;
          const rx = Math.cos(p.h) * side;
          const rz = -Math.sin(p.h) * side;
          at = {
            x: p.x + rx * 8.5,
            z: p.z + rz * 8.5,
            yaw: Math.atan2(-rx, -rz),
            area: town.id,
            along: { track: town.track, s },
          };
        }
      }
    }
    if (at === null) return;
    // not on top of another
    if (this.waiting.some(w => Math.hypot(w.pos.x - at!.x, w.pos.z - at!.z) < 25)) return;
    const dest = pickDestination(at.x, at.z, at.area, at.along, all, this.rand);
    if (dest === null) return;
    const spec: FareSpec = {
      id: `fare:${Math.floor(this.rand() * 1e9).toString(36)}`,
      x: at.x,
      z: at.z,
      yaw: at.yaw,
      dest,
      seed: seedFrom(this.rand),
      name: nameFrom(this.rand),
    };
    const p = this.person(spec.id, spec.name, spec.seed, spec.x, spec.z, spec.yaw, dest, null);
    this.waiting.push(p);
  }

  private clearWaiting() {
    for (const p of this.waiting) this.free(p);
    this.waiting = [];
  }

  // ── Hitchhikers ──

  private scanHitchers(pos: THREE.Vector3, driving: boolean) {
    const want = new Map<string, HitchSlot>();
    if (driving) {
      const here = locate(pos.x, pos.z);
      if (here.kind === 'line' && here.track !== null) {
        let t = here.track;
        let s = here.s;
        while (t.parent !== null) {
          s = t.s0;
          t = t.parent;
        }
        // only when actually near the main (branches get none)
        if (t === here.track || Math.abs(s - here.s) < HITCH.spawnR)
          for (const h of slotsNear(t.id, here.s, HITCH.spawnR).slice(0, HITCH.max)) {
            const id = slotId(h);
            if (!this.ridden.has(id)) want.set(id, h);
          }
      }
    }
    for (const [id, p] of this.hitchers) {
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (!want.has(id) && (d > HITCH.despawnR || !driving)) {
        this.free(p);
        this.hitchers.delete(id);
      }
    }
    for (const [id, h] of want) {
      if (this.hitchers.has(id) || this.hitchers.size >= HITCH.max) continue;
      const dest = this.hitchDest(h.to);
      const t = mainTrack(h.track);
      if (dest === null || t === null) continue;
      const p = tracks.pointAt(t, h.s, { x: 0, z: 0, h: 0, k: 0 });
      const rx = Math.cos(p.h) * h.side;
      const rz = -Math.sin(p.h) * h.side;
      const r = mulberry(h.hash);
      const person = this.person(
        id,
        nameFrom(r),
        seedFrom(r),
        p.x + rx * HITCH.side,
        p.z + rz * HITCH.side,
        Math.atan2(-rx, -rz),
        dest,
        h,
      );
      this.hitchers.set(id, person);
    }
  }

  private hitchDest(to: TownId): Destination | null {
    const all = allDestinations();
    if (to === 'city')
      return all.find(d => d.id === 'spot:fountain-n') ?? all.find(d => d.area === 'city') ?? null;
    return all.find(d => d.id === `town:${to}`) ?? null;
  }

  // ── People ──

  private person(
    id: string,
    name: string,
    seed: Person['seed'],
    x: number,
    z: number,
    yaw: number,
    dest: Destination,
    slot: HitchSlot | null,
  ): Person {
    const p: Person = {
      id,
      name,
      seed,
      pos: new THREE.Vector3(x, this.groundY(x, z), z),
      yaw,
      ch: null,
      bubble: null,
      bubbleKey: '',
      age: 0,
      wave: 0,
      dest,
      slot,
    };
    this.buildQueue.push(p);
    return p;
  }

  private build(p: Person) {
    const g = this.game;
    const assets = g.assets;
    if (assets === null) {
      this.buildQueue.push(p);
      return;
    }
    // freed before its turn came
    if (!this.waiting.includes(p) && ![...this.hitchers.values()].includes(p)) return;
    const s = p.seed;
    const ch = new NounCharacter(
      { background: s[0], body: s[1], accessory: s[2], head: s[3], glasses: s[4] },
      assets,
    );
    ch.setBoardType('skate');
    ch.board.visible = false;
    if (g.gfx.toon) toonify(ch.root);
    const shadows = g.gfx.quality !== 'low';
    ch.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = shadows && m.castShadow;
      if (!shadows) m.receiveShadow = false;
    });
    ch.root.position.copy(p.pos);
    ch.root.quaternion.setFromAxisAngle(UP, p.yaw);
    g.gfx.scene.add(ch.root);
    p.ch = ch;
    const b = document.createElement('div');
    b.className = 'w2-nametag';
    b.style.display = 'none';
    b.style.pointerEvents = 'none';
    g.labelLayer.appendChild(b);
    p.bubble = b;
  }

  private free(p: Person) {
    const i = this.buildQueue.indexOf(p);
    if (i >= 0) this.buildQueue.splice(i, 1);
    if (p.ch !== null) {
      const ch = p.ch;
      ch.root.removeFromParent();
      ch.dispose();
      ch.body.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          const src = mat.userData.toonSrc as THREE.Material | undefined;
          const sm = mat as THREE.MeshStandardMaterial;
          if (/nounbody/i.test(sm.name)) sm.map?.dispose();
          src?.dispose();
          mat.dispose();
        }
      });
      p.ch = null;
    }
    p.bubble?.remove();
    p.bubble = null;
  }

  private groundY(x: number, z: number): number {
    const top = terrainInDomain(x, z) ? terrainHeight(x, z) + 6 : 8;
    _v.set(x, top, z);
    const hit = this.game.world.raycast(_v, DOWN, 40);
    if (hit !== null) return hit.point.y;
    return terrainInDomain(x, z) ? terrainHeight(x, z) : ROAD_Y;
  }

  private stepPeople(dt: number, pos: THREE.Vector3) {
    const cam = this.game.gfx.camera.position;
    const list = [...this.waiting, ...this.hitchers.values()];
    for (const p of list) {
      p.age += dt;
      const ch = p.ch;
      if (ch === null) continue;
      const dc = cam.distanceTo(p.pos);
      ch.root.visible = dc < DRAW_PEOPLE;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (ch.root.visible) {
        // wave at the cab as it comes close; hitchhikers keep a thumb out
        const close = d < 45;
        const want = close ? Math.atan2(pos.x - p.pos.x, pos.z - p.pos.z) : p.yaw;
        _q.setFromAxisAngle(UP, want);
        ch.root.quaternion.slerp(_q, 1 - Math.exp(-3 * dt));
        p.wave -= dt;
        if (close && p.wave < -2.5) p.wave = 1.8;
        ch.play({ clip: p.wave > 0 || p.slot !== null ? 'wave' : 'idle', fade: 0.3 });
        ch.update(dt, { lean: 0, travelled: 0, riding: false, grounded: true });
      }
      this.bubble(p, dc, p.slot !== null ? '👍' : '🚕', d);
    }
  }

  private bubble(p: Person, dc: number, icon: string, d: number) {
    const b = p.bubble;
    if (b === null) return;
    _v.copy(p.pos);
    _v.y += 2.6;
    _v.project(this.game.gfx.camera);
    const on = dc < 120 && _v.z < 1 && _v.z > -1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
    if (!on) {
      if (b.style.display !== 'none') b.style.display = 'none';
      return;
    }
    b.style.display = 'block';
    const w = this.game.gfx.renderer.domElement.clientWidth;
    const h = this.game.gfx.renderer.domElement.clientHeight;
    b.style.transform = `translate(-50%, -100%) translate(${Math.round(((_v.x + 1) / 2) * w)}px, ${Math.round(((1 - _v.y) / 2) * h)}px)`;
    const shout = d < 40 ? (p.slot !== null ? 'going my way?' : 'TAXI!') : '';
    const key = `${icon}${shout}${p.dest.id}`;
    if (key === p.bubbleKey) return;
    p.bubbleKey = key;
    b.innerHTML = `${shout !== '' ? `<div class="w2-said">${esc(shout)}</div>` : ''}<span style="font-size:11px">${icon} → ${esc(p.dest.icon)} ${esc(p.dest.name)}</span>`;
  }

  // ── Getting in, riding, getting out ──

  private pickUp(p: Person, cab: boolean, carId: Parameters<typeof passengerSeats>[0]) {
    const g = this.game;
    const pos = g.player.pos;
    const route = routeTo(pos.x, pos.z, p.dest);
    const kind = p.slot !== null ? 'hitch' : 'fare';
    const ride = cab
      ? this.shift.board({
          id: p.id,
          kind,
          name: p.name,
          dest: p.dest,
          metres: Math.round(route.length),
          from: this.payTownAt(pos),
          road: route.road,
        })
      : makeRide({
          id: p.id,
          kind,
          name: p.name,
          dest: p.dest,
          metres: Math.round(route.length),
          from: this.payTownAt(pos),
          road: route.road,
        });
    const aboard: Aboard = {
      person: p,
      ride,
      seat: passengerSeats(carId),
      boarding: SHIFT.boardS,
      from: p.pos.clone(),
    };
    if (p.slot !== null) {
      this.hitchers.delete(p.id);
      this.ridden.add(p.id);
    } else this.waiting = this.waiting.filter(w => w !== p);
    if (p.bubble !== null) p.bubble.style.display = 'none';
    if (cab) this.cabRider = aboard;
    else this.solo = aboard;
    this.setRoute(route, p.dest.id);
    this.results = null;
    g.sfx.play('mission-accept', { gain: 0.5 });
    const long = route.road;
    // they talk the whole way (chatter/), the greeting first
    this.chatFor = p.id;
    this.chatter.start({
      speaker: 'passenger',
      seed: p.seed,
      name: p.name,
      context: () => ({
        dest: (this.cabRider ?? this.solo)?.ride.dest.name ?? p.dest.name,
        kmh: (g.cars.current?.sim?.speed ?? 0) * 3.6,
      }),
    });
    this.say(p, kind === 'hitch' ? 'hitchHi' : long ? 'greetLong' : 'greet', true);
    this.airWas = 0;
    this.driftT = 0;
    this.chatAcc = 0;
  }

  private payTownAt(pos: THREE.Vector3): TownId {
    const here = locate(pos.x, pos.z);
    if (here.kind !== 'line' || here.track === null) return 'city';
    let t = here.track;
    let s = here.s;
    while (t.parent !== null) {
      s = t.s0;
      t = t.parent;
    }
    // the town whose stretch this is, else the city (the cap allows the slack)
    const town = Object.values(TOWN_SPECS).find(
      q => q.track === t.id && Math.abs(q.s + 120 - s) < 400,
    );
    return town?.id ?? 'city';
  }

  private rideAlong(
    a: Aboard,
    dt: number,
    cur: NonNullable<Game['cars']['current']>,
    sim: NonNullable<Game['cars']['current']>['sim'],
    cab: boolean,
  ) {
    const g = this.game;
    const pos = g.player.pos;
    const p = a.person;
    const ch = p.ch;
    const grp = cur.model.group;
    if (a.boarding > 0) {
      a.boarding -= dt;
      // walk to the door
      grp.updateMatrixWorld();
      _v2.set(cur.spec.geo.width / 2 + 0.4, 0, -0.4);
      grp.localToWorld(_v2);
      if (ch !== null) {
        const k = 1 - Math.max(0, a.boarding) / SHIFT.boardS;
        ch.root.position.lerpVectors(a.from, _v2, k);
        ch.root.position.y = a.from.y + (_v2.y - a.from.y) * k;
        ch.play({ clip: 'walk', fade: 0.15 });
        ch.update(dt, { lean: 0, travelled: dt * 2, riding: false, grounded: true });
      }
      return;
    }
    // in the seat (shown in open cars, hidden in closed ones like the cab)
    if (ch !== null) {
      const shown = riderShown(cur.spec, a.seat);
      ch.root.visible = shown;
      if (shown) {
        ch.play({ clip: 'idle', fade: 0.3 });
        ch.update(dt, { lean: 0, travelled: 0, riding: false });
        poseInSeat(ch, grp, cur.spec.id, a.seat, { driver: false });
      }
    }
    const r = a.ride;
    if (!cab) r.t += dt;
    // route progress, re-plan when well off it
    const c = this.cursor;
    if (c !== null) {
      c.update(pos.x, pos.z);
      this.offFor = c.off > 45 ? this.offFor + dt : 0;
      if (needsReroute(c.off, this.offFor)) {
        this.setRoute(routeTo(pos.x, pos.z, r.dest), r.dest.id);
        this.offFor = 0;
      }
    }
    // style tips
    const now = this.t;
    const crashed = sim.impact >= 9;
    if (crashed) this.stunt(r.style.crash(sim.impact, now), a, 'crash');
    if (sim.airTime > 0) this.airWas = sim.airTime;
    else if (this.airWas > 0) {
      this.stunt(r.style.air(this.airWas, now), a, 'air');
      this.airWas = 0;
    }
    if (sim.drifting) this.driftT += dt;
    else if (this.driftT > 0) {
      this.stunt(r.style.drift(this.driftT, now), a, 'drift');
      this.driftT = 0;
    }
    const misses = nearMisses(
      { x: pos.x, z: pos.z, vx: sim.vel.x, vz: sim.vel.z },
      this.missTargets(cur.model.group),
      crashed,
      now,
      this.missCool,
    );
    for (let i = 0; i < misses.length; i++) this.stunt(r.style.nearMiss(now), a, 'nearMiss');
    // chatter
    const kmh = sim.speed * 3.6;
    if (kmh > 160 && now - this.fastSaid > 20) {
      this.fastSaid = now;
      this.say(p, 'fast', false);
    }
    if (cab && r.allow - r.t < 12 && r.allow - r.t > 11.5) this.say(p, 'slow', false);
    if (r.kind === 'hitch' && !this.chatter.talking) {
      this.chatAcc += dt;
      if (this.chatAcc > 22) {
        this.chatAcc = 0;
        this.say(p, 'hitchChat', false);
      }
    }
    // arrived?
    const dd = Math.hypot(r.dest.x - pos.x, r.dest.z - pos.z);
    if (dd < r.dest.r && sim.speed < SHIFT.dropSpeed) this.dropOff(a, cab);
  }

  private missTargets(mine: THREE.Object3D): MissTarget[] {
    const g = this.game;
    const out: MissTarget[] = [];
    const me = g.player.pos;
    for (const t of g.cars.fleet) {
      if (t.model.group === mine || t.mode === 'driven') continue;
      if (Math.abs(t.pos.x - me.x) > 20 || Math.abs(t.pos.z - me.z) > 20) continue;
      const v = t.mode === 'cruise' ? t.v : 0;
      out.push({
        id: `car${t.n}`,
        x: t.pos.x,
        z: t.pos.z,
        vx: Math.sin(t.yaw) * v,
        vz: Math.cos(t.yaw) * v,
      });
    }
    for (const [id, rp] of g.net.players) {
      const c = rp.current.pos;
      if (Math.abs(c.x - me.x) > 20 || Math.abs(c.z - me.z) > 20) continue;
      out.push({ id: `p${id}`, x: c.x, z: c.z, vx: 0, vz: 0 });
    }
    for (const p of [...this.waiting, ...this.hitchers.values()])
      out.push({ id: p.id, x: p.pos.x, z: p.pos.z, vx: 0, vz: 0 });
    return out;
  }

  private stunt(e: StuntEvent | null, a: Aboard, line: LineEvent) {
    if (e === null) return;
    this.chatter.note(
      e.stunt === 'near-miss'
        ? 'nearMiss'
        : e.stunt === 'air'
          ? 'air'
          : e.stunt === 'drift'
            ? 'drift'
            : 'crash',
    );
    if (a.ride.kind === 'hitch' && e.stunt !== 'crash') {
      // hitchhikers love it but don't tip for it
      this.pop(e.label, true);
    } else
      this.pop(
        e.points !== 0 ? `${e.label} ${e.points > 0 ? '+' : ''}${e.points}` : e.label,
        e.points >= 0,
      );
    this.say(a.person, line, false);
  }

  private dropOff(a: Aboard, cab: boolean) {
    const g = this.game;
    const r = a.ride;
    const pay = cab ? this.shift.drop()! : soloPay(r);
    if (cab) this.cabRider = null;
    else this.solo = null;
    this.clearRoute();
    this.receipt = { ...pay, at: performance.now(), name: r.name, dest: r.dest.name, kind: r.kind };
    this.say(a.person, r.kind === 'hitch' ? 'hitchBye' : thanksFor(pay.grade), true);
    this.pop(`${GRADE_LINE[pay.grade]} +${pay.total} COIN`, true);
    g.sfx.play('coins', { gain: 0.8 });
    // pay through the ledger; respect for a good ride
    const to = payTown(r.dest.area === 'wild' ? { area: this.payTownAt(g.player.pos) } : r.dest);
    void g.trade
      .act({
        t: 'fare',
        town: to,
        from: r.from as TownId,
        coin: pay.total,
        metres: r.metres,
        who: r.id.replace(/[^\w.:-]/g, '').slice(0, 48),
        kind: r.kind,
      })
      .then(res => {
        if (!res.ok)
          this.pop(res.reason !== undefined ? res.reason.toUpperCase() : 'FARE NOT PAID', false);
      })
      .catch(() => this.pop('OFFLINE: FARE NOT SAVED', false));
    if (pay.grade === 'S' || pay.grade === 'A' || r.kind === 'hitch')
      g.respect.add({ kind: 'helped', who: r.id.slice(0, 40) });
    this.letOut(a, true);
  }

  /** They get out beside the car and walk off (or vanish if there's no car). */
  private letOut(a: Aboard, walk: boolean) {
    const p = a.person;
    const ch = p.ch;
    if (ch === null) {
      this.free(p);
      return;
    }
    leaveSeat(ch);
    const cur = this.game.cars.current;
    if (!walk || cur === null) {
      this.free(p);
      return;
    }
    const grp = cur.model.group;
    grp.updateMatrixWorld();
    _v.set(cur.spec.geo.width / 2 + 0.6, 0, -0.5);
    grp.localToWorld(_v);
    ch.root.position.set(_v.x, this.groundY(_v.x, _v.z), _v.z);
    ch.root.visible = true;
    const dir = new THREE.Vector3(_v.x - grp.position.x, 0, _v.z - grp.position.z).normalize();
    ch.root.quaternion.setFromAxisAngle(UP, Math.atan2(dir.x, dir.z));
    this.leaving.push({ person: p, t: 0, dir });
  }

  private stepLeaving(dt: number) {
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const l = this.leaving[i];
      l.t += dt;
      const ch = l.person.ch;
      if (ch === null || l.t > 3) {
        this.free(l.person);
        this.leaving.splice(i, 1);
        continue;
      }
      if (l.t < 1.2) {
        ch.play({ clip: 'wave', fade: 0.2 });
      } else {
        ch.root.position.addScaledVector(l.dir, dt * 1.6);
        ch.play({ clip: 'walk', fade: 0.2 });
      }
      ch.update(dt, {
        lean: 0,
        travelled: l.t < 1.2 ? 0 : dt * 1.6,
        riding: false,
        grounded: true,
      });
    }
  }

  private finishShift(totals: ShiftTotals) {
    const f = foldBests(this.bests, totals);
    this.bests = f.bests;
    save(BESTS_KEY, JSON.stringify(f.bests));
    this.results = { totals, bests: f.bests, beat: f.beat };
    this.game.sfx.play('mission-complete', { gain: 0.6 });
    this.push(true);
  }

  // ── Route + guide ──

  private setRoute(r: Route, id: string) {
    this.route = r;
    this.routeFor = id;
    this.cursor = new RouteCursor(r);
  }

  private clearRoute() {
    this.route = null;
    this.cursor = null;
    this.routeFor = '';
  }

  private updateGuide(dt: number, pos: THREE.Vector3, cab: boolean) {
    const c = this.cursor;
    const a = this.cabRider ?? this.solo;
    const showPath = c !== null && a !== null && a.boarding <= 0;
    const showBeacons = (cab && a === null && this.waiting.length > 0) || showPath;
    const on = showPath || showBeacons;
    if (on && !this.warmed) {
      this.warmed = true;
      const gfx = this.game.gfx;
      void warmHidden(gfx.renderer, this.group, gfx.camera, gfx.scene, fn => gfx.asDrawn(fn), 1500);
    }
    if (!on) {
      if (this.warmed) this.group.visible = false;
      return;
    }
    if (this.warmed && !this.group.visible && this.warmT()) this.group.visible = true;
    this.arrow.visible = showPath;
    this.path.visible = showPath;
    // beacons
    const m = new THREE.Matrix4();
    let n = 0;
    if (showPath) {
      const d = a!.ride.dest;
      m.makeTranslation(d.x, this.groundY(d.x, d.z), d.z);
      this.beacons.setMatrixAt(n++, m);
    } else {
      for (const w of this.waiting) {
        if (n >= BEACONS) break;
        m.makeScale(0.5, 0.25, 0.5).setPosition(w.pos.x, w.pos.y, w.pos.z);
        this.beacons.setMatrixAt(n++, m);
      }
    }
    this.beacons.count = n;
    this.beacons.instanceMatrix.needsUpdate = true;
    if (!showPath) return;
    const mat = this.path.material as THREE.ShaderMaterial;
    mat.uniforms.uT.value = this.t;
    // the ribbon along the next PATH_N × PATH_STEP m
    const P = this.pathPos;
    let px = pos.x;
    let pz = pos.z;
    for (let i = 0; i < PATH_N; i++) {
      c!.pointAhead(i * PATH_STEP + 3, _pt);
      const nx = _pt.x;
      const nz = _pt.z;
      let dx = nx - px;
      let dz = nz - pz;
      const L = Math.hypot(dx, dz) || 1;
      dx /= L;
      dz /= L;
      if (i > 0 || L > 0.01) {
        px = nx;
        pz = nz;
      }
      const y = this.pathY(nx, nz);
      const o = i * 6;
      P[o] = nx - dz * PATH_W;
      P[o + 1] = y;
      P[o + 2] = nz + dx * PATH_W;
      P[o + 3] = nx + dz * PATH_W;
      P[o + 4] = y;
      P[o + 5] = nz - dx * PATH_W;
    }
    (this.path.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    // the arrow over the car, at the road 30 m on
    c!.pointAhead(30, _pt);
    this.arrow.position.set(pos.x, pos.y + 3.6, pos.z);
    const yaw = Math.atan2(_pt.x - pos.x, _pt.z - pos.z);
    // tip raised toward the road ahead, so the chase camera sees its face
    this.arrow.rotation.set(-0.75, yaw, 0, 'YXZ');
    const near = Math.hypot(a!.ride.dest.x - pos.x, a!.ride.dest.z - pos.z) < a!.ride.dest.r * 2;
    (this.arrow.material as THREE.MeshBasicMaterial).color.setHex(near ? 0xffd400 : 0x3ee86a);
    void dt;
  }

  private warmStart = 0;
  private warmT(): boolean {
    if (this.warmStart === 0) this.warmStart = this.t;
    return this.t - this.warmStart > 0.2;
  }

  private pathY(x: number, z: number): number {
    if (terrainInDomain(x, z)) return terrainHeight(x, z) + 0.35;
    return ROAD_Y + 0.12;
  }

  // ── Lines + pops ──

  private say(p: Person, ev: LineEvent, urgent: boolean) {
    if (!this.gate.allow(ev, this.t) && !urgent) return;
    const to = (this.cabRider ?? this.solo)?.ride.dest.name ?? p.dest.name;
    const text = lineFor(ev, to, this.rand);
    this.said = { name: p.name, text, at: performance.now() };
    // the chatter says it in their chatter voice (and resumes after); muted: words only
    if (this.chatFor === p.id && this.chatter.event(text)) return;
    if (this.chatter.muted) return;
    const s = p.seed;
    try {
      this.game.voice.speak({
        text,
        voice: seedVoice({
          background: s[0],
          body: s[1],
          accessory: s[2],
          head: s[3],
          glasses: s[4],
        }),
        gain: 0.9,
      });
    } catch {
      /* no voice: the words still show */
    }
  }

  private pop(text: string, good: boolean) {
    const now = performance.now();
    this.pops = [...this.pops.filter(p => now - p.at < 2200), { text, good, at: now }].slice(-4);
    this.push(true);
  }

  private push(force: boolean) {
    const g = this.game;
    const cab = this.inCab();
    const a = this.cabRider ?? this.solo;
    const pos = g.player.pos;
    const yaw = g.cam.yaw;
    const bearing = (x: number, z: number) => wrap(Math.atan2(x - pos.x, z - pos.z) - yaw);
    let ride: TaxiUi['ride'] = null;
    if (a !== null) {
      const r = a.ride;
      const c = this.cursor;
      let b = 0;
      if (c !== null) {
        c.pointAhead(40, _pt);
        b = bearing(_pt.x, _pt.z);
      }
      const left = c?.left ?? Math.hypot(r.dest.x - pos.x, r.dest.z - pos.z);
      ride = {
        kind: r.kind,
        name: r.name,
        dest: r.dest.name,
        icon: r.dest.icon,
        clock: Math.max(0, r.allow - r.t),
        allow: r.allow,
        left,
        tips: r.style.tips,
        mult: r.style.mult,
        bearing: b,
        arriving: Math.hypot(r.dest.x - pos.x, r.dest.z - pos.z) < r.dest.r * 1.5,
      };
    }
    const waiting =
      cab && a === null
        ? this.waiting
            .map(w => ({
              name: w.name,
              dest: w.dest.name,
              icon: w.dest.icon,
              d: Math.hypot(w.pos.x - pos.x, w.pos.z - pos.z),
              bearing: bearing(w.pos.x, w.pos.z),
            }))
            .sort((x, y) => x.d - y.d)
        : [];
    let hitch: TaxiUi['hitch'] = null;
    if (a === null && g.cars.driving)
      for (const h of this.hitchers.values()) {
        const d = Math.hypot(h.pos.x - pos.x, h.pos.z - pos.z);
        if (hitch === null || d < hitch.d) hitch = { name: h.name, dest: h.dest.name, d };
      }
    const now = performance.now();
    const next: TaxiUi = {
      cab: cab || a !== null,
      onShift: this.shift.on,
      shiftClock: Math.max(0, this.shift.clock),
      ride,
      waiting,
      hitch,
      said: this.said !== null && now - this.said.at < 4500 ? this.said : null,
      pops: this.pops.filter(p => now - p.at < 2200),
      receipt: this.receipt !== null && now - this.receipt.at < 5000 ? this.receipt : null,
      results: this.results,
      coin: g.trade.state?.coin ?? null,
      chat: this.chatter.ui,
      chatMuted: this.chatter.muted,
    };
    if (
      !force &&
      !next.cab &&
      !this.ui.cab &&
      next.results === this.ui.results &&
      next.hitch === null &&
      this.ui.hitch === null &&
      next.chat === null &&
      this.ui.chat === null &&
      next.chatMuted === this.ui.chatMuted
    )
      return;
    this.ui = next;
    for (const fn of this.listeners) fn();
  }

  dispose() {
    this.gone = true;
    this.chatter.dispose();
    for (const p of [...this.waiting, ...this.hitchers.values()]) this.free(p);
    for (const a of [this.cabRider, this.solo]) if (a !== null) this.free(a.person);
    for (const l of this.leaving) this.free(l.person);
    this.waiting = [];
    this.hitchers.clear();
    this.leaving = [];
    this.group.removeFromParent();
    for (const m of [this.arrow, this.path, this.beacons]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      inkExcluded.delete(m);
    }
    this.listeners.clear();
  }

  // ── Map (ui/WorldMap.tsx) ──

  /** The taxi rank, the stop you're driving to, and the people waiting near you. */
  mapPoints(): NonNullable<MapScene['taxi']> {
    const out: NonNullable<MapScene['taxi']> = [];
    const rank = this.game.cars.fleet.find(t => t.spec.id === 'cab' && t.mode === 'parked');
    if (rank !== undefined)
      out.push({ x: rank.pos.x, z: rank.pos.z, name: 'TAXI RANK', icon: '🚕', kind: 'rank' });
    const a = this.cabRider ?? this.solo;
    if (a !== null)
      out.push({
        x: a.ride.dest.x,
        z: a.ride.dest.z,
        name: a.ride.dest.name,
        icon: '◎',
        kind: 'stop',
      });
    for (const w of this.waiting)
      out.push({ x: w.pos.x, z: w.pos.z, name: w.name, icon: '✋', kind: 'fare' });
    for (const h of this.hitchers.values())
      out.push({ x: h.pos.x, z: h.pos.z, name: h.name, icon: '👍', kind: 'hitch' });
    return out;
  }

  // ── Dev / tests ──

  /** Dev: a fare waiting right beside the car, wanting `destId` (browser tests). */
  devFare(destId: string): boolean {
    const d = allDestinations().find(q => q.id === destId);
    const pos = this.game.player.pos;
    if (d === undefined) return false;
    for (const w of this.waiting) this.free(w);
    this.waiting = [];
    const r = this.rand;
    const p = this.person(
      `fare:dev${Math.floor(r() * 1e6)}`,
      nameFrom(r),
      seedFrom(r),
      pos.x + 4,
      pos.z + 1,
      0,
      d,
      null,
    );
    this.waiting.push(p);
    return true;
  }

  /** Dev: the road beside the nearest hitchhiker slot to along-track s on main `track`. */
  devHitchSpot(track: number, s: number): { x: number; z: number; yaw: number; id: string } | null {
    const h = slotsNear(track, s, 5000)[0];
    const t = mainTrack(track);
    if (h === undefined || t === null) return null;
    const p = tracks.pointAt(t, h.s - 30, { x: 0, z: 0, h: 0, k: 0 });
    return { x: p.x, z: p.z, yaw: p.h, id: slotId(h) };
  }

  /** Dev: the route point `frac` of the way along, and the heading there. */
  devRoutePoint(frac: number): { x: number; z: number; yaw: number } | null {
    const r = this.route;
    if (r === null || r.xs.length < 2) return null;
    const n = r.xs.length;
    const i = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
    const j = Math.min(i, n - 2);
    const yaw = Math.atan2(r.xs[j + 1] - r.xs[j], r.zs[j + 1] - r.zs[j]);
    return { x: r.xs[i], z: r.zs[i], yaw };
  }

  /** Dev: the state in one object (window.__w2.taxi.debug()). */
  debug() {
    const a = this.cabRider ?? this.solo;
    return {
      onShift: this.shift.on,
      clock: this.shift.clock,
      waiting: this.waiting.map(w => ({
        id: w.id,
        x: w.pos.x,
        z: w.pos.z,
        dest: w.dest.id,
        built: w.ch !== null,
      })),
      hitchers: [...this.hitchers.values()].map(h => ({
        id: h.id,
        x: h.pos.x,
        z: h.pos.z,
        dest: h.dest.id,
        built: h.ch !== null,
      })),
      ride:
        a === null
          ? null
          : {
              id: a.ride.id,
              dest: a.ride.dest.id,
              metres: a.ride.metres,
              t: a.ride.t,
              allow: a.ride.allow,
              tips: a.ride.style.tips,
              boarding: a.boarding,
            },
      route:
        this.route === null
          ? null
          : {
              length: this.route.length,
              points: this.route.xs.length,
              left: this.cursor?.left ?? 0,
              off: this.cursor?.off ?? 0,
              for: this.routeFor,
            },
      destinations: allDestinations().length,
      chatter: {
        ...this.chatter.voiceLoad,
        talking: this.chatter.talking,
        muted: this.chatter.muted,
        state: this.chatter.ui?.state ?? 'off',
        lines: this.chatter.log.lines,
        house: this.chatter.log.house,
        fallback: this.chatter.log.fallback,
        events: this.chatter.log.events,
        last: this.chatter.log.last,
      },
      ring: RING.R,
    };
  }
}

/** Off shift (a hitchhiker in any car): pay without the shift's clock. */
function soloPay(r: Ride): DropPay {
  const s = new Shift();
  s.ride = r;
  s.on = true;
  return s.drop()!;
}

const KIND_NAME: Record<string, string> = {
  home: 'a house',
  cafe: 'the cafe',
  shop: 'the shop',
  bar: 'the bar',
  studio: 'the studio',
  gallery: 'the gallery',
  arcade: 'the arcade',
  barber: 'the barber',
  laundromat: 'the laundromat',
  gym: 'the gym',
};

const KIND_ICON: Record<string, string> = {
  home: '🏠',
  cafe: '☕',
  shop: '🛍',
  bar: '🍺',
  studio: '🎨',
  gallery: '🖼',
  arcade: '🕹',
  barber: '💈',
  laundromat: '🧺',
  gym: '🏋',
};

function wrap(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function esc(s: string): string {
  return s.replace(/["&'<>]/g, c => `&#${c.charCodeAt(0)};`);
}

function load(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function save(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode: bests just aren't kept */
  }
}
