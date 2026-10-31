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
import type { Aabb } from '../mountain/ringOcclusion';

import * as THREE from 'three';

import { Birds } from './birds';
import { buildCamp, type CampBuild, type CampWorld } from './build';
import { pickSpawn } from './firstSpawn';
import { HandBook } from './HandBook';
import { INTRO_SECONDS, introShot, type Shot, type V3 } from './intro';
import { portalPlanes, seenFromRoom } from './portal';
import { FLIP_SECONDS, readingPlan, readingShot, type ReadingPlan } from './reading';
import { CAMP_TOWER, inCamp, toWorld, type CampSite } from './site';

export interface CampPrompt {
  kind: 'read' | 'pool';
  text: string;
  sub?: string;
}

export interface CampView {
  prompt: CampPrompt | null;
  /** The opening shot is running (letterbox, caption, skip hint). */
  intro: boolean;
}

/** The sky light indoors (pocket rooms use the same). */
const WARM_SKY = new THREE.Color(0xfff0dc);
const WARM_GROUND = new THREE.Color(0x8a7058);

/** The game camera's field of view on foot (SkateCamera). */
const FOOT_FOV = 62;
/** First person, on the book in your hands. */
const READ_FOV = 52;

/** Book / table reach (m, flat distance). */
const NEAR_BOOK = 1.5;
const NEAR_POOL = 1.8;
/** A fall this big off the tower gets called out on landing. */
const BIG_DROP = 25;
/** Rerun the portal cull when the camera has moved this far (or every CULL_EVERY s). */
const CULL_MOVE = 0.25;
const CULL_EVERY = 1;
/** Look for new meshes (streamed chunks, riders) this often while culling. */
const GATHER_EVERY = 2;

interface CullItem {
  o: THREE.Object3D;
  box: Aabb;
  /** matrixWorld translation + x scale when the box was taken. */
  key: [number, number, number, number];
  local: THREE.Box3;
}

/** Animate the bulb only this close (it's a glow material; nobody far sees it). */
const NEAR_CAMP = 80;

