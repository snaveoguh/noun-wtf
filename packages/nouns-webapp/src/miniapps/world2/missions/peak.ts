// ── The Big Drop: a 1,000 km snow peak behind the deepest door ──────────
//
// A per-player dimension, like the Upside Down it replaced: through the door
// you're stood on the summit pad of peakTerrain.ts's mountain, the city
// gone. While inside:
//   - the rider rides the peak's analytic surface (the player's terrain and
//     the collision world's terrain are swapped for it);
//   - gravity at 40% with no ceiling (huge, floaty airs) and a fraction of
//     the air drag, so the 49° fall line builds speed fast and keeps going;
//   - a camera-centred terrain mesh, rebuilt as you move (no chunks to keep
//     up with at thousands of km/h); the sky, sun, fog, snowfall and wind are
//     the atmosphere system's (bigdrop/scenery/atmosphere.ts);
//   - a floating origin: every few km the world is recentred under you, so
//     nothing on the GPU ever sees numbers that big (a skinned rider 1,000 km
//     out would shake by 6 cm otherwise). The peak sits ALT m above the
//     city's coordinates, so nothing down there ever notices you;
//   - other riders are hidden, and nothing counts (stats suspended, and on
//     the way out you stop dead with the combo, speed and streak reset).
// Everything it changes is saved on the way in and put back on the way out,
// and you come back out where you went in, by the door.

import type { Game } from '../Game';
import type { TerrainCollider } from '../physics/Collision';
import type { PlayerTerrain } from '../skate/Player';
import type { PeakCtx, PeakSystem } from './bigdrop/contract';

import * as THREE from 'three';

import { toToon } from '../render/Toon';
import { createCombo } from '../skate/Tricks';

import { ALT } from './bigdrop/contract';
import { snowColor } from './bigdrop/surface';
import { PEAK_SYSTEMS } from './bigdrop/systems';
import { type GridSampler, GridMesh } from './peakGrid';
import { PEAK_LIPSCHITZ, peakHeight, peakNormal, raycastHeight } from './peakTerrain';

/** Gravity scale inside (of the player's own tuning). */
export const PEAK_GRAVITY = 0.4;
/** Air drag scale inside: the fall line has to feel like one. */
const PEAK_DRAG = 0.15;
/** Recentre once the rider is this far from the origin (m)… */
const REBASE = 3000;
/** …on the ground, or anywhere past this. */
const REBASE_FORCE = 8000;
/** Recentring steps (m), so the summit always lands on round numbers. */
const STEP = 1000;
/**
 * Terrain: a fine NEAR grid rebuilt every frame and a coarse FAR grid out to
 * the fog, rebuilt a few rows a frame into a spare mesh (peakGrid.ts).
 * Vertices per side by quality, centre spacing (m) and reach (m).
 */
const NEAR_N = { low: 49, medium: 61, high: 61 } as const;
const NEAR_S0 = 1.5;
const NEAR_EDGE = 400;
const FAR_N = { low: 81, medium: 101, high: 101 } as const;
const FAR_S0 = 10;
const GRID_EDGE = 7000;
/** Far grid rows per frame (a rebuild takes ~n·1.5 / this frames). */
const FAR_ROWS = 18;
/** Under the near grid the far one sinks out of sight. */
const FAR_HOLE = { half: NEAR_EDGE * 0.82, depth: 12 };
/** Re-centre the far grid once the camera is this far from its centre (m). */
const FAR_MOVE = 30;

interface Saved {
  fog: THREE.Scene['fog'];
  background: THREE.Scene['background'];
  skyVisible: boolean;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiColor: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  gravity: number;
  drag: number;
  filter: string;
  playerTerrain: Game['player']['terrain'];
  worldTerrain: TerrainCollider | null;
  softBounds: number;
  mountain: Game['player']['mountain'];
  homeSpots: Game['player']['homeSpots'];
  /** Where you went in (you come back out here). */
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  hidden: THREE.Object3D[];
  far: number;
}

