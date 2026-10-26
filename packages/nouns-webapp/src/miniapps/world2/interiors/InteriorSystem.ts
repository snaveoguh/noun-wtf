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

import { seedVoice } from '../audio/voice/cast';
import { NounCharacter } from '../character/NounCharacter';
import { inkExcluded, toonify } from '../render/Toon';
import { GROWN_TOWNS, placementOf, townFrame, type GrownTown } from '../towns/site';
import { GOODS, GOOD_ICON, GOOD_IDS } from '../trade/goods';
import { inCorridor } from '../world/mountain/Alleys';
import { NJ, njFrame, njToWorld } from '../world/mountain/nounJersey';

import { buildArtAtlas, type TimeOfDay } from './art';
import { buildInterior, type BuiltInterior } from './build';
import { discounted, menuOf, type Food, type MenuItem } from './dialogue';
import { BANNED, SHUT } from './dialogue';
import { buildDoorMarkers, type DoorMarkers } from './doorMarkers';
import { doorReach } from './doors';
import { box, cyl, disposeMaterials, sphere } from './kit';
import {
  entryPoint,
  generateLayout,
  itemBox,
  layoutGrid,
  stealables,
  type Grid,
  type Layout,
} from './layout';
import { KIND_LABEL } from './names';
import { plazaDoors } from './plazaDoors';
import { handPos, poseEat, poseSit } from './pose';
import { residentsFor, type ResidentDef } from './residents';
import { hash32, mulberry32, pick, type Rng } from './rng';
import { njDoors, townDoors } from './townDoors';
import {
  EAT_S,
  answersDoor,
  arrive,
  caughtChance,
  menu,
  step,
  type Action,
  type Effect,
  type Visit,
  type VisitEvent,
} from './visit';