export class CampSystem {
  site: CampSite | null = null;
  built: CampBuild | null = null;
  /** World2Page wires this to the router (opens the book in the navigator). */
  onRead: (() => void) | null = null;
  private view_: CampView = { prompt: null, intro: false };
  private listeners = new Set<() => void>();
  private t = 0;
  /** Highest point of the current fall (null when grounded). */
  private fallTop: number | null = null;
  private keyBound = false;
  private lit = false;
  /** The window portal cull (portal.ts): on while the camera is inside. */
  private cull = {
    on: false,
    from: new THREE.Vector3(Infinity, 0, 0),
    at: -Infinity,
    gatheredAt: -Infinity,
    items: [] as CullItem[],
    hidden: new Set<THREE.Object3D>(),
  };
  birds: Birds | null = null;
  /** The opening shot while it runs (spawnInside starts it). */
  private intro: {
    t: number;
    shot: (s: number) => Shot;
    rider: V3;
    yaw: number;
    plan: ReadingPlan;
    /** First person, reading. */
    eyes: { pos: THREE.Vector3; look: THREE.Vector3 };
    play: { pos: THREE.Vector3; look: THREE.Vector3 };
  } | null = null;
  /** How many meshes the portal cull is hiding (perf probes). */
  culled = 0;

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
      this.birds = new Birds(site);
      level.root.add(this.birds.mesh);
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
    this.startIntro([x, s.floorY, z], sp.yaw);
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
    this.ambient(dt);
    const g = this.game;
    const p = g.player.pos;
    const o = s.origin;
    if (Math.abs(p.x - o.x) < NEAR_CAMP && Math.abs(p.z - o.z) < NEAR_CAMP && p.y > o.y - 60)
      b.animate(this.t);
    const cam = g.gfx.camera.position;
    if (
      this.birds !== null &&
      cam.distanceTo(this.birds.mesh.geometry.boundingSphere!.center) < 220
    )
      this.birds.update(this.t);
    this.stepIntro(dt);
    // Prompts, only inside
    let prompt: CampPrompt | null = null;
    if (inCamp(s, p.x, p.y, p.z) && !g.pool.active && !g.paused && this.intro === null) {
      const lx = p.x - o.x;
      const lz = p.z - o.z;
      const L = b.layout;
      if (Math.hypot(lx - L.book.x, lz - L.book.z) < NEAR_BOOK)
        prompt = { kind: 'read', text: 'READ MEME VALUE', sub: 'LIL 67' };
      else if (Math.hypot(lx - L.pool.x, lz - L.pool.z) < NEAR_POOL)
        prompt = { kind: 'pool', text: 'PLAY POOL', sub: '🎱' };
    }
    if (prompt?.kind !== this.view_.prompt?.kind) {
      this.view_ = { ...this.view_, prompt };
      for (const l of this.listeners) l();
    }
    this.trackDrop();
    this.portalCull();
  }

  /**
   * From inside CAMP only the room and what the window frames can be seen:
   * hide everything else (portal.ts). By layer bit 0, restored on the way
   * out, and only bits this took away (it never fights MountainStream's
   * ring cull, which sets whole masks).
   */
  private portalCull() {
    const s = this.site!;
    const g = this.game;
    const C = this.cull;
    const cam = g.gfx.camera.position;
    const r = s.room;
    const inside =
      cam.x > r.minX &&
      cam.x < r.maxX &&
      cam.z > r.minZ &&
      cam.z < r.maxZ &&
      cam.y > s.floorY &&
      cam.y < s.ceilY;
    if (!inside) {
      if (C.on) this.releaseCull();
      return;
    }
    if (!C.on || this.t - C.gatheredAt > GATHER_EVERY) this.gatherCull();
    C.on = true;
    if (cam.distanceToSquared(C.from) < CULL_MOVE * CULL_MOVE && this.t - C.at < CULL_EVERY) return;
    C.from.copy(cam);
    C.at = this.t;
    const w = s.window;
    const planes = portalPlanes(
      cam.x,
      cam.y,
      cam.z,
      { x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1, z: s.faceZ },
      0.3,
    );
    const room: Aabb = {
      minX: s.tier.minX,
      maxX: s.tier.maxX,
      minY: s.floorY - 0.3,
      maxY: s.ceilY + 0.3,
      minZ: s.faceZ - 0.05,
      maxZ: s.tier.maxZ,
    };
    for (const it of C.items) {
      const show = seenFromRoom(planes, room, boxOf(it));
      const o = it.o;
      if (!show) {
        if ((o.layers.mask & 1) !== 0) {
          o.layers.mask &= ~1;
          C.hidden.add(o);
        }
      } else if (C.hidden.has(o)) {
        o.layers.mask |= 1;
        C.hidden.delete(o);
      }
    }
    this.culled = C.hidden.size;
  }

  /** Every drawable in the scene but the room itself, the rider and the sky. */
  private gatherCull() {
    const g = this.game;
    const C = this.cull;
    C.gatheredAt = this.t;
    const skip = new Set<THREE.Object3D>([g.gfx.sky]);
    if (g.me !== null) skip.add(g.me.root);
    for (const c of this.built!.group.children) if (c.name.startsWith('Interior:')) skip.add(c);
    const known = new Set(C.items.map(i => i.o));
    const items: CullItem[] = C.items.filter(i => i.o.parent !== null);
    const walk = (o: THREE.Object3D) => {
      if (skip.has(o)) return;
      const m = o as THREE.Mesh & { isInstancedMesh?: boolean; boundingBox?: THREE.Box3 | null };
      if ((m.isMesh === true || (o as THREE.Points).isPoints === true) && !known.has(o)) {
        let local: THREE.Box3 | null = null;
        if (m.isInstancedMesh === true) {
          const im = m as unknown as THREE.InstancedMesh;
          if (im.boundingBox === null) im.computeBoundingBox();
          local = im.boundingBox;
        } else if (m.geometry !== undefined) {
          if (m.geometry.boundingBox === null) m.geometry.computeBoundingBox();
          local = m.geometry.boundingBox;
        }
        // Sky domes, terrain grids: too big to ever be behind the walls
        if (
          local !== null &&
          local.min.distanceTo(local.max) * o.matrixWorld.getMaxScaleOnAxis() < 4000
        )
          items.push({ o, local: local.clone(), key: [NaN, 0, 0, 0], box: emptyBox() });
      }
      for (const c of o.children) walk(c);
    };
    walk(g.gfx.scene);
    C.items = items;
  }

  private releaseCull() {
    const C = this.cull;
    for (const o of C.hidden) o.layers.mask |= 1;
    C.hidden.clear();
    C.items = [];
    C.on = false;
    C.from.set(Infinity, 0, 0);
    C.gatheredAt = -Infinity;
    this.culled = 0;
  }

  /**
   * The opening shot (intro.ts): over the city, in through the window, to
   * the game camera's own pose behind the rider. Any key, click, tap or
   * move skips it; reduced motion never sees it.
   */
  private startIntro(rider: V3, yaw: number) {
    const g = this.game;
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true) return;
    if (new URLSearchParams(window.location.search).get('camintro') === '0') return;
    // Where the game camera will settle: let it place itself once
    g.cam.rig = null;
    g.cam.update(1 / 60, g.player, 0, 0, performance.now());
    const c = g.gfx.camera;
    const dir = c.getWorldDirection(new THREE.Vector3());
    const play = {
      pos: new THREE.Vector3().copy(c.position),
      look: new THREE.Vector3().copy(c.position).addScaledVector(dir, 4),
    };
    // The fly-in ends in the rider's eyes, on the book in their hands
    const sh = readingShot(rider, yaw);
    const plan = readingPlan(Math.random);
    const book = new HandBook(plan.spreads, this.site!.floorY, sh.book);
    g.gfx.scene.add(book.group);
    this.book = book;
    this.intro = {
      t: 0,
      shot: introShot(this.site!, rider, sh.cam, sh.look, READ_FOV, sh.approach),
      rider,
      yaw,
      plan,
      eyes: { pos: new THREE.Vector3(...sh.cam), look: new THREE.Vector3(...sh.look) },
      play,
    };
    this.introRig = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: FOOT_FOV };
    this.view_ = { ...this.view_, intro: true };
    for (const l of this.listeners) l();
    for (const ev of ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const)
      window.addEventListener(ev, this.skipIntro, { capture: true, passive: true });
    this.stepIntro(0);
  }

  private introRig: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null = null;
  /** The copy of MEME VALUE the rider reads (it stays on the floor after). */
  private book: HandBook | null = null;

  /** Fly-in, then reading (reading.ts), the toss, and the camera easing back into play. */
  private stepIntro(dt: number) {
    const I = this.intro;
    if (I === null) return;
    const g = this.game;
    I.t += dt;
    const P = I.plan;
    const total = INTRO_SECONDS + P.endAt;
    // Moving (a gamepad stick, say) skips it too
    if (I.t > 0.5 && g.player.speed > 0.5) I.t = total;
    const r = this.introRig!;
    const me = g.me;
    const book = this.book!;
    if (I.t < INTRO_SECONDS) {
      const s = I.shot(I.t);
      r.pos.set(...s.pos);
      r.look.set(...s.look);
      r.fov = s.fov;
      if (me !== null) book.hold(me, I.rider, I.yaw, 0, -1, dt);
    } else {
      const t = I.t - INTRO_SECONDS;
      r.pos.copy(I.eyes.pos);
      r.look.copy(I.eyes.look);
      r.fov = READ_FOV;
      if (t < P.tossAt) {
        // Which spread, and how far through turning to it
        let k = 0;
        while (k < P.flips.length && P.flips[k]! <= t) k++;
        const since = k > 0 ? t - P.flips[k - 1]! : Infinity;
        const turning = since < FLIP_SECONDS ? since / FLIP_SECONDS : -1;
        if (me !== null) book.hold(me, I.rider, I.yaw, k, turning, dt);
      } else if (me !== null) book.toss(me, I.rider, I.yaw, t - P.tossAt, dt);
      if (t >= P.pullAt) {
        // Pull back out of their head to the whole rider (the game
        // camera's pose), still reading; then they chuck it
        const u = Math.min(1, (t - P.pullAt) / (P.pullEnd - P.pullAt));
        const e = u * u * (3 - 2 * u);
        r.pos.copy(I.eyes.pos).lerp(I.play.pos, e);
        r.look.copy(I.eyes.look).lerp(I.play.look, e);
        r.fov = READ_FOV + (FOOT_FOV - READ_FOV) * e;
      }
    }
    // (dev: look at the scene from elsewhere while it plays)
    const dev = import.meta.env.DEV
      ? (window as { __campCam?: { pos: V3; look: V3 } }).__campCam
      : undefined;
    if (dev !== undefined) {
      r.pos.set(...dev.pos);
      r.look.set(...dev.look);
    }
    g.cam.rig = r;
    this.hideHead(dev === undefined && I.t < total ? r.pos : null);
    if (I.t >= total) this.endIntro();
  }

  private readonly headBox = new THREE.Box3();
  private headHidden: THREE.Object3D | null = null;
  /**
   * First person: the whole rider is hidden only while the camera's inside
   * their head. Going in, the face (or the side of the head) fills the
   * frame as the camera reaches it, and from inside a head draws nothing
   * (its faces point out), so there's no pop either way.
   */
  private hideHead(cam: THREE.Vector3 | null) {
    const me = this.game.me;
    const h = me?.head ?? null;
    const root = me?.root ?? null;
    const hide = cam !== null && h !== null && this.headBox.setFromObject(h).containsPoint(cam);
    if (this.headHidden !== null && (this.headHidden !== root || !hide)) {
      this.headHidden.visible = true;
      this.headHidden = null;
    }
    if (hide && root !== null) {
      root.visible = false;
      this.headHidden = root;
    }
  }

  private skipIntro = () => {
    const I = this.intro;
    if (I !== null && I.t > 0.3) I.t = INTRO_SECONDS + I.plan.endAt;
  };

  private endIntro() {
    const g = this.game;
    const I = this.intro;
    this.intro = null;
    if (I !== null) this.book?.drop(g.me, I.rider, I.yaw);
    if (g.cam.rig === this.introRig) g.cam.rig = null;
    g.cam.fov = FOOT_FOV;
    this.hideHead(null);
    for (const ev of ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const)
      window.removeEventListener(ev, this.skipIntro, { capture: true });
    this.view_ = { ...this.view_, intro: false };
    for (const l of this.listeners) l();
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
   * The printed things (book pages, whiteboard, posters) read a touch
   * self-lit. Set after the time-of-day scan has run (Game.start), so they
   * never count as lamps or windows to light up at night.
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
        m.emissive.setHex(0x4a4642);
        m.emissiveMap = m.map;
      } else return;
      m.needsUpdate = true;
    });
  }

  /**
   * Indoors light, like the pocket rooms': the room sits in the tower's own
   * shadow and the low sun only reaches in at the window, so while you're
   * inside the sky light warms and brightens (uniforms only: no relink).
   * Eased in and out; whatever time of day sets meanwhile is kept.
   */
  private ambient(dt: number) {
    const s = this.site!;
    const h = this.game.gfx.hemi;
    const p = this.game.player.pos;
    // (during the opening shot only once the camera's nearly in: the city it
    // flies over keeps its own light)
    const shooting = this.intro !== null && this.intro.t < INTRO_SECONDS * 0.72;
    const want = inCamp(s, p.x, p.y, p.z, 0.3) && !shooting ? 1 : 0;
    const A = this.amb;
    if (want === 0 && A.k === 0) return;
    // Someone else (time of day) set the light since we last did: that's the new base
    if (A.k === 0 || h.intensity !== A.wrote || !h.color.equals(A.wroteSky)) {
      A.base = h.intensity;
      A.sky.copy(h.color);
      A.ground.copy(h.groundColor);
    }
    A.k = want > A.k ? Math.min(1, A.k + dt / 0.6) : Math.max(0, A.k - dt / 0.6);
    const k = A.k * A.k * (3 - 2 * A.k);
    h.intensity = A.base * (1 + 1.5 * k);
    h.color.copy(A.sky).lerp(WARM_SKY, 0.55 * k);
    h.groundColor.copy(A.ground).lerp(WARM_GROUND, 0.7 * k);
    A.wrote = h.intensity;
    A.wroteSky.copy(h.color);
  }

  private amb = {
    k: 0,
    base: 1,
    wrote: NaN,
    sky: new THREE.Color(),
    ground: new THREE.Color(),
    wroteSky: new THREE.Color(),
  };

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
    if (this.intro !== null) this.endIntro();
    this.birds?.dispose();
    this.book?.dispose();
    this.releaseCull();
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

const emptyBox = (): Aabb => ({ minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 });
const _b = new THREE.Box3();

/** A cull item's world box, retaken only when it has moved. */
function boxOf(it: CullItem): Aabb {
  const e = it.o.matrixWorld.elements;
  const k = it.key;
  if (k[0] !== e[12] || k[1] !== e[13] || k[2] !== e[14] || k[3] !== e[0]) {
    k[0] = e[12]!;
    k[1] = e[13]!;
    k[2] = e[14]!;
    k[3] = e[0]!;
    _b.copy(it.local).applyMatrix4(it.o.matrixWorld);
    const b = it.box;
    b.minX = _b.min.x;
    b.minY = _b.min.y;
    b.minZ = _b.min.z;
    b.maxX = _b.max.x;
    b.maxY = _b.max.y;
    b.maxZ = _b.max.z;
  }
  return it.box;
}
