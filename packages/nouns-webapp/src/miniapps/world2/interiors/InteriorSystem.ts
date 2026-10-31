// ── Interiors at runtime: `game.interiors` (InteriorsApi) ───────────────
//
// Outside: every building's door (plaza from the level's collision; Noun
// Jersey and the towns as you come near them) drawn as a lit doorway with
// its sign, and an "ENTER" prompt when you're at one. Arriving on a board
// steps you off it first.
//
// Going in: a quick fade to black, then the room is generated for that
// door (layout.ts, deterministic per door), built (build.ts) at a pocket
// high above the door, with its own collision (one dynamic body) and the
// world around it hidden, the light turned warm, and its residents (real
// Noun characters) spawned. Like the Big Drop's dimension, everything it
// changes is saved on the way in and put back on the way out; leaving puts
// you outside the door, facing the street, and frees the room.
//
// Inside, residents idle, walk between their spots, sit, turn to you and
// talk in speech bubbles; the visit (visit.ts) decides what they offer and
// how they take what you do; the menu (InteriorsUi) acts on it. What you
// do is reported to `game.respect` (if present) as RespectEvents, and your
// tier there decides who opens the door and what you're offered.

import type { BuildingDoor, InteriorKind, InteriorsApi, RespectApi, RespectTier } from './contract';
import type { Game } from '../Game';
import type { PlayerTerrain } from '../skate/Player';
import type { GoodId, TownId, TradeAction, TradeApi } from '../trade/contract';
import type { LevelData } from '../world/Level';

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { seedVoice } from '../audio/voice/cast';
import { prefetchGlbHead } from '../character/GlbHead';
import { NounCharacter } from '../character/NounCharacter';
import { clearFog, warmHidden } from '../render/shaderWarm';
import { inkExcluded, toonify } from '../render/Toon';
import { GROWN_TOWNS, placementOf, townFrame, type GrownTown } from '../towns/site';
import { GOODS, GOOD_ICON, GOOD_IDS } from '../trade/goods';
import { inCorridor } from '../world/mountain/Alleys';
import { NJ, njFrame, njToWorld } from '../world/mountain/nounJersey';

import { buildArtAtlas, type ArtAtlas, type TimeOfDay } from './art';
import { buildInterior, type BuiltInterior } from './build';
import { discounted, menuOf, type Food, type MenuItem } from './dialogue';
import { BANNED, SHUT } from './dialogue';
import { buildDoorMarkers, type DoorMarkers } from './doorMarkers';
import { doorReach } from './doors';
import { buildingFloors, pickSpawnHome } from './firstSpawn';
import { box, cyl, disposeMaterials, sphere } from './kit';
import { entryPoint, itemBox, layoutGrid, stealables, type Grid, type Layout } from './layout';
import {
  FEATURED,
  SNAPSHOT,
  askText,
  isPropMuseum,
  label,
  labelColor,
  latestProps,
  markPropMuseum,
  type Exhibit,
} from './museum';
import { KIND_LABEL } from './names';
import { plazaDoors } from './plazaDoors';
import { handPos, poseEat, poseSit } from './pose';
import { residentsFor, type ResidentDef } from './residents';
import { hash32, mulberry32, pick, type Rng } from './rng';
import { seatSpot, type RoomKey } from './roomNet';
import { storeyHeight, USE_LABEL } from './storeys';
import { njDoors, townDoors } from './townDoors';
import {
  EAT_S,
  answersDoor,
  arrive,
  asHouseGuest,
  caughtChance,
  menu,
  step,
  type Action,
  type Effect,
  type Visit,
  type VisitEvent,
} from './visit';
import { WindowViews } from './WindowViews';

/** Pocket height: the interiors float this high over their door (nothing up there). */
export const POCKET_Y = 4000;

/** The Prop Museum's wall props once the API has answered (this session). */
let museumWalls: readonly Exhibit[] | null = null;
/** Pool table felt height (build.ts pool_table). */
const POOL_FELT_Y = 0.82;

const _sunC = new THREE.Color();
const _hemiC = new THREE.Color();
const _hemiG = new THREE.Color();
/** Door prompt reach (m) and the most you can be moving to get one. */
const DOOR_R = 2.2;
const DOOR_SPEED = 7;
/** Areas stream their doors in / out at these distances (m). */
const AREA_IN = 650;
const AREA_OUT = 850;
const FADE_S = 0.28;
const BAN_MS = 10 * 60_000;
const NEAR_FOLK = 1.9;
const NEAR_SEAT = 1.25;
const NEAR_STEAL = 1.1;
const SAY_S = 3.2;
/** Camera pitch inside (rad): high over your head, looking down into the room. */
const INSIDE_PITCH = 0.62;
/** Indoor camera: how far behind you it sits (before the walls clamp it). */
const CAM_BACK = 3.4;
const Y = new THREE.Vector3(0, 1, 0);

/** What the menu (React) shows. */
export interface InteriorsView {
  /** The door prompt outside, the way out inside, or a thing you're at (a pool table, an exhibit). */
  prompt: { text: string; kind: 'enter' | 'leave' | 'spot'; sub?: string } | null;
  inside: { name: string; kind: InteriorKind; icon: string; label: string } | null;
  actions: RoomAction[];
  /** The first spawn: woken upstairs (the ways out are the first actions). */
  wake: { text: string; sub: string } | null;
  /** The buy panel (goods for a shop, the menu elsewhere). */
  shop: { title: string; rows: ShopRow[] } | null;
  gift: { to: string; name: string; amounts: number[] } | null;
  coin: number | null;
  note: { text: string; at: number } | null;
  eating: { name: string; icon: string } | null;
  /** The Prop Museum: the prop you're reading. */
  exhibit: ExhibitView | null;
}

/** The first spawn's ways out (offered in the menu, ahead of the visit's own). */
export interface WakeAction {
  a: 'wake';
  to: 'roof' | 'down';
  label: string;
  icon: string;
}

export type RoomAction = Action | WakeAction;

export interface ExhibitView {
  id: number;
  title: string;
  label: string;
  color: string;
  ask: string;
  votes: string;
  href: string;
}

/** Something in the room you can use from close by (E / tap): an exhibit, a pool table… */
interface Hotspot {
  /** Room frame. */
  x: number;
  z: number;
  reach: number;
  text: string;
  sub?: string;
  run: () => void;
}

/** What `game.pool` offers (built separately; absent until it lands). */
interface PoolApi {
  playAt(table: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    length: number;
    width: number;
  }): void;
  readonly active: boolean;
}

export interface ShopRow {
  id: string;
  name: string;
  icon: string;
  price: number | null;
  /** Goods go in the van; menu items are eaten here or are a service. */
  how: 'van' | 'eat' | 'service';
}

export type UiAction =
  | { a: 'enter' }
  | { a: 'leave' }
  | { a: 'menu'; index: number }
  | { a: 'buy'; id: string }
  | { a: 'gift'; coin: number }
  | { a: 'spot' }
  | { a: 'close' };

interface Saved {
  fog: THREE.Scene['fog'];
  background: THREE.Scene['background'];
  skyVisible: boolean;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiColor: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  playerTerrain: Game['player']['terrain'];
  worldTerrain: Game['world']['terrain'];
  softBounds: number;
  mountain: Game['player']['mountain'];
  homeSpots: Game['player']['homeSpots'];
  hidden: THREE.Object3D[];
}

interface Folk {
  def: ResidentDef;
  ch: NounCharacter | null;
  /** Room frame. */
  pos: THREE.Vector3;
  yaw: number;
  state: 'idle' | 'walk' | 'sit';
  timer: number;
  path: [number, number][];
  /** Where they're headed: a spot, or a seat. */
  goal: { spot?: number; seat?: number } | null;
  seat: number | null;
  sitK: number;
  bubble: HTMLDivElement;
  say: { text: string; t: number; tone: string; icon?: string } | null;
  bubbleKey: string;
  wave: number;
}

/** A floor of the building (0 = the ground floor, built on entry; the rest when you get near). */
interface Floor {
  level: number;
  layout: Layout;
  built: BuiltInterior | null;
  windows: WindowViews | null;
  spots: Hotspot[];
  /** Upstairs residents: they stay put (the ground floor's are `Live.folk`). */
  folk: { def: ResidentDef; ch: NounCharacter | null; x: number; z: number; yaw: number }[];
}

/** A spot in the world (a rooftop), facing `yaw`. */
interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface Live {
  door: BuildingDoor;
  kind: InteriorKind;
  layout: Layout;
  grid: Grid;
  built: BuiltInterior;
  origin: THREE.Vector3;
  folk: Folk[];
  visit: Visit;
  rnd: Rng;
  saved: Saved;
  steal: number[];
  taken: Set<number>;
  /** Sat on seat `seat` of floor `level`'s layout; `anchor` is where you stood (room frame). */
  sit: { seat: number; level: number; anchor: THREE.Vector3; k: number } | null;
  eat: { food: Food; t: number; mesh: THREE.Object3D } | null;
  t: number;
  /** Leave after this many seconds (shown / thrown out). */
  outIn: number | null;
  outWhy: 'kicked' | 'caught' | null;
  town: TownId;
  /** The real view out of the windows. */
  windows: WindowViews;
  atlas: ArtAtlas;
  /** Things to use from close by, and the one you're at. */
  spots: Hotspot[];
  spot: Hotspot | null;
  /** The Prop Museum: what's on the walls and plinths, and the one being read. */
  museum: { walls: readonly Exhibit[]; plinths: readonly Exhibit[] } | null;
  reading: Exhibit | null;
  /** Upstairs: the floors, storey height, the floor you're on, all floors' collision merged. */
  floors: Floor[];
  storey: number;
  level: number;
  collision: THREE.BufferGeometry | null;
  /** The real rooftop (multi-storey buildings), and where you're going out to (it, or the street). */
  roof: Pose | null;
  exit: Pose | null;
  /** The first spawn: sat upstairs, offered the roof or the way down (until you get up). */
  wake: boolean;
  /** The first spawn: the host's hello, held until you come downstairs. */
  greet: Effect[] | null;
}

interface Area {
  id: string;
  doors: BuildingDoor[];
  markers: DoorMarkers | null;
  /** Centre + whether it streams (the plaza never does). */
  x: number;
  z: number;
  streams: boolean;
}

export class InteriorSystem implements InteriorsApi {
  private areas = new Map<string, Area>();
  private live: Live | null = null;
  private phase: 'outside' | 'in' | 'out' | 'inside' = 'outside';
  private fadeT = 0;
  private pending: BuildingDoor | null = null;
  private stepOffT = 0;
  private near: BuildingDoor | null = null;
  private banned = new Map<string, number>();
  private overlay: HTMLDivElement | null = null;
  private layer: HTMLDivElement | null = null;
  private streamT = 0;
  private disposed = false;
  private started = false;
  /** A hop between floors (the first spawn's "downstairs"): fade, move, fade back. */
  private hop: { t: number; to: Pose; level: number } | null = null;
  /** The first spawn has been tried (once a page load). */
  private woke = false;
  private view: InteriorsView = {
    prompt: null,
    exhibit: null,
    inside: null,
    actions: [],
    wake: null,
    shop: null,
    gift: null,
    coin: null,
    note: null,
    eating: null,
  };
  private viewKey = '';
  private version = 0;
  private listeners = new Set<() => void>();
  private shopOpen = false;
  private giftTo: string | null = null;
  private note: { text: string; at: number } | null = null;
  private busy = false;
  private savedPitch = 0.12;
  /** Stats for browser checks: builds, frees, and the last build's numbers. */
  readonly stats = { entered: 0, left: 0, lastBuildMs: 0, drawCalls: 0, triangles: 0, items: 0 };

