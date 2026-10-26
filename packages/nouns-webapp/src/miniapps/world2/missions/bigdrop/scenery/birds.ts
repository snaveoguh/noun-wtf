// ── The Big Drop's weird skies: flocks that cross, pace, soar and drift ──
//
// Four behaviours over three creatures (creatures.ts):
//   CROSS  flocks of nogbirds (and the odd ptero pair) spawned ahead on the
//          line and timed to fly across it about when you get there;
//   PACE   now and then, once you're flying, a flock drops in alongside and
//          keeps pace with you, diving with you down the fall line, then
//          peels off up and away;
//   SOAR   giant pteros circling high over the slope ahead;
//   DRIFT  glowing jelly kites hanging over the slopes (more after dusk).
// Everything lives in local coordinates near the rider; each kind is one
// InstancedMesh positioned on the camera with matrices relative to it.

import type { PeakCtx, PeakSystem } from '../contract';
import type { CreatureKind } from './creatures';

import * as THREE from 'three';

import { inkExcluded } from '../../../render/Toon';
import { peakHeight } from '../../peakTerrain';
import { centerX, TRACK } from '../track';

import {
  creatureMaterial,
  creatureTime,
  jellyGeometry,
  nogbirdGeometry,
  pteroGeometry,
} from './creatures';
import { rng } from './placement';

type Mode = 'cross' | 'pace' | 'soar' | 'drift';

interface Member {
  ox: number;
  oy: number;
  oz: number;
  phase: number;
  rate: number;
  amp: number;
  scale: number;
  tint: THREE.Color;
}

interface Flock {
  kind: CreatureKind;
  mode: Mode;
  t: number;
  life: number;
  centre: THREE.Vector3;
  vel: THREE.Vector3;
  members: Member[];
  /** pace: offset in the rider's frame (right, up, along velocity). */
  off: THREE.Vector3;
  offFrom: THREE.Vector3;
  /** soar: pivot, radius, angular speed, angle. */
  pivot: THREE.Vector3;
  radius: number;
  w: number;
  ang: number;
}

const CAP: Record<CreatureKind, { low: number; medium: number; high: number }> = {
  nogbird: { low: 40, medium: 64, high: 80 },
  ptero: { low: 10, medium: 16, high: 22 },
  jelly: { low: 16, medium: 28, high: 36 },
};
const KINDS: CreatureKind[] = ['nogbird', 'ptero', 'jelly'];

const NOG_TINTS = [0xff638d, 0x2b83f6, 0xffc110, 0x63a0f9, 0xf8d689, 0xe8705b, 0x76d0a6, 0xd5d7e1];
const PTERO_TINTS = [0x3ad6c4, 0xff8a3a, 0xb59cff, 0xff5fa2, 0x9fe870];
const JELLY_TINTS = [0xff9ad6, 0x8af0ff, 0xb8ff7a, 0xc8a0ff, 0xffd27a];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _o = new THREE.Vector3();

interface KindMesh {
  mesh: THREE.InstancedMesh;
  phase: THREE.InstancedBufferAttribute;
  rate: THREE.InstancedBufferAttribute;
  amp: THREE.InstancedBufferAttribute;
  tint: THREE.InstancedBufferAttribute;
  n: number;
}

export class Birds implements PeakSystem {
  private readonly flocks: Flock[] = [];
  private readonly kinds = new Map<CreatureKind, KindMesh>();
  private readonly rand = rng(0xb1d5 ^ (Date.now() & 0xffff));
  private time = 0;
  private crossT = 2;
  private paceT = 9;
  private soarT = 0;
  private driftT = 0;
  private paceNog = true;

  constructor(private ctx: PeakCtx) {
    const q = ctx.quality;
    const geos: Record<CreatureKind, () => THREE.BufferGeometry> = {
      nogbird: nogbirdGeometry,
      ptero: pteroGeometry,
      jelly: jellyGeometry,
    };
    for (const k of KINDS) {
      const cap = CAP[k][q];
      const geo = geos[k]();
      const attr = (size: number) => {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
        a.setUsage(THREE.DynamicDrawUsage);
        return a;
      };
      const phase = attr(1);
      const rate = attr(1);
      const amp = attr(1);
      const tint = attr(3);
      geo.setAttribute('aPhase', phase);
      geo.setAttribute('aRate', rate);
      geo.setAttribute('aAmp', amp);
      geo.setAttribute('aTint', tint);
      const mesh = new THREE.InstancedMesh(geo, creatureMaterial(k, ctx.toon), cap);
      mesh.name = `BigDropCreatures_${k}`;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // The flap bends in the vertex shader; the ink pass's normal render
      // wouldn't, so keep them out of it (the depth edges still ink them)
      inkExcluded.add(mesh);
      ctx.group.add(mesh);
      this.kinds.set(k, { mesh, phase, rate, amp, tint, n: 0 });
    }
  }