export class Peak {
  active = false;
  /** The canvas filter inside (the door's cutscene eases into it): none. */
  readonly filter = '';
  /** Metres below the summit right now (the HUD). */
  depth = 0;
  private saved: Saved | null = null;
  /** Peak coordinates of the local point (0, ALT, 0). */
  private origin = new THREE.Vector3();
  private group = new THREE.Group();
  private near: GridMesh | null = null;
  /** The far grid on show, and the spare being rebuilt behind it. */
  private far: GridMesh | null = null;
  private farNext: GridMesh | null = null;
  private snowMat: THREE.Material | null = null;
  private readonly sampler: GridSampler = { height: peakHeight, color: snowColor };
  private lastRespawns = 0;
  /** The track, scenery, riders… (bigdrop/systems.ts), while inside. */
  private systems: PeakSystem[] = [];
  /** Colliders the systems added: id → geometry + its offset (peak coordinates). */
  private colliders = new Map<string, THREE.Vector3>();
  private riderPeak = new THREE.Vector3();
  private readonly ctx: PeakCtx;
  private readonly local: PlayerTerrain = {
    height: (x, z) => this.heightAt(x, z),
    inDomain: () => true,
    surface: () => null,
  };
  private readonly collider: TerrainCollider = {
    raycast: (ox, oy, oz, dx, dy, dz, far) =>
      raycastHeight(this.heightAt, PEAK_LIPSCHITZ, ox, oy, oz, dx, dy, dz, far),
    normal: (x, z, out) => peakNormal(x + this.origin.x, z + this.origin.z, out),
  };

  constructor(private game: Game) {
    this.group.name = 'BigDrop';
    // The context's getters (quality, depth) read live values off the dimension
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.ctx = {
      game,
      group: this.group,
      get quality() {
        return game.gfx.quality;
      },
      get toon() {
        return game.gfx.toon;
      },
      origin: this.origin,
      toLocal: (x, y, z, out) =>
        out.set(x - self.origin.x, y - self.origin.y + ALT, z - self.origin.z),
      toPeak: (x, y, z, out) =>
        out.set(x + self.origin.x, y + self.origin.y - ALT, z + self.origin.z),
      riderPeak: this.riderPeak,
      get depth() {
        return self.depth;
      },
      setCollider: (id, geometry, peakOffset) => {
        const key = `peak:${id}`;
        if (geometry === null) {
          game.world.setDynamic(key, null);
          self.colliders.delete(key);
          return;
        }
        const off = (peakOffset ?? new THREE.Vector3()).clone();
        self.colliders.set(key, off);
        game.world.setDynamic(
          key,
          geometry,
          self.ctx.toLocal(off.x, off.y, off.z, new THREE.Vector3()),
        );
      },
    };
  }

  /** Surface height at a local (x, z). */
  private heightAt = (x: number, z: number): number =>
    peakHeight(x + this.origin.x, z + this.origin.z) - this.origin.y + ALT;

  enter() {
    if (this.active) return;
    const g = this.game;
    const gfx = g.gfx;
    const p = g.player;
    const hidden: THREE.Object3D[] = [];
    const keep = new Set<THREE.Object3D>([gfx.sun, gfx.sun.target, g.particles.group]);
    if (g.me !== null) keep.add(g.me.root);
    for (const o of gfx.scene.children)
      if (o.visible && !keep.has(o) && !(o as THREE.Light).isLight && o !== gfx.sky) {
        o.visible = false;
        hidden.push(o);
      }
    this.saved = {
      fog: gfx.scene.fog,
      background: gfx.scene.background,
      skyVisible: gfx.sky.visible,
      sunColor: gfx.sun.color.clone(),
      sunIntensity: gfx.sun.intensity,
      hemiColor: gfx.hemi.color.clone(),
      hemiGround: gfx.hemi.groundColor.clone(),
      hemiIntensity: gfx.hemi.intensity,
      gravity: p.tuning.gravity,
      drag: p.tuning.drag,
      filter: gfx.renderer.domElement.style.filter,
      playerTerrain: p.terrain,
      worldTerrain: g.world.terrain,
      softBounds: p.softBounds,
      mountain: p.mountain,
      homeSpots: p.homeSpots,
      pos: p.pos.clone(),
      fwd: p.fwd.clone(),
      hidden,
      far: gfx.camera.far,
    };
    this.active = true;
    this.origin.set(0, 0, 0);
    g.stats.suspended = true;
    p.tuning.gravity = this.saved.gravity * PEAK_GRAVITY;
    p.tuning.drag = this.saved.drag * PEAK_DRAG;
    p.terrain = this.local;
    p.softBounds = Infinity;
    p.mountain = null;
    g.world.terrain = this.collider;
    g.cam.leadVertical = true;
    // R (and falling out) bring you back to the summit pad, facing +Z
    p.homeSpots = [{ pos: new THREE.Vector3(0, ALT + 0.05, 0), yaw: 0 }];
    p.respawnHome();
    this.lastRespawns = p.respawns;
    g.cam.snap(p);
    gfx.renderer.domElement.style.filter = '';
    // Never clip the terrain: its downhill corners are GRID_EDGE·√2 across
    // and ~1.15× that further down (~15 km away). It fogs out long before;
    // a clipped edge would show the sky through the fog
    gfx.camera.far = GRID_EDGE * 2.3;
    gfx.camera.updateProjectionMatrix();
    // Sky, sun + fill lights, fog, snowfall and wind: the atmosphere system
    this.buildTerrain();
    gfx.scene.add(this.group);
    this.riderPeak.set(
      p.pos.x + this.origin.x,
      p.pos.y + this.origin.y - ALT,
      p.pos.z + this.origin.z,
    );
    for (const make of PEAK_SYSTEMS)
      try {
        this.systems.push(make(this.ctx));
      } catch (err) {
        console.warn('[bigdrop] a system failed to start', err);
      }
  }

