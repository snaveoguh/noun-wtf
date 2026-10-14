// ── The Upside Down: the same world, turned dark (a per-player dimension) ──
//
// Not a new map: a world-state toggle over the one you're in. While inside:
//   - sky dome off, a blood-dark background and thick red fog;
//   - drained, reddened colours (a CSS filter on the game canvas: cheap,
//     and it can't upset the WebGL post stack on any GPU);
//   - floating spores around the camera, flickering ambient light;
//   - a procedural drone on the sfx bus;
//   - gravity at 20% (floaty, huge airs), with a soft ceiling so an air
//     can't carry you off forever;
//   - other riders are hidden (they're in the right-side-up world);
//   - nothing counts: the stats tracker is suspended (no records, no ride
//     trace; a fresh trace starts on the way out), and on the way out you
//     stop dead with the combo, session score and streak reset, so nothing
//     built under low gravity comes back with you.
// Everything it changes is saved on the way in and put back exactly on the
// way out.

import type { Game } from '../Game';

import * as THREE from 'three';

import { inkExcluded } from '../render/Toon';
import { createCombo } from '../skate/Tricks';

/** Gravity scale inside (of the player's own tuning). */
export const UD_GRAVITY = 0.2;
/** Above this height over take-off an air stops climbing (m). */
const CEILING = 32;
const SPORES = 420;
const SPORE_BOX = 70;
const FILTER = 'saturate(0.4) sepia(0.4) hue-rotate(-35deg) contrast(1.05) brightness(1.3)';

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
  filter: string;
}

export class UpsideDown {
  active = false;
  private saved: Saved | null = null;
  private fog = new THREE.FogExp2(0x6a1a22, 0.0025);
  private bg = new THREE.Color(0x3a0a10);
  private spores: THREE.Points | null = null;
  private sporeVel: Float32Array | null = null;
  private drone: { gain: GainNode; nodes: AudioScheduledSourceNode[] } | null = null;
  private flick = 0;
  private flickT = 0;
  private airStartY: number | null = null;

  constructor(private game: Game) {}

  enter() {
    if (this.active) return;
    const g = this.game;
    const gfx = g.gfx;
    this.saved = {
      fog: gfx.scene.fog,
      background: gfx.scene.background,
      skyVisible: gfx.sky.visible,
      sunColor: gfx.sun.color.clone(),
      sunIntensity: gfx.sun.intensity,
      hemiColor: gfx.hemi.color.clone(),
      hemiGround: gfx.hemi.groundColor.clone(),
      hemiIntensity: gfx.hemi.intensity,
      gravity: g.player.tuning.gravity,
      filter: gfx.renderer.domElement.style.filter,
    };
    this.active = true;
    g.stats.suspended = true;
    g.player.tuning.gravity = this.saved.gravity * UD_GRAVITY;
    gfx.sky.visible = false;
    gfx.sun.color.set(0xff7a60);
    gfx.sun.intensity = this.saved.sunIntensity;
    gfx.hemi.color.set(0xb04050);
    gfx.hemi.groundColor.set(0x120004);
    gfx.renderer.domElement.style.filter = FILTER;
    this.applySky();
    this.makeSpores();
    this.startDrone();
  }

  exit() {
    if (!this.active || this.saved === null) return;
    const g = this.game;
    const gfx = g.gfx;
    const s = this.saved;
    gfx.scene.fog = s.fog;
    gfx.scene.background = s.background;
    gfx.sky.visible = s.skyVisible;
    gfx.sun.color.copy(s.sunColor);
    gfx.sun.intensity = s.sunIntensity;
    gfx.hemi.color.copy(s.hemiColor);
    gfx.hemi.groundColor.copy(s.hemiGround);
    gfx.hemi.intensity = s.hemiIntensity;
    gfx.renderer.domElement.style.filter = s.filter;
    g.player.tuning.gravity = s.gravity;
    // Nothing comes back from in there: no session score or half-done
    // combo, no speed and no streak (it'd have built under low gravity)
    g.player.combo = createCombo();
    g.player.vel.set(0, 0, 0);
    g.player.run = 0;
    g.player.runTime = 0;
    g.stats.suspended = false;
    for (const r of g.remotes.values()) r.character.root.visible = true;
    this.stopDrone();
    if (this.spores !== null) {
      gfx.scene.remove(this.spores);
      inkExcluded.delete(this.spores);
      this.spores.geometry.dispose();
      (this.spores.material as THREE.Material).dispose();
      this.spores = null;
    }
    this.active = false;
    this.saved = null;
    this.airStartY = null;
  }

