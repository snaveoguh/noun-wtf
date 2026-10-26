// ── The Big Drop: snow spray off the boards, wind streaks, the sound barrier ──
//
// A PeakSystem. One pooled point cloud of snow in LOCAL coordinates round
// the rider (float32-safe, shifted on a rebase, outside the ink outline):
//   • a rooster tail / curtain off the board's outside edge when carving
//     hard, powersliding or braking: far bigger in powder (surfaceAt);
//   • a burst on landing, scaled by the impact; a fine mist at speed;
//   • the NPC hoverboarders (riders.ts) throw the same snow through
//     `sprayActive()`.
// Speed effects: wind streak lines past the camera from ~500 km/h, and at
// the speed of sound (1,235 km/h, and every Mach after) a vapour cone, a
// shockwave ring you fly through and a boom. A hiss under the spray.
// The rules (how much, when) are pure, in sprayRules.ts.

import type { PeakCtx, PeakSystem } from './contract';
import type { SnowSurface } from './surface';

import * as THREE from 'three';

import { inkExcluded } from '../../render/Toon';

import {
  sprayBoom,
  sprayCarveRate,
  sprayIntensity,
  sprayLandCount,
  sprayMistRate,
  spraySurfaceMult,
  sprayTake,
  sprayVapour,
  sprayWindAmount,
  type SprayInput,
} from './sprayRules';
import { surfaceAt } from './surface';

/** Pool size by quality. */
const POOL = { low: 1200, medium: 2000, high: 3000 } as const;
/** Wind streak lines by quality. */
const STREAKS = { low: 36, medium: 60, high: 90 } as const;
/** Snow falls a little faster than the riders do (it isn't floating on a board). */
const SNOW_G = 6;
/** The streak box round the camera (half-length along the motion, m). */
const STREAK_L = 70;

/** Per-board emission state (the caller owns one). */
export interface SprayBoard {
  edge: { a: number };
  mist: { a: number };
}

export const sprayBoard = (): SprayBoard => ({ edge: { a: 0 }, mist: { a: 0 } });

let active: SprayFx | null = null;

/** The live spray system while inside the Big Drop (NPC boards spray through it). */
export function sprayActive(): SprayFx | null {
  return active;
}

const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _out = new THREE.Vector3();
const _pk = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

/** Tangents of `up` (any two perpendicular unit vectors). */
function tangents(up: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  a.crossVectors(up, Math.abs(up.y) < 0.9 ? Y : _pk.set(1, 0, 0)).normalize();
  b.crossVectors(up, a).normalize();
}