  constructor(private game: Game) {}

  // ── InteriorsApi ──

  current(): { door: BuildingDoor; kind: InteriorKind } | null {
    return this.live === null ? null : { door: this.live.door, kind: this.live.kind };
  }

  doors(): readonly BuildingDoor[] {
    const out: BuildingDoor[] = [];
    for (const a of this.areas.values()) out.push(...a.doors);
    return out;
  }

  /** Inside a building (or on the way in / out): the world around is hidden. */
  get inside(): boolean {
    return this.live !== null;
  }

  // ── React store ──

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getView = () => this.view;

  private setView(v: InteriorsView) {
    const key = JSON.stringify(v);
    if (key === this.viewKey) return;
    this.viewKey = key;
    this.view = v;
    this.version++;
    for (const l of this.listeners) l();
  }

  // ── Setup ──

  private get respect(): RespectApi | null {
    return (this.game as unknown as { respect?: RespectApi | null }).respect ?? null;
  }

  private get trade(): TradeApi | null {
    return (this.game as unknown as { trade?: TradeApi | null }).trade ?? null;
  }

  private tier(): RespectTier {
    try {
      return this.respect?.state().tier ?? 'stranger';
    } catch {
      return 'stranger';
    }
  }

  /** After the level and its collision are built: the plaza's doors. */
  start(level: LevelData) {
    if (this.started) return;
    this.started = true;
    this.injectDom();
    document.addEventListener('keydown', this.onKey, true);
    try {
      if (!level.baked) return;
      const soft = level.softBounds ?? 93.6;
      const t0 = performance.now();
      const doors = plazaDoors(level.collisionMeshes, {
        probe: this.game.world,
        open: (x, z) => Math.max(Math.abs(x), Math.abs(z)) < soft - 0.3 || inCorridor(x, z),
      });
      markPropMuseum(doors);
      this.addArea({ id: 'plaza', doors, markers: null, x: 0, z: 0, streams: false });
      console.info(
        `[interiors] plaza: ${doors.length} doors in ${(performance.now() - t0).toFixed(0)} ms`,
      );
    } catch (err) {
      console.warn('[interiors] plaza doors failed', err);
    }
  }

  private addArea(a: Area) {
    if (a.doors.length > 0) {
      a.markers = buildDoorMarkers(a.doors, o => {
        if (this.game.gfx.toon) toonify(o);
      });
      this.game.gfx.scene.add(a.markers.group);
    }
    this.areas.set(a.id, a);
  }

  private dropArea(id: string) {
    const a = this.areas.get(id);
    if (a === undefined) return;
    a.markers?.dispose();
    this.areas.delete(id);
  }

  /** Noun Jersey and the towns: doors stream in as you come near. */
  private stream() {
    const p = this.game.player.pos;
    const nj = njFrame();
    if (nj !== null) {
      const c = njToWorld(nj, NJ.W / 2, NJ.L / 2, { x: 0, z: 0 });
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (!this.areas.has('jersey') && d < AREA_IN)
        this.addArea({
          id: 'jersey',
          doors: njDoors(nj),
          markers: null,
          x: c.x,
          z: c.z,
          streams: true,
        });
      else if (this.areas.has('jersey') && d > AREA_OUT) this.dropArea('jersey');
    }
    for (const id of GROWN_TOWNS) {
      const f = townFrame(id);
      if (f === null) continue;
      const pl = placementOf(f);
      const key = `town:${id}`;
      const d = Math.hypot(pl.x - p.x, pl.z - p.z);
      if (!this.areas.has(key) && d < AREA_IN) {
        try {
          this.addArea({
            id: key,
            doors: townDoors(id, f),
            markers: null,
            x: pl.x,
            z: pl.z,
            streams: true,
          });
        } catch (err) {
          console.warn('[interiors] town doors failed', id, err);
          this.areas.set(key, {
            id: key,
            doors: [],
            markers: null,
            x: pl.x,
            z: pl.z,
            streams: true,
          });
        }
      } else if (this.areas.has(key) && d > AREA_OUT) this.dropArea(key);
    }
  }

  // ── Per frame ──

  update(dt: number) {
    if (this.disposed || !this.started) return;
    const g = this.game;
    this.streamT -= dt;
    if (this.streamT <= 0 && this.live === null) {
      this.streamT = 0.5;
      this.stream();
    }
    // Fades
    if (this.phase === 'in' || this.phase === 'out') {
      this.fadeT += dt;
      const k = Math.min(1, this.fadeT / FADE_S);
      this.setFade(k);
      if (k >= 1) {
        if (this.phase === 'in' && this.pending !== null) {
          const door = this.pending;
          this.pending = null;
          try {
            this.goIn(door);
          } catch (err) {
            // Never leave the screen black: back outside (or out, if half in)
            console.warn('[interiors] enter failed', err);
            if (this.live !== null) this.goOut();
            else {
              this.phase = 'outside';
              this.fadeT = -FADE_S;
            }
          }
        } else if (this.phase === 'out') this.goOut();
        else {
          this.phase = this.live !== null ? 'inside' : 'outside';
          this.fadeT = -FADE_S;
        }
      }
    } else if (this.fadeT < 0 && this.hop === null) {
      // Fading back in (fadeT runs −FADE_S → 0), once the room can draw
      if (!this.warming) this.fadeT = Math.min(0, this.fadeT + dt);
      this.setFade(-this.fadeT / FADE_S);
    }
    if (this.hop !== null) this.updateHop(dt);
    if (this.stepOffT > 0) {
      this.stepOffT -= dt;
      if (this.stepOffT <= 0 && this.pending !== null) this.beginFade('in');
    }
    if (this.live !== null && this.phase !== 'in') this.updateInside(dt);
    else if (this.live === null) this.updateOutside();
    void g;
    this.publish();
  }

  private updateOutside() {
    const p = this.game.player;
    this.near = null;
    if (this.phase !== 'outside' || this.pending !== null) return;
    if (p.speed > DOOR_SPEED || this.game.van2.driving || this.game.dragon.riding) return;
    let best = Infinity;
    for (const a of this.areas.values())
      for (const d of a.doors) {
        if (Math.abs(d.x - p.pos.x) > DOOR_R + 1 || Math.abs(d.z - p.pos.z) > DOOR_R + 1) continue;
        if (Math.abs(p.pos.y - d.y) > 1.6) continue;
        const r = doorReach(d, p.pos.x, p.pos.z);
        if (r.dist < DOOR_R && r.front > 0.15 && r.dist < best) {
          best = r.dist;
          this.near = d;
        }
      }
  }

  /** Walk in: step off the board first, then fade. */
  requestEnter(door: BuildingDoor | null = this.near) {
    if (door === null || this.live !== null || this.phase !== 'outside' || this.pending !== null)
      return;
    // Not today: turned away at the door
    const now = Date.now();
    const ban = this.banned.get(door.id);
    const kind = door.kind ?? 'home';
    if (ban !== undefined && ban > now) return this.turnedAway(door, pick(Math.random, BANNED));
    const day = Math.floor(now / 3_600_000);
    const roll = hash32(`${door.id}:${day}`) / 4294967296;
    if (!answersDoor(kind, this.tier(), roll))
      return this.turnedAway(door, pick(Math.random, SHUT));
    this.pending = door;
    const p = this.game.player;
    if (p.mode === 'board') {
      p.toggleBoard();
      this.stepOffT = 0.35;
    } else this.beginFade('in');
    this.game.sfx.play('door-creak', { gain: 0.5 });
  }

  private turnedAway(door: BuildingDoor, line: string) {
    this.game.sfx.play('ui-cancel', { gain: 0.5 });
    this.toast(
      `“${line}”`,
      `${KIND_LABEL[door.kind ?? 'home'].icon} ${(door.name ?? '').toUpperCase()}`,
    );
    this.game.voice.speak({
      text: line,
      voice: seedVoice([0, hash32(door.id) % 31, 0, hash32(door.id) % 258, 0]),
    });
  }

  requestLeave() {
    if (this.live === null || this.phase !== 'inside') return;
    this.beginFade('out');
  }

  private beginFade(dir: 'in' | 'out') {
    this.phase = dir;
    this.fadeT = 0;
  }

  private setFade(k: number) {
    if (this.overlay === null) return;
    this.overlay.style.opacity = String(k);
    this.overlay.style.display = k > 0.001 ? 'block' : 'none';
  }

  // ── The first spawn (interiors/firstSpawn.ts) ──

  /**
   * Start the game sat upstairs in a plaza home (a random one with an
   * upper floor, a roof hatch and a seat up there), the screen black until
   * the room's ready. Once a page load; false (and nothing changed) when
   * no home fits or anything fails, so the caller's plaza spawn stands.
   */
  spawnUpstairs(rnd: () => number = Math.random): boolean {
    if (this.woke || this.disposed || !this.started) return false;
    if (this.live !== null || this.phase !== 'outside' || this.pending !== null) return false;
    this.woke = true;
    const plaza = this.areas.get('plaza');
    if (plaza === undefined) return false;
    let back: { pos: THREE.Vector3; yaw: number } | null = null;
    try {
      const pick = pickSpawnHome(plaza.doors, rnd, d => {
        const fl = buildingFloors(d).floors[0]!;
        return this.findRoof(d, fl) !== null;
      });
      if (pick === null) return false;
      const p = this.game.player;
      back = { pos: p.pos.clone(), yaw: Math.atan2(p.fwd.x, p.fwd.z) };
      if (p.mode === 'board') p.toggleBoard();
      this.setFade(1);
      this.goIn(pick.door, { level: pick.level, seat: pick.seat });
      if ((this.live as Live | null)?.wake !== true) throw new Error('no seat upstairs');
      console.info(`[interiors] woke up upstairs at ${pick.door.id} (floor ${pick.level + 1})`);
      return true;
    } catch (err) {
      // Never leave the screen black: back out to the plaza spawn
      console.warn('[interiors] first spawn failed', err);
      if (this.live !== null) this.goOut();
      // …right where the plaza spawn had put you
      if (back !== null) {
        this.game.player.spawn(back.pos, back.yaw);
        this.game.cam.snap(this.game.player);
      }
      this.phase = 'outside';
      this.fadeT = -FADE_S;
      return false;
    }
  }

  /** Woken upstairs: onto floor `level`, sat on `seat` (its "stand here" spot is the anchor). */
  private wakeOn(L: Live, at: { level: number; seat: number }) {
    const f = L.floors[at.level];
    const seat = f?.layout.seats[at.seat];
    if (f === undefined || seat === undefined || at.level < 1) return;
    this.buildFloor(L, at.level);
    L.level = at.level;
    const g = this.game;
    const fy = L.origin.y + at.level * L.storey;
    g.player.spawn(
      new THREE.Vector3(L.origin.x + seat.ax, fy + 0.05, L.origin.z + seat.az),
      seat.yaw,
    );
    g.cam.snap(g.player);
    L.sit = {
      seat: at.seat,
      level: at.level,
      anchor: new THREE.Vector3(seat.ax, 0, seat.az),
      k: 1,
    };
    // (a neutral visit: asHouseGuest, so this sit doesn't count as one)
    this.visitStep({ t: 'sit', seat: at.seat });
    L.wake = true;
  }

