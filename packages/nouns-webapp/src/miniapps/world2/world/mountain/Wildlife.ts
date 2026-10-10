// ── Wild things on the mountain (chunk decorator + per-frame life) ──────
//
// Per near chunk (MountainStream props), deterministically from the chunk
// coordinates + MOUNTAIN.seed:
//   • 0–8 procedural creatures (Creatures.ts), one seed each, in 1–2 loose
//     herds well off the lines → ONE BatchedMesh (body / head / limb sets as
//     instances, animated by instance matrices only).
//   • Hill houses + oddities (wildSites.ts plans, Oddities.ts builds) → ONE
//     merged mesh, plus a tiny mesh per moving bit (windmill sails, duck).
// So a chunk adds 0–3 draw calls. Domes and big solid oddities collide;
// creatures never do (nothing out here can bail you at 200 km/h).
//
// Life (update, once per frame): creatures wander their patch, graze, bob,
// turn their heads toward a rider within ~40 m and scarper (hop, scuttle,
// fly) when one comes within ~22 m — always away from the lines. Only herds
// within ANIM_FAR of the camera and in view are animated; herds past
// HIDE_FAR aren't drawn at all. A name tag ("Wobbly Grumplet") floats over
// the nearest creature when you're close. Animation is local (Math.random):
// what's seeded — and so the same for every player — is what lives where.

import type { ChunkContext, ChunkDecoration, ChunkDecorator } from './MountainStream';
import type { Quality } from '../../render/Graphics';

import * as THREE from 'three';

import { inkExcluded, toonify } from '../../render/Toon';

import { wrapAngle } from './config';
import { makeCreature, type CreatureDef } from './Creatures';
import { mountainDressing, mountainTerrainQuery } from './DressingDecorator';
import { Rand, hash3i } from './dressingUtil';
import { type WaterField } from './DressingWater';
import { CHUNK } from './MountainStream';
import { buildSite, type Spinner } from './Oddities';
import { MOUNTAIN, terrainHeight } from './terrain';
import { GeoBuilder } from './wildGeo';
import { chunkSites, chunkWater, installWildSites, wildKeepOut } from './wildSites';

/** Rider distances (m): look at them / run away. */
const ALERT_R = 40;
const FLEE_R = 22;
/** Camera distance (m, to the chunk's box): animate within / draw within. */
const ANIM_FAR = 150;
const HIDE_FAR = 300;
/** Name tag shows within this distance of the local rider. */
const TAG_R = 15;
/** Creatures stay this far (m) from a line's centre. */
const LINE_CLEAR = MOUNTAIN.trackHalf + 9;
const SPAWN_CLEAR = MOUNTAIN.trackHalf + 16;
const SALT = 0x63726974;

type Mood = 'idle' | 'graze' | 'walk' | 'flee';

interface Critter {
  def: CreatureDef;
  /** BatchedMesh instance ids: body, head, limb A, limb B (−1 = none). */
  ids: [number, number, number, number];
  /** Chunk-local position, home, target. */
  x: number;
  z: number;
  y: number;
  hx: number;
  hz: number;
  tx: number;
  tz: number;
  yaw: number;
  mood: Mood;
  timer: number;
  /** Gait phase (rad) + current ground speed (m/s). */
  phase: number;
  speed: number;
  headYaw: number;
  headPitch: number;
  /** Height above the ground (birds flying off, blobs mid-hop). */
  air: number;
  /** Seconds before it'll bolt again. */
  calm: number;
  wave: number;
}

interface Herd {
  origin: THREE.Vector3;
  size: number;
  /** World-space bounds (frustum test). */
  sphere: THREE.Sphere;
  mesh: THREE.BatchedMesh | null;
  critters: Critter[];
  spinners: { obj: THREE.Mesh; s: Spinner; t: number }[];
  ponds: { x: number; z: number; r: number }[];
  /** Streams + ponds (world space), to keep paws dry. */
  water: WaterField | null;
}

export interface WildlifeStats {
  herds: number;
  creatures: number;
  sites: number;
  animated: number;
  /** Draw calls + triangles the wild layer adds, per populated chunk. */
  draws: number;
  tris: number;
  /** Chunks built so far + build time (ms): total / worst. */
  built: number;
  buildMs: number;
  maxBuildMs: number;
}

