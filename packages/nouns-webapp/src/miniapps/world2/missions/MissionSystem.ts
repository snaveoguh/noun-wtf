// ── Missions in the game: characters, sensing, timers, sync ──────────────
//
// Owns the mission characters (npcs.ts), watches the game each frame and
// turns what happened into progress signals (progress.ts), runs the
// interactive bits (the Twins' race, the courier's parcel, the Keymaker's
// door into the Upside Down), keeps the rider's progress in localStorage
// and rides along with the stats posts to the server (net/Stats.ts:
// `extras` out, `onYou` back).
//
// Anti-cheat: record missions (speed, hang time) complete only from the
// records the server returns as accepted (`you.best`), never from what this
// client measured; the server re-checks every mission it's sent anyway.

import type { SceneId } from '../cutscene/scenes';
import type { Game } from '../Game';

import * as THREE from 'three';

import { CourtXform } from '../hoops/net/court';
import { riderId } from '../net/Stats';
import { MOUNTAIN, edgeDistance } from '../world/mountain/config';
import { bowlCentre, bowlFrame, inBowl } from '../world/mountain/noggleBowl';
import { njFrame, njInCore, njToWorld } from '../world/mountain/nounJersey';
import { terrainHeight, terrainInDomain } from '../world/mountain/terrain';

import { NPCS, NPC_IDS, type MissionDef, type NpcId } from './defs';
import {
  doorProp,
  keymakerProps,
  oracleProps,
  parcelProps,
  StandingNpc,
  TALK_R,
  twinsProps,
  type NpcHost,
} from './npcs';
import { Peak } from './peak';
import {
  activeMissions,
  apply,
  emptyState,
  mergeServer,
  postable,
  sanitizeState,
  unlockedFor,
  type MissionState,
  type Signal,
} from './progress';
import { DROP_LOCKED_MSG, doorUnlocked, STORE_PREFIX } from './unlocks';

const _down = new THREE.Vector3(0, -1, 0);
const _o = new THREE.Vector3();

/** Something you can walk up to and press E on. */
export type Talkable = NpcId | 'door';

export interface MissionToast {
  at: number;
  title: string;
  reward?: string;
  kind: 'done' | 'info' | 'fail';
}

interface Race {
  id: string;
  m: number;
  /** Countdown (s) before the off; then time since the off. */
  count: number;
  t: number;
  /** The Twins' distance along their line and speed. */
  s: number;
  v: number;
  v0: number;
  grow: number;
  respawns: number;
  over: null | { won: boolean; at: number };
}

/** Fixed spots (world x, z, facing yaw); the first clear one wins. */
type Spot = [number, number, number];