  /** The rider gets up off their seat (walked off, the menu, a floor change). */
  private getUp(L: Live) {
    L.sit = null;
    L.wake = false;
    this.visitStep({ t: 'stand' });
  }

  /** The first spawn's prompt, then the visit's own menu (Leave is "Downstairs" meanwhile). */
  private actionsNow(L: Live): RoomAction[] {
    const base = menu(L.visit, this.ctx);
    if (!L.wake) return base;
    const out: RoomAction[] = [];
    if (L.roof !== null) out.push({ a: 'wake', to: 'roof', label: 'Up to the roof', icon: '🪜' });
    out.push({ a: 'wake', to: 'down', label: 'Downstairs', icon: '🚪' });
    return [...out, ...base.filter(a => a.a !== 'leave')];
  }

  /**
   * Roof: out through the hatch onto the real rooftop. Down: a fade to the
   * foot of the ground-floor flight, facing into the room (the front door
   * just behind you).
   */
  private wakeGo(L: Live, to: 'roof' | 'down') {
    if (this.phase !== 'inside' || this.hop !== null) return;
    if (L.sit !== null) this.getUp(L);
    L.wake = false;
    if (to === 'roof') {
      if (L.roof === null) return;
      this.game.sfx.play('door-creak', { gain: 0.4 });
      L.exit = L.roof;
      this.requestLeave();
      return;
    }
    const ground = L.layout;
    const up = ground.stairs?.up ?? null;
    const [ex, ez] = entryPoint(ground);
    // The landing at the foot of the flight (kept clear), else just inside the door
    const pose: Pose =
      up !== null
        ? { x: (up.x0 + up.x1) / 2, y: 0, z: Math.max(0.6, up.z0 - 0.7), yaw: 0 }
        : { x: ex, y: 0, z: ez + 0.7, yaw: 0 };
    this.game.sfx.play('ui-click', { gain: 0.4 });
    this.hop = { t: 0, to: pose, level: 0 };
  }

  /** The hop's fade: to black, move (room frame → world), then the usual fade back in. */
  private updateHop(dt: number) {
    const h = this.hop!;
    const L = this.live;
    if (L === null || this.phase !== 'inside') {
      this.hop = null;
      return;
    }
    h.t += dt;
    const k = Math.min(1, h.t / FADE_S);
    this.setFade(k);
    if (k < 1) return;
    this.hop = null;
    const g = this.game;
    const p = g.player;
    p.spawn(
      new THREE.Vector3(
        L.origin.x + h.to.x,
        L.origin.y + h.level * L.storey + 0.05,
        L.origin.z + h.to.z,
      ),
      h.to.yaw,
    );
    p.vel.set(0, 0, 0);
    g.cam.snap(p);
    if (g.me !== null) g.me.root.position.copy(p.pos);
    this.camInit = false;
    // (updateFloors picks up the new floor, and the host's hello, next frame)
    this.fadeT = -FADE_S;
  }

  // ── Going in ──

  /**
   * `wake`: the first spawn (spawnUpstairs): straight onto that floor's
   * seat, sat down, with the way up / the way down offered.
   */
  private goIn(entered: BuildingDoor, wake?: { level: number; seat: number }) {
    const g = this.game;
    const fromRoof = this.roofDoors.get(entered.id);
    const door = fromRoof ?? entered;
    const t0 = performance.now();
    const museum = isPropMuseum(door)
      ? { walls: museumWalls ?? SNAPSHOT, plinths: FEATURED }
      : null;
    // Every floor planned now (cheap); upstairs is built when you get near
    const plan = buildingFloors(door, museum !== null ? 'prop-museum' : undefined);
    const kind = plan.kind;
    const multi = plan.floors.length > 1;
    const layout = plan.floors[0]!;
    const uppers = plan.floors.slice(1);
    const tLayout = performance.now();
    const tier = this.tier();
    const atlas = buildArtAtlas(layout, {
      area: door.area,
      time: timeOf(g.hud.timeOfDay),
      tier,
      ...(museum !== null ? { museum } : {}),
    });
    const tAtlas = performance.now();
    const built = buildInterior(layout, atlas, { shadows: g.gfx.quality !== 'low' });
    const tBuild = performance.now();
    // Residents
    const rnd = mulberry32(hash32(`${door.id}:${Date.now()}`));
    const defs = residentsFor(door.id, layout, tier);
    // Their 3D head models load over the network (the head stays hidden
    // until then): start now, so they're there by the time they're built
    for (const d of defs) prefetchGlbHead(d.seed[3], d.seed[4]);
    const tFolk0 = performance.now();
    const folk: Folk[] = defs.map(def => this.makeFolk(def, layout));
    const tFolk = performance.now();
    const arrived = arrive(door.id, kind, tier, defs, rnd);
    // Woken upstairs: a neutral visit, and the host's hello waits until you come down
    const visit = wake !== undefined ? asHouseGuest(arrived.visit) : arrived.visit;
    const effects = wake !== undefined ? [] : arrived.effects;
    // (Everything that could fail is done: now change the world)
    if (g.gfx.toon) toonify(built.group);
    const origin = new THREE.Vector3(door.x, POCKET_Y, door.z);
    built.group.position.copy(origin);
    built.group.updateMatrixWorld(true);
    g.gfx.scene.add(built.group);
    g.world.setDynamic('interior', built.collision, origin);

    // Hide the world; warm light
    const gfx = g.gfx;
    const hidden: THREE.Object3D[] = [];
    const keep = new Set<THREE.Object3D>([gfx.sun, gfx.sun.target, g.particles.group, built.group]);
    if (g.me !== null) keep.add(g.me.root);
    for (const o of gfx.scene.children)
      if (o.visible && !keep.has(o) && !(o as THREE.Light).isLight && o !== gfx.sky) {
        o.visible = false;
        hidden.push(o);
      }
    const p = g.player;
    const saved: Saved = {
      fog: gfx.scene.fog,
      background: gfx.scene.background,
      skyVisible: gfx.sky.visible,
      sunColor: gfx.sun.color.clone(),
      sunIntensity: gfx.sun.intensity,
      hemiColor: gfx.hemi.color.clone(),
      hemiGround: gfx.hemi.groundColor.clone(),
      hemiIntensity: gfx.hemi.intensity,
      playerTerrain: p.terrain,
      worldTerrain: g.world.terrain,
      softBounds: p.softBounds,
      mountain: p.mountain,
      homeSpots: p.homeSpots,
      hidden,
    };
    // No fog in here, without relinking every program in view (shaderWarm.ts)
    gfx.scene.fog = clearFog();
    gfx.scene.background = new THREE.Color(0x14100c);
    gfx.sky.visible = false;
    const dark =
      layout.palette.wall < 0x606060 || kind === 'bar' || kind === 'arcade' || kind === 'studio';
    gfx.sun.color.set(0xfff0d8);
    gfx.sun.intensity = saved.sunIntensity * (dark ? 0.75 : 0.95);
    gfx.hemi.color.set(dark ? 0xffd6a8 : 0xfff3e0);
    gfx.hemi.groundColor.set(dark ? 0x5a3a2a : 0x8a7058);
    gfx.hemi.intensity = Math.max(0.6, saved.hemiIntensity * (dark ? 2.6 : 2.2));

    // The rider: on foot, just inside the door, facing in
    const floorY = origin.y;
    const local: PlayerTerrain = {
      height: () => floorY,
      inDomain: () => true,
      surface: () => null,
    };
    p.terrain = local;
    g.world.terrain = null;
    p.softBounds = Infinity;
    p.mountain = null;
    const [ex, ez] = entryPoint(layout);
    // A step in from the door (so the way out isn't the first thing offered)
    const entry = new THREE.Vector3(origin.x + ex, floorY + 0.05, origin.z + ez + 0.7);
    p.homeSpots = [{ pos: entry.clone(), yaw: 0 }];
    if (p.mode === 'board') p.toggleBoard();
    p.spawn(entry, 0);
    p.mode = 'foot';
    g.cam.snap(p);
    // A dollhouse view: the camera up over your head, looking down into the
    // room (the ceiling is one-sided, so from above it's open)
    this.savedPitch = g.cam.pitch;
    g.cam.pitch = INSIDE_PITCH;
    this.camInit = false;
    g.stats.suspended = true;

    this.live = {
      door,
      kind,
      layout,
      grid: layoutGrid(layout, 0.2),
      built,
      origin,
      folk,
      visit,
      rnd,
      saved,
      steal: stealables(layout),
      taken: new Set(),
      sit: null,
      eat: null,
      t: 0,
      outIn: null,
      outWhy: null,
      town: townOf(door.area),
      windows: new WindowViews(door, layout),
      atlas,
      spots: [],
      spot: null,
      museum,
      reading: null,
      floors: [
        { level: 0, layout, built, windows: null, spots: [], folk: [] },
        ...uppers.map((ul, i) => ({
          level: i + 1,
          layout: ul,
          built: null,
          windows: null,
          spots: [],
          folk: [],
        })),
      ],
      storey: multi ? storeyHeight(plan.size.h) : 0,
      level: 0,
      collision: null,
      roof: multi ? this.findRoof(door, layout) : null,
      exit: null,
      wake: false,
      greet: wake !== undefined ? arrived.effects : null,
    };
    this.live.floors[0]!.windows = this.live.windows;
    this.live.spots = this.hotspots(this.live);
    // The museum's latest props: hung as soon as the API answers
    if (museum !== null && museumWalls === null) {
      const room = this.live;
      void latestProps().then(items => {
        if (items === null || items.length === 0) return;
        museumWalls = items;
        if (this.live !== room) return;
        room.museum = { walls: items, plinths: FEATURED };
        room.atlas.paintExhibits?.(items, FEATURED);
        room.spots = this.hotspots(room);
      });
    }
    // The real city out of the windows (rendered now, refreshed while inside)
    built.group.add(this.live.windows.group);
    this.live.windows.renderAll(this.renderOutside);
    // In from the roof: start at the top, by the hatch
    if (fromRoof !== undefined && this.live.floors.length > 1) {
      const L = this.live;
      const top = L.floors.length - 1;
      this.buildFloor(L, top);
      L.level = top;
      const hatch = L.floors[top]!.layout.items.find(it => it.type === 'roof_ladder');
      const hx = hatch?.x ?? 0;
      const hz = hatch?.z ?? L.layout.d / 2;
      // A step into the room from the ladder
      const [cx, cz] = [Math.sign(-hx) * 0.9, Math.sign(L.layout.d / 2 - hz) * 0.9];
      g.player.spawn(
        new THREE.Vector3(
          L.origin.x + hx + cx,
          L.origin.y + top * L.storey + 0.05,
          L.origin.z + hz + cz,
        ),
        0,
      );
      g.cam.snap(g.player);
    }
    // Woken upstairs: on that floor, sat on its seat
    if (wake !== undefined && fromRoof === undefined) this.wakeOn(this.live, wake);
    // The floor above too, now while the screen is black: updateFloors built
    // it 0.4 s after the fade-in, a ~0.5 s freeze on a desktop, seconds on a phone
    if (
      fromRoof === undefined &&
      wake === undefined &&
      this.live.floors.length > 1 &&
      this.live.floors[1]!.built === null
    )
      this.buildFloor(this.live, 1);
    this.applyEffects(effects);
    const s = built.stats;
    if (import.meta.env.DEV)
      console.info(
        `[interiors] ${door.id}: layout ${(tLayout - t0).toFixed(0)} ms, art ${(tAtlas - tLayout).toFixed(0)}, build ${(tBuild - tAtlas).toFixed(0)}, folk ${(tFolk - tFolk0).toFixed(0)}, total ${(performance.now() - t0).toFixed(0)}`,
      );
    Object.assign(this.stats, {
      entered: this.stats.entered + 1,
      lastBuildMs: performance.now() - t0,
      drawCalls: s.drawCalls,
      triangles: s.triangles,
      items: s.items,
    });
    this.shopOpen = false;
    this.giftTo = null;
    this.phase = 'inside';
    this.fadeT = -FADE_S;
    // The room's programs link in the background while the screen is still
    // black; it fades in once they're ready (a blocking link here was a
    // 2 s freeze on a weak phone)
    const room = this.live;
    this.warming = true;
    void warmHidden(g.gfx.renderer, built.group, g.gfx.camera, g.gfx.scene, fn =>
      g.gfx.asDrawn(fn),
    ).then(() => {
      if (this.live === room) this.warming = false;
    });
  }

