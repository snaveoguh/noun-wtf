// ── NOUN STADIUM in the world: build near, hide far, free further ────────
//
// Owned by the Game (`game.stadium`). `update(dt, eye)` once a frame:
//   • within BUILD_R of the stadium (3D, so a pocket room 4 km up or the Big
//     Drop never counts) it makes the StadiumView and builds it a slice a
//     frame; once built it adds the colliders (one CollisionWorld dynamic
//     body), compiles its programs while it stays hidden (warmHidden), then
//     shows it;
//   • past HIDE_R it's hidden (no draws, the colliders stay: cheap, a box
//     check); past FREE_R everything is freed (geometry, textures,
//     materials, colliders) and rebuilt if you come back;
//   • while shown it ticks the view (crowd uniforms, wave, ads, screen).
// The match layer (football/net) reads `.view` for setPitch / setKits /
// board / crowd / netHit / setLive. Dev: `?spot=stadium` spawns at the
// main entrance; `window.__w2.stadium.go()` jumps there.

import type { Game } from '../../../Game';

import * as THREE from 'three';

import { warmHidden } from '../../../render/shaderWarm';
import { inStadium, stadiumFrame, stadiumSpawn } from '../../site';

import { StadiumView } from './StadiumView';

export const STADIUM_COLLIDER = 'football:stadium';
/** Start building within this (m), hide beyond HIDE_R, free beyond FREE_R. */
export const BUILD_R = 1500;
export const HIDE_R = 1650;
export const FREE_R = 2600;

export class StadiumSystem {
  view: StadiumView | null = null;
  private centre: THREE.Vector3 | null = null;
  private shown = false;
  private warming = false;
  private collider: THREE.BufferGeometry | null = null;
  /** Build stats for perf reports. */
  stats = { builtMs: 0, slices: 0, maxSliceMs: 0, draws: 0, triangles: 0 };

  constructor(private readonly game: Game) {}

  /** Stadium centre (world), resolved once. */
  private where(): THREE.Vector3 {
    if (this.centre === null) {
      const f = stadiumFrame();
      this.centre = new THREE.Vector3(f.x, f.y, f.z);
    }
    return this.centre;
  }

  update(dt: number, eye: THREE.Vector3) {
    const d = eye.distanceTo(this.where());
    if (this.view === null) {
      if (d > BUILD_R) return;
      const g = this.game.gfx;
      this.view = new StadiumView({ frame: stadiumFrame(), quality: g.quality, toon: g.toon });
      this.view.root.visible = false;
      g.scene.add(this.view.root);
    }
    const v = this.view;
    if (d > FREE_R) {
      this.free();
      return;
    }
    if (!v.built) {
      if (v.buildStep()) this.onBuilt();
      return;
    }
    if (this.warming) return;
    const show = d < HIDE_R;
    if (show !== this.shown) {
      this.shown = show;
      v.root.visible = show;
    }
    if (show) v.tick(dt, eye);
  }

  private onBuilt() {
    const v = this.view!;
    const g = this.game;
    const f = v.opts.frame;
    this.collider = v.colliderGeometry();
    g.world.setDynamic(STADIUM_COLLIDER, this.collider, new THREE.Vector3(f.x, f.y, f.z));
    const ms = v.sliceMs;
    this.stats.builtMs = ms.reduce((a, b) => a + b, 0);
    this.stats.slices = ms.length;
    this.stats.maxSliceMs = Math.max(...ms);
    v.root.visible = true;
    this.stats.draws = v.draws;
    this.stats.triangles = v.triangles;
    // link the programs before the first frame that draws them
    this.warming = true;
    void warmHidden(
      g.gfx.renderer,
      v.root,
      g.gfx.camera,
      g.gfx.scene,
      fn => g.gfx.asDrawn(fn),
      2000,
    ).then(() => {
      this.warming = false;
      if (this.view !== v) return;
      this.shown = v.root.visible;
    });
    if (import.meta.env.DEV)
      console.info(
        `[stadium] built in ${ms.length} slices, ${this.stats.builtMs.toFixed(1)} ms (max ${this.stats.maxSliceMs.toFixed(1)} ms), ${this.stats.draws} meshes, ${Math.round(this.stats.triangles / 1000)}k tris`,
      );
  }

  /** Is (x, z) inside the stadium's outer wall? (for the match layer / HUD) */
  inside(x: number, z: number, margin = 0): boolean {
    return inStadium(x, z, margin);
  }

  /** Dev: spawn at the main entrance, facing in. */
  go() {
    const sp = stadiumSpawn();
    const g = this.game;
    g.player.spawn(new THREE.Vector3(sp.x, sp.y, sp.z), sp.yaw);
    g.cam.snap(g.player);
    return sp;
  }

  private free() {
    if (this.collider !== null) {
      this.game.world.setDynamic(STADIUM_COLLIDER, null);
      this.collider.dispose();
      this.collider = null;
    }
    this.view?.dispose();
    this.view = null;
    this.shown = false;
    this.warming = false;
  }

  dispose() {
    this.free();
  }
}