  /** Per frame while inside (after the physics and the network). */
  update(dt: number) {
    if (!this.active || this.saved === null) return;
    const g = this.game;
    const gfx = g.gfx;
    // Time-of-day changes and the sky haze would put the day back
    this.applySky();
    // Flicker: mostly steady, with sudden dips
    this.flickT -= dt;
    if (this.flickT <= 0) {
      this.flickT = 0.05 + Math.random() * (Math.random() < 0.15 ? 0.1 : 1.6);
      this.flick = Math.random() < 0.18 ? 0.15 + Math.random() * 0.35 : 0.8 + Math.random() * 0.3;
    }
    gfx.hemi.intensity = this.saved.hemiIntensity * 1.8 * this.flick;
    // Soft ceiling on airs (low gravity would otherwise throw you for ever)
    const p = g.player;
    if (p.state === 'air') {
      this.airStartY ??= p.pos.y;
      const over = p.pos.y - this.airStartY - CEILING;
      if (over > 0 && p.vel.y > 0) p.vel.y *= Math.exp(-(1.5 + over * 0.3) * dt);
    } else this.airStartY = null;
    // The others are in the other world
    for (const r of g.remotes.values()) {
      r.character.root.visible = false;
      if (r.label) r.label.style.display = 'none';
      if (r.pointer) r.pointer.style.display = 'none';
    }
    this.updateSpores(dt);
  }

  private applySky() {
    const scene = this.game.gfx.scene;
    if (scene.fog !== this.fog) scene.fog = this.fog;
    if (scene.background !== this.bg) scene.background = this.bg;
    if (this.game.gfx.sky.visible) this.game.gfx.sky.visible = false;
  }

  private makeSpores() {
    const pos = new Float32Array(SPORES * 3);
    const vel = new Float32Array(SPORES * 3);
    const c = this.game.gfx.camera.position;
    for (let i = 0; i < SPORES; i++) {
      pos[i * 3] = c.x + (Math.random() - 0.5) * SPORE_BOX;
      pos[i * 3 + 1] = c.y + (Math.random() - 0.5) * SPORE_BOX * 0.6;
      pos[i * 3 + 2] = c.z + (Math.random() - 0.5) * SPORE_BOX;
      vel[i * 3] = (Math.random() - 0.5) * 0.3;
      vel[i * 3 + 1] = 0.05 + Math.random() * 0.25;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      color: 0xffc2b0,
      size: 0.16,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.spores = new THREE.Points(geo, m);
    this.spores.frustumCulled = false;
    this.sporeVel = vel;
    inkExcluded.add(this.spores);
    this.game.gfx.scene.add(this.spores);
  }

  private updateSpores(dt: number) {
    const sp = this.spores;
    const vel = this.sporeVel;
    if (sp === null || vel === null) return;
    const attr = sp.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = attr.array as Float32Array;
    const c = this.game.gfx.camera.position;
    const half = SPORE_BOX / 2;
    const t = performance.now() / 1000;
    for (let i = 0; i < SPORES; i++) {
      const o = i * 3;
      a[o] += (vel[o] + Math.sin(t * 0.7 + i) * 0.15) * dt;
      a[o + 1] += vel[o + 1] * dt;
      a[o + 2] += (vel[o + 2] + Math.cos(t * 0.6 + i * 1.3) * 0.15) * dt;
      // Wrap around the camera (riding fast drags the cloud along)
      for (const k of [0, 2] as const) {
        const d = a[o + k] - (k === 0 ? c.x : c.z);
        if (d > half) a[o + k] -= SPORE_BOX;
        else if (d < -half) a[o + k] += SPORE_BOX;
      }
      const dy = a[o + 1] - c.y;
      if (dy > half * 0.6) a[o + 1] -= SPORE_BOX * 0.6;
      else if (dy < -half * 0.6) a[o + 1] += SPORE_BOX * 0.6;
    }
    attr.needsUpdate = true;
  }

  private startDrone() {
    const ctx = this.game.audio.ctx;
    const out = this.game.audio.master;
    if (ctx === null || out === null || this.drone !== null) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.11, ctx.currentTime, 1.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    lp.Q.value = 6;
    lp.connect(gain);
    gain.connect(out);
    const nodes: AudioScheduledSourceNode[] = [];
    for (const [f, type] of [
      [41.2, 'sawtooth'],
      [41.9, 'sawtooth'],
      [61.7, 'triangle'],
      [82.4, 'sine'],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(lp);
      o.start();
      nodes.push(o);
    }
    // A slow breath on the filter
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = ctx.createGain();
    depth.gain.value = 160;
    lfo.connect(depth);
    depth.connect(lp.frequency);
    lfo.start();
    nodes.push(lfo);
    this.drone = { gain, nodes };
  }

  private stopDrone() {
    const d = this.drone;
    const ctx = this.game.audio.ctx;
    if (d === null) return;
    this.drone = null;
    if (ctx === null) return;
    d.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    const stopAt = ctx.currentTime + 1.5;
    for (const n of d.nodes) n.stop(stopAt);
    setTimeout(() => d.gain.disconnect(), 1800);
  }

  dispose() {
    if (this.active) this.exit();
    this.stopDrone();
  }
}