  /** The room's shaders are still compiling: hold the fade on black. */
  private warming = false;

  /** A resident's character: built one per frame after you're in (heads take a moment). */
  private makeCharacter(def: ResidentDef): NounCharacter | null {
    const g = this.game;
    const assets = g.assets;
    if (assets === null) return null;
    const s = def.seed;
    const ch = new NounCharacter(
      { background: s[0], body: s[1], accessory: s[2], head: s[3], glasses: s[4] },
      assets,
    );
    ch.setBoardType('skate');
    ch.board.visible = false;
    if (g.gfx.toon) toonify(ch.root);
    if (g.gfx.quality === 'low') ch.setCastShadows(false);
    g.gfx.scene.add(ch.root);
    return ch;
  }

  private makeFolk(def: ResidentDef, l: Layout): Folk {
    const spot = l.spots[def.home] ?? { x: 0, z: l.d / 2, yaw: 0 };
    const ch: NounCharacter | null = null;
    const bubble = document.createElement('div');
    bubble.className = 'ni-bubble';
    bubble.style.display = 'none';
    this.layer?.appendChild(bubble);
    return {
      def,
      ch,
      pos: new THREE.Vector3(spot.x, 0, spot.z),
      yaw: spot.yaw,
      state: 'idle',
      timer: 2 + Math.random() * 5,
      path: [],
      goal: null,
      seat: null,
      sitK: 0,
      bubble,
      say: null,
      bubbleKey: '',
      wave: def.role === 'owner' ? 0 : 1.5,
    };
  }

  // ── Going out ──

  private goOut() {
    this.warming = false;
    this.hop = null;
    const L = this.live;
    if (L === null) return;
    const g = this.game;
    // Tell the visit (walking out on food, an unthanked meal)
    this.visitStep({ t: 'leave' });
    for (const f of L.folk) this.disposeFolk(f);
    if (L.eat !== null) this.dropFood(L);
    g.world.setDynamic('interior', null);
    L.windows.dispose();
    for (const f of L.floors.slice(1)) this.disposeFloor(f);
    L.collision?.dispose();
    L.built.dispose();
    disposeMaterials(L.built.group);
    const s = L.saved;
    const gfx = g.gfx;
    for (const o of s.hidden) o.visible = true;
    gfx.scene.fog = s.fog;
    gfx.scene.background = s.background;
    gfx.sky.visible = s.skyVisible;
    gfx.sun.color.copy(s.sunColor);
    gfx.sun.intensity = s.sunIntensity;
    gfx.hemi.color.copy(s.hemiColor);
    gfx.hemi.groundColor.copy(s.hemiGround);
    gfx.hemi.intensity = s.hemiIntensity;
    const p = g.player;
    p.terrain = s.playerTerrain;
    g.world.terrain = s.worldTerrain;
    p.softBounds = s.softBounds;
    p.mountain = s.mountain;
    p.homeSpots = s.homeSpots;
    // Back outside the door, facing the street (or out on the roof), on foot
    const d = L.door;
    const nx = Math.sin(d.yaw);
    const nz = Math.cos(d.yaw);
    if (L.exit !== null) {
      p.spawn(new THREE.Vector3(L.exit.x, L.exit.y + 0.3, L.exit.z), L.exit.yaw);
      this.addRoofDoor(d, L.exit);
    } else p.spawn(new THREE.Vector3(d.x + nx * 1.8, d.y + 0.3, d.z + nz * 1.8), d.yaw);
    p.mode = 'foot';
    g.cam.snap(p);
    g.cam.pitch = this.savedPitch;
    g.stats.suspended = false;
    if (L.outWhy === 'caught') this.banned.set(d.id, Date.now() + BAN_MS);
    if (L.outWhy !== null)
      this.toast(
        L.outWhy === 'caught' ? 'THROWN OUT' : 'SHOWN THE DOOR',
        `${KIND_LABEL[L.kind].icon} ${(d.name ?? '').toUpperCase()}`,
      );
    if (g.me !== null) g.me.root.position.copy(p.pos);
    this.live = null;
    this.stats.left++;
    this.phase = 'outside';
    this.fadeT = -FADE_S;
    this.shopOpen = false;
    this.giftTo = null;
  }

  /**
   * Render the city as it is outside into a window's view: the world shown,
   * the outdoor light, fog and sky back, the room hidden, for this one
   * render; the shadow map isn't redrawn for it (its frustum is up here).
   */
  private renderOutside = (camera: THREE.PerspectiveCamera, target: THREE.WebGLRenderTarget) => {
    const L = this.live;
    if (L === null) return;
    const g = this.game;
    const gfx = g.gfx;
    const s = L.saved;
    const r = gfx.renderer;
    const fog = gfx.scene.fog;
    const background = gfx.scene.background;
    const sky = gfx.sky.visible;
    const sunC = _sunC.copy(gfx.sun.color);
    const sunI = gfx.sun.intensity;
    const hemiC = _hemiC.copy(gfx.hemi.color);
    const hemiG = _hemiG.copy(gfx.hemi.groundColor);
    const hemiI = gfx.hemi.intensity;
    // Only the riders out in the street are out there (Game.updateNetwork
    // draws just the ones in here, and the room is hidden for this render)
    const remotes: { o: THREE.Object3D; was: boolean }[] = [];
    for (const [id, q] of g.remotes) {
      const o = q.character.root;
      remotes.push({ o, was: o.visible });
      o.visible = (g.net.players.get(id)?.room ?? null) === null;
    }
    for (const o of s.hidden) o.visible = true;
    const shown = L.floors.map(f => f.built?.group.visible ?? false);
    for (const f of L.floors) if (f.built !== null) f.built.group.visible = false;
    gfx.scene.fog = s.fog;
    gfx.scene.background = s.background;
    gfx.sky.visible = s.skyVisible;
    gfx.sun.color.copy(s.sunColor);
    gfx.sun.intensity = s.sunIntensity;
    gfx.hemi.color.copy(s.hemiColor);
    gfx.hemi.groundColor.copy(s.hemiGround);
    gfx.hemi.intensity = s.hemiIntensity;
    const auto = r.shadowMap.autoUpdate;
    const prev = r.getRenderTarget();
    r.shadowMap.autoUpdate = false;
    try {
      r.setRenderTarget(target);
      r.clear();
      r.render(gfx.scene, camera);
    } finally {
      r.setRenderTarget(prev);
      r.shadowMap.autoUpdate = auto;
      for (const o of s.hidden) o.visible = false;
      for (const q of remotes) q.o.visible = q.was;
      L.floors.forEach((f, i) => {
        if (f.built !== null) f.built.group.visible = shown[i]!;
      });
      gfx.scene.fog = fog;
      gfx.scene.background = background;
      gfx.sky.visible = sky;
      gfx.sun.color.copy(sunC);
      gfx.sun.intensity = sunI;
      gfx.hemi.color.copy(hemiC);
      gfx.hemi.groundColor.copy(hemiG);
      gfx.hemi.intensity = hemiI;
    }
  };

  private disposeFolk(f: Folk) {
    f.bubble.remove();
    if (f.ch === null) return;
    f.ch.dispose();
    disposeMaterials(f.ch.body, true);
    // Each cloned skinned mesh has its own skeleton, and its bone texture
    // lives on the GPU until the skeleton itself is freed
    f.ch.root.traverse(o => (o as THREE.SkinnedMesh).skeleton?.dispose());
  }

  // ── Others in here (multiplayer: interiors/roomNet.ts) ──

  /** The room I'm in, for the pose blob's `in` (null in the street). */
  roomKey(): RoomKey | null {
    const L = this.live;
    if (L === null) return null;
    return { door: L.door.id, level: L.level, seat: L.sit?.seat ?? -1 };
  }

  private remoteSit = new Map<string, number>();

  /**
   * A rider in here with me, after their own update: on the seat they're sat
   * on (the blob's position is where they stood to sit), eased down onto it.
   */
  poseRemote(id: string, ch: NounCharacter, room: RoomKey | null, dt: number) {
    const L = this.live;
    const here = L !== null && room !== null && room.door === L.door.id && room.seat >= 0;
    // (the seat is on the floor they're on: upstairs too)
    const seat = here ? L.floors[room.level]?.layout.seats[room.seat] : undefined;
    if (L === null || room === null || seat === undefined) {
      this.remoteSit.delete(id);
      return;
    }
    const k = Math.min(1, (this.remoteSit.get(id) ?? 0) + dt * 4);
    this.remoteSit.set(id, k);
    const at = seatSpot(seat);
    const fy = L.origin.y + room.level * L.storey;
    ch.root.position.set(L.origin.x + at.x, fy, L.origin.z + at.z);
    ch.root.quaternion.setFromAxisAngle(Y, at.yaw);
    ch.play({ clip: 'idle', fade: 0.3 });
    poseSit(ch, fy, fy + seat.h, k);
  }

  // ── Inside ──

  private toRoom(w: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const o = this.live!.origin;
    return out.set(w.x - o.x, w.y - o.y, w.z - o.z);
  }

  private _rp = new THREE.Vector3();
  private _w = new THREE.Vector3();

