// ── The Big Drop: NPC Nouns on hoverboards, racing down the track ───────
//
// A PeakSystem. A handful of Nouns (random traits, the game's own rigged
// characters) on glowing hoverboards: no wheels, floating ~0.4 m over the
// snow, a coloured underglow and a light ribbon behind. The riding is pure
// (riderSim.ts): they hold a pace that's a multiple of yours, carve across
// the lane, fly off the kickers with grabs, spins and flips, and respawn
// round you down the line (never more than RIDER.window m away, so their
// float32 bones stay near the floating origin). Far off they're a glowing
// dot; near they spray snow (spray.ts), and the fast ones whoosh past.
// Visual only: they swerve round you rather than collide.

import type { Feature, PeakCtx, PeakSystem } from './contract';

import * as THREE from 'three';

import { randomSeed } from '../../character/NounAppearance';
import { NounCharacter } from '../../character/NounCharacter';
import { inkExcluded, toonify } from '../../render/Toon';
import { peakHeight, peakNormal } from '../peakTerrain';

import {
  RIDER,
  riderCreate,
  riderShouldRecycle,
  riderSlope,
  riderSpawn,
  riderStep,
  riderTrickK,
  type RiderEnv,
  type RiderState,
} from './riderSim';
import { sprayActive, sprayBoard, type SprayBoard } from './spray';
import { surfaceAt } from './surface';
import { featuresIn, nearestTrack } from './track';

/** NPCs by quality. */
const COUNT = { low: 3, medium: 5, high: 8 } as const;
/** Extra float on top of the character's own hover (m): the board rides ~0.4 m up. */
const HOVER_EXTRA = 0.22;
/** Draw the character within this (m); beyond, only its glow dot. */
const CHAR_DIST = 900;
/** Snow spray within this (m). */
const SPRAY_DIST = 380;
/** Ribbon points per rider. */
const SEG = 22;
const RIBBON_W = 0.13;
/** Seconds between character builds (spreads the cost), and between new faces. */
const BUILD_EVERY = 0.3;
const RESEED_EVERY = 6;
const TINTS = [0x7ff4ff, 0xff5ce1, 0xb6ff4a, 0xffb347, 0xa98bff, 0xff5a5a, 0x5affc8, 0xfff36b];

interface Slot {
  st: RiderState;
  ch: NounCharacter | null;
  pool: THREE.Object3D | null;
  tint: THREE.Color;
  spray: SprayBoard;
  /** Ribbon history (LOCAL): centre and half-width vector, newest at `head`. */
  hist: Float32Array;
  side: Float32Array;
  head: number;
  count: number;
  /** Smoothed board up, and forward (local = peak directions). */
  up: THREE.Vector3;
  fwd: THREE.Vector3;
  /** Scale-in after a spawn (0..1). */
  grow: number;
  /** s − player s last frame (whoosh on a pass). */
  rel: number;
  /** This slot's character should be swapped for a new face when out of sight. */
  reseed: boolean;
}

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _out = new THREE.Vector3();
const _n = { x: 0, y: 1, z: 0 };
const _x = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _piv = new THREE.Vector3();
const _camR = new THREE.Vector3();
const _near = { s: 0, lateral: 0, dist: 0 };
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const CORK = new THREE.Vector3(0.55, 1, 0).normalize();
/** Body centre the flips turn about (character space). */
const PIVOT = new THREE.Vector3(0, 0.95, 0);

const DOT_VERT = /* glsl */ `
  attribute vec2 aSA;
  attribute vec3 color;
  varying vec3 vC;
  varying float vA;
  uniform float scale;
  void main() {
    vC = color;
    vA = aSA.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSA.y > 0.003 ? clamp(aSA.x * scale / max(0.1, -mv.z), 3.0, 22.0) : 0.0;
    gl_Position = projectionMatrix * mv;
  }`;
const DOT_FRAG = /* glsl */ `
  varying vec3 vC;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = vA * (1.0 - smoothstep(0.0, 1.0, d));
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(vC, vec3(1.0), 0.45 * (1.0 - d)) * a, a);
  }`;