const _m0 = new THREE.Matrix4();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();

let material: THREE.MeshStandardMaterial | null = null;
function wildMaterial(): THREE.MeshStandardMaterial {
  if (material === null) {
    material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    material.name = 'MountainWild';
  }
  return material;
}

function disposeDef(d: CreatureDef) {
  d.body.dispose();
  d.head.dispose();
  d.limbs[0]?.dispose();
  d.limbs[1]?.dispose();
}

/** Shear legs about the hip line: z += k·y (feet swing, hips stay put), then lift. */
function legMatrix(out: THREE.Matrix4, k: number, lift: number) {
  return out.set(1, 0, 0, 0, 0, lift, 0, 0, 0, k, 1, 0, 0, 0, 0, 1);
}

export class Wildlife {
  /** Scene-level bits (the name tag). */
  readonly group = new THREE.Group();
  readonly stats: WildlifeStats = {
    herds: 0,
    creatures: 0,
    sites: 0,
    animated: 0,
    draws: 0,
    tris: 0,
    built: 0,
    buildMs: 0,
    maxBuildMs: 0,
  };
  private herds = new Set<Herd>();
  private tag: THREE.Sprite;
  private tagCanvas: HTMLCanvasElement;
  private tagTex: THREE.CanvasTexture;
  private tagName = '';
  private time = 0;