  private updateInside(dt: number) {
    const L = this.live!;
    const g = this.game;
    const p = g.player;
    L.t += dt;
    // On foot only, and no wall climbing in a living room
    if (p.mode === 'board') p.toggleBoard();
    if (p.climb !== null) p.climb = null;
    (p as unknown as { climbCooldown: number }).climbCooldown = 1;
    // (The others: Game.updateNetwork draws only those in here, on this floor)
    const me = this.toRoom(p.pos, this._rp);
    this.updateFloors(L, dt);
    const here = L.floors[L.level]!;
    here.windows?.update(
      dt,
      g.gfx.camera,
      this.renderOutside,
      this.windowRefresh && g.gfx.quality !== 'low',
    );

    // Sitting: the rider is drawn on the seat; walking off stands you up
    if (L.sit !== null) {
      const seat = L.floors[L.sit.level]?.layout.seats[L.sit.seat];
      if (seat === undefined || Math.hypot(me.x - L.sit.anchor.x, me.z - L.sit.anchor.z) > 0.35) {
        this.getUp(L);
      } else {
        L.sit.k = Math.min(1, L.sit.k + dt * 4);
        if (g.me !== null) {
          const r = g.me.root;
          const at = seatSpot(seat);
          const fy = L.origin.y + L.sit.level * L.storey;
          r.position.set(L.origin.x + at.x, fy, L.origin.z + at.z);
          r.quaternion.setFromAxisAngle(Y, at.yaw);
          g.me.play({ clip: 'idle', fade: 0.3 });
          poseSit(g.me, fy, fy + seat.h, L.sit.k);
        }
        p.vel.set(0, 0, 0);
      }
    }
    // Eating: food in the hand, bites
    if (L.eat !== null) this.updateFood(L, dt);

    if (!this.poolActive()) this.dollhouse(L, dt);
    // What you're at: an exhibit, a pool table…
    L.spot = null;
    let best = Infinity;
    for (const h of L.level === 0 ? L.spots : here.spots) {
      const dd = Math.hypot(me.x - h.x, me.z - h.z);
      if (dd < h.reach && dd < best) {
        best = dd;
        L.spot = h;
      }
    }
    if (L.reading !== null && (L.spot === null || !L.spot.text.includes(`PROP ${L.reading.id}`)))
      L.reading = null;
    // Residents: one character built per frame (downstairs first)
    const unbuilt = L.folk.find(f => f.ch === null);
    if (unbuilt !== undefined) unbuilt.ch = this.makeCharacter(unbuilt.def);
    else this.stepUpFolk(L, here, dt, me);
    for (const f of L.folk) if (f.ch !== null) f.ch.root.visible = L.level === 0;
    let near: Folk | null = null;
    let nearD = NEAR_FOLK;
    let watched = false;
    const down = L.level === 0;
    for (const f of L.folk) {
      this.stepFolk(L, f, dt, me);
      if (!down) {
        f.bubble.style.display = 'none';
        continue;
      }
      const d = Math.hypot(f.pos.x - me.x, f.pos.z - me.z);
      if (d < nearD) {
        nearD = d;
        near = f;
      }
      // Eyes on you: close, facing your way
      if (d < 9) {
        const ang = Math.atan2(me.x - f.pos.x, me.z - f.pos.z);
        const diff = Math.abs(Math.atan2(Math.sin(ang - f.yaw), Math.cos(ang - f.yaw)));
        if (diff < 1.05) watched = true;
      }
    }
    // The visit's clock
    this.visitStep({ t: 'tick', dt, near: near?.def.id ?? null });
    if (L.outIn !== null) {
      L.outIn -= dt;
      if (L.outIn <= 0 && this.phase === 'inside') {
        L.outIn = null;
        this.beginFade('out');
      }
    }
    L.built.animate(L.t);
    // Menu context
    this.ctx = {
      near: near?.def.id ?? null,
      seat: L.sit !== null ? null : this.nearSeat(L, me),
      stealable: down ? this.nearStealable(L, me) : null,
      watched,
      canBuy: down && this.canBuy(L, me),
    };
  }

  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;

  /**
   * The camera inside: behind and well above you, looking down into the
   * room, kept within the room's walls (so a wall never comes between) and
   * up past the ceiling, which is one-sided: a dollhouse view. Mouse / stick
   * look still turns it (it follows the skate camera's heading).
   */
  private dollhouse(L: Live, dt: number) {
    const g = this.game;
    const cam = g.gfx.camera;
    const p = g.player.pos;
    const yaw = g.cam.controlYaw;
    const o = L.origin;
    const lay = L.layout;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const m = 0.45;
    let x = p.x - fx * CAM_BACK;
    let z = p.z - fz * CAM_BACK;
    x = Math.min(o.x + lay.w / 2 - m, Math.max(o.x - lay.w / 2 + m, x));
    z = Math.min(o.z + lay.d - m, Math.max(o.z + m, z));
    // Look a little ahead of you, the more so the closer the walls have
    // pushed the camera in over your head (so the room fills the view, not
    // the top of your head)
    const pushed = 1 - Math.min(1, Math.hypot(x - p.x, z - p.z) / CAM_BACK);
    const ahead = 0.6 + 1.6 * pushed;
    const tx = p.x + fx * ahead;
    const ty = p.y + 1.1 - 0.4 * pushed;
    const tz = p.z + fz * ahead;
    const y = o.y + L.level * L.storey + Math.max(lay.h + 0.35, 3.6);
    const k = this.camInit ? 1 - Math.exp(-7 * dt) : 1;
    this.camPos.lerp(this._w.set(x, y, z), k);
    this.camLook.lerp(this._w.set(tx, ty, tz), this.camInit ? 1 - Math.exp(-12 * dt) : 1);
    this.camInit = true;
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
  }

  private ctx = {
    near: null as string | null,
    seat: null as number | null,
    stealable: null as number | null,
    watched: false,
    canBuy: false,
  };

