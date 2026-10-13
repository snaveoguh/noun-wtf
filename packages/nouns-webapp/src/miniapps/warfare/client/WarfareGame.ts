// ── Noun Warfare client: sim + renderer + input + audio + HUD store ────
//
// Owns one canvas for its whole life. In the lobby it flies a camera over
// the selected map; a match builds a WarfareSim and steps it at a fixed
// 60 Hz from a frame accumulator, rendering interpolated between ticks.
// Everything the HUD shows is published as a plain snapshot (useSyncExternalStore).
//
// Phase 2 note: the only things that touch the sim are `stepSim` (local
// input in, events out) and `onEvents`. A networked client would swap
// `stepSim` for "send input, apply host snapshot + events", keeping the
// rendering / HUD code as is.

import type { MapVisual } from './MapVisual';
import type { LevelData } from '@/miniapps/world2/world/Level';

import * as THREE from 'three';

import {
  loadCharacterAssets,
  type CharacterAssets,
} from '@/miniapps/world2/character/NounCharacter';
import { CollisionWorld } from '@/miniapps/world2/physics/Collision';
import { Graphics, type Quality } from '@/miniapps/world2/render/Graphics';
import { toonify } from '@/miniapps/world2/render/Toon';

import { MAPS } from '../sim/maps';
import { MODES } from '../sim/modes';
import { eyeHeight, headY, viewDir } from '../sim/physics';
import { matchRep, type RepBreakdown } from '../sim/progression';
import { WarfareSim, isEnemy } from '../sim/sim';
import {
  BODY,
  DT,
  TEAM_COLORS,
  TEAM_NAMES,
  emptyInput,
  type Difficulty,
  type MapId,
  type MatchPhase,
  type ModeId,
  type PlayerInput,
  type PlayerState,
  type SimEvent,
  type TeamSize,
} from '../sim/types';
import { GRENADE, WEAPONS, sourceLabel, type WeaponId } from '../sim/weapons';
import { newHit } from '../sim/world';

import { Avatar } from './Avatars';
import { buildBlaster, buildGrenade, type Blaster } from './Blasters';
import { Effects } from './Effects';
import { FpsInput } from './FpsInput';
import { buildMapVisual } from './MapVisual';
import { Splats } from './Splats';
import { WarfareAudio } from './WarfareAudio';
import { ZoneVisual } from './ZoneVisual';

export type GamePhase = 'loading' | 'lobby' | 'play' | 'results';

export interface FeedItem {
  id: number;
  killer: string;
  kc: string;
  victim: string;
  vc: string;
  weapon: string;
  head: boolean;
  mine: boolean;
  t: number;
}

export interface ScoreRow {
  id: number;
  name: string;
  team: number;
  color: string;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  me: boolean;
  bot: boolean;
  alive: boolean;
}

export interface HudState {
  phase: GamePhase;
  loading: string;
  matchPhase: MatchPhase;
  mode: ModeId;
  map: MapId;
  countdown: number;
  timeLeft: number;
  scores: [number, number];
  target: number;
  round: number;
  myTeam: number;
  ffaLead: { name: string; kills: number; color: string } | null;
  myKills: number;
  hp: number;
  alive: boolean;
  protectedFor: number;
  weapon: WeaponId;
  weapons: WeaponId[];
  mag: number;
  magSize: number;
  reload: number;
  grenades: number;
  respawnIn: number;
  killer: { name: string; color: string; weapon: string } | null;
  scoped: boolean;
  zoom: number;
  spread: number;
  hit: { t: number; head: boolean; kill: boolean };
  dmgDirs: { id: number; angle: number; t: number }[];
  screenPaint: { id: number; color: string; x: number; y: number; r: number; t: number }[];
  feed: FeedItem[];
  callouts: { id: number; text: string; tier: number; t: number }[];
  banner: { id: number; text: string; sub: string; color: string; t: number } | null;
  zones: { id: string; owner: number; progress: number; contested: boolean }[];
  rows: ScoreRow[];
  showBoard: boolean;
  tp: boolean;
  paused: boolean;
  touch: boolean;
  fps: number;
  results: {
    winner: string;
    won: boolean;
    draw: boolean;
    rep: RepBreakdown;
  } | null;
  now: number;
}