  private get rider() {
    return this.ctx.game.player;
  }

  /** Track distance of the rider. */
  private get s(): number {
    return Math.min(TRACK.end, Math.max(TRACK.start, this.ctx.riderPeak.z));
  }

  private used(kind: CreatureKind): number {
    let n = 0;
    for (const f of this.flocks) if (f.kind === kind) n += f.members.length;
    return n;
  }

  private count(mode: Mode): number {
    let n = 0;
    for (const f of this.flocks) if (f.mode === mode) n++;
    return n;
  }

  /** A point over the slope `ahead` m down the line, `lat` m across, `alt` m up (local). */
  private overSlope(ahead: number, lat: number, alt: number, out: THREE.Vector3): THREE.Vector3 {
    const s = Math.min(TRACK.end, this.s + ahead);
    const x = centerX(s) + lat;
    return this.ctx.toLocal(x, peakHeight(x, s) + alt, s, out);
  }

  private flock(
    kind: CreatureKind,
    mode: Mode,
    n: number,
    formation: 'v' | 'swarm' | 'loose',
  ): Flock | null {
    const room = CAP[kind][this.ctx.quality] - this.used(kind);
    n = Math.min(n, room);
    if (n <= 0) return null;
    const r = this.rand;
    const tints = kind === 'nogbird' ? NOG_TINTS : kind === 'ptero' ? PTERO_TINTS : JELLY_TINTS;
    const base = new THREE.Color(tints[Math.floor(r() * tints.length)]!);
    const members: Member[] = [];
    for (let i = 0; i < n; i++) {
      let ox = 0;
      let oy = 0;
      let oz = 0;
      const sp = kind === 'ptero' ? 14 : kind === 'jelly' ? 22 : 5;
      if (formation === 'v') {
        const row = Math.ceil(i / 2);
        const side = i % 2 === 0 ? 1 : -1;
        ox = side * row * sp * 0.9;
        oz = -row * sp * 0.8;
        oy = (r() - 0.5) * sp * 0.3;
      } else {
        const spread = formation === 'swarm' ? sp * 2.2 : sp * 4;
        ox = (r() - 0.5) * spread * 2;
        oy = (r() - 0.5) * spread;
        oz = (r() - 0.5) * spread * 2;
      }
      const tint = base.clone();
      if (r() < 0.25) tint.set(tints[Math.floor(r() * tints.length)]!);
      members.push({
        ox,
        oy,
        oz,
        phase: r() * Math.PI * 2,
        rate: kind === 'nogbird' ? 9 + r() * 4 : kind === 'ptero' ? 2.6 + r() : 1.4 + r() * 1.2,
        amp: kind === 'nogbird' ? 0.65 : kind === 'ptero' ? 0.55 : 0,
        scale: kind === 'jelly' ? 0.9 + r() * 1.2 : 0.9 + r() * 0.6,
        tint,
      });
    }
    const f: Flock = {
      kind,
      mode,
      t: 0,
      life: 60,
      centre: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      members,
      off: new THREE.Vector3(),
      offFrom: new THREE.Vector3(),
      pivot: new THREE.Vector3(),
      radius: 0,
      w: 0,
      ang: 0,
    };
    this.flocks.push(f);
    return f;
  }

  // ── Spawning ──────────────────────────────────────────────────────────