/** Free a character's own GPU bits (geometry and textures are shared caches). */
function riderFree(ch: NounCharacter) {
  ch.dispose();
  ch.root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      (mat.userData.toonSrc as THREE.Material | undefined)?.dispose();
      mat.dispose();
    }
    if (m.geometry.type === 'PlaneGeometry') m.geometry.dispose();
    (m as THREE.SkinnedMesh).skeleton?.dispose();
  });
}

class Riders implements PeakSystem {
  private slots: Slot[] = [];
  private env: RiderEnv;
  private features: Feature[] = [];
  private featAt = -Infinity;
  private started = false;
  private buildIn = 0;
  private reseedIn = RESEED_EVERY;
  private whooshIn = 0;
  // Ribbons (one mesh for all) and far glow dots (one point cloud)
  private ribbon: THREE.Mesh;
  private rP: Float32Array;
  private rC: Float32Array;
  private dots: THREE.Points;
  private dP: Float32Array;
  private dSA: Float32Array;
  private dotMat: THREE.ShaderMaterial;
  private fx = new THREE.Group();
  /** ms spent in update (running average). */
  ms = 0;

  constructor(private ctx: PeakCtx) {
    const n = COUNT[ctx.quality];
    this.env = { height: peakHeight, riderS: 0, riderLat: 0, riderV: 0, features: this.features };
    for (let i = 0; i < n; i++)
      this.slots.push({
        st: riderCreate(),
        ch: null,
        pool: null,
        tint: new THREE.Color(TINTS[i % TINTS.length]),
        spray: sprayBoard(),
        hist: new Float32Array(SEG * 3),
        side: new Float32Array(SEG * 3),
        head: 0,
        count: 0,
        up: new THREE.Vector3(0, 1, 0),
        fwd: new THREE.Vector3(0, 0, 1),
        grow: 0,
        rel: 0,
        reseed: false,
      });
    // Ribbons: a strip of SEG points (2 vertices each) per rider
    this.rP = new Float32Array(n * SEG * 2 * 3);
    this.rC = new Float32Array(n * SEG * 2 * 4);
    const idx: number[] = [];
    for (let k = 0; k < n; k++)
      for (let i = 0; i < SEG - 1; i++) {
        const a = (k * SEG + i) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute(
      'position',
      new THREE.BufferAttribute(this.rP, 3).setUsage(THREE.DynamicDrawUsage),
    );
    rg.setAttribute(
      'color',
      new THREE.BufferAttribute(this.rC, 4).setUsage(THREE.DynamicDrawUsage),
    );
    rg.setIndex(idx);
    this.ribbon = new THREE.Mesh(
      rg,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    this.ribbon.frustumCulled = false;
    this.ribbon.name = 'BigDropRibbons';
    this.fx.add(this.ribbon);
    // Glow dots: every rider stays a light on the slope, however far
    this.dP = new Float32Array(n * 3);
    this.dSA = new Float32Array(n * 2);
    const dC = new Float32Array(n * 3);
    this.slots.forEach((s, i) => s.tint.toArray(dC, i * 3));
    const dg = new THREE.BufferGeometry();
    dg.setAttribute(
      'position',
      new THREE.BufferAttribute(this.dP, 3).setUsage(THREE.DynamicDrawUsage),
    );
    dg.setAttribute('aSA', new THREE.BufferAttribute(this.dSA, 2).setUsage(THREE.DynamicDrawUsage));
    dg.setAttribute('color', new THREE.BufferAttribute(dC, 3));
    this.dotMat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 } },
      vertexShader: DOT_VERT,
      fragmentShader: DOT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dots = new THREE.Points(dg, this.dotMat);
    this.dots.frustumCulled = false;
    this.dots.name = 'BigDropRiderDots';
    this.fx.add(this.dots);
    this.fx.name = 'BigDropRiderFx';
    ctx.group.add(this.fx);
    inkExcluded.add(this.fx);
  }