export interface StartOpts {
  mode: ModeId;
  map: MapId;
  teamSize: TeamSize;
  difficulty: Difficulty;
  name: string;
  look: string;
  weapons: WeaponId[];
  seed?: number;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export function pickQuality(): Quality {
  const q = new URLSearchParams(window.location.search).get('q');
  if (q === 'low' || q === 'medium' || q === 'high') return q;
  const ipad = /macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches === true;
  if (/android|iphone|ipad|ipod/i.test(navigator.userAgent) || ipad || coarse) return 'low';
  return (navigator.hardwareConcurrency ?? 4) >= 8 ? 'high' : 'medium';
}

export function isTouchDevice(): boolean {
  return (
    window.matchMedia?.('(pointer: coarse)').matches === true ||
    (navigator.maxTouchPoints > 1 && window.innerWidth < 1100)
  );
}

const _hit = newHit();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class WarfareGame {
  readonly gfx: Graphics;
  readonly input: FpsInput;
  readonly audio = new WarfareAudio();
  sim: WarfareSim | null = null;
  me = 0;
  mapId: MapId = 'nouncity';
  private canvas: HTMLCanvasElement;
  private labels: HTMLElement;
  private assets: CharacterAssets | null = null;
  private mapVis: MapVisual | null = null;
  private camWorld = new CollisionWorld();
  private avatars: Avatar[] = [];
  private splats: Splats;
  private effects: Effects;
  private zoneVis: ZoneVisual[] = [];
  private matchRoot = new THREE.Group();
  private vmRoot = new THREE.Group();
  private vm: Blaster | null = null;
  private vmWeapon: WeaponId | null = null;
  private vmCache = new Map<WeaponId, Blaster>();
  private vmGrenade: THREE.Group;
  private raf = 0;
  private last = performance.now();
  private acc = 0;
  private t = 0;
  private listeners = new Set<() => void>();
  private hudAcc = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private nextId = 1;
  /** Last input fed to the sim (debug handle reads it). */
  lastInput: PlayerInput = emptyInput();
  private punch = 0;
  private vmKick = 0;
  private vmReloadT = -1;
  private vmReloadDur = 1;
  private vmSwapT = 1;
  private vmThrowT = 1;
  private landDip = 0;
  private shake = 0;
  private eyeH: number = BODY.eye;
  private tp = false;
  private strideMark = new Map<number, number>();
  private lastCountdownSec = -1;
  private resultsAt = 0;
  private labelTick = 0;
  private visibleTo = new Set<number>();
  private splatSounds = 0;
  private quality: Quality;
  /** Desk mode in NounOS: freeze everything. */
  paused = false;
  /** Pointer lock lost mid-match (desktop): sim waits. */
  menuPaused = false;
  /** Player hit pause (touch menu button / Esc). */
  userPaused = false;
  /** Debug: play without pointer lock (headless browsers can't lock). */
  debugNoLock = false;
  /** Debug: the rAF loop renders but never steps the sim. */
  manual = false;
  hud: HudState;
  touch: boolean;
  /** Sensitivity multiplier (lobby setting). */
  sensitivity = 1;
  onResults:
    | ((r: NonNullable<HudState['results']>, p: PlayerState, finished: boolean) => void)
    | null = null;

  constructor(opts: { canvas: HTMLCanvasElement; labelLayer: HTMLElement; quality?: Quality }) {
    this.canvas = opts.canvas;
    this.labels = opts.labelLayer;
    this.quality = opts.quality ?? pickQuality();
    this.gfx = new Graphics(opts.canvas, this.quality);
    this.gfx.camera.fov = 78;
    this.gfx.camera.near = 0.04;
    this.gfx.camera.far = 1200;
    this.gfx.camera.updateProjectionMatrix();
    this.input = new FpsInput(opts.canvas);
    this.touch = isTouchDevice();
    if (this.touch) this.input.mode = 'touch';
    this.splats = new Splats(this.quality === 'low' ? 240 : 720);
    this.effects = new Effects(this.quality === 'low');
    if (this.gfx.toon) toonify(this.splats.group);
    this.gfx.scene.add(this.matchRoot);
    this.matchRoot.add(this.splats.group, this.effects.group);
    // Viewmodel rides the camera
    this.gfx.scene.add(this.gfx.camera);
    this.gfx.camera.add(this.vmRoot);
    this.vmGrenade = buildGrenade(0xffffff);
    this.vmGrenade.visible = false;
    this.vmRoot.add(this.vmGrenade);
    const vmLight = new THREE.PointLight(0xffffff, 1.2, 2.5, 2);
    vmLight.position.set(0.2, 0.3, 0.2);
    this.gfx.camera.add(vmLight);
    this.hud = this.blankHud();
  }

  private blankHud(): HudState {
    return {
      phase: 'loading',
      loading: 'warming up the paint',
      matchPhase: 'countdown',
      mode: 'tdm',
      map: this.mapId,
      countdown: 0,
      timeLeft: 0,
      scores: [0, 0],
      target: 0,
      round: 1,
      myTeam: 0,
      ffaLead: null,
      myKills: 0,
      hp: 100,
      alive: true,
      protectedFor: 0,
      weapon: 'hopper',
      weapons: ['splatter', 'hopper'],
      mag: 0,
      magSize: 0,
      reload: 0,
      grenades: GRENADE.perLife,
      respawnIn: 0,
      killer: null,
      scoped: false,
      zoom: 1,
      spread: 10,
      hit: { t: -10, head: false, kill: false },
      dmgDirs: [],
      screenPaint: [],
      feed: [],
      callouts: [],
      banner: null,
      zones: [],
      rows: [],
      showBoard: false,
      tp: false,
      paused: false,
      touch: this.touch,
      fps: 0,
      results: null,
      now: 0,
    };
  }

  // ── Store ─────────────────────────────────────────────────────────────

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit() {
    this.hud = { ...this.hud, now: this.t };
    for (const l of this.listeners) l();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async start() {
    this.setMap(this.mapId);
    this.raf = requestAnimationFrame(this.frame);
    this.assets = await loadCharacterAssets();
    this.hud.phase = 'lobby';
    this.emit();
  }

  get ready() {
    return this.assets !== null;
  }

  resize(w: number, h: number) {
    this.gfx.resize(w, h);
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (p) this.input.releaseLock();
    this.input.enabled = !p;
  }

  unlockAudio() {
    this.audio.start();
  }

  setMap(id: MapId) {
    if (this.mapVis !== null && this.mapId === id) return;
    if (this.mapVis !== null) {
      this.gfx.scene.remove(this.mapVis.root);
      this.mapVis.dispose();
    }
    this.mapId = id;
    const map = MAPS[id];
    const vis = buildMapVisual(map, this.quality, this.gfx.toon);
    this.mapVis = vis;
    this.gfx.scene.add(vis.root);
    this.camWorld.build(vis.collisionMeshes);
    const night = vis.night;
    const level = {
      root: vis.root,
      collisionMeshes: vis.collisionMeshes,
      rails: [],
      spawns: [],
      landmarks: [],
      bounds: new THREE.Box3(),
      baked: false,
      sun: night
        ? {
            direction: new THREE.Vector3(0.4, -0.8, 0.35),
            color: new THREE.Color(0x9fb4ff),
            intensity: 2.4,
          }
        : {
            direction: new THREE.Vector3(-0.5, -0.62, 0.42),
            color: new THREE.Color(0xffe2c0),
            intensity: 3.4,
          },
      sky: night
        ? { zenith: new THREE.Color(0x141a3c), horizon: new THREE.Color(0x3a2a58) }
        : { zenith: new THREE.Color(0x5d8fd6), horizon: new THREE.Color(0xf2c7a0) },
      fog: night
        ? { color: new THREE.Color(0x1a1838), density: 0.0105 }
        : { color: new THREE.Color(0xc9b8a8), density: 0.006 },
    } as unknown as LevelData;
    this.gfx.applyLevel(level);
    this.gfx.sky.visible = !night;
    this.gfx.scene.background = night ? new THREE.Color(0x0d1030) : null;
    if (night) {
      this.gfx.hemi.color.set(0x8f9dff);
      this.gfx.hemi.groundColor.set(0x2a1f3a);
      this.gfx.hemi.intensity = 0.85;
    } else {
      this.gfx.hemi.intensity = 0.7;
    }
    this.hud.map = id;
    this.emit();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.endMatch(false);
    this.input.dispose();
    this.audio.dispose();
    this.mapVis?.dispose();
    this.splats.dispose();
    this.effects.dispose();
    this.camWorld.dispose();
    this.gfx.dispose();
  }

  // ── Match ─────────────────────────────────────────────────────────────

  startMatch(o: StartOpts) {
    if (this.assets === null) return;
    this.endMatch(false);
    this.setMap(o.map);
    const seed = o.seed ?? (Math.floor(Math.random() * 0x7fffffff) ^ Date.now()) >>> 0;
    const sim = new WarfareSim({
      mode: o.mode,
      map: o.map,
      teamSize: o.teamSize,
      difficulty: o.difficulty,
      seed,
      humans: [{ name: o.name, look: o.look, weapons: o.weapons }],
    });
    this.sim = sim;
    this.me = 0;
    const me = sim.state.players[0];
    this.input.yaw = me.yaw;
    this.input.pitch = 0;
    this.input.owned = [...me.weapons];
    this.input.desired = me.weapon;
    this.splats.clear();
    this.effects.clear();
    const teams = MODES[o.mode].teams;
    for (const p of sim.state.players) {
      const a = new Avatar(
        p,
        this.assets,
        this.labels,
        this.gfx.toon,
        teams && p.team === me.team && p.id !== me.id,
      );
      this.avatars.push(a);
      this.matchRoot.add(a.root);
    }
    for (const z of sim.state.zones) {
      const zv = new ZoneVisual(z);
      this.zoneVis.push(zv);
      this.matchRoot.add(zv.group);
    }
    this.acc = 0;
    this.lastCountdownSec = -1;
    this.resultsAt = 0;
    this.tp = false;
    this.hud = {
      ...this.blankHud(),
      phase: 'play',
      mode: o.mode,
      map: o.map,
      target: sim.state.match.target,
      myTeam: me.team,
      weapons: [...me.weapons],
    };
    this.effects.tick(sim.state.projectiles);
    for (const a of this.avatars) a.tick(sim.state.players[a.id]);
    this.emit();
  }

  /** Tear down the current match (abandon = no "finished" rep). */
  endMatch(reportAbandon: boolean) {
    const sim = this.sim;
    if (sim !== null && reportAbandon && this.hud.results === null) {
      const me = sim.state.players[this.me];
      const rep = matchRep(me, sim.cfg.mode, false, false, false);
      this.onResults?.({ winner: '', won: false, draw: false, rep }, me, false);
    }
    for (const a of this.avatars) {
      this.matchRoot.remove(a.root);
      a.dispose();
    }
    this.avatars = [];
    for (const z of this.zoneVis) {
      this.matchRoot.remove(z.group);
      z.dispose();
    }
    this.zoneVis = [];
    this.sim = null;
    this.input.releaseLock();
    this.menuPaused = false;
    this.userPaused = false;
    this.splats.clear();
    this.effects.clear();
    if (this.vm !== null) this.vmRoot.remove(this.vm.group);
    this.vm = null;
    this.vmWeapon = null;
    this.vmCache.clear();
  }

  toLobby() {
    this.endMatch(this.hud.phase === 'play');
    this.hud = { ...this.blankHud(), phase: 'lobby' };
    this.emit();
  }

  /** Advance the sim one fixed tick with the local input. */
  stepSim(inp: PlayerInput) {
    const sim = this.sim;
    if (sim === null) return [];
    const events = sim.step({ [this.me]: inp });
    this.effects.tick(sim.state.projectiles);
    for (const a of this.avatars) a.tick(sim.state.players[a.id]);
    this.onEvents(events);
    return events;
  }

  /** Debug / tests: step N ticks with an input (defaults to current local input). */
  stepTicks(n: number, inp?: Partial<PlayerInput>) {
    for (let i = 0; i < n; i++) {
      const base = this.input.sample(0);
      const merged = { ...base, ...inp };
      if (inp?.yaw !== undefined) this.input.yaw = inp.yaw;
      if (inp?.pitch !== undefined) this.input.pitch = inp.pitch;
      this.lastInput = merged;
      this.stepSim(merged);
      this.t += DT;
    }
    this.publish();
  }

  // ── Events → visuals / audio / HUD ────────────────────────────────────

  private onEvents(events: SimEvent[]) {
    const sim = this.sim!;
    const me = sim.state.players[this.me];
    const ps = sim.state.players;
    for (const e of events) {
      switch (e.type) {
        case 'fire': {
          if (e.pid === this.me) {
            const w = WEAPONS[e.weapon];
            this.audio.fire(e.weapon, null);
            this.vmKick = Math.min(1.5, this.vmKick + 0.6 + w.kick * 6);
            this.punch += w.kick;
            // Real aim climb (part of the kick stays)
            this.input.pitch += w.kick * (w.auto ? 0.28 : 0.45);
            // Paint leaves the visible muzzle, then converges on the true path
            if (this.vm !== null && !this.tp) {
              this.vmRoot.updateMatrixWorld(true);
              _v.copy(this.vm.muzzle).applyMatrix4(this.vm.group.matrixWorld);
              for (const pr of sim.state.projectiles) {
                if (pr.owner === this.me && pr.born >= sim.time - 1e-6) {
                  this.effects.setMuzzle(pr.id, _v.x - e.x, _v.y - e.y, _v.z - e.z);
                }
              }
              this.effects.burst(_v.x, _v.y, _v.z, e.dx, e.dy, e.dz, me.color, 3, 2);
            }
          } else {
            const p = ps[e.pid];
            this.audio.fire(e.weapon, [p.x, p.y + 1.4, p.z]);
          }
          break;
        }
        case 'splat': {
          if (e.on >= 0) {
            const victim = ps[e.on];
            this.avatars[e.on]?.addPaint(victim, e.x, e.y, e.z, e.color);
            this.effects.burst(e.x, e.y, e.z, e.nx, e.ny, e.nz, e.color, 7, 3.5);
          } else {
            this.splats.add(e.x, e.y, e.z, e.nx, e.ny, e.nz, e.color, e.size);
            this.effects.burst(e.x, e.y, e.z, e.nx, e.ny, e.nz, e.color, 4, 2.5);
            if (this.splatSounds < 4) {
              this.splatSounds++;
              this.audio.splat([e.x, e.y, e.z]);
            }
          }
          break;
        }
        case 'hit': {
          if (e.attacker === this.me && e.victim !== this.me) {
            this.hud.hit = { t: this.t, head: e.head, kill: false };
            this.audio.hitMarker(e.head);
          }
          if (e.victim === this.me) {
            this.audio.hurt();
            const a = ps[e.attacker];
            if (a !== undefined && e.attacker !== this.me) {
              const yawTo = Math.atan2(-(a.x - me.x), -(a.z - me.z));
              let rel = yawTo - this.input.yaw;
              while (rel > Math.PI) rel -= Math.PI * 2;
              while (rel < -Math.PI) rel += Math.PI * 2;
              this.hud.dmgDirs = [
                ...this.hud.dmgDirs.filter(d => this.t - d.t < 1.2),
                { id: this.nextId++, angle: -rel, t: this.t },
              ].slice(-4);
              // Screen paint on the side it came from
              const side = Math.sin(-rel);
              this.hud.screenPaint = [
                ...this.hud.screenPaint.filter(s => this.t - s.t < 2.5),
                {
                  id: this.nextId++,
                  color: hex(a.color),
                  x: 50 + side * 28 + (Math.random() - 0.5) * 30,
                  y: 35 + Math.random() * 35,
                  r: 9 + Math.min(14, e.dmg * 0.25) + Math.random() * 6,
                  t: this.t,
                },
              ].slice(-6);
            }
            this.shake = Math.min(1, this.shake + e.dmg / 60);
          }
          break;
        }
        case 'kill': {
          const k = ps[e.attacker];
          const v = ps[e.victim];
          const self = e.attacker === e.victim;
          this.hud.feed = [
            ...this.hud.feed.filter(f => this.t - f.t < 7),
            {
              id: this.nextId++,
              killer: self ? '' : k.name,
              kc: hex(k.color),
              victim: v.name,
              vc: hex(v.color),
              weapon: self
                ? e.source === 'fall'
                  ? 'fell off'
                  : 'self-splat'
                : sourceLabel(e.source),
              head: e.head,
              mine: e.attacker === this.me || e.victim === this.me,
              t: this.t,
            },
          ].slice(-5);
          // Pop: burst + big puddle where they stood
          const killerColor = self ? v.color : k.color;
          this.effects.burst(v.x, v.y + 1.1, v.z, 0, 1, 0, killerColor, 26, 6);
          this.effects.burst(v.x, v.y + 1.1, v.z, 0, 1, 0, v.color, 10, 4);
          if (sim.world.segment(v.x, v.y + 0.5, v.z, v.x, v.y - 3, v.z, _hit))
            this.splats.add(_hit.x, _hit.y, _hit.z, _hit.nx, _hit.ny, _hit.nz, killerColor, 2.2);
          this.audio.splat([v.x, v.y + 1, v.z], true);
          if (e.attacker === this.me && !self) {
            this.hud.hit = { t: this.t, head: e.head, kill: true };
            this.audio.killConfirm();
          }
          if (e.victim === this.me) {
            this.hud.killer = self
              ? null
              : { name: k.name, color: hex(k.color), weapon: sourceLabel(e.source) };
            this.input.releaseLock();
            this.menuPaused = false;
          }
          break;
        }
        case 'callout':
          if (e.pid === this.me) {
            this.hud.callouts = [
              ...this.hud.callouts.filter(c => this.t - c.t < 2.2),
              { id: this.nextId++, text: e.text, tier: e.tier, t: this.t },
            ].slice(-3);
            this.audio.callout(e.tier);
          }
          break;
        case 'spawn': {
          this.avatars[e.pid]?.clearPaint();
          if (e.pid === this.me) {
            const p = ps[e.pid];
            this.input.yaw = p.yaw;
            this.input.pitch = 0;
            this.hud.killer = null;
            this.hud.screenPaint = [];
          }
          break;
        }
        case 'reload':
          if (e.pid === this.me) {
            this.vmReloadT = 0;
            this.vmReloadDur = WEAPONS[e.weapon].reload;
            this.audio.reload(null);
          }
          break;
        case 'swap':
          if (e.pid === this.me) {
            this.vmSwapT = 0;
            this.audio.swap();
          }
          break;
        case 'land':
          if (e.pid === this.me) {
            this.landDip = Math.min(0.12, e.speed * 0.01);
            this.audio.land();
          }
          break;
        case 'throw':
          if (e.pid === this.me) this.vmThrowT = 0;
          break;
        case 'bounce':
          this.audio.bounce([e.x, e.y, e.z]);
          break;
        case 'explode': {
          this.effects.blast(e.x, e.y, e.z, e.color, e.radius);
          this.splats.add(e.x, e.y, e.z, e.nx, e.ny, e.nz, e.color, e.radius * 0.75);
          // Throw paint around: rays out from the blast
          const ox = e.x + e.nx * 0.25;
          const oy = e.y + e.ny * 0.25 + 0.1;
          const oz = e.z + e.nz * 0.25;
          const rays = this.quality === 'low' ? 8 : 16;
          for (let i = 0; i < rays; i++) {
            const a = Math.random() * Math.PI * 2;
            const el = -0.6 + Math.random() * 1.2;
            const r = e.radius * (0.6 + Math.random() * 0.5);
            const dx = Math.cos(a) * Math.cos(el) * r;
            const dy = Math.sin(el) * r;
            const dz = Math.sin(a) * Math.cos(el) * r;
            if (sim.world.segment(ox, oy, oz, ox + dx, oy + dy, oz + dz, _hit))
              this.splats.add(
                _hit.x,
                _hit.y,
                _hit.z,
                _hit.nx,
                _hit.ny,
                _hit.nz,
                e.color,
                0.5 + Math.random() * 0.7,
              );
          }
          this.audio.blast([e.x, e.y, e.z]);
          const d = Math.hypot(e.x - me.x, e.y - me.y, e.z - me.z);
          if (d < 14) this.shake = Math.min(1, this.shake + (14 - d) / 14);
          break;
        }
        case 'zone': {
          const mine = e.owner === me.team;
          const lost = e.prev === me.team;
          if (e.owner !== -1 || lost) {
            this.hud.banner = {
              id: this.nextId++,
              text:
                e.owner === -1
                  ? `ZONE ${e.zone} NEUTRAL`
                  : `ZONE ${e.zone} ${mine ? 'CAPTURED' : 'LOST'}`,
              sub: e.owner === -1 ? 'paint it back' : TEAM_NAMES[e.owner as 0 | 1],
              color: e.owner === -1 ? '#ffffff' : hex(TEAM_COLORS[e.owner as 0 | 1]),
              t: this.t,
            };
            this.audio.zone(mine);
          }
          break;
        }
        case 'round': {
          const won = e.winner === me.team;
          this.hud.banner = {
            id: this.nextId++,
            text:
              e.winner === -1
                ? `ROUND ${e.round} DRAW`
                : `${TEAM_NAMES[e.winner as 0 | 1]} TAKE ROUND ${e.round}`,
            sub: `${sim.state.match.scores[0]} — ${sim.state.match.scores[1]}`,
            color: e.winner === -1 ? '#ffffff' : hex(TEAM_COLORS[e.winner as 0 | 1]),
            t: this.t,
          };
          this.audio.zone(won);
          this.hud.showBoard = true;
          break;
        }
        case 'phase':
          if (e.phase === 'live') {
            this.audio.countdown(true);
            this.hud.showBoard = false;
          }
          break;
        case 'match': {
          this.resultsAt = this.t + 2.6;
          this.input.releaseLock();
          this.hud.showBoard = true;
          break;
        }
        default:
          break;
      }
    }
  }

  private finishMatch() {
    const sim = this.sim;
    if (sim === null) return;
    const m = sim.state.match;
    const me = sim.state.players[this.me];
    const w = m.winner ?? -1;
    let winner = 'DRAW';
    let won = false;
    const draw = w === -1;
    if (w >= 100) {
      const p = sim.state.players[w - 100];
      winner = `${p.name} WINS`;
      won = p.id === this.me;
    } else if (w === 0 || w === 1) {
      winner = `${TEAM_NAMES[w]} WIN`;
      won = me.team === w;
    }
    const rep = matchRep(me, m.mode, won, draw, true);
    this.hud.results = { winner, won, draw, rep };
    this.hud.phase = 'results';
    this.onResults?.(this.hud.results, me, true);
    this.emit();
  }

  // ── Frame loop ────────────────────────────────────────────────────────

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.paused) return;
    this.t += dt;
    this.splatSounds = 0;
    this.fpsAcc += dt;
    this.fpsFrames++;
    const sim = this.sim;
    if (sim !== null && this.hud.phase === 'play') {
      this.input.lookScale = this.lookScale() * this.sensitivity;
      this.input.assist = this.aimAssist();
      const inp = this.input.sample(dt);
      if (this.input.viewTogglePressed) {
        this.input.viewTogglePressed = false;
        this.tp = !this.tp;
      }
      this.lastInput = inp;
      const wasLocked = this.input.locked;
      // Desktop: losing pointer lock mid-match pauses (Esc menu)
      this.menuPaused =
        this.userPaused ||
        (!this.touch &&
          !this.debugNoLock &&
          this.input.mode !== 'gamepad' &&
          !wasLocked &&
          sim.state.players[this.me].alive &&
          sim.phase !== 'matchEnd');
      if (!this.manual && !this.menuPaused) {
        this.acc += dt;
        let n = 0;
        while (this.acc >= DT && n < 6) {
          this.stepSim(inp);
          this.acc -= DT;
          n++;
        }
        if (n === 6) this.acc = 0;
      }
      if (this.resultsAt > 0 && this.t >= this.resultsAt) {
        this.resultsAt = 0;
        this.finishMatch();
      }
    }
    this.render(dt);
    this.hudAcc += dt;
    if (this.hudAcc >= 1 / 20) {
      this.hudAcc = 0;
      this.publish();
    }
  };