  /** A free seat within reach on the floor you're on (downstairs residents take theirs). */
  private nearSeat(L: Live, me: THREE.Vector3): number | null {
    let best: number | null = null;
    let bd = NEAR_SEAT;
    const down = L.level === 0;
    L.floors[L.level]!.layout.seats.forEach((s, i) => {
      if (down && L.folk.some(f => f.seat === i || f.goal?.seat === i)) return;
      const d = Math.min(Math.hypot(s.x - me.x, s.z - me.z), Math.hypot(s.ax - me.x, s.az - me.z));
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  private nearStealable(L: Live, me: THREE.Vector3): number | null {
    for (const i of L.steal) {
      if (L.taken.has(i)) continue;
      const b = itemBox(L.layout.items[i]!);
      const dx = Math.max(b.minX - me.x, 0, me.x - b.maxX);
      const dz = Math.max(b.minZ - me.z, 0, me.z - b.maxZ);
      if (Math.hypot(dx, dz) < NEAR_STEAL) return i;
    }
    return null;
  }

  private canBuy(L: Live, me: THREE.Vector3): boolean {
    if (L.kind === 'home') return false;
    const owner = L.folk.find(f => f.def.role === 'owner');
    if (owner !== undefined && Math.hypot(owner.pos.x - me.x, owner.pos.z - me.z) < 3.6)
      return true;
    // …or at the counter / desk / decks
    return L.layout.items.some(it => {
      if (it.type !== 'counter' && it.type !== 'desk' && it.type !== 'decks') return false;
      const b = itemBox(it);
      const dx = Math.max(b.minX - me.x, 0, me.x - b.maxX);
      const dz = Math.max(b.minZ - me.z, 0, me.z - b.maxZ);
      return Math.hypot(dx, dz) < 1.5;
    });
  }

  private stepFolk(L: Live, f: Folk, dt: number, me: THREE.Vector3) {
    const lay = L.layout;
    const owner = f.def.role === 'owner';
    f.timer -= dt;
    f.wave -= dt;
    if (f.say !== null) {
      f.say.t -= dt;
      if (f.say.t <= 0) f.say = null;
    }
    const offering = L.visit.offer?.from === f.def.id;
    const dMe = Math.hypot(me.x - f.pos.x, me.z - f.pos.z);
    // An offer: come over to you
    if (offering && dMe > 1.6 && f.state !== 'walk') {
      const ang = Math.atan2(f.pos.x - me.x, f.pos.z - me.z);
      const tx = me.x + Math.sin(ang) * 1.1;
      const tz = me.z + Math.cos(ang) * 1.1;
      const path = L.grid.path(f.pos.x, f.pos.z, tx, tz);
      if (path !== null) {
        this.standUp(f);
        f.path = path;
        f.goal = null;
        f.state = 'walk';
      }
    }
    switch (f.state) {
      case 'idle':
      case 'sit':
        if (f.timer > 0 || offering) break;
        if (owner) {
          // Owners keep to their post: back to it if they've left it, else a look about
          const home = lay.spots[f.def.home];
          if (home !== undefined && Math.hypot(home.x - f.pos.x, home.z - f.pos.z) > 0.5)
            this.pickGoal(L, f);
          else {
            f.timer = 5 + Math.random() * 8;
            if (home !== undefined) f.yaw = home.yaw + (Math.random() - 0.5) * 1.0;
          }
        } else this.pickGoal(L, f);
        break;
      case 'walk': {
        const next = f.path[0];
        if (next === undefined) {
          this.arrive(L, f);
          break;
        }
        const dx = next[0] - f.pos.x;
        const dz = next[1] - f.pos.z;
        const d = Math.hypot(dx, dz);
        const sp = 1.05;
        if (d < 0.08) f.path.shift();
        else {
          const k = Math.min(1, (sp * dt) / d);
          f.pos.x += dx * k;
          f.pos.z += dz * k;
          f.yaw = turnTo(f.yaw, Math.atan2(dx, dz), dt * 8);
        }
        break;
      }
    }
    // Face you when you're close, or when they're talking to you
    if (
      f.state !== 'walk' &&
      f.state !== 'sit' &&
      (dMe < 3.2 || (f.say !== null && dMe < 7) || offering)
    )
      f.yaw = turnTo(f.yaw, Math.atan2(me.x - f.pos.x, me.z - f.pos.z), dt * 5);
    // Draw
    const ch = f.ch;
    if (ch === null) return;
    const o = L.origin;
    ch.root.position.set(o.x + f.pos.x, o.y, o.z + f.pos.z);
    ch.root.quaternion.setFromAxisAngle(Y, f.yaw);
    const clip =
      f.state === 'walk'
        ? 'walk'
        : f.wave > 0
          ? 'wave'
          : f.say !== null && f.say.tone === 'happy'
            ? 'idle_look'
            : 'idle';
    ch.play({ clip, fade: 0.25, timeScale: f.state === 'walk' ? 1.3 : 1 });
    ch.update(dt, { lean: 0, travelled: 0, riding: false, grounded: true });
    if (f.state === 'sit' && f.seat !== null) {
      const s = lay.seats[f.seat]!;
      f.sitK = Math.min(1, f.sitK + dt * 3);
      ch.root.position.set(
        o.x + s.x - Math.sin(s.yaw) * 0.08,
        o.y,
        o.z + s.z - Math.cos(s.yaw) * 0.08,
      );
      ch.root.quaternion.setFromAxisAngle(Y, s.yaw);
      poseSit(ch, o.y, o.y + s.h, f.sitK);
    }
    this.renderBubble(L, f);
  }

  private standUp(f: Folk) {
    if (f.state !== 'sit' || f.seat === null) return;
    const s = this.live!.layout.seats[f.seat]!;
    f.pos.set(s.ax, 0, s.az);
    f.seat = null;
    f.sitK = 0;
    f.state = 'idle';
  }

  private pickGoal(L: Live, f: Folk) {
    const lay = L.layout;
    this.standUp(f);
    const owner = f.def.role === 'owner';
    const playerSeat = L.sit?.seat ?? null;
    const freeSeats = lay.seats
      .map((_, i) => i)
      .filter(
        i => i !== playerSeat && !L.folk.some(o => o !== f && (o.seat === i || o.goal?.seat === i)),
      );
    let goal: Folk['goal'] = null;
    let tx = f.pos.x;
    let tz = f.pos.z;
    if (owner) {
      const home = lay.spots[f.def.home];
      if (home === undefined) return;
      goal = { spot: f.def.home };
      tx = home.x;
      tz = home.z;
    } else if (freeSeats.length > 0 && Math.random() < 0.35) {
      const i = freeSeats[Math.floor(Math.random() * freeSeats.length)]!;
      goal = { seat: i };
      tx = lay.seats[i]!.ax;
      tz = lay.seats[i]!.az;
    } else {
      const spots = lay.spots.map((s, i) => [s, i] as const).filter(([s]) => s.owner !== true);
      if (spots.length === 0) return;
      const [s, i] = spots[Math.floor(Math.random() * spots.length)]!;
      goal = { spot: i };
      tx = s.x;
      tz = s.z;
    }
    const path = L.grid.path(f.pos.x, f.pos.z, tx, tz);
    if (path === null) {
      f.timer = 2 + Math.random() * 3;
      return;
    }
    f.path = path;
    f.goal = goal;
    f.state = 'walk';
  }

  private arrive(L: Live, f: Folk) {
    const g = f.goal;
    f.path = [];
    f.goal = null;
    if (g?.seat !== undefined && L.sit?.seat !== g.seat) {
      f.state = 'sit';
      f.seat = g.seat;
      f.sitK = 0;
      f.timer = 10 + Math.random() * 18;
      return;
    }
    f.state = 'idle';
    f.timer = 4 + Math.random() * 9;
    if (g?.spot !== undefined) {
      const s = L.layout.spots[g.spot];
      if (s !== undefined) f.yaw = s.yaw;
    }
  }

  // ── Visit + effects ──

  private visitStep(ev: VisitEvent) {
    const L = this.live;
    if (L === null) return;
    const r = step(L.visit, ev, L.rnd);
    L.visit = r.visit;
    this.applyEffects(r.effects);
  }

  private applyEffects(fx: Effect[]) {
    const L = this.live;
    if (L === null) return;
    for (const e of fx) {
      switch (e.t) {
        case 'say': {
          const f = L.folk.find(q => q.def.id === e.who);
          if (f === undefined) break;
          f.say = { text: e.text, t: SAY_S, tone: e.tone };
          f.bubbleKey = '';
          if (e.tone === 'happy' && Math.random() < 0.4) f.wave = 1.6;
          const d = Math.hypot(
            f.pos.x - this.toRoom(this.game.player.pos, this._w).x,
            f.pos.z - this._w.z,
          );
          this.game.voice.speak({
            text: e.text,
            voice: seedVoice(f.def.seed),
            gain: Math.max(0.35, 1 - d / 14),
          });
          break;
        }
        case 'offer': {
          const f = L.folk.find(q => q.def.id === e.who);
          if (f !== undefined) f.say = { text: '', t: 14, tone: 'happy', icon: e.food.icon };
          this.game.sfx.play('ui-click', { gain: 0.4 });
          break;
        }
        case 'eat':
          this.startFood(L, e.food);
          break;
        case 'done_eating':
          if (L.eat !== null) this.dropFood(L);
          break;
        case 'out':
          L.outWhy = e.why;
          L.outIn = 1.4;
          this.shopOpen = false;
          this.giftTo = null;
          break;
        case 'respect':
          try {
            this.respect?.add(e.e);
          } catch (err) {
            console.warn('[interiors] respect.add failed', err);
          }
          break;
      }
    }
  }

  // ── Food in your hand ──

  private startFood(L: Live, food: Food) {
    if (L.eat !== null) this.dropFood(L);
    const mesh = foodMesh(food);
    if (this.game.gfx.toon) toonify(mesh);
    this.game.gfx.scene.add(mesh);
    L.eat = { food, t: 0, mesh };
  }

  private updateFood(L: Live, dt: number) {
    const e = L.eat!;
    e.t += dt;
    const me = this.game.me;
    const dur = EAT_S;
    const k = Math.min(1, e.t / dur);
    // Three bites: up to the mouth, chew, back down
    const cyc = (e.t / dur) * 3;
    const bite = Math.max(0, Math.sin(Math.min(1, cyc % 1) * Math.PI));
    if (me !== null) {
      poseEat(me, bite);
      const hp = handPos(me, this._w);
      if (hp !== null) e.mesh.position.copy(hp);
      else e.mesh.position.copy(me.root.position).add(new THREE.Vector3(0, 1.1, 0));
      e.mesh.quaternion.copy(me.root.quaternion);
      e.mesh.scale.setScalar(Math.max(0.35, 1 - k * 0.65));
      if (bite > 0.95 && Math.random() < dt * 8)
        this.game.particles.dustAt(e.mesh.position, 0.12, new THREE.Color(e.food.color));
    }
    if (e.t > dur + 0.4) this.dropFood(L);
  }

  private dropFood(L: Live) {
    const e = L.eat;
    if (e === null) return;
    e.mesh.removeFromParent();
    inkExcluded.delete(e.mesh);
    e.mesh.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    disposeMaterials(e.mesh);
    L.eat = null;
  }

  // ── UI actions ──

  act(u: UiAction) {
    const L = this.live;
    switch (u.a) {
      case 'enter':
        this.requestEnter();
        return;
      case 'leave':
        this.requestLeave();
        return;
      case 'close':
        this.shopOpen = false;
        this.giftTo = null;
        if (L !== null) L.reading = null;
        return;
      case 'spot':
        if (L !== null && this.phase === 'inside' && !this.poolActive()) L.spot?.run();
        return;
      case 'gift':
        if (L !== null && this.giftTo !== null) void this.gift(L, this.giftTo, u.coin);
        this.giftTo = null;
        return;
      case 'buy':
        if (L !== null) void this.buy(L, u.id);
        return;
      case 'menu': {
        if (L === null || this.phase !== 'inside') return;
        const a = this.actionsNow(L)[u.index];
        if (a === undefined) return;
        if (a.a === 'wake') this.wakeGo(L, a.to);
        else this.doAction(L, a);
        return;
      }
    }
  }

  private doAction(L: Live, a: Action) {
    const g = this.game;
    switch (a.a) {
      case 'accept':
        this.visitStep({ t: 'accept' });
        break;
      case 'refuse':
        this.visitStep({ t: 'refuse' });
        break;
      case 'thank':
        this.visitStep({ t: 'thank' });
        break;
      case 'sit': {
        const seat = L.floors[L.level]!.layout.seats[a.seat];
        if (seat === undefined) break;
        const me = this.toRoom(g.player.pos, new THREE.Vector3());
        L.sit = { seat: a.seat, level: L.level, anchor: me.clone(), k: 0 };
        this.visitStep({ t: 'sit', seat: a.seat });
        break;
      }
      case 'stand':
        this.getUp(L);
        break;
      case 'chat':
        this.visitStep({ t: 'chat', to: a.to });
        break;
      case 'gift':
        this.giftTo = a.to;
        this.shopOpen = false;
        break;
      case 'buy':
        this.shopOpen = true;
        this.giftTo = null;
        break;
      case 'steal': {
        const it = L.layout.items[a.item];
        if (it === undefined) break;
        const watchful = Math.max(0, ...L.folk.map(f => f.def.watchful));
        const caught = L.rnd() < caughtChance(this.ctx.watched, watchful * 0.5);
        L.taken.add(a.item);
        const coin = stealValue(it.type);
        this.visitStep({ t: 'steal', coin, caught });
        if (!caught) {
          this.notice(`🤫 POCKETED: ${stealName(it.type)}`);
          g.sfx.play('chips', { gain: 0.3 });
        } else g.sfx.play('ui-cancel', { gain: 0.8 });
        break;
      }
      case 'leave':
        this.requestLeave();
        break;
    }
  }

  private shopRows(L: Live): ShopRow[] {
    const tier = L.visit.tier;
    if (L.kind === 'shop') {
      const t = this.trade;
      return GOOD_IDS.map(gid => ({
        id: `good:${gid}`,
        name: GOODS[gid].name,
        icon: GOOD_ICON[gid],
        price: t?.quote(L.town, gid)?.ask ?? null,
        how: 'van' as const,
      }));
    }
    return menuOf(L.kind).map((m: MenuItem) => ({
      id: `menu:${m.id}`,
      name: m.name,
      icon: m.icon,
      price: discounted(m.price, tier),
      how: m.use === 'eat' ? ('eat' as const) : ('service' as const),
    }));
  }

  private async buy(L: Live, id: string) {
    const t = this.trade;
    if (t === null || this.busy) return;
    this.busy = true;
    try {
      const before = t.state?.coin ?? null;
      if (id.startsWith('good:')) {
        const good = id.slice(5) as GoodId;
        const r = await t.act({ t: 'buy', town: L.town, good, qty: 1 });
        if (this.live !== L) return;
        if (!r.ok) return this.notice(`✋ ${(r.reason ?? 'refused').toUpperCase()}`);
        const paid =
          before !== null ? Math.max(1, before - r.state.coin) : (t.quote(L.town, good)?.ask ?? 1);
        this.visitStep({ t: 'bought', coin: paid });
        this.notice(`${GOOD_ICON[good]} ${GOODS[good].name.toUpperCase()} → IN THE VAN · −${paid}`);
        return;
      }
      const item = menuOf(L.kind).find(m => `menu:${m.id}` === id);
      if (item === undefined) return;
      const price = discounted(item.price, L.visit.tier);
      const a: TradeAction = {
        t: 'spend',
        town: L.town,
        to: L.door.id,
        coin: price,
        what: item.use === 'eat' ? 'meal' : 'service',
      };
      const r = await t.act(a);
      if (this.live !== L) return;
      if (!r.ok) return this.notice(`✋ ${(r.reason ?? 'refused').toUpperCase()}`);
      this.visitStep({ t: 'bought', coin: price });
      this.notice(`${item.icon} ${item.name.toUpperCase()} · −${price} COIN`);
      if (item.food !== undefined) this.startFood(L, item.food);
      this.shopOpen = false;
    } finally {
      this.busy = false;
    }
  }

  private async gift(L: Live, to: string, coin: number) {
    const t = this.trade;
    if (t === null || this.busy) return;
    this.busy = true;
    try {
      const r = await t.act({ t: 'spend', town: L.town, to, coin, what: 'gift' });
      if (this.live !== L) return;
      if (!r.ok) return this.notice(`✋ ${(r.reason ?? 'refused').toUpperCase()}`);
      this.visitStep({ t: 'gift', to, coin });
      this.game.sfx.play('coins', { gain: 0.7 });
      const f = L.folk.find(q => q.def.id === to);
      this.notice(`🎁 ${coin} COIN → ${(f?.def.name ?? '').toUpperCase()}`);
    } finally {
      this.busy = false;
    }
  }

  private notice(text: string) {
    this.note = { text, at: performance.now() };
  }

  private toast(text: string, tag: string) {
    const g = this.game;
    g.hud = { ...g.hud, toast: { text, tag, at: performance.now() } };
  }

  // ── The view for React ──

  private publish() {
    const L = this.live;
    const coin = this.trade?.state?.coin ?? null;
    const note = this.note !== null && performance.now() - this.note.at < 2600 ? this.note : null;
    if (L === null) {
      const d = this.near;
      this.setView({
        prompt:
          d !== null && this.phase === 'outside' && this.pending === null
            ? {
                text: `ENTER ${(d.name ?? KIND_LABEL[d.kind ?? 'home'].label).toUpperCase()}`,
                kind: 'enter',
                sub: `${KIND_LABEL[d.kind ?? 'home'].icon} ${KIND_LABEL[d.kind ?? 'home'].label}`,
              }
            : null,
        inside: null,
        actions: [],
        wake: null,
        shop: null,
        gift: null,
        coin,
        note,
        eating: null,
        exhibit: null,
      });
      return;
    }
    const me = this.toRoom(this.game.player.pos, this._w);
    const atDoor = L.level === 0 && me.z < 1.3 && Math.abs(me.x - L.layout.door.x) < 1.1;
    const k = KIND_LABEL[L.kind];
    const pool = this.poolActive();
    const actions = this.phase === 'inside' && !pool ? this.actionsNow(L) : [];
    const spot = this.phase === 'inside' && !pool && !atDoor ? L.spot : null;
    const r = L.reading;
    const giftF = this.giftTo !== null ? L.folk.find(f => f.def.id === this.giftTo) : undefined;
    const floorLabel =
      L.level > 0 && L.floors[L.level]!.layout.use !== undefined
        ? ` · ${USE_LABEL[L.floors[L.level]!.layout.use!].toUpperCase()}`
        : '';
    this.setView({
      prompt:
        atDoor && this.phase === 'inside' && !pool
          ? { text: 'LEAVE', kind: 'leave' }
          : spot !== null
            ? {
                text: spot.text,
                kind: 'spot',
                ...(spot.sub !== undefined ? { sub: spot.sub } : {}),
              }
            : null,
      inside: {
        name: `${L.door.name ?? k.label}${floorLabel}`,
        kind: L.kind,
        icon: k.icon,
        label: L.level > 0 ? `FLOOR ${L.level + 1}` : k.label,
      },
      actions,
      wake:
        L.wake && this.phase === 'inside' && this.hop === null && !pool
          ? {
              text: `☀️ YOU CRASHED AT ${(L.door.name ?? 'A MATE’S').toUpperCase()}`,
              sub: L.roof !== null ? 'Roof, or downstairs?' : 'Head downstairs?',
            }
          : null,
      shop: this.shopOpen
        ? { title: L.kind === 'shop' ? 'BUY · INTO THE VAN' : 'MENU', rows: this.shopRows(L) }
        : null,
      gift:
        giftF !== undefined
          ? { to: giftF.def.id, name: giftF.def.name, amounts: [1, 5, 25] }
          : null,
      coin,
      note,
      eating: L.eat !== null ? { name: L.eat.food.name, icon: L.eat.food.icon } : null,
      exhibit:
        r !== null && !pool
          ? {
              id: r.id,
              title: r.title,
              label: label(r),
              color: labelColor(label(r)),
              ask: askText(r),
              votes: `${r.forVotes} for · ${r.againstVotes} against`,
              href: `/vote/${r.id}`,
            }
          : null,
    });
  }

  // ── Bubbles ──

  private _v = new THREE.Vector3();

  private renderBubble(L: Live, f: Folk) {
    const b = f.bubble;
    const s = f.say;
    if (s === null || f.ch === null) {
      if (b.style.display !== 'none') b.style.display = 'none';
      return;
    }
    const cam = this.game.gfx.camera;
    const v = this._v.set(
      L.origin.x + f.pos.x,
      L.origin.y + (f.state === 'sit' ? 2.0 : 2.45),
      L.origin.z + f.pos.z,
    );
    if (f.state === 'sit' && f.seat !== null) {
      const st = L.layout.seats[f.seat]!;
      v.x = L.origin.x + st.x;
      v.z = L.origin.z + st.z;
    }
    v.project(cam);
    if (v.z >= 1 || v.z <= -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) {
      b.style.display = 'none';
      return;
    }
    const canvas = this.game.gfx.renderer.domElement;
    const x = ((v.x + 1) / 2) * canvas.clientWidth;
    const y = ((1 - v.y) / 2) * canvas.clientHeight;
    b.style.display = 'block';
    b.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
    const key = `${s.text}|${s.icon ?? ''}|${s.tone}`;
    if (key !== f.bubbleKey) {
      f.bubbleKey = key;
      const icon = s.icon !== undefined ? `<b>${s.icon}</b>` : '';
      const text = s.text !== '' ? `<span>${escapeHtml(s.text)}</span>` : '';
      b.innerHTML = `<div class="ni-b ni-${s.tone}">${icon}${text}</div><i>${escapeHtml(f.def.name)}</i>`;
    }
  }

  // ── DOM ──

  private injectDom() {
    const host = this.game.labelLayerEl;
    injectCss();
    const layer = document.createElement('div');
    layer.className = 'ni-layer';
    host.appendChild(layer);
    this.layer = layer;
    const ov = document.createElement('div');
    ov.className = 'ni-fade';
    ov.style.display = 'none';
    host.appendChild(ov);
    this.overlay = ov;
  }

  private onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el !== null && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable))
      return;
    if (this.game.paused) return;
    const inside = this.live !== null;
    // The pool game has the keys while you play
    if (inside && this.poolActive()) return;
    if (e.code === 'KeyE') {
      if (!inside && this.near !== null && this.phase === 'outside') {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.requestEnter();
      } else if (inside) {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (this.view.prompt?.kind === 'leave') this.requestLeave();
        else if (this.view.prompt?.kind === 'spot') this.act({ a: 'spot' });
      }
      return;
    }
    if (!inside) return;
    // No board in here
    if (e.code === 'KeyF') {
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    if (
      e.code === 'Escape' &&
      (this.shopOpen || this.giftTo !== null || this.live?.reading != null)
    ) {
      e.stopImmediatePropagation();
      this.shopOpen = false;
      this.giftTo = null;
      if (this.live !== null) this.live.reading = null;
      return;
    }
    // 1–9: the menu, the gift amounts or the shop rows
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m !== null) {
      const i = Number(m[1]) - 1;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (this.giftTo !== null) {
        const amt = [1, 5, 25][i];
        if (amt !== undefined) this.act({ a: 'gift', coin: amt });
      } else if (this.shopOpen) {
        const row = this.view.shop?.rows[i];
        if (row !== undefined) this.act({ a: 'buy', id: row.id });
      } else this.act({ a: 'menu', index: i });
    }
  };