  exit() {
    if (!this.active || this.saved === null) return;
    const g = this.game;
    const gfx = g.gfx;
    const s = this.saved;
    const p = g.player;
    for (const sys of this.systems)
      try {
        sys.dispose();
      } catch (err) {
        console.warn('[bigdrop] a system failed to dispose', err);
      }
    this.systems = [];
    for (const key of this.colliders.keys()) g.world.setDynamic(key, null);
    this.colliders.clear();
    gfx.scene.remove(this.group);
    this.disposeGroup();
    this.group.clear();
    for (const o of s.hidden) o.visible = true;
    gfx.scene.fog = s.fog;
    gfx.scene.background = s.background;
    gfx.sky.visible = s.skyVisible;
    gfx.sun.color.copy(s.sunColor);
    gfx.sun.intensity = s.sunIntensity;
    gfx.hemi.color.copy(s.hemiColor);
    gfx.hemi.groundColor.copy(s.hemiGround);
    gfx.hemi.intensity = s.hemiIntensity;
    gfx.renderer.domElement.style.filter = s.filter;
    gfx.camera.far = s.far;
    gfx.camera.updateProjectionMatrix();
    p.tuning.gravity = s.gravity;
    p.tuning.drag = s.drag;
    p.terrain = s.playerTerrain;
    p.softBounds = s.softBounds;
    p.mountain = s.mountain;
    p.homeSpots = s.homeSpots;
    g.world.terrain = s.worldTerrain;
    g.cam.leadVertical = false;
    // Back out where you went in, by the door, with nothing carried over:
    // no session score or half-done combo, no speed and no streak
    p.safePos.copy(s.pos);
    p.safeFwd.copy(s.fwd);
    p.respawnSafe();
    p.combo = createCombo();
    g.cam.snap(p);
    g.stats.suspended = false;
    for (const r of g.remotes.values()) r.character.root.visible = true;
    this.active = false;
    this.saved = null;
    this.depth = 0;
  }

  /** Per frame while inside (after the physics and the network). */
  update(dt: number) {
    if (!this.active || this.saved === null) return;
    const g = this.game;
    const p = g.player;
    // A respawn may have put you back on the summit, a long way off: recentre
    if (p.respawns !== this.lastRespawns) {
      this.lastRespawns = p.respawns;
      this.rebase(true);
    } else this.rebase(false);
    this.depth = Math.max(0, ALT - p.pos.y - this.origin.y);
    this.updateTerrain();
    this.riderPeak.set(
      p.pos.x + this.origin.x,
      p.pos.y + this.origin.y - ALT,
      p.pos.z + this.origin.z,
    );
    for (const sys of this.systems)
      try {
        sys.update(dt);
      } catch (err) {
        console.warn('[bigdrop] a system failed', err);
      }
    // The others are in the right-side-up world
    for (const r of g.remotes.values()) {
      r.character.root.visible = false;
      if (r.label) r.label.style.display = 'none';
      if (r.pointer) r.pointer.style.display = 'none';
    }
  }

