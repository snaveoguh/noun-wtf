// ── NOUNS CAMP in the game: build it, wake riders up in it, the prompts ──
//
// build(level) runs in Game.start before the level is toonified and its
// collision built: CAMP's meshes join the level root and its colliders
// the level's static collision (it's in the real world, not a pocket).
// spawnInside() is the first spawn (World2Page calls it once per page
// load; firstSpawn.ts says when). update() flickers the bulb, offers
// READ MEME VALUE at the coffee table and PLAY POOL at the table, and
// calls out the drop when someone jumps out of the window.

import type { Game } from '../../Game';
import type { LevelData } from '../Level';

import * as THREE from 'three';

import { buildCamp, type CampBuild, type CampWorld } from './build';
import { pickSpawn } from './firstSpawn';
import { CAMP_TOWER, inCamp, toWorld, type CampSite } from './site';

export interface CampPrompt {
  kind: 'read' | 'pool';
  text: string;
  sub?: string;
}

export interface CampView {
  prompt: CampPrompt | null;
}

/** Book / table reach (m, flat distance). */
const NEAR_BOOK = 1.5;
const NEAR_POOL = 1.8;
/** A fall this big off the tower gets called out on landing. */
const BIG_DROP = 25;
/** Animate the bulb only this close (it's a glow material; nobody far sees it). */
const NEAR_CAMP = 80;

export class CampSystem {
  site: CampSite | null = null;
  built: CampBuild | null = null;
  /** World2Page wires this to the router (opens the book in the navigator). */
  onRead: (() => void) | null = null;
  private view_: CampView = { prompt: null };
  private listeners = new Set<() => void>();
  private t = 0;
  /** Highest point of the current fall (null when grounded). */
  private fallTop: number | null = null;
  private keyBound = false;
  private lit = false;

  constructor(private readonly game: Game) {}