  // ── Upstairs ──

  /** Which floor you're on (by height), the floors shown, the next one built. */
  private updateFloors(L: Live, dt: number) {
    void dt;
    if (L.floors.length < 2) return;
    const g = this.game;
    const y = g.player.pos.y - L.origin.y;
    const level = Math.max(0, Math.min(L.floors.length - 1, Math.floor(y / L.storey + 0.5)));
    if (level !== L.level) {
      L.level = level;
      L.reading = null;
      if (L.sit !== null) this.getUp(L);
      L.wake = false;
      // Woken upstairs: the host says hello once you come down
      if (level === 0 && L.greet !== null) {
        const hi = L.greet;
        L.greet = null;
        this.applyEffects(hi);
      }
    }
    L.floors.forEach((f, i) => {
      if (f.built !== null) f.built.group.visible = i === L.level;
      for (const u of f.folk) if (u.ch !== null) u.ch.root.visible = i === L.level;
    });
    // Build the floor above / below (one per frame, once you've settled in)
    if (L.t < 0.4) return;
    for (const k of [L.level + 1, L.level - 1])
      if (k > 0 && k < L.floors.length && L.floors[k]!.built === null) {
        this.buildFloor(L, k);
        return;
      }
  }

  private buildFloor(L: Live, k: number) {
    const g = this.game;
    const f = L.floors[k]!;
    const base = k * L.storey;
    const atlas = buildArtAtlas(f.layout, {
      area: L.door.area,
      time: timeOf(g.hud.timeOfDay),
      tier: this.tier(),
    });
    const built = buildInterior(f.layout, atlas, { shadows: g.gfx.quality !== 'low' });
    if (g.gfx.toon) toonify(built.group);
    built.group.position.set(L.origin.x, L.origin.y + base, L.origin.z);
    built.group.visible = k === L.level;
    g.gfx.scene.add(built.group);
    f.built = built;
    f.windows = new WindowViews({ ...L.door, y: L.door.y + base }, f.layout);
    built.group.add(f.windows.group);
    built.group.updateMatrixWorld(true);
    f.windows.renderAll(this.renderOutside);
    // Built as you near the stairs: issue its programs now, before you see it
    g.gfx.asDrawn(() => g.gfx.renderer.compile(built.group, g.gfx.camera, g.gfx.scene));
    f.spots = this.hotspots(L, f.layout, base);
    // Someone up here now and then
    const defs = residentsFor(`${L.door.id}:up${k}`, f.layout, this.tier());
    const def = defs.find(d => d.role !== 'owner');
    if (def !== undefined && hash32(`${L.door.id}:upfolk:${k}`) % 3 !== 0) {
      const spot = f.layout.spots[def.home] ?? { x: 0, z: f.layout.d / 2, yaw: 0 };
      prefetchGlbHead(def.seed[3], def.seed[4]);
      f.folk.push({ def, ch: null, x: spot.x, z: spot.z, yaw: spot.yaw });
    }
    this.updateCollision(L);
  }

  /** Every built floor's collision, stacked, as the one dynamic piece. */
  private updateCollision(L: Live) {
    const parts: THREE.BufferGeometry[] = [];
    L.floors.forEach((f, i) => {
      if (f.built === null) return;
      // The BVH adds an index to a geometry it's built on, so the ground floor
      // (already in the world) comes back indexed and the new floor doesn't:
      // mergeGeometries refuses that mix and returned null, the upstairs had
      // no collision at all and you fell back down the stairwell
      const src = f.built.collision;
      const c = src.index !== null ? src.toNonIndexed() : src.clone();
      c.translate(0, i * L.storey, 0);
      parts.push(c);
    });
    const merged = mergeGeometries(parts, false);
    for (const c of parts) c.dispose();
    if (merged === null) {
      console.warn("[interiors] could not merge the floors' collision");
      return;
    }
    this.game.world.setDynamic('interior', merged, L.origin);
    L.collision?.dispose();
    L.collision = merged;
  }

  /** Upstairs residents: built lazily, standing, turning to you when you're close. */
  private stepUpFolk(L: Live, f: Floor, dt: number, me: THREE.Vector3) {
    if (f.level === 0) return;
    const base = f.level * L.storey;
    for (const u of f.folk) {
      if (u.ch === null) {
        u.ch = this.makeCharacter(u.def);
        return;
      }
      if (Math.hypot(me.x - u.x, me.z - u.z) < 3.5)
        u.yaw = turnTo(u.yaw, Math.atan2(me.x - u.x, me.z - u.z), dt * 5);
      const o = L.origin;
      u.ch.root.position.set(o.x + u.x, o.y + base, o.z + u.z);
      u.ch.root.quaternion.setFromAxisAngle(Y, u.yaw);
      u.ch.play({ clip: 'idle', fade: 0.25 });
      u.ch.update(dt, { lean: 0, travelled: 0, riding: false, grounded: true });
    }
  }

  private disposeFloor(f: Floor) {
    for (const u of f.folk) {
      if (u.ch === null) continue;
      u.ch.dispose();
      disposeMaterials(u.ch.body, true);
      u.ch.root.traverse(o => (o as THREE.SkinnedMesh).skeleton?.dispose());
    }
    f.folk.length = 0;
    f.windows?.dispose();
    if (f.built !== null) {
      f.built.dispose();
      disposeMaterials(f.built.group);
    }
    f.built = null;
  }