  /** Recentre the world under the rider once they're far from the origin. */
  private rebase(force: boolean) {
    const g = this.game;
    const p = g.player;
    const far = Math.max(Math.abs(p.pos.x), Math.abs(p.pos.z), Math.abs(p.pos.y - ALT));
    if (far < REBASE) return;
    if (!force && far < REBASE_FORCE && p.state !== 'ground') return;
    const d = new THREE.Vector3(
      Math.round(p.pos.x / STEP) * STEP,
      Math.round((p.pos.y - ALT) / STEP) * STEP,
      Math.round(p.pos.z / STEP) * STEP,
    );
    this.origin.add(d);
    d.negate();
    p.shift(d);
    g.cam.shift(d);
    if (g.me !== null) g.me.root.position.add(d);
    g.world.shiftDynamic('peak:', d);
    for (const sys of this.systems) sys.rebase?.(d);
  }

  // ── Terrain: camera-centred grids, a fine near one and a coarse far one ─

  private buildTerrain() {
    const q = this.game.gfx.quality;
    // A cool self-glow keeps the shaded side snow, not grey concrete
    const src = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      emissive: 0x8492a8,
    });
    src.name = 'BigDropSnow';
    const mat = this.game.gfx.toon ? toToon(src) : src;
    this.snowMat = mat;
    this.near = new GridMesh(NEAR_N[q], NEAR_S0, NEAR_EDGE, mat);
    this.far = new GridMesh(FAR_N[q], FAR_S0, GRID_EDGE, mat, FAR_HOLE);
    this.farNext = new GridMesh(FAR_N[q], FAR_S0, GRID_EDGE, mat, FAR_HOLE);
    this.near.mesh.name = 'BigDropTerrainNear';
    this.far.mesh.name = 'BigDropTerrainFar';
    this.farNext.mesh.name = 'BigDropTerrainFar';
    this.farNext.mesh.visible = false;
    this.group.add(this.near.mesh, this.far.mesh, this.farNext.mesh);
  }

  private updateTerrain() {
    const near = this.near;
    const far = this.far;
    const next = this.farNext;
    if (near === null || far === null || next === null) return;
    const cam = this.game.gfx.camera.position;
    const o = this.origin;
    // Camera in peak coordinates
    const px = cam.x + o.x;
    const py = cam.y + o.y - ALT;
    const pz = cam.z + o.z;
    // Near: snapped to its finest spacing (in peak coordinates, so its
    // vertices never swim), rebuilt whenever that moves
    const nx = Math.round(px / NEAR_S0) * NEAR_S0;
    const nz = Math.round(pz / NEAR_S0) * NEAR_S0;
    if (nx !== near.at.x || nz !== near.at.z) near.buildNow(nx, py, nz, this.sampler);
    // Far: the first time at once, then a slice a frame into the spare
    const fx = Math.round(px / FAR_S0) * FAR_S0;
    const fz = Math.round(pz / FAR_S0) * FAR_S0;
    if (!Number.isFinite(far.at.x)) far.buildNow(fx, py, fz, this.sampler);
    else if (next.building) {
      if (next.step(FAR_ROWS, this.sampler)) {
        next.mesh.visible = true;
        far.mesh.visible = false;
        this.far = next;
        this.farNext = far;
      }
    } else if (Math.hypot(fx - far.at.x, fz - far.at.z) > FAR_MOVE) next.begin(fx, py, fz);
    // Placed from peak coordinates every frame: rebases need nothing else
    for (const g of [near, this.far!]) {
      g.mesh.position.set(g.at.x - o.x, g.at.y - o.y + ALT, g.at.z - o.z);
    }
  }

  private disposeGroup() {
    for (const g of [this.near, this.far, this.farNext]) {
      if (g === null) continue;
      this.group.remove(g.mesh);
      g.dispose();
    }
    this.near = this.far = this.farNext = null;
    const mat = this.snowMat;
    if (mat !== null) {
      // toToon swaps in a converted copy: free the original as well
      (mat.userData.toonSrc as THREE.Material | undefined)?.dispose();
      mat.dispose();
      this.snowMat = null;
    }
  }

  dispose() {
    if (this.active) this.exit();
  }
}