/** Pocket height: the interiors float this high over their door (nothing up there). */
export const POCKET_Y = 4000;
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
  /** The door prompt outside / the way out inside. */
  prompt: { text: string; kind: 'enter' | 'leave'; sub?: string } | null;
  inside: { name: string; kind: InteriorKind; icon: string; label: string } | null;
  actions: Action[];
  /** The buy panel (goods for a shop, the menu elsewhere). */
  shop: { title: string; rows: ShopRow[] } | null;
  gift: { to: string; name: string; amounts: number[] } | null;
  coin: number | null;
  note: { text: string; at: number } | null;
  eating: { name: string; icon: string } | null;
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
  sit: { seat: number; anchor: THREE.Vector3; k: number } | null;
  eat: { food: Food; t: number; mesh: THREE.Object3D } | null;
  t: number;
  /** Leave after this many seconds (shown / thrown out). */
  outIn: number | null;
  outWhy: 'kicked' | 'caught' | null;
  town: TownId;
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
  private view: InteriorsView = {
    prompt: null,
    inside: null,
    actions: [],
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
          this.goIn(door);
        } else if (this.phase === 'out') this.goOut();
        this.fadeT = 0;
      }
    } else if (this.fadeT < 0) {
      // Fading back in (fadeT runs −FADE_S → 0)
      this.fadeT = Math.min(0, this.fadeT + dt);
      this.setFade(-this.fadeT / FADE_S);
    }
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

  // ── Going in ──

  private goIn(door: BuildingDoor) {
    const g = this.game;
    const t0 = performance.now();
    const kind = door.kind ?? 'home';
    const fp = door.footprint;
    // Frontage along the door wall, depth into the building
    const along = Math.abs(Math.sin(door.yaw)) > 0.7;
    const frontage = fp === undefined ? undefined : along ? fp.maxZ - fp.minZ : fp.maxX - fp.minX;
    const depth = fp === undefined ? undefined : along ? fp.maxX - fp.minX : fp.maxZ - fp.minZ;
    const layout = generateLayout({ id: door.id, kind, frontage, depth, height: fp?.height });
    const tLayout = performance.now();
    const tier = this.tier();
    const atlas = buildArtAtlas(layout, { area: door.area, time: timeOf(g.hud.timeOfDay), tier });
    const tAtlas = performance.now();
    const built = buildInterior(layout, atlas, { shadows: g.gfx.quality !== 'low' });
    const tBuild = performance.now();
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
    gfx.scene.fog = null;
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
    const entry = new THREE.Vector3(origin.x + ex, floorY + 0.05, origin.z + ez);
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

    // Residents
    const rnd = mulberry32(hash32(`${door.id}:${Date.now()}`));
    const defs = residentsFor(door.id, layout, tier);
    const tFolk0 = performance.now();
    const folk: Folk[] = defs.map(def => this.makeFolk(def, layout));
    const tFolk = performance.now();
    const { visit, effects } = arrive(door.id, kind, tier, defs, rnd);
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
    };
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
    g.gfx.renderer.compile(g.gfx.scene, g.gfx.camera);
  }

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
    const L = this.live;
    if (L === null) return;
    const g = this.game;
    // Tell the visit (walking out on food, an unthanked meal)
    this.visitStep({ t: 'leave' });
    for (const f of L.folk) this.disposeFolk(f);
    if (L.eat !== null) this.dropFood(L);
    g.world.setDynamic('interior', null);
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
    // Back outside the door, facing the street, on foot
    const d = L.door;
    const nx = Math.sin(d.yaw);
    const nz = Math.cos(d.yaw);
    p.spawn(new THREE.Vector3(d.x + nx * 1.1, d.y + 0.3, d.z + nz * 1.1), d.yaw);
    p.mode = 'foot';
    g.cam.snap(p);
    g.cam.pitch = this.savedPitch;
    g.stats.suspended = false;
    for (const r of g.remotes.values()) r.character.root.visible = true;
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

  private disposeFolk(f: Folk) {
    f.bubble.remove();
    if (f.ch === null) return;
    f.ch.dispose();
    disposeMaterials(f.ch.body, true);
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
    // The others are in the world outside
    for (const r of g.remotes.values()) {
      r.character.root.visible = false;
      if (r.label) r.label.style.display = 'none';
      if (r.pointer) r.pointer.style.display = 'none';
    }
    const me = this.toRoom(p.pos, this._rp);

    // Sitting: the rider is drawn on the seat; walking off stands you up
    if (L.sit !== null) {
      const seat = L.layout.seats[L.sit.seat]!;
      if (Math.hypot(me.x - L.sit.anchor.x, me.z - L.sit.anchor.z) > 0.35) {
        L.sit = null;
        this.visitStep({ t: 'stand' });
      } else {
        L.sit.k = Math.min(1, L.sit.k + dt * 4);
        if (g.me !== null) {
          const r = g.me.root;
          r.position.set(
            L.origin.x + seat.x - Math.sin(seat.yaw) * 0.08,
            L.origin.y,
            L.origin.z + seat.z - Math.cos(seat.yaw) * 0.08,
          );
          r.quaternion.setFromAxisAngle(Y, seat.yaw);
          g.me.play({ clip: 'idle', fade: 0.3 });
          poseSit(g.me, L.origin.y, L.origin.y + seat.h, L.sit.k);
        }
        p.vel.set(0, 0, 0);
      }
    }
    // Eating: food in the hand, bites
    if (L.eat !== null) this.updateFood(L, dt);

    this.dollhouse(L, dt);
    // Residents: one character built per frame
    const unbuilt = L.folk.find(f => f.ch === null);
    if (unbuilt !== undefined) unbuilt.ch = this.makeCharacter(unbuilt.def);
    let near: Folk | null = null;
    let nearD = NEAR_FOLK;
    let watched = false;
    for (const f of L.folk) {
      this.stepFolk(L, f, dt, me);
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
      stealable: this.nearStealable(L, me),
      watched,
      canBuy: this.canBuy(L, me),
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
    const tx = p.x;
    const ty = p.y + 1.25;
    const tz = p.z;
    const m = 0.45;
    let x = tx - Math.sin(yaw) * CAM_BACK;
    let z = tz - Math.cos(yaw) * CAM_BACK;
    x = Math.min(o.x + lay.w / 2 - m, Math.max(o.x - lay.w / 2 + m, x));
    z = Math.min(o.z + lay.d - m, Math.max(o.z + m, z));
    const y = o.y + Math.max(lay.h + 0.35, 3.6);
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

  private nearSeat(L: Live, me: THREE.Vector3): number | null {
    let best: number | null = null;
    let bd = NEAR_SEAT;
    L.layout.seats.forEach((s, i) => {
      if (L.folk.some(f => f.seat === i || f.goal?.seat === i)) return;
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
        return;
      case 'gift':
        if (L !== null && this.giftTo !== null) void this.gift(L, this.giftTo, u.coin);
        this.giftTo = null;
        return;
      case 'buy':
        if (L !== null) void this.buy(L, u.id);
        return;
      case 'menu': {
        if (L === null) return;
        const a = menu(L.visit, this.ctx)[u.index];
        if (a !== undefined) this.doAction(L, a);
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
        const seat = L.layout.seats[a.seat];
        if (seat === undefined) break;
        const me = this.toRoom(g.player.pos, new THREE.Vector3());
        L.sit = { seat: a.seat, anchor: me.clone(), k: 0 };
        this.visitStep({ t: 'sit', seat: a.seat });
        break;
      }
      case 'stand':
        L.sit = null;
        this.visitStep({ t: 'stand' });
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
        shop: null,
        gift: null,
        coin,
        note,
        eating: null,
      });
      return;
    }
    const me = this.toRoom(this.game.player.pos, this._w);
    const atDoor = me.z < 1.6 && Math.abs(me.x - L.layout.door.x) < 1.2;
    const k = KIND_LABEL[L.kind];
    const actions = this.phase === 'inside' ? menu(L.visit, this.ctx) : [];
    const giftF = this.giftTo !== null ? L.folk.find(f => f.def.id === this.giftTo) : undefined;
    this.setView({
      prompt: atDoor && this.phase === 'inside' ? { text: 'LEAVE', kind: 'leave' } : null,
      inside: { name: L.door.name ?? k.label, kind: L.kind, icon: k.icon, label: k.label },
      actions,
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
    if (e.code === 'KeyE') {
      if (!inside && this.near !== null && this.phase === 'outside') {
        e.stopPropagation();
        e.preventDefault();
        this.requestEnter();
      } else if (inside) {
        e.stopPropagation();
        e.preventDefault();
        if (this.view.prompt?.kind === 'leave') this.requestLeave();
      }
      return;
    }
    if (!inside) return;
    // No board in here
    if (e.code === 'KeyF') {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (e.code === 'Escape' && (this.shopOpen || this.giftTo !== null)) {
      e.stopPropagation();
      this.shopOpen = false;
      this.giftTo = null;
      return;
    }
    // 1–9: the menu, the gift amounts or the shop rows
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m !== null) {
      const i = Number(m[1]) - 1;
      e.stopPropagation();
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