  /**
   * The building's real rooftop: straight down onto it from above, at the
   * middle of its footprint (or a little off it if the middle is open).
   */
  private findRoof(door: BuildingDoor, l: Layout): Pose | null {
    const fp = door.footprint;
    const [ix, iz] = [Math.sin(door.yaw + Math.PI), Math.cos(door.yaw + Math.PI)];
    const cx = fp !== undefined ? (fp.minX + fp.maxX) / 2 : door.x + ix * (l.d / 2);
    const cz = fp !== undefined ? (fp.minZ + fp.maxZ) / 2 : door.z + iz * (l.d / 2);
    const tries: [number, number][] = [
      [cx, cz],
      [(cx + door.x) / 2, (cz + door.z) / 2],
      [cx + 1.5, cz],
      [cx - 1.5, cz],
      [cx, cz + 1.5],
      [cx, cz - 1.5],
    ];
    for (const [x, z] of tries) {
      const hit = this.game.world.raycast(
        this._w.set(x, door.y + 250, z),
        new THREE.Vector3(0, -1, 0),
        300,
      );
      if (hit !== null && hit.normal.y > 0.7 && hit.point.y > door.y + 2.5)
        return { x, y: hit.point.y, z, yaw: door.yaw };
    }
    return null;
  }

  /** Doors on the rooftops you've been out on: back in, at the top of the stairs. */
  private roofDoors = new Map<string, BuildingDoor>();

  private addRoofDoor(d: BuildingDoor, at: Pose) {
    const id = `${d.id}#roof`;
    // (towns reload their doors when you come back: look in the area, not the map)
    const a = this.areas.get(d.area);
    if (a === undefined || a.doors.some(q => q.id === id)) return;
    // A little back from where you came out, facing the way you face
    const roof: BuildingDoor = {
      id,
      area: d.area,
      x: at.x - Math.sin(at.yaw) * 1.2,
      y: at.y,
      z: at.z - Math.cos(at.yaw) * 1.2,
      yaw: at.yaw,
      width: 1.0,
      ...(d.kind !== undefined ? { kind: d.kind } : {}),
      name: `Roof · ${d.name ?? KIND_LABEL[d.kind ?? 'home'].label}`,
    };
    this.roofDoors.set(id, d);
    a.doors.push(roof);
    if (a.markers !== null) {
      a.markers.dispose();
      a.markers = null;
    }
    a.markers = buildDoorMarkers(a.doors, o => {
      if (this.game.gfx.toon) toonify(o);
    });
    this.game.gfx.scene.add(a.markers.group);
  }

  /** Re-render the window views while inside (off: the entry snapshot only). */
  windowRefresh = true;

  /** Is the pool game running (game.pool, when it exists)? */
  private poolActive(): boolean {
    return (this.game as unknown as { pool?: PoolApi }).pool?.active === true;
  }

  /** The room's hotspots: exhibits (the Prop Museum), pool tables, the roof ladder. */
  private hotspots(L: Live, l: Layout = L.layout, base = 0): Hotspot[] {
    const out: Hotspot[] = [];
    // The way out onto the real roof (top floor)
    for (const it of l.items) {
      if (it.type !== 'roof_ladder') continue;
      out.push({
        x: it.x,
        z: it.z,
        reach: 1.5,
        text: L.roof !== null ? 'UP TO THE ROOF' : 'ROOF HATCH',
        sub: '🪜',
        run: () => {
          if (L.roof === null) {
            this.notice('🪜 The hatch is bolted shut.');
            return;
          }
          L.exit = L.roof;
          this.requestLeave();
        },
      });
    }
    // Pool tables: E to play (game.pool, when it's there)
    for (const it of l.items) {
      if (it.type !== 'pool_table') continue;
      const r = (it.rot * Math.PI) / 2;
      out.push({
        x: it.x,
        z: it.z,
        reach: Math.max(it.w, it.d) / 2 + 0.9,
        text: 'PLAY POOL',
        sub: '🎱',
        run: () => {
          const pool = (this.game as unknown as { pool?: PoolApi }).pool;
          if (pool === undefined) {
            this.notice('🎱 The cues are out being chalked. Come back soon!');
            return;
          }
          const long = Math.max(it.w, it.d);
          const short = Math.min(it.w, it.d);
          pool.playAt({
            x: L.origin.x + it.x,
            y: L.origin.y + base + POOL_FELT_Y,
            z: L.origin.z + it.z,
            // Long axis: the item's local x when it's wider than deep
            yaw: it.w >= it.d ? r + Math.PI / 2 : r,
            length: long - 0.2,
            width: short - 0.2,
          });
        },
      });
    }
    const m = L.museum;
    if (m === null || l !== L.layout) return out;
    // Placards on the walls, in order; plinths in the middle
    let k = 0;
    for (const d of l.decor) {
      if (d.type !== 'placard' || m.walls.length === 0) continue;
      const e = m.walls[k++ % m.walls.length]!;
      const [x, z] =
        d.wall === 'n'
          ? [d.at, l.d - 0.9]
          : d.wall === 's'
            ? [d.at, 0.9]
            : d.wall === 'e'
              ? [l.w / 2 - 0.9, d.at]
              : [-l.w / 2 + 0.9, d.at];
      out.push(this.readSpot(L, e, x, z));
    }
    l.items
      .filter(it => it.type === 'plinth')
      .forEach((it, i) => {
        const e = m.plinths[i % m.plinths.length];
        if (e !== undefined)
          out.push(this.readSpot(L, e, it.x, it.z, Math.max(it.w, it.d) / 2 + 0.8));
      });
    return out;
  }

  private readSpot(L: Live, e: Exhibit, x: number, z: number, reach = 1.0): Hotspot {
    return {
      x,
      z,
      reach,
      text: `READ PROP ${e.id}`,
      sub: '📜',
      run: () => {
        L.reading = e;
      },
    };
  }

  /** Dev / browser checks: walk straight in through a door (by id, or the nearest). */
  debugEnter(id?: string) {
    const d = id !== undefined ? (this.doors().find(q => q.id === id) ?? null) : this.near;
    if (d === null) return false;
    this.requestEnter(d);
    return true;
  }

  /** Dev / browser checks: the live room. */
  get debug() {
    const L = this.live;
    if (L === null) return null;
    return {
      layout: L.layout,
      origin: L.origin,
      visit: L.visit,
      folk: L.folk.map(f => ({
        id: f.def.id,
        name: f.def.name,
        pos: f.pos,
        state: f.state,
        role: f.def.role,
      })),
      ctx: this.ctx,
      stats: L.built.stats,
      windows: {
        count: L.windows.views.length,
        renders: L.floors.reduce((n, f) => n + (f.windows?.renders ?? 0), 0),
        lastMs: L.floors[L.level]!.windows?.lastMs ?? 0,
      },
      level: L.level,
      storey: L.storey,
      roof: L.roof,
      spot: L.spot?.text ?? null,
      floors: L.floors.map(f => ({
        level: f.level,
        use: f.layout.use ?? null,
        built: f.built !== null,
        stairs: f.layout.stairs ?? null,
        items: f.layout.items.map(it => ({ type: it.type, x: it.x, z: it.z, w: it.w, d: it.d })),
        decor: f.layout.decor.map(d => ({ type: d.type, wall: d.wall, at: d.at, y: d.y })),
      })),
    };
  }

  dispose() {
    this.disposed = true;
    document.removeEventListener('keydown', this.onKey, true);
    if (this.live !== null) {
      for (const f of this.live.folk) this.disposeFolk(f);
      this.game.world.setDynamic('interior', null);
      this.live.built.dispose();
      this.live = null;
    }
    for (const id of [...this.areas.keys()]) this.dropArea(id);
    this.layer?.remove();
    this.overlay?.remove();
  }
}

// ── Helpers ──

function townOf(area: string): TownId {
  if (area === 'plaza') return 'city';
  if (area === 'jersey') return 'jersey';
  const t = area.startsWith('town:') ? area.slice(5) : area;
  return (GROWN_TOWNS as string[]).includes(t) ? (t as GrownTown) : 'city';
}

function timeOf(t: string): TimeOfDay {
  return t === 'golden' || t === 'blue' || t === 'night' ? t : 'afternoon';
}

function turnTo(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}

const STEAL: Partial<Record<string, [string, number]>> = {
  shelf: ['something off the shelf', 8],
  gondola: ['a snack', 5],
  pastry_case: ['a pastry', 4],
  record_crate: ['a record', 10],
  record_shelf: ['a rare record', 18],
  plinth: ['a tiny sculpture', 30],
  bookshelf: ['a book', 6],
  drinks_fridge: ['a drink', 3],
  kitchen: ['a cookie', 2],
  side_table: ['a trinket', 4],
};

function stealName(type: string): string {
  return (STEAL[type]?.[0] ?? 'something').toUpperCase();
}

function stealValue(type: string): number {
  return STEAL[type]?.[1] ?? 3;
}

/** A little model of the food (in your hand). */
function foodMesh(food: Food): THREE.Object3D {
  const g = new THREE.Group();
  const mat = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
  const add = (geo: THREE.BufferGeometry, c: number) => g.add(new THREE.Mesh(geo, mat(c)));
  switch (food.look) {
    case 'cup':
      add(cyl(0.06, 0.05, 0.12, 10), 0xf4f1ea);
      add(cyl(0.052, 0.052, 0.01, 10, 0, 0.11), food.color);
      break;
    case 'can':
      add(cyl(0.04, 0.04, 0.13, 10), food.color);
      break;
    case 'bowl':
      add(sphere(0.09, 0, 0.05, 0, 10, 6).scale(1, 0.55, 1), 0xf4f1ea);
      add(cyl(0.08, 0.08, 0.01, 10, 0, 0.07), food.color);
      break;
    case 'cone':
      add(cyl(0.05, 0.005, 0.14, 8, 0, -0.1), 0xd9a23f);
      add(sphere(0.055, 0, 0.06, 0, 8, 6), food.color);
      break;
    case 'bar':
      add(box(0.12, 0.03, 0.05), food.color);
      break;
    case 'slice':
      add(box(0.13, 0.025, 0.11), food.color);
      break;
    default:
      add(cyl(0.11, 0.1, 0.015, 12), 0xf4f1ea);
      add(sphere(0.06, 0, 0.04, 0, 8, 5).scale(1, 0.6, 1), food.color);
  }
  for (const c of g.children) c.castShadow = false;
  inkExcluded.add(g);
  return g;
}

function escapeHtml(s: string) {
  return s.replace(
    /["&'<>]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'noun-interiors-css';
  s.textContent = `
.ni-layer{position:absolute;inset:0;pointer-events:none;font-family:system-ui,sans-serif;overflow:hidden}
.ni-bubble{position:absolute;left:0;top:0;text-align:center;white-space:nowrap;pointer-events:none}
.ni-bubble i{display:block;font-style:normal;font-size:10px;font-weight:700;color:#fff;text-shadow:0 1px 2px #000;margin-top:3px}
.ni-b{position:relative;display:inline-flex;align-items:center;gap:6px;max-width:min(320px,70vw);white-space:normal;background:#fff;color:#111;border:2px solid #111;border-radius:12px;padding:4px 10px;box-shadow:3px 3px 0 #d22209;font-weight:800;font-size:14px;line-height:1.2}
.ni-b:after{content:"";position:absolute;left:50%;bottom:-9px;margin-left:-6px;border:6px solid transparent;border-top-color:#111}
.ni-b b{font-size:24px;line-height:1}
.ni-angry{box-shadow:3px 3px 0 #111;background:#ffe2dc}
.ni-sad{box-shadow:3px 3px 0 #555}
.ni-plain{box-shadow:3px 3px 0 #888}
.ni-fade{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;z-index:40}
`;
  document.head.appendChild(s);
}