const VERT = /* glsl */ `
  attribute vec3 aSA;
  varying float vA;
  varying float vShade;
  uniform float scale;
  void main() {
    vA = aSA.y;
    vShade = aSA.z;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSA.y > 0.003 ? min(320.0, aSA.x * scale / max(0.05, -mv.z)) : 0.0;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */ `
  varying float vA;
  varying float vShade;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = vA * (1.0 - smoothstep(0.35, 1.0, d));
    if (a < 0.01) discard;
    // Blue-grey shadowed flakes to bright white, so spray reads on white snow
    gl_FragColor = vec4(mix(vec3(0.66, 0.75, 0.88), vec3(1.0), vShade), a);
  }`;

export class SprayFx {
  private readonly n: number;
  private readonly P: Float32Array;
  private readonly V: Float32Array;
  private readonly SA: Float32Array;
  /** Per particle: age, life, base size, base alpha, drag. */
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size0: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly drag: Float32Array;
  private next = 0;
  private live = 0;
  private readonly points: THREE.Points;
  private readonly mat: THREE.ShaderMaterial;
  readonly group = new THREE.Group();
  // Wind
  private readonly streaks: THREE.LineSegments;
  private readonly sP: Float32Array;
  private readonly sC: Float32Array;
  private readonly sU: Float32Array;
  private readonly sA: Float32Array;
  // Sound barrier
  private readonly rings: { mesh: THREE.Mesh; t: number; dur: number; r0: number; r1: number }[] =
    [];
  private readonly cone: THREE.Mesh;
  private readonly boomArmed = { next: 1 };
  // The player's board
  private readonly me = sprayBoard();
  private lastSinceLand = 10;
  private hiss: { gain: GainNode; src: AudioBufferSourceNode } | null = null;
  private hissLevel = 0;
  /** ms spent in update (a running average, for the perf check). */
  ms = 0;

  constructor(private ctx: PeakCtx) {
    const q = ctx.quality;
    const n = POOL[q];
    this.n = n;
    this.P = new Float32Array(n * 3);
    this.V = new Float32Array(n * 3);
    this.SA = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1);
    this.life = new Float32Array(n).fill(0);
    this.size0 = new Float32Array(n);
    this.alpha0 = new Float32Array(n);
    this.drag = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.P, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geo.setAttribute('aSA', new THREE.BufferAttribute(this.SA, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.name = 'BigDropSpray';
    // Draw after the riders' glows
    this.points.renderOrder = 2;
    this.group.add(this.points);

    // Wind streaks: segments round the camera along the motion
    const ns = STREAKS[q];
    this.sP = new Float32Array(ns * 6);
    this.sC = new Float32Array(ns * 8);
    this.sU = new Float32Array(ns * 2);
    this.sA = new Float32Array(ns);
    for (let i = 0; i < ns; i++) this.respawnStreak(i, (Math.random() * 2 - 1) * STREAK_L);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute(
      'position',
      new THREE.BufferAttribute(this.sP, 3).setUsage(THREE.DynamicDrawUsage),
    );
    sg.setAttribute(
      'color',
      new THREE.BufferAttribute(this.sC, 4).setUsage(THREE.DynamicDrawUsage),
    );
    this.streaks = new THREE.LineSegments(
      sg,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
    this.streaks.name = 'BigDropWind';
    this.group.add(this.streaks);

    // Shockwave rings (two, reused) and the vapour cone
    const ringGeo = new THREE.RingGeometry(0.9, 1, 96);
    for (const [color, inner] of [
      [0xffffff, 0.9],
      [0xbfe8ff, 0.7],
    ] as const) {
      const g = inner === 0.9 ? ringGeo : new THREE.RingGeometry(inner, 1, 96);
      const m = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        }),
      );
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.rings.push({ mesh: m, t: 1, dur: 1, r0: 1, r1: 1 });
    }
    const coneGeo = new THREE.ConeGeometry(2.6, 4.8, 40, 1, true);
    // Apex forward: the cone's +Y becomes the direction of travel
    coneGeo.translate(0, -2.4, 0);
    this.cone = new THREE.Mesh(
      coneGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        alphaMap: vapourTexture(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    this.cone.visible = false;
    this.cone.name = 'BigDropVapour';
    this.group.add(this.cone);

    this.group.name = 'BigDropFx';
    ctx.group.add(this.group);
    inkExcluded.add(this.group);
  }

  private respawnStreak(i: number, a: number) {
    const ang = Math.random() * Math.PI * 2;
    const r = 2.4 + Math.pow(Math.random(), 0.7) * 15;
    this.sU[i * 2] = Math.cos(ang) * r;
    this.sU[i * 2 + 1] = Math.sin(ang) * r * 0.7;
    this.sA[i] = a;
  }

  /** One particle (local coordinates). */
  private emit(
    px: number,
    py: number,
    pz: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    alpha: number,
    life: number,
    drag: number,
  ) {
    const i = this.next;
    this.next = (i + 1) % this.n;
    const o = i * 3;
    this.P[o] = px;
    this.P[o + 1] = py;
    this.P[o + 2] = pz;
    this.V[o] = vx;
    this.V[o + 1] = vy;
    this.V[o + 2] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = size;
    this.alpha0[i] = alpha;
    this.drag[i] = drag;
    this.SA[o + 2] = 0.55 + Math.random() * 0.45;
    if (this.live < this.n) this.live++;
  }

  /**
   * A board on the snow this frame: the rooster tail off its outside edge and
   * the mist at speed. `out` is the unit vector out of the turn (where the
   * snow goes), `up` the board's up; positions and velocities are LOCAL.
   * `fade` (0..1) dims far boards in the fog. Returns the edge intensity.
   */
  board(
    src: SprayBoard,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    out: THREE.Vector3,
    up: THREE.Vector3,
    input: SprayInput,
    dt: number,
    fade = 1,
  ): number {
    const k = sprayIntensity(input);
    const n = sprayTake(src.edge, sprayCarveRate(input), dt, 48);
    const powder = input.surface === 'powder';
    const throwOut = (2.5 + 7 * k) * (powder ? 1.3 : 1);
    const throwUp = (2 + 6.5 * k) * (powder ? 1.7 : 1);
    const big = powder ? 1.45 : 1;
    for (let j = 0; j < n; j++) {
      // Spread along this frame's path so fast boards leave a continuous tail
      const back = Math.random() * dt;
      const r1 = Math.random();
      const r2 = Math.random();
      const keep = 0.72 + Math.random() * 0.2;
      this.emit(
        pos.x - vel.x * back + out.x * (0.22 + r1 * 0.25) + up.x * 0.06,
        pos.y - vel.y * back + out.y * (0.22 + r1 * 0.25) + up.y * 0.06,
        pos.z - vel.z * back + out.z * (0.22 + r1 * 0.25) + up.z * 0.06,
        vel.x * keep +
          out.x * throwOut * (0.4 + r1) +
          up.x * throwUp * r2 +
          (Math.random() - 0.5) * 1.6,
        vel.y * keep +
          out.y * throwOut * (0.4 + r1) +
          up.y * throwUp * r2 +
          (Math.random() - 0.5) * 1.6,
        vel.z * keep +
          out.z * throwOut * (0.4 + r1) +
          up.z * throwUp * r2 +
          (Math.random() - 0.5) * 1.6,
        (0.16 + Math.random() * 0.34) * big * (0.7 + k * 0.6),
        0.9 * fade,
        0.55 + Math.random() * 0.7 + (powder ? 0.4 : 0),
        1.4 + Math.random() * 0.8,
      );
    }
    const speed = vel.length();
    const m = sprayTake(src.mist, sprayMistRate(speed, input.surface, input.grounded), dt, 8);
    for (let j = 0; j < m; j++) {
      const back = Math.random() * dt;
      this.emit(
        pos.x - vel.x * back + (Math.random() - 0.5) * 0.8,
        pos.y - vel.y * back + 0.15 + Math.random() * 0.3,
        pos.z - vel.z * back + (Math.random() - 0.5) * 0.8,
        vel.x * 0.55 + up.x * 1.2 + (Math.random() - 0.5) * 3,
        vel.y * 0.55 + up.y * 1.2 + (Math.random() - 0.5) * 2,
        vel.z * 0.55 + up.z * 1.2 + (Math.random() - 0.5) * 3,
        1.1 + Math.random() * 1.4,
        0.22 * fade,
        0.8 + Math.random() * 0.8,
        3.2,
      );
    }
    return k * spraySurfaceMult(input.surface);
  }

  /** A landing: a ring of snow out round the board, scaled by the impact (m/s). */
  burst(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    up: THREE.Vector3,
    impact: number,
    surface: SnowSurface,
    fade = 1,
  ) {
    const n = sprayLandCount(impact, surface);
    if (n === 0) return;
    tangents(up, _t1, _t2);
    const outV = 3 + Math.min(18, impact * 0.6);
    const upV = 2 + Math.min(14, impact * 0.4);
    const powder = surface === 'powder';
    for (let j = 0; j < n; j++) {
      const a = Math.random() * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const r = 0.4 + Math.random();
      const ox = _t1.x * c + _t2.x * s;
      const oy = _t1.y * c + _t2.y * s;
      const oz = _t1.z * c + _t2.z * s;
      const u = Math.random();
      this.emit(
        pos.x + ox * 0.5,
        pos.y + oy * 0.5 + 0.05,
        pos.z + oz * 0.5,
        vel.x * 0.55 + ox * outV * r + up.x * upV * u,
        vel.y * 0.55 + oy * outV * r + up.y * upV * u,
        vel.z * 0.55 + oz * outV * r + up.z * upV * u,
        (0.25 + Math.random() * 0.55) * (powder ? 1.5 : 1),
        0.9 * fade,
        0.7 + Math.random() * 0.9 + (powder ? 0.5 : 0),
        1.6 + Math.random(),
      );
    }
  }

  update(dt: number) {
    const t0 = performance.now();
    const g = this.ctx.game;
    const p = g.player;
    const cam = g.gfx.camera;
    // Point size in pixels per metre at 1 m
    const h = g.gfx.renderer.domElement.height;
    this.mat.uniforms.scale!.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));

    // The player's board
    const speed = p.speed;
    const riding = p.mode === 'board' && p.state !== 'bail';
    const grounded = riding && (p.state === 'ground' || p.state === 'manual');
    const rp = this.ctx.riderPeak;
    const surface = surfaceAt(rp.x, rp.z);
    let hiss = 0;
    if (riding) {
      const side = _out.copy(p.side);
      // Outside of the turn: lean right (+) bends right, so the snow goes left (+side)
      const sign = p.lean >= 0 ? 1 : -1;
      side.multiplyScalar(sign);
      hiss = this.board(
        this.me,
        p.pos,
        p.vel,
        side,
        p.up,
        { speed, carve: Math.abs(p.lean), slide: p.powerslide, surface, grounded },
        dt,
      );
      if (p.sinceLand < this.lastSinceLand && p.sinceLand < 0.25)
        this.burst(p.pos, p.vel, p.up, p.lastLandImpact, surface);
    }
    this.lastSinceLand = p.sinceLand;

    // Integrate the pool
    if (this.live > 0) {
      const P = this.P;
      const V = this.V;
      const SA = this.SA;
      let alive = 0;
      for (let i = 0; i < this.n; i++) {
        const o = i * 3;
        const life = this.life[i]!;
        let age = this.age[i]!;
        if (age >= life) {
          SA[o + 1] = 0;
          continue;
        }
        age += dt;
        this.age[i] = age;
        if (age >= life) {
          SA[o + 1] = 0;
          continue;
        }
        alive++;
        const k = Math.exp(-this.drag[i]! * dt);
        V[o] = V[o]! * k;
        V[o + 1] = V[o + 1]! * k - SNOW_G * dt;
        V[o + 2] = V[o + 2]! * k;
        P[o] = P[o]! + V[o]! * dt;
        P[o + 1] = P[o + 1]! + V[o + 1]! * dt;
        P[o + 2] = P[o + 2]! + V[o + 2]! * dt;
        const f = age / life;
        SA[o] = this.size0[i]! * (1 + f * 1.6);
        SA[o + 1] = this.alpha0[i]! * Math.min(1, age * 25) * (1 - f) * (1 - f * 0.5);
      }
      this.live = alive;
      const geo = this.points.geometry;
      geo.getAttribute('position').needsUpdate = true;
      geo.getAttribute('aSA').needsUpdate = true;
    }

    this.updateWind(dt, speed, p.vel, cam.position);
    this.updateBarrier(dt, speed, p.pos, p.vel, p.up);
    this.updateHiss(grounded ? hiss : 0);
    const ms = performance.now() - t0;
    this.ms += (ms - this.ms) * 0.05;
  }

  private updateWind(dt: number, speed: number, vel: THREE.Vector3, cam: THREE.Vector3) {
    const amount = sprayWindAmount(speed);
    this.streaks.visible = amount > 0.01;
    if (!this.streaks.visible) return;
    _dir.copy(vel).normalize();
    tangents(_dir, _t1, _t2);
    const ns = this.sA.length;
    const P = this.sP;
    const C = this.sC;
    const len = 4 + amount * Math.min(24, speed * 0.05);
    const flow = speed * 0.85 * dt;
    for (let i = 0; i < ns; i++) {
      let a = this.sA[i]! - flow;
      if (a < -STREAK_L) {
        this.respawnStreak(i, STREAK_L - Math.random() * 10);
        a = this.sA[i]!;
      }
      this.sA[i] = a;
      const u = this.sU[i * 2]!;
      const v = this.sU[i * 2 + 1]!;
      const hx = _t1.x * u + _t2.x * v + _dir.x * a;
      const hy = _t1.y * u + _t2.y * v + _dir.y * a;
      const hz = _t1.z * u + _t2.z * v + _dir.z * a;
      const o = i * 6;
      P[o] = hx;
      P[o + 1] = hy;
      P[o + 2] = hz;
      P[o + 3] = hx - _dir.x * len;
      P[o + 4] = hy - _dir.y * len;
      P[o + 5] = hz - _dir.z * len;
      const edge = 1 - Math.abs(a) / STREAK_L;
      const al = amount * 0.55 * Math.min(1, edge * 3);
      const c = i * 8;
      C[c] = C[c + 1] = C[c + 2] = 1;
      C[c + 3] = al;
      C[c + 4] = 0.85;
      C[c + 5] = 0.92;
      C[c + 6] = 1;
      C[c + 7] = 0;
    }
    this.streaks.position.copy(cam);
    const geo = this.streaks.geometry;
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('color').needsUpdate = true;
  }

  private updateBarrier(
    dt: number,
    speed: number,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    up: THREE.Vector3,
  ) {
    _dir.copy(vel);
    if (speed > 1) _dir.divideScalar(speed);
    // The vapour cone, right at the barrier
    const vap = sprayVapour(speed);
    this.cone.visible = vap > 0.01;
    if (this.cone.visible) {
      (this.cone.material as THREE.MeshBasicMaterial).opacity = vap * 0.6;
      _q.setFromUnitVectors(Y, _dir);
      this.cone.quaternion.copy(_q);
      this.cone.position.copy(pos).addScaledVector(up, 0.9).addScaledVector(_dir, 1.6);
      this.cone.scale.setScalar(0.9 + vap * 0.25);
    }
    const mach = sprayBoom(speed, this.boomArmed);
    if (mach > 0) {
      // A ring in the air just ahead: you fly through it as it grows
      for (let i = 0; i < this.rings.length; i++) {
        const r = this.rings[i]!;
        r.t = 0;
        r.dur = i === 0 ? 1.1 : 1.6;
        r.r0 = 1.5;
        r.r1 = i === 0 ? 90 : 55;
        r.mesh.visible = true;
        r.mesh.quaternion.setFromUnitVectors(_t1.set(0, 0, 1), _dir);
        r.mesh.position
          .copy(pos)
          .addScaledVector(up, 0.9)
          .addScaledVector(_dir, 4 + i * 3);
      }
      const sfx = this.ctx.game.sfx;
      sfx.play('cut-boom', { gain: 1.1 });
      sfx.play('whoosh', { gain: 0.8, rate: 0.6 });
      // The snow round you goes too
      this.burst(pos, vel, up, 30, 'powder');
    }
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k) * (1 - k);
    }
  }

  /** A hiss under the spray (filtered noise, follows how hard the edge bites). */
  private updateHiss(level: number) {
    const au = this.ctx.game.audio;
    const ac = au.ctx;
    if (ac === null || au.master === null || au.noise === null) return;
    const want = Math.min(1, level / 2.2) * 0.16;
    if (this.hiss === null) {
      if (want <= 0.001) return;
      const gain = ac.createGain();
      gain.gain.value = 0;
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1600;
      const src = ac.createBufferSource();
      src.buffer = au.noise;
      src.loop = true;
      src.connect(hp).connect(gain).connect(au.master);
      src.start();
      this.hiss = { gain, src };
    }
    if (Math.abs(want - this.hissLevel) > 0.004) {
      this.hissLevel = want;
      this.hiss.gain.gain.setTargetAtTime(want, ac.currentTime, 0.06);
    }
  }

  rebase(d: THREE.Vector3) {
    const P = this.P;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i]! >= this.life[i]!) continue;
      const o = i * 3;
      P[o] = P[o]! + d.x;
      P[o + 1] = P[o + 1]! + d.y;
      P[o + 2] = P[o + 2]! + d.z;
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
    for (const r of this.rings) r.mesh.position.add(d);
    this.cone.position.add(d);
  }

  dispose() {
    if (active === this) active = null;
    inkExcluded.delete(this.group);
    this.group.removeFromParent();
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry !== undefined) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat !== undefined) {
        (mat as THREE.MeshBasicMaterial).alphaMap?.dispose();
        mat.dispose();
      }
    });
    const h = this.hiss;
    this.hiss = null;
    const ac = this.ctx.game.audio.ctx;
    if (h !== null && ac !== null) {
      h.gain.gain.setTargetAtTime(0, ac.currentTime, 0.08);
      h.src.stop(ac.currentTime + 0.5);
      setTimeout(() => h.gain.disconnect(), 800);
    }
  }
}

/** Soft streaky alpha for the vapour cone: solid at the apex, gone at the rim. */
function vapourTexture(): THREE.Texture {
  const w = 128;
  const hgt = 64;
  const data = new Uint8Array(w * hgt * 4);
  for (let y = 0; y < hgt; y++)
    for (let x = 0; x < w; x++) {
      // v = 1 at the apex (cone UV), streaks round it
      const v = y / (hgt - 1);
      const streak = 0.65 + 0.35 * Math.sin(x * 0.7 + Math.sin(x * 0.23) * 3);
      const a = Math.pow(v, 1.6) * streak * 255;
      const o = (y * w + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = Math.round(a);
      data[o + 3] = 255;
    }
  const t = new THREE.DataTexture(data, w, hgt);
  t.needsUpdate = true;
  return t;
}

export function createSpray(ctx: PeakCtx): PeakSystem {
  const fx = new SprayFx(ctx);
  active = fx;
  return fx;
}