  private spawn(dt: number) {
    const ctx = this.ctx;
    const q = ctx.quality;
    const r = this.rand;
    const speed = Math.max(20, this.rider.speed);
    const night = Math.min(1, ctx.depth / 400_000);
    // CROSS: timed to cross the line about when you arrive
    this.crossT -= dt;
    if (this.crossT <= 0 && this.count('cross') < (q === 'low' ? 2 : 4)) {
      this.crossT = 2.5 + r() * 4;
      const ahead = Math.min(2600, Math.max(380, speed * (5 + r() * 4)));
      const eta = ahead / speed;
      const ptero = r() < 0.22;
      const f = this.flock(
        ptero ? 'ptero' : 'nogbird',
        'cross',
        ptero ? 2 + Math.floor(r() * 2) : 6 + Math.floor(r() * 12),
        ptero ? 'loose' : r() < 0.5 ? 'v' : 'swarm',
      );
      if (f !== null) {
        const side = r() < 0.5 ? -1 : 1;
        const v = ptero ? 22 + r() * 10 : 16 + r() * 12;
        const lat = Math.min(1600, v * eta * (0.75 + r() * 0.4)) + 30;
        this.overSlope(ahead, side * lat, 18 + r() * 90, f.centre);
        f.vel.set(-side * v, (r() - 0.6) * 3, (r() - 0.3) * 8);
        f.life = eta * 2.5 + 20;
      }
    }
    // PACE: a flock comes alongside once you're flying
    if (this.rider.speed > 28) this.paceT -= dt;
    if (this.paceT <= 0 && this.count('pace') === 0) {
      this.paceT = 18 + r() * 18;
      const nog = this.paceNog;
      this.paceNog = !nog;
      const f = nog
        ? this.flock('nogbird', 'pace', 5 + Math.floor(r() * 5), 'v')
        : this.flock('ptero', 'pace', 2 + Math.floor(r() * 2), 'loose');
      if (f !== null) {
        const side = r() < 0.5 ? -1 : 1;
        f.off.set(
          side * (nog ? 16 + r() * 14 : 30 + r() * 20),
          nog ? 6 + r() * 8 : 12 + r() * 12,
          nog ? 6 + r() * 14 : 10 + r() * 20,
        );
        f.offFrom.set(f.off.x * 3, f.off.y + 40, f.off.z + 140);
        f.life = 9 + r() * 5;
        this.paceFrame();
        _o.copy(_right)
          .multiplyScalar(f.offFrom.x)
          .addScaledVector(_up, f.offFrom.y)
          .addScaledVector(_fwd, f.offFrom.z);
        f.centre.copy(this.rider.pos).add(_o);
      }
    }
    // SOAR: giant pteros circling over the slope ahead
    this.soarT -= dt;
    if (this.soarT <= 0 && this.count('soar') < (q === 'low' ? 1 : 3)) {
      this.soarT = 3 + r() * 5;
      const f = this.flock('ptero', 'soar', 1 + Math.floor(r() * 2), 'loose');
      if (f !== null) {
        const ahead = Math.min(3500, Math.max(600, speed * (8 + r() * 10)));
        this.overSlope(ahead, (r() - 0.5) * 1400, 160 + r() * 260, f.pivot);
        f.radius = 120 + r() * 220;
        f.w = (r() < 0.5 ? -1 : 1) * (0.12 + r() * 0.1);
        f.ang = r() * Math.PI * 2;
        f.life = 90;
        for (const m of f.members) m.scale *= 2.4;
      }
    }
    // DRIFT: glowing jelly kites hanging over the slope
    this.driftT -= dt;
    if (this.driftT <= 0 && this.count('drift') < Math.round((q === 'low' ? 1 : 2) + 3 * night)) {
      this.driftT = 2 + r() * 4;
      const f = this.flock('jelly', 'drift', 3 + Math.floor(r() * 6), 'loose');
      if (f !== null) {
        const ahead = Math.min(3000, Math.max(400, speed * (6 + r() * 8)));
        const side = r() < 0.5 ? -1 : 1;
        this.overSlope(ahead, side * (60 + r() * 500), 30 + r() * 160, f.centre);
        f.vel.set((r() - 0.5) * 5, (r() - 0.5) * 1.5, (r() - 0.5) * 5);
        f.life = 120;
      }
    }
  }

  /** The rider's frame: along the velocity (dives with you), right, up. */
  private paceFrame() {
    const p = this.rider;
    if (p.vel.lengthSq() > 4) _fwd.copy(p.vel).normalize();
    else _fwd.copy(p.fwd).normalize();
    _right.crossVectors(_fwd, _up);
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
    _right.normalize();
  }

  // ── Per frame ─────────────────────────────────────────────────────────

  update(dt: number) {
    this.time += dt;
    creatureTime.value = this.time;
    this.spawn(dt);
    const p = this.rider;
    const rp = p.pos;
    this.paceFrame();
    for (let i = this.flocks.length - 1; i >= 0; i--) {
      const f = this.flocks[i]!;
      f.t += dt;
      switch (f.mode) {
        case 'pace': {
          const enter = THREE.MathUtils.smoothstep(f.t, 0, 2.5);
          const leave = Math.max(0, f.t - (f.life - 3));
          _v.lerpVectors(f.offFrom, f.off, enter);
          // Peel off: climb, swing out and fall behind
          _v.x += Math.sign(f.off.x) * leave * leave * 6;
          _v.y += leave * leave * 9;
          _v.z -= leave * leave * Math.max(8, p.speed * 0.6);
          _o.copy(_right)
            .multiplyScalar(_v.x)
            .addScaledVector(_up, _v.y)
            .addScaledVector(_fwd, _v.z);
          const prevX = f.centre.x;
          const prevY = f.centre.y;
          const prevZ = f.centre.z;
          f.centre.copy(rp).add(_o);
          if (dt > 0)
            f.vel.set(
              (f.centre.x - prevX) / dt,
              (f.centre.y - prevY) / dt,
              (f.centre.z - prevZ) / dt,
            );
          break;
        }
        case 'soar': {
          f.ang += f.w * dt;
          f.centre.set(
            f.pivot.x + Math.cos(f.ang) * f.radius,
            f.pivot.y + Math.sin(f.t * 0.3) * 12,
            f.pivot.z + Math.sin(f.ang) * f.radius,
          );
          f.vel.set(-Math.sin(f.ang) * f.radius * f.w, 0, Math.cos(f.ang) * f.radius * f.w);
          break;
        }
        case 'drift':
          f.centre.addScaledVector(f.vel, dt);
          f.centre.y += Math.sin(f.t * 0.5) * 0.4 * dt;
          break;
        default:
          f.centre.addScaledVector(f.vel, dt);
      }
      // Gone: too far, well behind you, or done
      _v.subVectors(f.mode === 'soar' ? f.pivot : f.centre, rp);
      const along = _v.dot(_fwd);
      if (f.t > f.life || _v.lengthSq() > 5000 * 5000 || (f.mode !== 'pace' && along < -700))
        this.flocks.splice(i, 1);
    }
    this.write();
  }