  constructor(private quality: Quality) {
    this.group.name = 'mountain-wild';
    installWildSites(mountainDressing(quality));
    this.tagCanvas = document.createElement('canvas');
    this.tagCanvas.width = 512;
    this.tagCanvas.height = 96;
    this.tagTex = new THREE.CanvasTexture(this.tagCanvas);
    this.tagTex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: this.tagTex,
      transparent: true,
      depthWrite: false,
    });
    this.tag = new THREE.Sprite(mat);
    this.tag.name = 'wild-nametag';
    this.tag.scale.set(3.6, 0.675, 1);
    this.tag.visible = false;
    this.tag.renderOrder = 10;
    this.group.add(this.tag);
    inkExcluded.add(this.tag);
  }

  /** ChunkDecorator for MountainStream.addDecorator(). */
  decorator(): ChunkDecorator {
    return { id: 'wild', populate: ctx => this.populate(ctx) };
  }

  private populate(ctx: ChunkContext): ChunkDecoration | null {
    const t0 = performance.now();
    const ox = ctx.origin.x;
    const oz = ctx.origin.z;
    const size = ctx.size;
    const root = new THREE.Group();
    root.name = 'mountain-wild';
    const owned: { dispose(): void }[] = [];
    let draws = 0;
    let tris = 0;

    // ── Houses + oddities ──
    const sites = chunkSites(ctx.ix, ctx.iz);
    const b = new GeoBuilder();
    const spins: Spinner[] = [];
    for (const s of sites) buildSite(b, s, ox, oz, spins);
    let collision: THREE.BufferGeometry | undefined;
    if (!b.empty) {
      const geo = b.build();
      const mesh = new THREE.Mesh(geo, wildMaterial());
      mesh.name = 'wild-sites';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
      owned.push(geo);
      draws++;
      tris += (geo.index?.count ?? 0) / 3;
      collision = b.buildCollider() ?? undefined;
      if (collision !== undefined) owned.push(collision);
    }
    const spinners: Herd['spinners'] = [];
    for (const s of spins) {
      const obj = new THREE.Mesh(s.geo, wildMaterial());
      obj.name = `wild-${s.kind}`;
      obj.position.set(s.x, s.y, s.z);
      obj.rotation.y = s.yaw;
      obj.castShadow = true;
      root.add(obj);
      owned.push(s.geo);
      spinners.push({ obj, s, t: Math.random() * 10 });
      draws++;
      tris += (s.geo.index?.count ?? 0) / 3;
    }

    // ── Creatures ──
    const water = chunkWater(ctx.ix, ctx.iz);
    const rnd = new Rand(Math.floor(hash3i(ctx.ix, ctx.iz, 3, SALT ^ MOUNTAIN.seed) * 4294967296));
    const roll = rnd.next();
    const groups = roll < 0.3 ? 0 : roll < 0.8 ? 1 : 2;
    const maxN = this.quality === 'low' ? 3 : 8;
    const defs: { def: CreatureDef; x: number; z: number; yaw: number }[] = [];
    for (let g = 0; g < groups && defs.length < maxN; g++) {
      const n = 1 + Math.floor(rnd.next() * 4);
      let cx = 0;
      let cz = 0;
      let found = false;
      for (let t = 0; t < 10 && !found; t++) {
        cx = ox + 12 + rnd.next() * (size - 24);
        cz = oz + 12 + rnd.next() * (size - 24);
        found = this.okSpot(cx, cz, SPAWN_CLEAR, water?.field.dist(cx, cz) ?? 16);
      }
      if (!found) continue;
      const first = defs.length;
      for (let i = 0; i < n && defs.length < maxN; i++) {
        const seed = Math.floor(hash3i(ctx.ix * 8 + g, ctx.iz * 8 + i, 5, SALT) * 4294967296);
        const a = rnd.next() * Math.PI * 2;
        const d = i === 0 ? 0 : rnd.range(4, 10);
        const yaw = rnd.next() * Math.PI * 2;
        const def = makeCreature(seed);
        // Push out until it doesn't stand inside a herd-mate (giants need room)
        let x = cx + Math.sin(a) * d;
        let z = cz + Math.cos(a) * d;
        for (let t = 0; t < 4; t++) {
          const hit = defs
            .slice(first)
            .find(
              o => Math.hypot(o.x + ox - x, o.z + oz - z) < (o.def.scale + def.scale) * 1.1 + 1,
            );
          if (hit === undefined) break;
          x += Math.sin(a) * (def.scale + 2);
          z += Math.cos(a) * (def.scale + 2);
        }
        if (!this.okSpot(x, z, SPAWN_CLEAR - 3, water?.field.dist(x, z) ?? 16)) {
          disposeDef(def);
          continue;
        }
        defs.push({ def, x: x - ox, z: z - oz, yaw });
      }
    }
    let mesh: THREE.BatchedMesh | null = null;
    const critters: Critter[] = [];
    if (defs.length > 0) {
      let nv = 0;
      let ni = 0;
      let inst = 0;
      const partsOf = (d: CreatureDef) => [d.body, d.head, d.limbs[0], d.limbs[1]];
      for (const { def } of defs) {
        for (const g of partsOf(def)) {
          if (g === null) continue;
          nv += g.attributes.position.count;
          ni += g.index?.count ?? 0;
          inst++;
        }
      }
      const bm = new THREE.BatchedMesh(inst, nv, ni, wildMaterial());
      mesh = bm;
      mesh.name = 'wild-creatures';
      mesh.sortObjects = false;
      mesh.perObjectFrustumCulled = true;
      // Instances move: per-instance culling only (the whole-mesh sphere would go stale)
      mesh.frustumCulled = false;
      mesh.castShadow = this.quality !== 'low';
      mesh.receiveShadow = true;
      for (const { def, x, z, yaw } of defs) {
        const ids: Critter['ids'] = [-1, -1, -1, -1];
        partsOf(def).forEach((g, k) => {
          if (g === null) return;
          ids[k] = bm.addInstance(bm.addGeometry(g));
          tris += (g.index?.count ?? 0) / 3;
          g.dispose();
        });
        const c: Critter = {
          def,
          ids,
          x,
          z,
          y: terrainHeight(x + ox, z + oz),
          hx: x,
          hz: z,
          tx: x,
          tz: z,
          yaw,
          mood: 'idle',
          timer: Math.random() * 3,
          phase: Math.random() * 6,
          speed: 0,
          headYaw: 0,
          headPitch: 0,
          air: 0,
          calm: 0,
          wave: 0,
        };
        critters.push(c);
        this.pose(bm, c);
      }
      root.add(mesh);
      owned.push(mesh);
      draws++;
    }
    const ms = performance.now() - t0;
    this.stats.built++;
    this.stats.buildMs += ms;
    this.stats.maxBuildMs = Math.max(this.stats.maxBuildMs, ms);
    if (root.children.length === 0) return null;
    if (ctx.toon) toonify(root);
    root.updateMatrixWorld(true);

    const herd: Herd = {
      origin: ctx.origin.clone(),
      size,
      sphere: new THREE.Sphere(
        new THREE.Vector3(
          ox + size / 2,
          terrainHeight(ox + size / 2, oz + size / 2),
          oz + size / 2,
        ),
        size * 0.8,
      ),
      mesh,
      critters,
      spinners,
      ponds: (water?.ponds ?? []).map(p => ({ x: p.x - ox, z: p.z - oz, r: p.r })),
      water: water?.field ?? null,
    };
    this.herds.add(herd);
    this.stats.herds = this.herds.size;
    this.stats.creatures += critters.length;
    this.stats.sites += sites.length;
    this.stats.draws += draws;
    this.stats.tris += tris;
    // (debug / tests: what this chunk holds and what it costs)
    root.userData.wild = {
      draws,
      tris,
      creatures: critters.length,
      sites: sites.map(s => ({ kind: s.kind, x: s.x, y: s.y, z: s.z, r: s.r, yaw: s.yaw })),
    };
    let disposed = false;
    return {
      object: root,
      collision,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.herds.delete(herd);
        this.stats.herds = this.herds.size;
        this.stats.creatures -= critters.length;
        this.stats.sites -= sites.length;
        this.stats.draws -= draws;
        this.stats.tris -= tris;
        root.removeFromParent();
        for (const o of owned) o.dispose();
        root.clear();
      },
    };
  }

  /** World (x, z) a creature may stand on: off the lines, dry, unblocked, not in a house. */
  private okSpot(x: number, z: number, clear: number, waterDist: number): boolean {
    const T = mountainTerrainQuery;
    if (waterDist < 2) return false;
    if (T.trackDist(x, z) < clear) return false;
    if (T.blocked?.(x, z) === true) return false;
    return !wildKeepOut(x, z);
  }

  /**
   * Animate creatures near `camera` (once per frame). `riders` are world
   * positions: the local player first (the name tag follows them), then
   * any remote riders.
   */
  update(dt: number, camera: THREE.Camera, riders: readonly THREE.Vector3[]) {
    if (this.herds.size === 0) {
      this.tag.visible = false;
      return;
    }
    dt = Math.min(dt, 0.1);
    this.time += dt;
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    const cx = camera.matrixWorld.elements[12];
    const cz = camera.matrixWorld.elements[14];
    const me = riders.length > 0 ? riders[0] : null;
    let tagC: Critter | null = null;
    let tagH: Herd | null = null;
    let tagD = TAG_R;
    let animated = 0;
    for (const h of this.herds) {
      const ox = h.origin.x;
      const oz = h.origin.z;
      const dx = Math.max(ox - cx, 0, cx - (ox + h.size));
      const dz = Math.max(oz - cz, 0, cz - (oz + h.size));
      const d = Math.hypot(dx, dz);
      const far = this.quality === 'low' ? HIDE_FAR * 0.7 : HIDE_FAR;
      if (h.mesh !== null) h.mesh.visible = d < far;
      if (d > ANIM_FAR * 2.5 || !_frustum.intersectsSphere(h.sphere)) continue;
      for (const sp of h.spinners) {
        sp.t += dt;
        if (sp.s.kind === 'spin') sp.obj.rotation.z += dt * sp.s.speed;
        else {
          sp.obj.position.y = sp.s.y + Math.sin(sp.t * sp.s.speed) * 0.08;
          sp.obj.rotation.z = Math.sin(sp.t * sp.s.speed * 0.7) * 0.06;
          sp.obj.rotation.y = sp.s.yaw + Math.sin(sp.t * 0.13) * 0.8;
        }
      }
      if (h.mesh === null || d > ANIM_FAR) continue;
      for (const c of h.critters) {
        this.tick(h, c, dt, riders);
        this.pose(h.mesh, c);
        animated++;
        if (me !== null) {
          const md = Math.hypot(ox + c.x - me.x, oz + c.z - me.z);
          if (md < tagD) {
            tagD = md;
            tagC = c;
            tagH = h;
          }
        }
      }
    }
    this.stats.animated = animated;
    this.updateTag(tagC, tagH, tagD);
  }

  private tick(h: Herd, c: Critter, dt: number, riders: readonly THREE.Vector3[]) {
    const ox = h.origin.x;
    const oz = h.origin.z;
    const wx = ox + c.x;
    const wz = oz + c.z;
    // Nearest rider
    let rd = Infinity;
    let rx = 0;
    let rz = 0;
    for (const p of riders) {
      const d = Math.hypot(p.x - wx, p.z - wz);
      if (d < rd) {
        rd = d;
        rx = p.x;
        rz = p.z;
      }
    }
    c.calm = Math.max(0, c.calm - dt);
    // Big beasts are braver
    const fleeR = FLEE_R * (c.def.scale > 1.9 ? 0.55 : 1);
    if (rd < fleeR && c.mood !== 'flee' && c.calm <= 0) this.bolt(h, c, rx - ox, rz - oz);
    const def = c.def;
    let want = 0;
    let turnRate = 2.5;
    switch (c.mood) {
      case 'idle':
      case 'graze':
        c.timer -= dt;
        if (c.timer <= 0) {
          if (c.mood === 'idle' && def.grazes && Math.random() < 0.45) {
            c.mood = 'graze';
            c.timer = 2 + Math.random() * 4;
          } else if (Math.random() < 0.6) {
            this.wander(h, c);
          } else {
            c.mood = 'idle';
            c.timer = 1.5 + Math.random() * 3.5;
          }
        }
        break;
      case 'walk':
        want = def.walk;
        break;
      case 'flee':
        want = def.run;
        turnRate = 9;
        c.timer -= dt;
        if (c.timer <= 0) this.rest(c);
        break;
    }
    // Head toward the target, then go
    if (c.mood === 'walk' || c.mood === 'flee') {
      const dx = c.tx - c.x;
      const dz = c.tz - c.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.4) {
        this.rest(c);
        want = 0;
      } else {
        const turn = wrapAngle(Math.atan2(dx, dz) - c.yaw);
        c.yaw += Math.sign(turn) * Math.min(Math.abs(turn), turnRate * dt);
        want *= Math.max(0.15, Math.cos(turn));
      }
    }
    c.speed += (want - c.speed) * Math.min(1, dt * (c.mood === 'flee' ? 6 : 2.5));
    if (c.speed > 0.01) {
      c.x += Math.sin(c.yaw) * c.speed * dt;
      c.z += Math.cos(c.yaw) * c.speed * dt;
      c.y = terrainHeight(ox + c.x, oz + c.z);
    }
    // Gait phase: about one stride per leg length
    const stride = Math.max(0.35, def.legLen * 1.8 + 0.3);
    const rate = def.gait === 'scuttle' ? 2.2 : def.gait === 'hop' ? 0.8 : 1;
    c.phase += ((c.speed / stride) * Math.PI * 2 * rate + (c.speed < 0.05 ? 0 : 1.5)) * dt;
    // Birds take off when spooked; everything else stays on the ground
    const flying = def.plan === 'bird' && c.mood === 'flee';
    c.air += ((flying ? 2.5 + def.scale : 0) - c.air) * Math.min(1, dt * (flying ? 2 : 1.2));
    // Head: look at a rider in range, else graze / idle glances
    let hy = Math.sin(this.time * 0.6 + def.seed) * 0.35;
    let hp = Math.sin(this.time * 0.9 + def.seed * 0.7) * 0.06;
    if (rd < ALERT_R && c.mood !== 'flee') {
      hy = Math.max(-1.2, Math.min(1.2, wrapAngle(Math.atan2(rx - wx, rz - wz) - c.yaw)));
      hp = -0.12;
      // Blobs wave at you
      c.wave = Math.min(1, c.wave + dt * 2);
    } else {
      c.wave = Math.max(0, c.wave - dt);
      if (c.mood === 'graze') hp = 0.75 + Math.sin(this.time * 7 + def.seed) * 0.06;
    }
    const k = Math.min(1, dt * 6);
    c.headYaw += (hy - c.headYaw) * k;
    c.headPitch += (hp - c.headPitch) * k;
  }

  /** Pick a stroll target near home, clear of the lines and ponds. */
  private wander(h: Herd, c: Critter) {
    for (let t = 0; t < 4; t++) {
      const a = Math.random() * Math.PI * 2;
      const d = 2 + Math.random() * 9;
      const x = c.hx + Math.sin(a) * d;
      const z = c.hz + Math.cos(a) * d;
      if (!this.walkable(h, x, z) || !this.walkable(h, (x + c.x) / 2, (z + c.z) / 2)) continue;
      c.tx = x;
      c.tz = z;
      c.mood = 'walk';
      return;
    }
    c.mood = 'idle';
    c.timer = 2;
  }

  /** Scarper: away from the rider at (lx, lz) (chunk-local), never toward a line. */
  private bolt(h: Herd, c: Critter, lx: number, lz: number) {
    const away = Math.atan2(c.x - lx, c.z - lz);
    const d = 9 + Math.random() * 7 + c.def.run;
    for (const off of [0, 0.6, -0.6, 1.2, -1.2, 2.0, -2.0]) {
      const a = away + off + (Math.random() - 0.5) * 0.3;
      const x = c.x + Math.sin(a) * d;
      const z = c.z + Math.cos(a) * d;
      if (!this.walkable(h, x, z) || !this.walkable(h, (x + c.x) / 2, (z + c.z) / 2)) continue;
      c.tx = x;
      c.tz = z;
      c.mood = 'flee';
      c.timer = 4;
      c.calm = 6;
      // Shift home along, so it settles where it ran to
      c.hx = x;
      c.hz = z;
      return;
    }
    // Cornered: freeze for a bit
    c.mood = 'idle';
    c.timer = 2;
    c.calm = 3;
  }

  private rest(c: Critter) {
    c.mood = 'idle';
    c.timer = 1 + Math.random() * 3;
  }

  private walkable(h: Herd, x: number, z: number): boolean {
    // Stay in this chunk's patch (a little over the edge is fine)
    if (x < -10 || z < -10 || x > h.size + 10 || z > h.size + 10) return false;
    for (const p of h.ponds) if (Math.hypot(p.x - x, p.z - z) < p.r + 1) return false;
    const wx = h.origin.x + x;
    const wz = h.origin.z + z;
    if (h.water !== null && h.water.dist(wx, wz) < 2) return false;
    if (mountainTerrainQuery.trackDist(wx, wz) < LINE_CLEAR) return false;
    return mountainTerrainQuery.blocked?.(wx, wz) !== true;
  }

  /** Write the creature's four instance matrices. */
  private pose(mesh: THREE.BatchedMesh, c: Critter) {
    const def = c.def;
    const moving = Math.min(1, c.speed / Math.max(0.3, def.walk * 0.6));
    const run = Math.min(1, c.speed / Math.max(1, def.run * 0.7));
    const ph = c.phase;
    const sn = Math.sin(ph);
    let bob = 0;
    let roll = 0;
    let pitch = 0;
    let squash = 1 + Math.sin(this.time * 2.2 + def.seed) * 0.02;
    switch (def.gait) {
      case 'walk':
        bob = Math.abs(Math.cos(ph)) * 0.05 * def.scale * moving;
        pitch = -0.08 * run;
        break;
      case 'waddle':
        bob = Math.abs(Math.cos(ph)) * 0.06 * def.scale * moving;
        roll = sn * 0.14 * moving;
        break;
      case 'scuttle':
        bob = Math.abs(Math.sin(ph * 2)) * 0.02 * def.scale * moving;
        break;
      case 'hop': {
        const hop = Math.max(0, sn);
        bob = hop * (0.25 + run * 0.45) * def.scale * moving;
        squash *= 1 + (hop - 0.4) * 0.18 * moving;
        pitch = -0.1 * moving;
        break;
      }
    }
    _e.set(pitch, c.yaw, roll, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(c.x, c.y + bob + c.air, c.z);
    _m0.compose(_p, _q, _s.set(1, 1, 1));
    // Body (squash and stretch about the ground)
    _m1.makeScale(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    _m2.multiplyMatrices(_m0, _m1);
    mesh.setMatrixAt(c.ids[0], _m2);
    // Head
    _e.set(c.headPitch, c.headYaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.copy(def.neck);
    _p.y *= squash;
    _m1.compose(_p, _q, _s.set(1, 1, 1));
    _m2.multiplyMatrices(_m0, _m1);
    mesh.setMatrixAt(c.ids[1], _m2);
    // Limbs
    for (let k = 0; k < 2; k++) {
      const id = c.ids[2 + k];
      if (id < 0) continue;
      const pv = def.pivots[k];
      const side = k === 0 ? 1 : -1;
      if (def.limbKind === 'leg') {
        const swing = (0.35 + run * 0.4) * moving;
        const s = k === 0 ? sn : -sn;
        const lift = 1 - 0.18 * Math.max(0, k === 0 ? Math.cos(ph) : -Math.cos(ph)) * moving;
        legMatrix(_m1, s * swing, lift);
        _m1.setPosition(pv.x, pv.y * squash, pv.z);
      } else {
        // Wings / arms: flap when flying, flutter on the hop, wave when alert
        const flying = c.air > 0.3;
        let a = Math.sin(this.time * 2 + def.seed) * 0.06;
        if (def.plan === 'bird') {
          if (flying) a = 0.2 + Math.sin(this.time * 16) * 0.9;
          else a += Math.max(0, sn) * 0.5 * moving;
        } else {
          a += c.wave * (0.9 + Math.sin(this.time * 9) * 0.5) * (k === 0 ? 1 : 0.15);
          a += Math.max(0, sn) * 0.4 * moving;
        }
        _m1.makeRotationZ(a * side);
        _m1.setPosition(pv.x, pv.y * squash, pv.z);
      }
      _m2.multiplyMatrices(_m0, _m1);
      mesh.setMatrixAt(id, _m2);
    }
  }

  private updateTag(c: Critter | null, h: Herd | null, d: number) {
    if (c === null || h === null || h.mesh === null || !h.mesh.visible) {
      this.tag.visible = false;
      return;
    }
    if (c.def.name !== this.tagName) {
      this.tagName = c.def.name;
      this.drawTag(this.tagName);
    }
    this.tag.visible = true;
    this.tag.position.set(h.origin.x + c.x, c.y + c.air + c.def.top + 0.7, h.origin.z + c.z);
    const m = this.tag.material;
    m.opacity = Math.min(1, (TAG_R - d) / 3);
  }

  private drawTag(name: string) {
    const cv = this.tagCanvas;
    const g = cv.getContext('2d');
    if (g === null) return;
    g.clearRect(0, 0, cv.width, cv.height);
    g.font = 'bold 44px system-ui, -apple-system, Segoe UI, sans-serif';
    const w = Math.min(cv.width - 8, g.measureText(name).width + 48);
    const x0 = (cv.width - w) / 2;
    g.fillStyle = 'rgba(20, 18, 28, 0.78)';
    g.beginPath();
    g.roundRect(x0, 10, w, 76, 38);
    g.fill();
    g.fillStyle = '#fff6d8';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name, cv.width / 2, 50, cv.width - 40);
    this.tagTex.needsUpdate = true;
  }

  /** Planned sites within `rad` chunks of world (x, z) — built or not (tests / debugging). */
  plannedSites(x: number, z: number, rad: number) {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const out: { kind: string; x: number; y: number; z: number; r: number; yaw: number }[] = [];
    for (let j = -rad; j <= rad; j++)
      for (let i = -rad; i <= rad; i++)
        for (const s of chunkSites(cx + i, cz + j))
          out.push({ kind: s.kind, x: s.x, y: s.y, z: s.z, r: s.r, yaw: s.yaw });
    return out;
  }

  /** Every creature currently alive (tests / debugging). */
  creatures() {
    const out: {
      name: string;
      plan: string;
      x: number;
      y: number;
      z: number;
      yaw: number;
      top: number;
      mood: Mood;
    }[] = [];
    for (const h of this.herds)
      for (const c of h.critters)
        out.push({
          name: c.def.name,
          plan: c.def.plan,
          x: h.origin.x + c.x,
          y: c.y + c.air,
          z: h.origin.z + c.z,
          yaw: c.yaw,
          top: c.def.top,
          mood: c.mood,
        });
    return out;
  }

  dispose() {
    this.group.removeFromParent();
    inkExcluded.delete(this.tag);
    this.tag.material.dispose();
    this.tagTex.dispose();
    this.herds.clear();
  }
}