  private lookScale() {
    const sim = this.sim;
    if (sim === null) return 1;
    const p = sim.state.players[this.me];
    if (!p.scoped) return 1;
    return 1 / (WEAPONS[p.weapon].zoom ?? 1.3);
  }

  /** Slow the look a little when the crosshair sits on an enemy (touch / pad). */
  private aimAssist(): number {
    const sim = this.sim;
    if (sim === null || (this.input.mode === 'keyboard' && !this.touch)) return 0;
    const me = sim.state.players[this.me];
    if (!me.alive) return 0;
    const [fx, fy, fz] = viewDir(this.input.yaw, this.input.pitch);
    const ex = me.x;
    const ey = me.y + eyeHeight(me);
    const ez = me.z;
    let best = 0;
    for (const o of sim.state.players) {
      if (!o.alive || !isEnemy(me, o)) continue;
      const dx = o.x - ex;
      const dy = headY(o) - 0.3 - ey;
      const dz = o.z - ez;
      const d = Math.hypot(dx, dy, dz);
      if (d > 45) continue;
      const cos = (dx * fx + dy * fy + dz * fz) / d;
      const ang = Math.acos(Math.min(1, cos));
      const lim = Math.atan2(0.9, d) + 0.02;
      if (ang < lim) best = Math.max(best, 1 - ang / lim);
    }
    return best;
  }