  get view(): CampView {
    return this.view_;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** Build CAMP into the level (before toonify + world.build). */
  build(level: LevelData) {
    const site = level.camp;
    if (site === undefined || this.built !== null) return;
    try {
      const world = probeWorld(level.collisionMeshes, site);
      const built = buildCamp(site, world, { low: this.game.gfx.quality === 'low' });
      level.root.add(built.group);
      level.collisionMeshes.push(...built.collision);
      this.site = site;
      this.built = built;
      if (import.meta.env.DEV)
        console.info(
          `[camp] built: ${built.stats.drawCalls} draws, ${built.stats.triangles} tris, stair ${built.stair?.flights ?? 0} flights`,
        );
    } catch (err) {
      console.warn('[camp] not built', err);
    }
    if (!this.keyBound && typeof document !== 'undefined') {
      document.addEventListener('keydown', this.onKey, true);
      this.keyBound = true;
    }
  }

  /** Wake up in CAMP: on foot at a spawn spot, facing the window, at sunset. False if there's no CAMP. */
  spawnInside(): boolean {
    const s = this.site;
    const b = this.built;
    if (s === null || b === null) return false;
    const g = this.game;
    const spots = b.layout.spawns;
    const sp = spots[pickSpawn(spots.length, Math.random())]!;
    const [x, y, z] = toWorld(s, sp.x, 0.05, sp.z);
    const p = g.player;
    if (p.mode === 'board') p.toggleBoard();
    p.spawn(new THREE.Vector3(x, y, z), sp.yaw);
    p.mode = 'foot';
    p.footGrounded = true;
    g.cam.snap(p);
    g.setTimeOfDay('golden');
    b.art.loadPages();
    g.hud = {
      ...g.hud,
      toast: {
        text: 'NOUNS CAMP · CONDEMNED. THE WINDOW IS THE WAY OUT',
        tag: 'camp',
        at: performance.now(),
      },
    };
    return true;
  }

  update(dt: number) {
    const s = this.site;
    const b = this.built;
    if (s === null || b === null) return;
    this.t += dt;
    if (!this.lit) this.selfLight(b);
    const g = this.game;
    const p = g.player.pos;
    const o = s.origin;
    if (Math.abs(p.x - o.x) < NEAR_CAMP && Math.abs(p.z - o.z) < NEAR_CAMP && p.y > o.y - 60)
      b.animate(this.t);
    // Prompts, only inside
    let prompt: CampPrompt | null = null;
    if (inCamp(s, p.x, p.y, p.z) && !g.pool.active && !g.paused) {
      const lx = p.x - o.x;
      const lz = p.z - o.z;
      const L = b.layout;
      if (Math.hypot(lx - L.book.x, lz - L.book.z) < NEAR_BOOK)
        prompt = { kind: 'read', text: 'READ MEME VALUE', sub: 'LIL 67' };
      else if (Math.hypot(lx - L.pool.x, lz - L.pool.z) < NEAR_POOL)
        prompt = { kind: 'pool', text: 'PLAY POOL', sub: '🎱' };
    }
    if (prompt?.kind !== this.view_.prompt?.kind) {
      this.view_ = { prompt };
      for (const l of this.listeners) l();
    }
    this.trackDrop();
  }

  act(kind: CampPrompt['kind']) {
    const s = this.site;
    const b = this.built;
    if (s === null || b === null) return;
    if (kind === 'read') {
      this.onRead?.();
      return;
    }
    const t = b.layout.pool;
    const [x, y, z] = toWorld(s, t.x, 0, t.z);
    // The table's length runs along its local x, turned by the piece's yaw
    this.game.pool.playAt({ x, y, z, yaw: t.yaw, length: t.length - 0.2, width: t.width - 0.2 });
  }

  /**
   * A little warm light of its own: the low sunset sun only gets in at the
   * window, and lighting it for real (a point light) would relink every
   * lit material in the game. Set after the time-of-day scan has run
   * (Game.start), so it never reads as a lamp or a window to light at night.
   */
  private selfLight(b: CampBuild) {
    this.lit = true;
    const seen = new Set<THREE.Material>();
    b.group.traverse(o => {
      // The room's own surfaces only (not the stair outside, not the glass)
      if (o.name !== 'Interior:solid' && o.name !== 'Interior:art') return;
      const m = (o as THREE.Mesh).material as THREE.Material & {
        emissive?: THREE.Color;
        map?: THREE.Texture | null;
        emissiveMap?: THREE.Texture | null;
      };
      if (seen.has(m) || !(m.emissive instanceof THREE.Color)) return;
      seen.add(m);
      if (m.map !== null && m.map !== undefined) {
        // Printed things: self-lit through their own picture
        m.emissive.setHex(0x86807a);
        m.emissiveMap = m.map;
      } else m.emissive.setHex(0x625244);
      m.needsUpdate = true;
    });
  }

  /** A jump out of the window: how far you fell, called out when you land. */
  private trackDrop() {
    const g = this.game;
    const pl = g.player;
    const s = this.site!;
    const grounded = pl.mode === 'foot' ? pl.footGrounded || pl.climb !== null : pl.state !== 'air';
    if (!grounded) {
      const near = Math.abs(pl.pos.x - CAMP_TOWER.x) < 40 && Math.abs(pl.pos.z - CAMP_TOWER.z) < 40;
      if (this.fallTop === null) {
        if (near && pl.pos.y > s.floorY - 6) this.fallTop = pl.pos.y;
      } else this.fallTop = Math.max(this.fallTop, pl.pos.y);
      return;
    }
    if (this.fallTop === null) return;
    const drop = this.fallTop - pl.pos.y;
    this.fallTop = null;
    if (drop < BIG_DROP) return;
    g.cam.addShake(0.9);
    g.hud = {
      ...g.hud,
      toast: {
        text: `SENT IT · ${Math.round(drop)} M OFF NOUNS CAMP`,
        tag: 'camp-drop',
        at: performance.now(),
      },
    };
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyE') return;
    const el = e.target as HTMLElement | null;
    if (el !== null && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable))
      return;
    const pr = this.view_.prompt;
    if (pr === null || this.game.paused) return;
    // Ours, not the board toggle's
    e.stopImmediatePropagation();
    e.preventDefault();
    this.act(pr.kind);
  };

  dispose() {
    if (this.keyBound) document.removeEventListener('keydown', this.onKey, true);
    this.keyBound = false;
    this.built?.dispose();
    this.built = null;
    this.listeners.clear();
  }
}

/**
 * Where the stair lands: the roof east of the tower, and the parapet along
 * the facade there, read off the level's collision.
 */
function probeWorld(meshes: THREE.Mesh[], site: CampSite): CampWorld {
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const towerMaxX = CAMP_TOWER.x + CAMP_TOWER.w / 2;
  const x = towerMaxX + 1.5;
  const at = (z: number) => {
    ray.set(new THREE.Vector3(x, site.floorY - 20, z), down);
    ray.far = site.floorY;
    const hits = ray.intersectObjects(meshes, false);
    return hits.length > 0 ? hits[0]!.point.y : 0;
  };
  const roof = at(site.faceZ + 3);
  // The parapet: the highest point along the facade's first half metre
  let parapet = roof;
  let depth = 0.25;
  for (let d = 0.02; d < 0.8; d += 0.04) {
    const y = at(site.faceZ + d);
    if (y > roof + 0.2) {
      parapet = Math.max(parapet, y);
      depth = d + 0.04;
    }
  }
  if (parapet <= roof + 0.2) parapet = roof + 0.9;
  return { roof, parapet, parapetDepth: depth, towerMaxX };
}
