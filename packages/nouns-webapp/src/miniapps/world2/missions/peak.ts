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
//     up with at thousands of km/h), white sky, snowfall that thins out
//     below the first few km, fog that clears further down;
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

import * as THREE from 'three';

import { inkExcluded, toonify } from '../render/Toon';
import { createCombo } from '../skate/Tricks';

import { PEAK_LIPSCHITZ, peakHeight, peakNormal, raycastHeight } from './peakTerrain';

/** Gravity scale inside (of the player's own tuning). */
export const PEAK_GRAVITY = 0.4;
/** Air drag scale inside: the fall line has to feel like one. */
const PEAK_DRAG = 0.15;
/** Local y of the summit: far above anything in the city's coordinates. */
const ALT = 20_000;
/** Recentre once the rider is this far from the origin (m)… */
const REBASE = 3000;
/** …on the ground, or anywhere past this. */
const REBASE_FORCE = 8000;
/** Recentring steps (m), so the summit always lands on round numbers. */
const STEP = 1000;
/** Terrain grid: vertices per side by quality, and its spacing. */
const GRID_N = { low: 101, medium: 141, high: 141 } as const;
/** First ring spacing (m) and the far edge (m) the geometric spacing reaches. */
const GRID_S0 = 1.5;
const GRID_EDGE = 7000;
const SNOW = 900;
const SNOW_BOX = 70;

const SKY_TOP = new THREE.Color(0xdfe6ee);
const SKY_LOW = new THREE.Color(0xa9cdee);
const SNOW_LIT = new THREE.Color(0xf7fbff);
const SNOW_SHADE = new THREE.Color(0xd6e2f0);
const ROCK = new THREE.Color(0x8d97a6);

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