  private build(slot: Slot) {
    const assets = this.ctx.game.assets;
    if (assets === null) return;
    const ch = new NounCharacter(randomSeed(), assets);
    if (this.ctx.toon) toonify(ch.root);
    ch.setBoardType('hover');
    ch.setCastShadows(false);
    ch.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.receiveShadow = false;
    });
    if (Math.random() < 0.4) ch.setWeight(-0.6 + Math.random() * 1.3);
    // Each board glows its own colour
    ch.board.traverse(o => {
      const m = o as THREE.Mesh;
      const mat = m.material as THREE.MeshBasicMaterial | undefined;
      if (!m.isMesh || mat === undefined || mat.blending !== THREE.AdditiveBlending) return;
      mat.color.copy(slot.tint).multiplyScalar(o.name === 'hoverPool' ? 1.1 : 3);
    });
    slot.pool = ch.board.getObjectByName('hoverPool') ?? null;
    ch.root.visible = false;
    ch.play({ clip: 'skate_idle', fade: 0 });
    this.ctx.group.add(ch.root);
    slot.ch = ch;
    slot.reseed = false;
  }

  private spawn(slot: Slot, initial: boolean) {
    riderSpawn(slot.st, this.env, Math.random, initial);
    slot.count = 0;
    slot.grow = 0;
    slot.rel = slot.st.s - this.env.riderS;
    // Now and then a new face, swapped while it's out of sight
    if (!initial && this.reseedIn <= 0 && slot.ch !== null && Math.random() < 0.4) {
      slot.reseed = true;
      this.reseedIn = RESEED_EVERY;
    }
  }

  update(dt: number) {
    const t0 = performance.now();
    if (dt <= 0) return;
    const ctx = this.ctx;
    const g = ctx.game;
    const p = g.player;
    const cam = g.gfx.camera;
    const rp = ctx.riderPeak;
    nearestTrack(rp.x, rp.z, _near);
    const env = this.env;
    env.riderS = _near.s;
    env.riderLat = _near.lateral;
    env.riderV = Math.max(0, p.vel.z);
    // Features near the player (refreshed every 400 m: no per-frame allocation)
    if (Math.abs(env.riderS - this.featAt) > 400) {
      this.featAt = env.riderS;
      this.features.length = 0;
      for (const f of featuresIn(env.riderS - RIDER.window - 200, env.riderS + RIDER.window + 400))
        if (f.kind === 'kicker' || f.kind === 'berm' || f.kind === 'loop') this.features.push(f);
    }
    if (!this.started) {
      this.started = true;
      for (const s of this.slots) this.spawn(s, true);
    }
    this.buildIn -= dt;
    this.reseedIn -= dt;
    this.whooshIn -= dt;
    const h = g.gfx.renderer.domElement.height;
    this.dotMat.uniforms.scale!.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    _camR.setFromMatrixColumn(cam.matrixWorld, 0);
    const fog = g.gfx.scene.fog as THREE.FogExp2 | null;
    const density = fog !== null && 'density' in fog ? fog.density : 0;
    const spray = sprayActive();

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      const st = slot.st;
      riderStep(st, dt, env, Math.random);
      if (riderShouldRecycle(st, env.riderS, env.riderV)) this.spawn(slot, false);
      ctx.toLocal(st.x, st.y, st.s, _p);
      const dist = _p.distanceTo(cam.position);
      const fogK = Math.exp(-Math.pow(density * dist, 2));
      // Characters: built a few at a time, swapped for a new face out of sight
      if (slot.ch !== null && slot.reseed && (dist > 500 || st.s < env.riderS - 30)) {
        riderFree(slot.ch);
        slot.ch = null;
        slot.pool = null;
      }
      if (slot.ch === null && this.buildIn <= 0) {
        this.buildIn = BUILD_EVERY;
        this.build(slot);
      }
      slot.grow = Math.min(1, slot.grow + dt / 0.35);
      // Board frame: up = the snow's normal (the slope's in the air), fwd = motion
      if (dist < 260) peakNormal(st.x, st.s, _n);
      else {
        const k = riderSlope(st.s);
        const l = Math.hypot(1, k);
        _n.x = 0;
        _n.y = 1 / l;
        _n.z = k / l;
      }
      if (st.air) {
        const k = riderSlope(st.s);
        const l = Math.hypot(1, k);
        _v.set(0, 1 / l, k / l);
      } else _v.set(_n.x, _n.y, _n.z);
      slot.up.lerp(_v, 1 - Math.exp(-(st.air ? 3 : 14) * dt)).normalize();
      _vel.set(st.vx, st.vy, st.v);
      slot.fwd.copy(_vel).addScaledVector(slot.up, -_vel.dot(slot.up)).normalize();
      _x.crossVectors(slot.up, slot.fwd).normalize();
      _m.makeBasis(_x, slot.up, slot.fwd);
      _q.setFromRotationMatrix(_m);
      const shown = dist < CHAR_DIST;
      const ch = slot.ch;
      if (ch !== null) {
        ch.root.visible = shown;
        if (shown) this.pose(slot, ch, dt);
      }
      // Ribbon tail point (behind the board, just over it)
      this.pushRibbon(slot, _p);
      this.writeRibbon(i, slot, shown ? fogK : 0);
      // Far glow dot
      const o = i * 3;
      this.dP[o] = _p.x + slot.up.x * 0.45;
      this.dP[o + 1] = _p.y + slot.up.y * 0.45;
      this.dP[o + 2] = _p.z + slot.up.z * 0.45;
      const near = Math.min(1, Math.max(0, (dist - 50) / 120));
      this.dSA[i * 2] = 1.2;
      this.dSA[i * 2 + 1] = near * Math.sqrt(fogK) * slot.grow;
      // Snow off its board
      if (spray !== null && dist < SPRAY_DIST) {
        _out.set(slot.fwd.z, 0, -slot.fwd.x).normalize();
        // Out of the turn: pulled toward +lat (≈ +x) throws the snow the other way
        if (st.latA > 0) _out.negate();
        const surface = surfaceAt(st.x, st.s);
        if (!st.air)
          spray.board(
            slot.spray,
            _p,
            _vel,
            _out,
            slot.up,
            {
              speed: _vel.length(),
              carve: Math.min(1, Math.abs(st.latA) / 8),
              slide: 0,
              surface,
              grounded: true,
            },
            dt,
            fogK,
          );
        if (st.landed) spray.burst(_p, _vel, slot.up, st.landImpact, surface, fogK);
      }
      // Whoosh as one goes by (either way)
      const rel = st.s - env.riderS;
      if (
        Math.sign(rel) !== Math.sign(slot.rel) &&
        Math.abs(st.lat - env.riderLat) < 30 &&
        Math.abs(st.v - env.riderV) > 8 &&
        this.whooshIn <= 0 &&
        st.age > 0.5
      ) {
        this.whooshIn = 0.35;
        const dv = Math.abs(st.v - env.riderV);
        _v.copy(_p).sub(cam.position);
        const pan = Math.max(-1, Math.min(1, _v.dot(_camR) / 12));
        g.sfx.play('whoosh', {
          gain: Math.min(1, 0.35 + dv / 120) * 0.9,
          rate: Math.min(1.6, Math.max(0.7, dv / 70)),
          pan,
        });
      }
      slot.rel = rel;
    }
    const rg = this.ribbon.geometry;
    rg.getAttribute('position').needsUpdate = true;
    rg.getAttribute('color').needsUpdate = true;
    const dg = this.dots.geometry;
    dg.getAttribute('position').needsUpdate = true;
    dg.getAttribute('aSA').needsUpdate = true;
    const ms = performance.now() - t0;
    this.ms += (ms - this.ms) * 0.05;
  }

  /** Place and animate a visible rider (uses _p, _q: its local position and board frame). */
  private pose(slot: Slot, ch: NounCharacter, dt: number) {
    const st = slot.st;
    // The trick turns about the body's centre
    const k = riderTrickK(st);
    _qt.identity();
    if (st.air && k > 0) {
      if (st.trick === 'spin') _qt.setFromAxisAngle(AY, st.spin * k);
      else if (st.trick === 'flip') _qt.setFromAxisAngle(AX, Math.PI * 2 * k);
      else if (st.trick === 'backflip') _qt.setFromAxisAngle(AX, -Math.PI * 2 * k);
      else if (st.trick === 'cork') {
        _qt.setFromAxisAngle(CORK, st.spin * k);
        _qa.setFromAxisAngle(AX, -Math.PI * 2 * k);
        _qt.multiply(_qa);
      }
    }
    _piv.copy(PIVOT).applyQuaternion(_qt).sub(PIVOT).negate().applyQuaternion(_q);
    ch.root.position.copy(_p).addScaledVector(slot.up, HOVER_EXTRA).add(_piv);
    ch.root.quaternion.copy(_q).multiply(_qt);
    ch.root.scale.setScalar(Math.max(0.01, slot.grow));
    // Clip
    let clip = 'skate_idle';
    let once = false;
    const lean = Math.max(-1, Math.min(1, -st.latA / 7));
    if (st.air) clip = st.trick === 'grab' ? 'skate_grab' : 'skate_air';
    else if (st.sinceLand < 0.35) {
      clip = 'skate_land';
      once = true;
    } else if (Math.abs(lean) > 0.55 || this.kickerAhead(st.s)) clip = 'skate_crouch';
    ch.play({ clip, once, fade: once ? 0.06 : 0.2 });
    ch.update(dt, { lean, travelled: 0, riding: true, grounded: !st.air });
    if (slot.pool !== null) slot.pool.position.y -= HOVER_EXTRA;
  }

  private kickerAhead(s: number): boolean {
    for (const f of this.features)
      if (f.kind === 'kicker' && f.s + f.len - s > 0 && f.s + f.len - s < 45) return true;
    return false;
  }

  private pushRibbon(slot: Slot, p: THREE.Vector3) {
    const up = slot.up;
    const f = slot.fwd;
    slot.head = (slot.head + 1) % SEG;
    const o = slot.head * 3;
    const lift = HOVER_EXTRA + 0.2;
    slot.hist[o] = p.x + up.x * lift - f.x * 0.45;
    slot.hist[o + 1] = p.y + up.y * lift - f.y * 0.45;
    slot.hist[o + 2] = p.z + up.z * lift - f.z * 0.45;
    _x.crossVectors(up, f).normalize();
    slot.side[o] = _x.x;
    slot.side[o + 1] = _x.y;
    slot.side[o + 2] = _x.z;
    slot.count = Math.min(SEG, slot.count + 1);
  }

  private writeRibbon(i: number, slot: Slot, alpha: number) {
    const P = this.rP;
    const C = this.rC;
    const c = slot.tint;
    for (let j = 0; j < SEG; j++) {
      const at = ((slot.head - Math.min(j, slot.count - 1) + SEG) % SEG) * 3;
      const t = j / (SEG - 1);
      const w = RIBBON_W * (1 - t * 0.85) * slot.grow;
      const v = (i * SEG + j) * 2 * 3;
      const hx = slot.hist[at]!;
      const hy = slot.hist[at + 1]!;
      const hz = slot.hist[at + 2]!;
      const sx = slot.side[at]! * w;
      const sy = slot.side[at + 1]! * w;
      const sz = slot.side[at + 2]! * w;
      P[v] = hx - sx;
      P[v + 1] = hy - sy;
      P[v + 2] = hz - sz;
      P[v + 3] = hx + sx;
      P[v + 4] = hy + sy;
      P[v + 5] = hz + sz;
      const a = j < slot.count ? alpha * 0.7 * (1 - t) * (1 - t) : 0;
      const q = (i * SEG + j) * 2 * 4;
      C[q] = C[q + 4] = c.r;
      C[q + 1] = C[q + 5] = c.g;
      C[q + 2] = C[q + 6] = c.b;
      C[q + 3] = C[q + 7] = a;
    }
  }

  rebase(d: THREE.Vector3) {
    for (const s of this.slots)
      for (let j = 0; j < SEG; j++) {
        s.hist[j * 3] = s.hist[j * 3]! + d.x;
        s.hist[j * 3 + 1] = s.hist[j * 3 + 1]! + d.y;
        s.hist[j * 3 + 2] = s.hist[j * 3 + 2]! + d.z;
      }
  }

  dispose() {
    for (const s of this.slots) {
      if (s.ch !== null) riderFree(s.ch);
      s.ch = null;
    }
    inkExcluded.delete(this.fx);
    this.fx.removeFromParent();
    this.ribbon.geometry.dispose();
    (this.ribbon.material as THREE.Material).dispose();
    this.dots.geometry.dispose();
    this.dotMat.dispose();
  }
}

export function createRiders(ctx: PeakCtx): PeakSystem {
  return new Riders(ctx);
}