  // ── Render ────────────────────────────────────────────────────────────

  private render(dt: number) {
    const cam = this.gfx.camera;
    const sim = this.sim;
    this.mapVis?.update(this.t);
    if (sim === null) {
      // Lobby flyover
      const map = MAPS[this.mapId];
      const r = Math.max(map.half[0], map.half[1]) * 0.95;
      const a = this.t * 0.06;
      cam.position.set(Math.cos(a) * r, 13 + Math.sin(this.t * 0.2) * 2, Math.sin(a) * r * 0.8);
      cam.lookAt(0, 1.5, 0);
      cam.fov = 70;
      cam.updateProjectionMatrix();
      this.vmRoot.visible = false;
      this.gfx.followShadow(_v.set(0, 0, 0));
      this.gfx.render(dt);
      return;
    }
    const alpha = this.manual ? 1 : Math.min(1, this.acc / DT);
    const me = sim.state.players[this.me];
    const meAv = this.avatars[this.me];
    // Eye
    const targetEye = eyeHeight(me);
    this.eyeH += (targetEye - this.eyeH) * Math.min(1, dt * 14);
    this.landDip *= Math.exp(-dt * 8);
    this.punch *= Math.exp(-dt * 12);
    this.shake *= Math.exp(-dt * 5);
    _v.lerpVectors(meAv.prev, meAv.cur, alpha);
    const sp = Math.hypot(me.vx, me.vz);
    const bob =
      me.grounded && me.alive ? Math.sin(me.stride * 2.2) * 0.03 * Math.min(1, sp / 6) : 0;
    cam.position.set(_v.x, _v.y + this.eyeH - this.landDip + Math.abs(bob), _v.z);
    const shk = this.shake * 0.02;
    cam.rotation.set(
      this.input.pitch + this.punch + (Math.random() - 0.5) * shk,
      this.input.yaw + (Math.random() - 0.5) * shk,
      bob * 0.15,
      'YXZ',
    );
    // FOV
    const w = WEAPONS[me.weapon];
    let fov = 78;
    if (me.sprinting) fov += 6;
    if (me.scoped) fov = 78 / (w.zoom ?? 1.3);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 16);
    cam.updateProjectionMatrix();