const PLAZA_SPOTS: Partial<Record<NpcId, Spot[]>> = {
  // By the noggles fountain, across from the Fountain spawn
  oracle: [
    [-8.5, 8.5, 2.35],
    [8.5, 8.5, -2.35],
    [-10, -8, 0.9],
    [10, -8, -0.9],
    [-6, 18, Math.PI],
  ],
  // Ledge Garden
  writer: [
    [-25, 29, 2.4],
    [-26, 24, 2],
    [-22, 38, 2.6],
  ],
  // The DOWNHILL alley mouth (+Z), beside the opening
  courier: [
    [5.6, 66, Math.PI],
    [-6, 66, Math.PI],
    [5, 58, Math.PI],
  ],
  // The GO DOWN alley mouth (−X), the Noggle Bowl's line
  keymaker: [
    [-66, 19.5, Math.PI / 2],
    [-66, 28.5, Math.PI / 2],
    [-60, 19, Math.PI / 2],
  ],
};
/** The Twins' start line: the MOUNTAIN alley (+X) mouth, racing out along +X. */
const TWINS_GATE = { x: 68, z: -24 };

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export class MissionSystem {
  state: MissionState = emptyState();
  /** Bumped on every change the UI shows. */
  version = 0;
  near: Talkable | null = null;
  panel: Talkable | 'journal' | null = null;
  toast: MissionToast | null = null;
  race: Race | null = null;
  parcel: { id: string; until: number } | null = null;
  /** The next dialogue line was just heard in a cutscene: show it without speaking it again. */
  quietLine = false;
  /** Seconds the door glows brighter (its cutscene). */
  doorBoost = 0;
  /** The Big Drop behind the deepest door (it replaced the Upside Down). */
  readonly ud: Peak;
  private npcs = new Map<NpcId, StandingNpc>();
  private door: { group: THREE.Group; glow: THREE.MeshBasicMaterial; pos: THREE.Vector3 } | null =
    null;
  private host: NpcHost | null = null;
  private listeners = new Set<() => void>();
  private storeKey = '';
  private saveAcc = 0;
  private dirty = false;
  private farAcc = 1;
  // Sensing
  private lastBankedAt = -1;
  private tagT = 0;
  private tagIdle = 0;
  private grindM = 0;
  private wasTuned = false;
  private fmAcc = 0;
  private crewAcc = 0;
  private hoopsPhase = 'idle';
  private airT = 0;
  private wasAir = false;
  private udAcc = 0;
  private lastPos = new THREE.Vector3();
  private njSeen = false;
  private bowlSeen = false;
  /**
   * Places only count when you got there under your own steam: a session
   * that started somewhere by URL (?spot=, ?play=hoops, ?megaramp=) doesn't
   * count them until you've been back up to the city.
   */
  private placesOk = true;
  private respawns = 0;

  constructor(private game: Game) {
    this.ud = new Peak(game);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** After the level and characters are loaded. */
  start() {
    const g = this.game;
    if (g.assets === null) return;
    this.storeKey = STORE_PREFIX + riderId();
    try {
      this.state = sanitizeState(JSON.parse(load(this.storeKey) ?? 'null'));
    } catch {
      this.state = emptyState();
    }
    this.host = {
      scene: g.gfx.scene,
      assets: g.assets,
      labelLayer: g.labelLayerEl,
      camera: g.gfx.camera,
      canvas: g.gfx.renderer.domElement,
      toon: g.gfx.toon,
      mergeProps: g.gfx.quality === 'low',
    };
    // Server sync rides on the stats posts
    g.stats.extras = () => ({ missions: postable(this.state), title: this.state.title });
    g.stats.onYou = you => this.fromServer(you);
    if (g.level?.baked === true) this.placePlaza();
    const q = new URLSearchParams(window.location.search);
    this.placesOk = !['spot', 'megaramp'].some(k => q.has(k)) && q.get('play') === null;
    this.respawns = g.player.respawns;
    this.lastPos.copy(g.player.pos);
    this.refreshFlags();
    this.emit();
  }

  // ── Placement ──

  /** Ground under (x, z), casting down 100 m from height `from` (a world y, not a range). */
  private ground(x: number, z: number, from = 30): number | null {
    const hit = this.game.world.raycast(_o.set(x, from, z), _down, 100);
    return hit !== null && hit.normal.y > 0.9 ? hit.point.y : null;
  }

  /** Flat and clear over a ~2.6 m square (no props, walls or steps). */
  private clearAt(x: number, z: number): number | null {
    const y0 = this.ground(x, z);
    if (y0 === null) return null;
    for (const dx of [-1.3, 0, 1.3])
      for (const dz of [-1.3, 0, 1.3]) {
        const y = this.ground(x + dx, z + dz);
        if (y === null || Math.abs(y - y0) > 0.15) return null;
      }
    return y0;
  }

  private spawnNpc(id: NpcId, x: number, y: number, z: number, yaw: number) {
    if (this.host === null) return null;
    const props =
      id === 'oracle'
        ? oracleProps()
        : id === 'keymaker'
          ? keymakerProps()
          : id === 'courier'
            ? parcelProps()
            : id === 'twins'
              ? twinsProps()
              : null;
    const npc = new StandingNpc(NPCS[id], this.host, {
      props,
      fixedProps: id === 'twins',
      board: id === 'twins',
      spread: id === 'twins' ? 1.8 : 1.3,
    });
    npc.place(x, y, z, yaw);
    this.npcs.set(id, npc);
    return npc;
  }

  private placePlaza() {
    for (const [id, spots] of Object.entries(PLAZA_SPOTS) as [NpcId, Spot[]][]) {
      let placed = false;
      for (const [x, z, yaw] of spots) {
        const y = this.clearAt(x, z);
        if (y === null) continue;
        this.spawnNpc(id, x, y, z, yaw);
        placed = true;
        break;
      }
      if (!placed) {
        const [x, z, yaw] = spots[0]!;
        this.spawnNpc(id, x, this.ground(x, z) ?? 0, z, yaw);
      }
    }
    // The DJ stands outside the van's serving hatch
    const van = this.game.van?.group;
    if (van !== undefined) {
      van.updateMatrixWorld(true);
      const p = van.localToWorld(new THREE.Vector3(3.3, 0, -1.6));
      const yaw = van.rotation.y + Math.PI / 2;
      this.spawnNpc('dj', p.x, this.ground(p.x, p.z) ?? van.position.y, p.z, yaw);
    }
    this.placeTwinsAtGate();
  }

  private placeTwinsAtGate() {
    const y = this.ground(TWINS_GATE.x, TWINS_GATE.z) ?? 0;
    const npc = this.npcs.get('twins') ?? this.spawnNpc('twins', 0, 0, 0, 0);
    npc?.place(TWINS_GATE.x, y, TWINS_GATE.z, -Math.PI / 2);
    npc?.placeProps(TWINS_GATE.x, y, TWINS_GATE.z, -Math.PI / 2);
  }

  /** Noun Jersey's two and the bowl's door, once you're near and the ground is in. */
  private placeFar() {
    const p = this.game.player.pos;
    if (this.game.mountain === null || this.host === null) return;
    const f = njFrame();
    if (f !== null && (!this.npcs.has('captain') || !this.npcs.has('baller'))) {
      const c = njToWorld(f, 60, 75, { x: 0, z: 0 });
      if (Math.hypot(c.x - p.x, c.z - p.z) < 500) {
        if (!this.npcs.has('captain')) {
          const at = njToWorld(f, 11, 6, { x: 0, z: 0 });
          const spawn = njToWorld(f, 6, 2, { x: 0, z: 0 });
          const y = this.ground(at.x, at.z, f.P + 40);
          if (y !== null)
            this.spawnNpc('captain', at.x, y, at.z, Math.atan2(spawn.x - at.x, spawn.z - at.z));
        }
        if (!this.npcs.has('baller')) {
          const court = new CourtXform(f);
          const at = court.toWorld(14.6, 0, 2, { x: 0, y: 0, z: 0 });
          const y = this.ground(at.x, at.z, f.P + 40);
          if (y !== null)
            this.spawnNpc('baller', at.x, y, at.z, Math.atan2(court.cx - at.x, court.cz - at.z));
        }
      }
    }
    if (this.door === null) {
      const bf = bowlFrame(p.x, p.z);
      if (bf !== null) {
        const c = bowlCentre(bf, { x: 0, z: 0 });
        if (Math.hypot(c.x - p.x, c.z - p.z) < 450) {
          const top = Math.max(p.y, terrainHeight(c.x, c.z)) + 80;
          const hit = this.game.world.raycast(_o.set(c.x, top, c.z), _down, 400);
          if (hit !== null) {
            const d = doorProp();
            d.group.position.set(c.x, hit.point.y, c.z);
            this.host.scene.add(d.group);
            this.door = { ...d, pos: d.group.position.clone() };
          }
        }
      }
    }
  }

  // ── Per frame ──

  update(dt: number) {
    const g = this.game;
    if (this.host === null) return;
    const p = g.player;
    const now = Date.now();
    this.farAcc += dt;
    if (this.farAcc > 0.5) {
      this.farAcc = 0;
      this.placeFar();
      this.refreshFlags();
    }
    for (const npc of this.npcs.values()) npc.update(dt, p.pos);
    if (this.door !== null) {
      const k = 0.75 + 0.25 * Math.sin(performance.now() / 300);
      this.doorBoost = Math.max(0, this.doorBoost - dt);
      this.door.glow.opacity = Math.min(
        1,
        (this.ud.active ? 0.5 + 0.3 * k : 0.6 + 0.35 * k) + (this.doorBoost > 0 ? 0.4 : 0),
      );
      this.door.glow.color.setHex(this.doorBoost > 0 ? 0xff2a3a : 0x9a0f1c);
    }
    // The crystal ball hums when you're near her table
    const oracle = this.npcs.get('oracle');
    if (oracle !== undefined) {
      const d = oracle.pos.distanceTo(p.pos);
      g.sfx.loop('crystal-hum', d < 9 ? 0.12 * (1 - d / 9) : 0);
    }
    this.ud.update(dt);
    this.updateRace(dt);
    this.updateParcel();
    this.sense(dt, now);
    this.updateNear();
    this.saveAcc += dt;
    if (this.dirty && this.saveAcc > 2) this.save();
    this.lastPos.copy(p.pos);
  }

  private signal(sig: Signal, now = Date.now()) {
    const done = apply(this.state, sig, now);
    if (sig.t !== 'speed') this.dirty = true;
    if (done.length > 0) this.completed(done);
  }

  private completed(done: MissionDef[]) {
    for (const m of done) {
      this.toast = { at: performance.now(), title: m.title, reward: m.reward, kind: 'done' };
    }
    this.game.sfx.play('mission-complete', { gain: 0.8 });
    this.game.sfx.play('sparkle', { gain: 0.5, delay: 0.15 });
    // 10,000 km/h: The One (once; it waits until nothing's in the way)
    if (done.some(m => m.id === 'the-one') && !this.seen('one')) this.game.cutscene.request('one');
    this.game.stats.markDirty();
    this.refreshFlags();
    this.save();
    this.emit();
  }

  /** Read what happened this frame and turn it into signals. */
  private sense(dt: number, now: number) {
    const g = this.game;
    const p = g.player;
    const ud = this.ud.active;
    const onBoard = p.mode === 'board';
    // Banked combos (tricks)
    const b = p.combo.lastBanked;
    if (b !== null && b.at !== this.lastBankedAt) {
      this.lastBankedAt = b.at;
      if (!b.bailed && b.label)
        this.signal(
          { t: 'combo', tricks: b.label.split(' + '), nj: njInCore(p.pos.x, p.pos.z, 4), ud },
          now,
        );
    }
    // Spray: a tag is half a second of paint on a wall
    const gr = g.graffiti;
    if (gr !== null && gr.spraying && gr.aim !== null) {
      this.tagT += dt;
      this.tagIdle = 0;
      if (this.tagT >= 0.5) {
        this.tagT = -1e9; // once per stroke
        this.signal({ t: 'tag', color: gr.colorHex }, now);
      }
    } else if ((this.tagIdle += dt) > 0.4) this.tagT = 0;
    // NOUN FM
    const tuned = g.fm.getView().tuned;
    if (tuned && !this.wasTuned) this.signal({ t: 'fm' }, now);
    this.wasTuned = tuned;
    if (tuned && onBoard && p.speed > 2) {
      this.fmAcc += dt;
      if (this.fmAcc >= 1) {
        this.signal({ t: 'fmRide', dt: this.fmAcc }, now);
        this.fmAcc = 0;
      }
    }
    // Hoops results
    const phase = g.hoops.ui.phase;
    if (phase === 'results' && this.hoopsPhase !== 'results') {
      const r = g.hoops.ui.results;
      this.signal(
        { t: 'hoops', win: r !== null && r.myTeam !== null && r.winner === r.myTeam },
        now,
      );
    }
    this.hoopsPhase = phase;
    if (g.hoops.active) return;
    // Places (back in the city after a URL start: they count from here on)
    if (!this.placesOk && p.respawns !== this.respawns && edgeDistance(p.pos.x, p.pos.z) === 0)
      this.placesOk = true;
    this.respawns = p.respawns;
    if (this.placesOk && !this.njSeen && njInCore(p.pos.x, p.pos.z)) {
      this.njSeen = true;
      this.signal({ t: 'spot', spot: 'nj' }, now);
    }
    if (this.placesOk && !this.bowlSeen && g.mountain !== null && inBowl(p.pos.x, p.pos.z)) {
      this.bowlSeen = true;
      this.signal({ t: 'spot', spot: 'bowl' }, now);
    }
    if (!onBoard) {
      this.grindM = 0;
      this.wasAir = false;
      return;
    }
    // Grinds
    if (p.state === 'grind') this.grindM += p.speed * dt;
    else if (this.grindM > 0) {
      if (!ud && p.state !== 'bail') this.signal({ t: 'grind', m: this.grindM }, now);
      this.grindM = 0;
    }
    // The streak clock (mountain only, resets on a bail)
    if (!ud && p.runTime > 0 && Math.floor(p.runTime) !== Math.floor(p.runTime - dt))
      this.signal({ t: 'streak', s: p.runTime }, now);
    // Grass speed (gates "There is no road"; the speed itself must be a saved record)
    if (!ud && p.surface === 'grass') {
      const kmh = p.speed * 3.6;
      if (kmh > this.state.grassKmh + 1) this.signal({ t: 'speed', kmh, surface: 'grass' }, now);
    }
    // Riding with the Jersey crew
    const crew = g.crew;
    if (crew !== null && !ud && p.speed > 3 && crew.npcs.length > 0) {
      let close = false;
      for (const n of crew.npcs) {
        if (n.state === 'hang' || n.state === 'bail') continue;
        if (n.pos.distanceToSquared(p.pos) < 36) {
          close = true;
          break;
        }
      }
      if (close) {
        this.crewAcc += dt;
        if (this.crewAcc >= 0.5) {
          this.signal({ t: 'crew', dt: this.crewAcc }, now);
          this.crewAcc = 0;
        }
      }
    }
    // The Upside Down: hang time and distance (not records, just missions)
    if (ud) {
      if (p.state === 'air') this.airT = this.wasAir ? this.airT + dt : dt;
      else if (this.wasAir && p.state !== 'bail') this.signal({ t: 'udHang', s: this.airT }, now);
      this.wasAir = p.state === 'air';
      const moved = Math.hypot(p.pos.x - this.lastPos.x, p.pos.z - this.lastPos.z);
      if (moved < 200) this.udAcc += moved;
      if (this.udAcc >= 25) {
        this.signal({ t: 'udRide', m: this.udAcc }, now);
        this.udAcc = 0;
      }
    } else this.wasAir = false;
  }

  /** The server's view after a post: accepted records, and missions it holds. */
  private fromServer(you: {
    best?: Record<string, number | undefined>;
    missions?: unknown;
    title?: unknown;
  }) {
    const fresh = mergeServer(this.state, you.missions);
    if (you.best) {
      const best: Partial<Record<'kmh' | 'airM' | 'airS', number>> = {};
      for (const k of ['kmh', 'airM', 'airS'] as const) {
        const v = you.best[k];
        if (typeof v === 'number') best[k] = v;
      }
      this.signal({ t: 'server', best });
    }
    if (fresh.length > 0) {
      this.refreshFlags();
      this.save();
      this.emit();
    }
  }

  private save() {
    this.dirty = false;
    this.saveAcc = 0;
    try {
      localStorage.setItem(this.storeKey, JSON.stringify(this.state));
    } catch {
      // private mode: progress lasts for this page
    }
  }

  /** "!" over everyone with something new for you. */
  private refreshFlags() {
    for (const [id, npc] of this.npcs) {
      const m = unlockedFor(this.state, id);
      npc.flag = m !== null && (this.state.met[id] === undefined || id === 'oracle');
      if (id === 'oracle') npc.flag = this.state.met.oracle === undefined;
      if (id === 'captain' && this.parcel !== null) npc.flag = true;
    }
  }

  private updateNear() {
    const p = this.game.player;
    let best: Talkable | null = null;
    let bd = Infinity;
    // At the ice cream van's cab door (or driving it) E is the van's, not a chat
    const van = this.game.van2;
    const vanE = van !== undefined && (van.driving || van.nearDoor());
    if (p.speed < 7 && !this.game.hoops.active && !vanE) {
      for (const [id, npc] of this.npcs) {
        if (this.race !== null && id === 'twins') continue;
        const d = Math.hypot(p.pos.x - npc.pos.x, p.pos.z - npc.pos.z);
        if (d < bd && npc.inRange(p.pos, id === 'twins' ? TALK_R + 1.5 : TALK_R)) {
          best = id;
          bd = d;
        }
      }
      if (this.door !== null) {
        const d = Math.hypot(p.pos.x - this.door.pos.x, p.pos.z - this.door.pos.z);
        if (d < 3.2 && d < bd && Math.abs(p.pos.y - this.door.pos.y) < 3) best = 'door';
      }
    }
    if (best !== this.near) {
      this.near = best;
      this.emit();
    }
  }

  // ── Talking ──

  /** E / tap: open whoever's here. */
  talk(who: Talkable | null = this.near) {
    if (who === null) return;
    // Arriving with the parcel delivers it
    if (who === 'captain' && this.parcel !== null) {
      const id = this.parcel.id;
      this.parcel = null;
      this.signal({ t: 'delivered', id });
    }
    // Meeting the Oracle for the first time is a scene; her panel opens after it
    if (
      who === 'oracle' &&
      this.state.met.oracle === undefined &&
      !this.seen('oracle') &&
      this.game.cutscene.play('oracle', {
        then: () => {
          this.quietLine = true;
          this.openPanel('oracle');
        },
      })
    )
      return;
    this.game.sfx.play('ui-confirm', { gain: 0.5 });
    this.openPanel(who);
  }

  // ── Cutscenes ──

  /** Has this rider seen a story scene? */
  seen(id: SceneId) {
    return this.state.seen[id] !== undefined;
  }

  markSeen(id: SceneId) {
    if (this.seen(id)) return;
    this.state.seen[id] = Date.now();
    this.save();
    this.emit();
  }

  /** Replay a seen scene from the journal (nothing in the world changes). */
  replayScene(id: SceneId) {
    this.openPanel(null);
    this.game.cutscene.play(id, { replay: true });
  }

  /** A character (for cutscenes), if they're in the world. */
  npcOf(id: string): StandingNpc | null {
    return this.npcs.get(id as NpcId) ?? null;
  }

  /** Where the deepest door stands, once it's been placed. */
  doorAt(): THREE.Vector3 | null {
    return this.door?.pos ?? null;
  }

  openPanel(p: Talkable | 'journal' | null) {
    this.panel = p;
    this.game.input.setEnabled(p === null);
    this.emit();
  }

  /** Accept: you've met them (and their open mission now counts). */
  accept(npc: NpcId) {
    const first = this.state.met[npc] === undefined;
    this.signal({ t: 'met', npc });
    const m = unlockedFor(this.state, npc);
    if (first && m !== null)
      this.toast = { at: performance.now(), title: `New mission: ${m.title}`, kind: 'info' };
    this.game.sfx.play('mission-accept', { gain: 0.8 });
    this.refreshFlags();
    this.save();
    this.emit();
    // Taking the Keymaker's line is a scene (the panel closes for it)
    if (npc === 'keymaker' && first && !this.seen('keymaker')) {
      this.openPanel(null);
      this.game.cutscene.play('keymaker');
    }
  }

  /** The courier's parcel: the clock starts now. */
  takeParcel() {
    const m = unlockedFor(this.state, 'courier');
    if (m?.obj.k !== 'deliver' || this.state.met.courier === undefined) return;
    this.parcel = { id: m.id, until: performance.now() + m.obj.s * 1000 };
    this.toast = {
      at: performance.now(),
      title: 'Parcel taken: get it to Cap in Noun Jersey',
      kind: 'info',
    };
    this.refreshFlags();
    this.openPanel(null);
  }

  private updateParcel() {
    if (this.parcel === null || performance.now() < this.parcel.until) return;
    this.parcel = null;
    this.toast = {
      at: performance.now(),
      title: 'Too late: the parcel went back to Parcel',
      kind: 'fail',
    };
    this.refreshFlags();
    this.emit();
  }

  /** The Twins: line up at the gate and go. */
  startRace() {
    const m = unlockedFor(this.state, 'twins');
    if (m?.obj.k !== 'race' || this.state.met.twins === undefined) return;
    const second = m.id !== 'outrun-the-twins';
    this.race = {
      id: m.id,
      m: m.obj.m,
      count: 3,
      t: 0,
      s: 0,
      v: 0,
      v0: second ? 22 : 20,
      grow: second ? 0.25 : 0.06,
      respawns: this.game.player.respawns,
      over: null,
    };
    const tw = this.npcs.get('twins');
    if (tw) {
      tw.driven = true;
      // They may have turned to greet you; race facing down the line
      tw.faceForward();
    }
    this.openPanel(null);
    // The first race opens on a scene that runs exactly as long as the countdown
    if (!this.seen('twins')) this.game.cutscene.play('twins');
  }

  /** Down distance of a point on the Twins' line (+X from the gate). */
  private twinsAt(s: number) {
    const x = TWINS_GATE.x + s;
    const z = TWINS_GATE.z;
    const y = terrainInDomain(x, z) ? terrainHeight(x, z) : (this.ground(x, z) ?? 0);
    return { x, y, z };
  }

  private updateRace(dt: number) {
    const r = this.race;
    if (r === null) return;
    const g = this.game;
    const p = g.player;
    const tw = this.npcs.get('twins');
    if (r.over !== null) {
      if (performance.now() - r.over.at > 4000) {
        this.race = null;
        if (tw) tw.driven = false;
        this.placeTwinsAtGate();
        this.emit();
      }
      return;
    }
    if (r.count > 0) {
      // Hold at the line during the countdown
      if (Math.hypot(p.pos.x - TWINS_GATE.x, p.pos.z - TWINS_GATE.z) > 14) r.count = 3;
      r.count -= dt;
      if (r.count <= 0) {
        r.count = 0;
        r.respawns = p.respawns;
      }
    } else {
      r.t += dt;
      r.v = Math.min(r.v0 + r.grow * r.t, r.v + 4 * dt);
      r.s += r.v * dt;
    }
    // Pose the Twins on their line
    if (tw) {
      const a = this.twinsAt(r.s);
      tw.place(a.x, a.y, a.z, Math.PI / 2);
      tw.root.visible = true;
      for (const ch of tw.chars) {
        ch.board.visible = true;
        ch.play({
          clip: r.count > 0 ? 'skate_idle' : r.v < 9 ? 'skate_push' : 'skate_crouch',
          fade: 0.3,
        });
        ch.update(dt, {
          lean: 0,
          travelled: r.count > 0 ? 0 : r.v * dt,
          riding: true,
          grounded: true,
        });
      }
    }
    if (r.count > 0) return;
    const twinsDown = Math.max(0, TWINS_GATE.x + r.s - MOUNTAIN.wallZ);
    const youDown = edgeDistance(p.pos.x, p.pos.z);
    const lost = p.respawns !== r.respawns;
    if (youDown >= r.m && !lost) {
      r.over = { won: true, at: performance.now() };
      this.signal({ t: 'raceWon', id: r.id });
    } else if (twinsDown >= r.m || lost) {
      r.over = { won: false, at: performance.now() };
      this.toast = {
        at: performance.now(),
        title: lost
          ? 'You left the race. The Twins wait at the gate.'
          : 'The Twins win. Go again at the gate.',
        kind: 'fail',
      };
    }
    this.emit();
  }

  /** HUD numbers for a race in progress. */
  raceView() {
    const r = this.race;
    if (r === null) return null;
    const p = this.game.player.pos;
    return {
      count: r.count,
      m: r.m,
      you: Math.min(r.m, edgeDistance(p.x, p.z)),
      twins: Math.min(r.m, Math.max(0, TWINS_GATE.x + r.s - MOUNTAIN.wallZ)),
      over: r.over,
    };
  }

  // ── The door ──

  /** Can the door be opened (the Keymaker sent you, or you've been through)? */
  doorOpen() {
    const s = this.state;
    return s.done['deepest-door'] !== undefined || (this.placesOk && doorUnlocked(s));
  }

  /**
   * The homepage's THE BIG DROP card (`/world?drop=1`): once the rider is
   * in, straight onto the mountain if the door is open to them (no scene,
   * and it doesn't count as finding the door), else a word on how to open
   * it. Leaving puts you back where you started, in the plaza.
   */
  launchBigDrop(): boolean {
    if (this.ud.active) return true;
    if (!doorUnlocked(this.state)) {
      this.toast = { at: performance.now(), title: DROP_LOCKED_MSG, kind: 'info' };
      this.emit();
      return false;
    }
    this.openPanel(null);
    this.game.sfx.play('cut-boom', { gain: 0.5 });
    this.enterUpsideDown(false);
    return true;
  }

  /** Step through: onto the Big Drop, or back out. */
  throughDoor() {
    if (this.ud.active) {
      this.leaveUpsideDown();
      return;
    }
    if (!this.doorOpen()) return;
    this.openPanel(null);
    // The first time through is a scene (it calls enterUpsideDown at the flash)
    if (!this.seen('door') && this.game.cutscene.play('door')) return;
    this.game.sfx.play('door-creak', { gain: 0.8 });
    this.game.sfx.play('cut-boom', { gain: 0.6, delay: 0.3 });
    this.game.sfx.play('ud-accent', { gain: 0.6, delay: 0.4 });
    this.enterUpsideDown();
  }

  /** Onto the Big Drop (the door's scene calls this at its flash). */
  enterUpsideDown(throughTheDoor = true) {
    if (this.ud.active) return;
    this.ud.enter();
    if (throughTheDoor) this.signal({ t: 'door' });
    this.toast = { at: performance.now(), title: 'The Big Drop: 1,000 km down', kind: 'info' };
    this.emit();
  }

  leaveUpsideDown() {
    if (!this.ud.active) return;
    this.ud.exit();
    this.toast = { at: performance.now(), title: 'Back in your own world', kind: 'info' };
    this.openPanel(null);
  }

  /** Equip a title (a finished mission's id), or none. */
  setTitle(id: string | null) {
    if (id !== null && this.state.done[id] === undefined) return;
    this.state.title = id;
    this.game.stats.markDirty();
    this.save();
    this.emit();
  }

  /** Missions in progress, for the tracker. */
  tracked(): MissionDef[] {
    return activeMissions(this.state);
  }

  /** Who still needs meeting, for the tracker's hints. */
  toMeet(): NpcId[] {
    return NPC_IDS.filter(
      n => this.state.met[n] === undefined && unlockedFor(this.state, n) !== null,
    );
  }

  /** Records only count online (the server holds them). */
  recordsLive() {
    return this.game.stats.isLive();
  }

  dispose() {
    this.ud.dispose();
    if (this.dirty) this.save();
    for (const npc of this.npcs.values()) npc.dispose();
    this.npcs.clear();
    if (this.door !== null) {
      this.host?.scene.remove(this.door.group);
      this.door = null;
    }
    if (this.panel !== null) this.game.input.setEnabled(true);
  }
}