/** Grid offsets for one axis: dense at the centre, geometric out to GRID_EDGE. */
function gridOffsets(n: number): Float64Array {
  const k = (n - 1) / 2;
  // Solve (1+q)^k − 1 = GRID_EDGE·q / s0 for q (bisection; it's monotone)
  let lo = 1e-4;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const q = (lo + hi) / 2;
    if ((Math.pow(1 + q, k) - 1) * (GRID_S0 / q) > GRID_EDGE) hi = q;
    else lo = q;
  }
  const q = (lo + hi) / 2;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = i - k;
    const d = (GRID_S0 * (Math.pow(1 + q, Math.abs(j)) - 1)) / q;
    out[i] = Math.sign(j) * d;
  }
  return out;
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
  private fog = new THREE.FogExp2(SKY_TOP.getHex(), 0.0035);
  private bg = SKY_TOP.clone();
  private group = new THREE.Group();
  private terrain: THREE.Mesh | null = null;
  private offsets: Float64Array | null = null;
  private heights: Float64Array | null = null;
  private builtAt = new THREE.Vector3(Infinity, 0, 0);
  private snow: THREE.Points | null = null;
  private snowVel: Float32Array | null = null;
  private wind: { gain: GainNode; nodes: AudioScheduledSourceNode[] } | null = null;
  private lastRespawns = 0;
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
    // R (and falling out) bring you back to the summit pad, facing +Z
    p.homeSpots = [{ pos: new THREE.Vector3(0, ALT + 0.05, 0), yaw: 0 }];
    p.respawnHome();
    this.lastRespawns = p.respawns;
    g.cam.snap(p);
    gfx.renderer.domElement.style.filter = '';
    // See all the way down to the fog (the terrain mesh reaches GRID_EDGE)
    gfx.camera.far = GRID_EDGE + 1000;
    gfx.camera.updateProjectionMatrix();
    gfx.sun.color.set(0xfff6ea);
    gfx.sun.intensity = this.saved.sunIntensity * 1.15;
    gfx.hemi.color.set(0xcfe2ff);
    gfx.hemi.groundColor.set(0xeef3ff);
    gfx.hemi.intensity = this.saved.hemiIntensity * 1.3;
    this.buildTerrain();
    this.makeSnow();
    gfx.scene.add(this.group);
    this.builtAt.set(Infinity, 0, 0);
    this.applySky();
    this.startWind();
  }

  exit() {
    if (!this.active || this.saved === null) return;
    const g = this.game;
    const gfx = g.gfx;
    const s = this.saved;
    const p = g.player;
    gfx.scene.remove(this.group);
    this.disposeGroup();
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
    // Back out where you went in, by the door, with nothing carried over:
    // no session score or half-done combo, no speed and no streak
    p.safePos.copy(s.pos);
    p.safeFwd.copy(s.fwd);
    p.respawnSafe();
    p.combo = createCombo();
    g.cam.snap(p);
    g.stats.suspended = false;
    for (const r of g.remotes.values()) r.character.root.visible = true;
    this.stopWind();
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
    this.applySky();
    this.updateTerrain();
    this.updateSnow(dt);
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
    if (this.snow !== null) {
      const a = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = a.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] += d.x;
        arr[i + 1] += d.y;
        arr[i + 2] += d.z;
      }
      a.needsUpdate = true;
    }
    this.builtAt.set(Infinity, 0, 0);
  }

  private applySky() {
    const gfx = this.game.gfx;
    const scene = gfx.scene;
    // A snowstorm round the summit, clearing to blue sky a few km down
    const k = Math.min(1, this.depth / 25_000);
    const e = 1 - Math.pow(1 - k, 2);
    this.bg.copy(SKY_TOP).lerp(SKY_LOW, e);
    this.fog.color.copy(this.bg);
    this.fog.density = 0.0035 + (0.00034 - 0.0035) * e;
    if (scene.fog !== this.fog) scene.fog = this.fog;
    if (scene.background !== this.bg) scene.background = this.bg;
    if (gfx.sky.visible) gfx.sky.visible = false;
  }

  // ── Terrain: one camera-centred grid, dense near and sparse far ───────

  private buildTerrain() {
    const n = GRID_N[this.game.gfx.quality];
    this.offsets = gridOffsets(n);
    this.heights = new Float64Array(n * n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let o = 0;
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        idx[o++] = a;
        idx[o++] = a + n;
        idx[o++] = a + 1;
        idx[o++] = a + 1;
        idx[o++] = a + n;
        idx[o++] = a + n + 1;
      }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
    });
    mat.name = 'BigDropSnow';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'BigDropTerrain';
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    if (this.game.gfx.toon) toonify(mesh);
    this.terrain = mesh;
    this.group.add(mesh);
  }

  private updateTerrain() {
    const mesh = this.terrain;
    const off = this.offsets;
    const hs = this.heights;
    if (mesh === null || off === null || hs === null) return;
    const cam = this.game.gfx.camera.position;
    // Snap the centre to the finest spacing, in peak coordinates (so the
    // near vertices never swim as you move)
    const cx = Math.round((cam.x + this.origin.x) / GRID_S0) * GRID_S0 - this.origin.x;
    const cz = Math.round((cam.z + this.origin.z) / GRID_S0) * GRID_S0 - this.origin.z;
    if (Math.abs(cx - this.builtAt.x) < 1e-6 && Math.abs(cz - this.builtAt.z) < 1e-6) return;
    this.builtAt.set(cx, 0, cz);
    const n = off.length;
    const base = cam.y;
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const nor = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const col = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const N = nor.array as Float32Array;
    const C = col.array as Float32Array;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) hs[j * n + i] = this.heightAt(cx + off[i]!, cz + off[j]!);
    const c = new THREE.Color();
    for (let j = 0; j < n; j++) {
      const j0 = j > 0 ? j - 1 : j;
      const j1 = j < n - 1 ? j + 1 : j;
      for (let i = 0; i < n; i++) {
        const i0 = i > 0 ? i - 1 : i;
        const i1 = i < n - 1 ? i + 1 : i;
        const v = j * n + i;
        const gx = (hs[j * n + i1]! - hs[j * n + i0]!) / (off[i1]! - off[i0]!);
        const gz = (hs[j1 * n + i]! - hs[j0 * n + i]!) / (off[j1]! - off[j0]!);
        const l = Math.hypot(gx, 1, gz);
        const ny = 1 / l;
        P[v * 3] = off[i]!;
        P[v * 3 + 1] = hs[v]! - base;
        P[v * 3 + 2] = off[j]!;
        N[v * 3] = -gx / l;
        N[v * 3 + 1] = ny;
        N[v * 3 + 2] = -gz / l;
        // Fresh snow on the gentler bits, bluer on the steep, rock where
        // it's steepest (the faces of the kickers)
        c.copy(SNOW_SHADE).lerp(SNOW_LIT, Math.min(1, Math.max(0, (ny - 0.6) / 0.25)));
        if (ny < 0.62) c.lerp(ROCK, Math.min(1, (0.62 - ny) / 0.05) * 0.6);
        C[v * 3] = c.r;
        C[v * 3 + 1] = c.g;
        C[v * 3 + 2] = c.b;
      }
    }
    mesh.position.set(cx, base, cz);
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    col.needsUpdate = true;
  }

  // ── Snow: falling round the camera, only up top ───────────────────────

  private makeSnow() {
    const pos = new Float32Array(SNOW * 3);
    const vel = new Float32Array(SNOW * 3);
    const c = this.game.gfx.camera.position;
    for (let i = 0; i < SNOW; i++) {
      pos[i * 3] = c.x + (Math.random() - 0.5) * SNOW_BOX;
      pos[i * 3 + 1] = c.y + (Math.random() - 0.5) * SNOW_BOX * 0.6;
      pos[i * 3 + 2] = c.z + (Math.random() - 0.5) * SNOW_BOX;
      vel[i * 3] = 0.6 + Math.random() * 0.8;
      vel[i * 3 + 1] = -(0.8 + Math.random() * 1.2);
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.12,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.snow = new THREE.Points(geo, m);
    this.snow.frustumCulled = false;
    this.snowVel = vel;
    inkExcluded.add(this.snow);
    this.group.add(this.snow);
  }

  private updateSnow(dt: number) {
    const sn = this.snow;
    const vel = this.snowVel;
    if (sn === null || vel === null) return;
    // Snowing round the summit, easing off by 12 km down
    const amount = 1 - Math.min(1, Math.max(0, (this.depth - 2000) / 10_000));
    sn.visible = amount > 0.01;
    (sn.material as THREE.PointsMaterial).opacity = 0.9 * amount;
    if (!sn.visible) return;
    const attr = sn.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = attr.array as Float32Array;
    const c = this.game.gfx.camera.position;
    const half = SNOW_BOX / 2;
    const t = performance.now() / 1000;
    for (let i = 0; i < SNOW; i++) {
      const o = i * 3;
      a[o] += (vel[o]! + Math.sin(t * 0.9 + i) * 0.4) * dt;
      a[o + 1] += vel[o + 1]! * dt;
      a[o + 2] += (vel[o + 2]! + Math.cos(t * 0.7 + i * 1.3) * 0.4) * dt;
      // Wrap round the camera: riding fast streams the flakes past you
      for (const k of [0, 2] as const) {
        const d = a[o + k]! - (k === 0 ? c.x : c.z);
        if (d > half || d < -half) a[o + k] -= Math.round(d / SNOW_BOX) * SNOW_BOX;
      }
      const dy = a[o + 1]! - c.y;
      const hy = half * 0.6;
      if (dy > hy || dy < -hy) a[o + 1] -= Math.round(dy / (SNOW_BOX * 0.6)) * SNOW_BOX * 0.6;
    }
    attr.needsUpdate = true;
  }

  // ── Wind: a cold hiss that thins as the snow does ─────────────────────

  private startWind() {
    const au = this.game.audio;
    const ctx = au.ctx;
    const out = au.master;
    if (ctx === null || out === null || this.wind !== null) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.09, ctx.currentTime, 1.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.7;
    bp.connect(gain);
    gain.connect(out);
    // Noise from a looping buffer, with a slow gust on the filter
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(bp);
    src.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const depth = ctx.createGain();
    depth.gain.value = 260;
    lfo.connect(depth);
    depth.connect(bp.frequency);
    lfo.start();
    this.wind = { gain, nodes: [src, lfo] };
  }

  private stopWind() {
    const w = this.wind;
    const ctx = this.game.audio.ctx;
    if (w === null) return;
    this.wind = null;
    if (ctx === null) return;
    w.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    const stopAt = ctx.currentTime + 1.5;
    for (const n of w.nodes) n.stop(stopAt);
    setTimeout(() => w.gain.disconnect(), 1800);
  }

  private disposeGroup() {
    if (this.terrain !== null) {
      this.group.remove(this.terrain);
      this.terrain.geometry.dispose();
      (this.terrain.material as THREE.Material).dispose();
      this.terrain = null;
    }
    if (this.snow !== null) {
      this.group.remove(this.snow);
      inkExcluded.delete(this.snow);
      this.snow.geometry.dispose();
      (this.snow.material as THREE.Material).dispose();
      this.snow = null;
    }
    this.offsets = null;
    this.heights = null;
  }

  dispose() {
    if (this.active) this.exit();
    this.stopWind();
  }
}
