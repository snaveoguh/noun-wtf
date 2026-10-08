// ── Nature layer entry point ────────────────────────────────────────────
//
//   const nature = new NatureSystem(gfx);            // after gfx.applyLevel(level)
//   buildNatureShowcase(nature, world, origin);      // optional park corner
//   replaceFallbackTrees(level.root, nature);        // optional: upgrade placeholder trees
//   nature.build();
//   world.build([...level.collisionMeshes, ...nature.collisionMeshes()]);
//   applyTimeOfDay(gfx, 'afternoon', level, { duration: 0 });
//   // per frame, before gfx.render(dt):
//   nature.update(dt, player.pos);

import type { CinematicEffects } from './PostFX';
import type { NatureQuality } from './shared';
import type { Graphics } from '../render/Graphics';

import * as THREE from 'three';

import { FoliageSystem } from './Foliage';
import { addCinematicEffects } from './PostFX';
import { RockField } from './Rocks';
import { natureUniforms } from './shared';
import { getTimeOfDay } from './TimeOfDay';
import { WaterSystem } from './Water';

export type NatureHost = Pick<
  Graphics,
  'renderer' | 'scene' | 'camera' | 'sun' | 'hemi' | 'sky' | 'composer' | 'quality'
>;

export class NatureSystem {
  readonly gfx: NatureHost;
  readonly quality: NatureQuality;
  readonly group = new THREE.Group();
  readonly foliage: FoliageSystem;
  readonly rocks: RockField;
  /** Rocks that sit in/at water (also rendered into the refraction pass). */
  readonly wetRocks: RockField;
  readonly water: WaterSystem;
  cinematic: CinematicEffects | null = null;
  private extraCollision: THREE.Mesh[] = [];

  constructor(gfx: NatureHost, opts: { seed?: number; cinematic?: boolean } = {}) {
    this.gfx = gfx;
    this.quality = gfx.quality;
    this.group.name = 'nature';
    const seed = opts.seed ?? 1;
    this.foliage = new FoliageSystem(this.quality, seed);
    this.rocks = new RockField(this.quality, { seed });
    this.wetRocks = new RockField(this.quality, { seed: seed + 5, bedLayer: true });
    this.water = new WaterSystem(gfx, this.quality);
    this.group.add(this.foliage.group, this.rocks.group, this.wetRocks.group, this.water.group);
    gfx.scene.add(this.group);
    if (opts.cinematic !== false) this.cinematic = addCinematicEffects(gfx);
  }

  /** Register extra collision proxies (fountain rims, planters…). */
  addCollision(...m: THREE.Mesh[]) {
    this.extraCollision.push(...m);
  }

  /** Build all instanced meshes. Call after placing everything (can be called again). */
  build() {
    this.foliage.build();
    this.rocks.build();
    this.wetRocks.build();
  }

  /** Collision proxies for trunks, big boulders, basins — merge into CollisionWorld.build. */
  collisionMeshes(): THREE.Mesh[] {
    return [
      ...this.foliage.collisionMeshes,
      ...this.rocks.collisionMeshes,
      ...this.wetRocks.collisionMeshes,
      ...this.extraCollision,
    ];
  }

  /**
   * Per-frame: advance wind/time, sync lighting uniforms, cull grass chunks,
   * render the water refraction pre-pass, steer DoF focus. Call right before
   * `gfx.render(dt)` (after the camera has been updated).
   */
  update(dt: number, focus?: THREE.Vector3) {
    natureUniforms.uTime.value += dt;
    if (focus !== undefined) natureUniforms.uPlayerPos.value.copy(focus);
    natureUniforms.uSunColor.value.copy(this.gfx.sun.color).multiplyScalar(this.gfx.sun.intensity);
    const cam = this.gfx.camera;
    this.foliage.update(cam);
    getTimeOfDay(this.gfx)?.update();
    this.water.update();
    if (focus !== undefined) this.cinematic?.update(dt, focus);
  }

  /** Wind direction (XZ) + strength (0 calm … 2 windy). */
  setWind(dirX: number, dirZ: number, strength: number) {
    natureUniforms.uWindDir.value.set(dirX, dirZ).normalize();
    natureUniforms.uWindStrength.value = strength;
  }

  stats() {
    let tris = 0;
    let meshes = 0;
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh !== true || !m.visible) return;
      meshes++;
      const idx = m.geometry.index;
      const t = idx !== null ? idx.count / 3 : m.geometry.attributes.position.count / 3;
      tris +=
        t *
        ((m as THREE.InstancedMesh).isInstancedMesh === true
          ? (m as THREE.InstancedMesh).count
          : 1);
    });
    return { meshes, tris };
  }

  dispose() {
    this.gfx.scene.remove(this.group);
    this.water.dispose();
    this.cinematic?.dispose();
  }
}

export { FoliageSystem, createTree, scatterFoliage } from './Foliage';
export type { FoliageRegion, PlantKind, PlantPlacement } from './Foliage';
export { RockField, createBoulder, generateBoulder, rockMaterial } from './Rocks';
export { WaterSystem, applyCaustics } from './Water';
export type { WaterBody, WaterOptions, WaterShape } from './Water';
export { TimeOfDay, applyTimeOfDay, getTimeOfDay, TIME_OF_DAY_PRESETS } from './TimeOfDay';
export type { TimeOfDayPreset } from './TimeOfDay';
export { addCinematicEffects } from './PostFX';
export { getToonRamp, setToonRamp, toonMaterial, natureUniforms, NATURE_BED_LAYER } from './shared';
export type { Region } from './shared';
export { buildNatureShowcase, createFountain, replaceFallbackTrees } from './NatureShowcase';