  private write() {
    const cam = this.ctx.game.gfx.camera.position;
    for (const k of this.kinds.values()) k.n = 0;
    const t = this.time;
    for (const f of this.flocks) {
      const km = this.kinds.get(f.kind)!;
      const v = f.vel;
      const sp = v.length();
      const yaw = sp > 0.5 ? Math.atan2(v.x, v.z) : 0;
      const pitch = sp > 0.5 ? -Math.asin(Math.max(-1, Math.min(1, v.y / sp))) : 0;
      _e.set(0, yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      for (let i = 0; i < f.members.length; i++) {
        const m = f.members[i]!;
        const n = km.n;
        if (n >= km.mesh.instanceMatrix.count) break;
        // Formation offset turned with the flock, plus a lazy wobble
        _o.set(m.ox, m.oy, m.oz).applyQuaternion(_q);
        const wob = f.kind === 'jelly' ? 3 : f.kind === 'ptero' ? 2 : 1.2;
        _o.x += Math.sin(t * 0.9 + m.phase) * wob;
        _o.y += Math.sin(t * 1.3 + m.phase * 1.7) * wob * 0.6;
        _o.z += Math.cos(t * 0.7 + m.phase) * wob;
        _p.copy(f.centre).add(_o).sub(cam);
        if (f.kind === 'jelly')
          _e.set(
            Math.sin(t * 0.4 + m.phase) * 0.15,
            t * 0.2 + m.phase,
            Math.cos(t * 0.3 + m.phase) * 0.15,
            'YXZ',
          );
        else {
          const bank =
            (f.mode === 'soar' ? -0.45 * Math.sign(f.w) : 0) + Math.sin(t * 0.9 + m.phase) * 0.25;
          _e.set(pitch, yaw, bank, 'YXZ');
        }
        _q.setFromEuler(_e);
        _s.setScalar(m.scale);
        _m.compose(_p, _q, _s);
        km.mesh.setMatrixAt(n, _m);
        // Restore the flock's heading for the next member's offset
        _e.set(0, yaw, 0, 'YXZ');
        _q.setFromEuler(_e);
        km.phase.setX(n, m.phase);
        // Pacers flap hard; pteros glide with a few slow beats; divers tuck in
        let rate = m.rate;
        let amp = m.amp;
        if (f.kind === 'ptero') amp *= Math.sin(t * 0.35 + m.phase) > 0.3 ? 1 : 0.15;
        if (f.mode === 'pace') {
          rate *= 1.3;
          if (f.kind === 'ptero') amp = 0.12;
        }
        km.rate.setX(n, rate);
        km.amp.setX(n, amp);
        km.tint.setXYZ(n, m.tint.r, m.tint.g, m.tint.b);
        km.n = n + 1;
      }
    }
    for (const k of this.kinds.values()) {
      k.mesh.count = k.n;
      k.mesh.position.copy(cam);
      if (k.n === 0) continue;
      k.mesh.instanceMatrix.needsUpdate = true;
      k.phase.needsUpdate = true;
      k.rate.needsUpdate = true;
      k.amp.needsUpdate = true;
      k.tint.needsUpdate = true;
    }
  }

  rebase(d: THREE.Vector3) {
    for (const f of this.flocks) {
      f.centre.add(d);
      f.pivot.add(d);
    }
  }

  /** For the perf readout. */
  get live() {
    let n = 0;
    for (const f of this.flocks) n += f.members.length;
    return { flocks: this.flocks.length, creatures: n };
  }

  dispose() {
    for (const k of this.kinds.values()) {
      inkExcluded.delete(k.mesh);
      this.ctx.group.remove(k.mesh);
      k.mesh.geometry.dispose();
      (k.mesh.material as THREE.Material).dispose();
      k.mesh.dispose();
    }
    this.kinds.clear();
    this.flocks.length = 0;
  }
}

export const makeBirds = (ctx: PeakCtx): PeakSystem => new Birds(ctx);