    let showSelf = this.tp;
    if (!me.alive) {
      // Death cam: hover above where you dropped, watching your splatter
      const killer = me.killerId >= 0 ? sim.state.players[me.killerId] : undefined;
      const spect = this.spectateTarget(sim);
      const look = killer !== undefined && killer.alive && killer.id !== me.id ? killer : spect;
      const since = sim.time - me.diedAt;
      const k = Math.min(1, since / 0.6);
      cam.position.set(me.x, me.y + 1.5 + k * 2.2, me.z);
      if (look !== null && look !== undefined) {
        _v2.set(look.x, look.y + 1.2, look.z);
        if (!Number.isFinite(me.respawnAt) && spect !== null && since > 2.5) {
          // Elimination: follow a living teammate
          const [fx, , fz] = viewDir(spect.yaw, 0);
          cam.position.set(spect.x - fx * 3.2, spect.y + 2.6, spect.z - fz * 3.2);
          _v2.set(spect.x + fx * 4, spect.y + 1.4, spect.z + fz * 4);
        }
        cam.lookAt(_v2);
      }
      showSelf = false;
    } else if (this.tp) {
      // Third person boom with camera collision (world2 BVH)
      const [fx, fy, fz] = viewDir(this.input.yaw, this.input.pitch);
      const rx = Math.cos(this.input.yaw);
      const rz = -Math.sin(this.input.yaw);
      const eye = cam.position.clone();
      const want = eye
        .clone()
        .add(new THREE.Vector3(-fx * 3 + rx * 0.7, -fy * 3 + 0.35, -fz * 3 + rz * 0.7));
      const dir = want.clone().sub(eye);
      const len = dir.length();
      dir.normalize();
      const hit = this.camWorld.raycast(eye, dir, len);
      cam.position
        .copy(eye)
        .addScaledVector(dir, hit !== null ? Math.max(0.3, hit.distance - 0.25) : len);
    }

    // Avatars
    for (const a of this.avatars) {
      const p = sim.state.players[a.id];
      a.update(p, alpha, dt, a.id === this.me ? showSelf && p.alive : true);
    }
    this.updateLabels(sim);
    this.updateFootsteps(sim);
    for (let i = 0; i < this.zoneVis.length; i++)
      this.zoneVis[i].update(sim.state.zones[i], this.t);
    this.effects.render(sim.state.projectiles, alpha, dt);
    this.splats.flush();
    this.updateViewmodel(me, dt, sp);
    this.audio.lx = cam.position.x;
    this.audio.ly = cam.position.y;
    this.audio.lz = cam.position.z;
    this.audio.lyaw = this.input.yaw;
    this.gfx.followShadow(cam.position);
    this.gfx.render(dt);
  }

  private spectateTarget(sim: WarfareSim): PlayerState | null {
    const me = sim.state.players[this.me];
    for (const p of sim.state.players)
      if (p.alive && p.id !== me.id && (me.team === -1 ? true : p.team === me.team)) return p;
    for (const p of sim.state.players) if (p.alive) return p;
    return null;
  }

  private updateViewmodel(me: PlayerState, dt: number, speed: number) {
    const show = me.alive && !this.tp && !(me.scoped && me.weapon === 'longsplat');
    this.vmRoot.visible = show;
    if (this.vmWeapon !== me.weapon) {
      if (this.vm !== null) this.vmRoot.remove(this.vm.group);
      let b = this.vmCache.get(me.weapon);
      if (b === undefined) {
        b = buildBlaster(me.weapon, me.color, this.gfx.toon);
        b.group.traverse(o => {
          o.castShadow = false;
          o.receiveShadow = false;
        });
        this.vmCache.set(me.weapon, b);
      }
      this.vm = b;
      this.vmWeapon = me.weapon;
      this.vmRoot.add(b.group);
    }
    if (this.vm === null) return;
    this.vmKick *= Math.exp(-dt * 14);
    this.vmSwapT += dt;
    this.vmThrowT += dt;
    const g = this.vm.group;
    const ads = me.scoped;
    let x = ads ? 0 : 0.2;
    let y = ads ? -0.12 : -0.2;
    let z = ads ? -0.3 : -0.36;
    let rx = 0;
    let ry = 0;
    let rz = 0;
    // Bob
    const bobK = me.grounded ? Math.min(1, speed / 6) : 0.2;
    x += Math.cos(me.stride * 1.1) * 0.012 * bobK;
    y += Math.abs(Math.sin(me.stride * 1.1)) * 0.012 * bobK;
    // Sprint carry
    if (me.sprinting) {
      rx -= 0.35;
      ry += 0.55;
      x -= 0.05;
      y -= 0.04;
    }
    // Kick
    z += this.vmKick * 0.05;
    rx += this.vmKick * 0.12;
    // Reload: dip + roll
    if (me.reloadUntil > 0 && this.vmReloadT >= 0) {
      this.vmReloadT += dt;
      const k = Math.min(1, this.vmReloadT / this.vmReloadDur);
      const s = Math.sin(k * Math.PI);
      y -= s * 0.12;
      rz += s * 0.6;
      rx -= s * 0.25;
    } else this.vmReloadT = -1;
    // Swap: drop in
    if (this.vmSwapT < 0.3) {
      const k = 1 - this.vmSwapT / 0.3;
      y -= k * 0.25;
      rx -= k * 0.6;
    }
    // Grenade throw: gun dips, grenade arcs out
    const th = this.vmThrowT < 0.35;
    if (th) {
      const k = Math.sin((this.vmThrowT / 0.35) * Math.PI);
      y -= k * 0.15;
      rz -= k * 0.3;
    }
    this.vmGrenade.visible = th;
    if (th) {
      const k = this.vmThrowT / 0.35;
      this.vmGrenade.position.set(
        -0.15 + k * 0.1,
        -0.15 + Math.sin(k * Math.PI) * 0.15,
        -0.4 - k * 0.3,
      );
    }
    g.position.set(x, y, z);
    g.rotation.set(rx, ry, rz);
  }

  private updateLabels(sim: WarfareSim) {
    const me = sim.state.players[this.me];
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.labelTick++;
    const recheck = this.labelTick % 8 === 0;
    const cam = this.gfx.camera;
    for (const a of this.avatars) {
      if (a.id === this.me) continue;
      const p = sim.state.players[a.id];
      const mate = !isEnemy(me, p);
      if (recheck) {
        const d = Math.hypot(p.x - cam.position.x, p.z - cam.position.z);
        const vis =
          p.alive &&
          (mate ? d < 70 : d < 24) &&
          (mate ||
            sim.world.clear(cam.position.x, cam.position.y, cam.position.z, p.x, headY(p), p.z));
        if (vis) this.visibleTo.add(a.id);
        else this.visibleTo.delete(a.id);
      }
      a.placeLabel(cam, w, h, this.visibleTo.has(a.id), p);
    }
  }

  private updateFootsteps(sim: WarfareSim) {
    for (const p of sim.state.players) {
      if (!p.alive || !p.grounded) continue;
      const stepLen = p.sprinting ? 2.6 : 2.1;
      const mark = this.strideMark.get(p.id) ?? p.stride;
      if (p.stride - mark >= stepLen) {
        this.strideMark.set(p.id, p.stride);
        if (p.crouched) continue;
        if (p.id === this.me) this.audio.step(null, p.sprinting);
        else if (Math.hypot(p.x - this.audio.lx, p.z - this.audio.lz) < 26)
          this.audio.step([p.x, p.y, p.z], p.sprinting);
      } else if (p.stride < mark) this.strideMark.set(p.id, p.stride);
    }
  }

  // ── HUD snapshot ──────────────────────────────────────────────────────

  private publish() {
    if (this.fpsAcc > 0.5) {
      this.hud.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    const sim = this.sim;
    if (sim !== null && (this.hud.phase === 'play' || this.hud.phase === 'results')) {
      const st = sim.state;
      const m = st.match;
      const me = st.players[this.me];
      const w = WEAPONS[me.weapon];
      const h = this.hud;
      h.matchPhase = m.phase;
      h.countdown = m.phase === 'countdown' ? Math.max(0, m.phaseUntil - st.time) : 0;
      const sec = Math.ceil(h.countdown);
      if (m.phase === 'countdown' && sec !== this.lastCountdownSec && sec > 0) {
        this.lastCountdownSec = sec;
        this.audio.countdown(false);
      }
      h.timeLeft =
        m.phase === 'live'
          ? Math.max(0, m.timeLimit - (st.time - m.liveAt))
          : m.phase === 'countdown'
            ? m.timeLimit
            : h.timeLeft;
      h.scores = [m.scores[0], m.scores[1]];
      h.round = m.round;
      h.hp = Math.ceil(me.hp);
      h.alive = me.alive;
      h.protectedFor = Math.max(0, me.protectedUntil - st.time);
      h.weapon = me.weapon;
      h.weapons = me.weapons;
      h.mag = me.mags[me.weapon];
      h.magSize = w.mag;
      h.reload = me.reloadUntil > 0 ? 1 - (me.reloadUntil - st.time) / w.reload : 0;
      h.grenades = me.grenades;
      h.respawnIn = me.alive
        ? 0
        : Number.isFinite(me.respawnAt)
          ? Math.max(0, me.respawnAt - st.time)
          : Infinity;
      h.scoped = me.scoped;
      h.zoom = me.scoped ? (w.zoom ?? 1.3) : 1;
      h.myKills = me.stats.kills;
      // Crosshair spread in px (same cone the sim uses)
      const speedFrac = Math.min(1, Math.hypot(me.vx, me.vz) / BODY.walk);
      let cone = w.spread + w.moveSpread * speedFrac + (me.grounded ? 0 : w.airSpread) + me.bloom;
      if (me.crouched) cone *= 0.7;
      if (me.scoped) cone *= w.scopedSpread ?? 0.65;
      const fovR = (this.gfx.camera.fov * Math.PI) / 180;
      h.spread = Math.max(
        4,
        (Math.tan(cone) / Math.tan(fovR / 2)) * (this.canvas.clientHeight / 2),
      );
      h.zones = st.zones.map(z => ({
        id: z.id,
        owner: z.owner,
        progress: z.progress,
        contested: z.contested,
      }));
      if (m.mode === 'ffa') {
        let lead: PlayerState | null = null;
        for (const p of st.players) if (lead === null || p.stats.kills > lead.stats.kills) lead = p;
        h.ffaLead =
          lead !== null
            ? { name: lead.name, kills: lead.stats.kills, color: hex(lead.color) }
            : null;
      }
      h.rows = st.players
        .map(p => ({
          id: p.id,
          name: p.name,
          team: p.team,
          color: hex(p.color),
          kills: p.stats.kills,
          deaths: p.stats.deaths,
          assists: p.stats.assists,
          score: p.stats.score,
          me: p.id === this.me,
          bot: p.bot,
          alive: p.alive,
        }))
        .sort((a, b) => b.kills * 10 + b.score - (a.kills * 10 + a.score) || a.deaths - b.deaths);
      h.tp = this.tp;
      h.paused = this.menuPaused;
      h.feed = h.feed.filter(f => this.t - f.t < 7);
      h.callouts = h.callouts.filter(c => this.t - c.t < 2.4);
      h.dmgDirs = h.dmgDirs.filter(d => this.t - d.t < 1.2);
      h.screenPaint = h.screenPaint.filter(s => this.t - s.t < 2.6);
      if (h.banner !== null && this.t - h.banner.t > 3.2) h.banner = null;
    }
    this.emit();
  }

  /** Hold-to-show scoreboard (Tab). */
  setBoard(v: boolean) {
    if (this.sim !== null && this.sim.phase !== 'matchEnd' && this.sim.phase !== 'roundEnd')
      this.hud.showBoard = v;
    this.emit();
  }

  pause() {
    this.userPaused = true;
    this.input.releaseLock();
  }

  resume() {
    this.userPaused = false;
    this.unlockAudio();
    if (!this.touch) this.input.requestLock();
  }

  toggleView() {
    this.tp = !this.tp;
  }
}

export function teamHex(team: number): string {
  return team === 0 || team === 1 ? hex(TEAM_COLORS[team]) : '#ffffff';
}
