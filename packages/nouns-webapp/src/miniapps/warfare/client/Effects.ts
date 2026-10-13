// ── Paint in flight + bursts ────────────────────────────────────────────
//
// Projectiles: one InstancedMesh of glossy paint balls (team-coloured,
// unlit so they read at night), interpolated between sim ticks.
// Bursts: instanced droplets with gravity for every pop, plus expanding
// rings for grenade / launcher blasts.

import type { Projectile } from '../sim/types';

import * as THREE from 'three';

import { inkExcluded } from '@/miniapps/world2/render/Toon';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

interface Drop {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  color: number;
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  radius: number;
}

export class Effects {
  group = new THREE.Group();
  private balls: THREE.InstancedMesh;
  private dropsMesh: THREE.InstancedMesh;
  private drops: Drop[] = [];
  private maxDrops: number;
  private rings: Ring[] = [];
  private ringGeo = new THREE.RingGeometry(0.7, 1, 40);
  /** Last-tick positions per projectile id, for interpolation. */
  private prev = new Map<number, { x: number; y: number; z: number }>();
  private cur = new Map<number, { x: number; y: number; z: number }>();
  /** Muzzle offsets for the local player's fresh balls (decays to 0). */
  private muzzle = new Map<number, { x: number; y: number; z: number; t: number }>();

  constructor(lowQuality: boolean) {
    const ballGeo = new THREE.IcosahedronGeometry(1, 1);
    const ballMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.balls = new THREE.InstancedMesh(ballGeo, ballMat, 320);
    this.balls.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(320 * 3), 3);
    this.balls.count = 0;
    this.balls.frustumCulled = false;
    this.group.add(this.balls);
    inkExcluded.add(this.balls);
    this.maxDrops = lowQuality ? 220 : 600;
    const dropGeo = new THREE.IcosahedronGeometry(1, 0);
    const dropMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.dropsMesh = new THREE.InstancedMesh(dropGeo, dropMat, this.maxDrops);
    this.dropsMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.maxDrops * 3),
      3,
    );
    this.dropsMesh.count = 0;
    this.dropsMesh.frustumCulled = false;
    this.group.add(this.dropsMesh);
    inkExcluded.add(this.dropsMesh);
  }

  /** Call after each sim tick with the live projectile list. */
  tick(projectiles: readonly Projectile[]) {
    const next = new Map<number, { x: number; y: number; z: number }>();
    for (const p of projectiles) {
      const c = this.cur.get(p.id);
      this.prev.set(p.id, c ?? { x: p.x, y: p.y, z: p.z });
      next.set(p.id, { x: p.x, y: p.y, z: p.z });
    }
    for (const id of this.prev.keys()) if (!next.has(id)) this.prev.delete(id);
    for (const id of this.muzzle.keys()) if (!next.has(id)) this.muzzle.delete(id);
    this.cur = next;
  }

  /** Visual muzzle offset for a fresh local projectile (world-space delta). */
  setMuzzle(id: number, dx: number, dy: number, dz: number) {
    this.muzzle.set(id, { x: dx, y: dy, z: dz, t: 0 });
  }

  render(projectiles: readonly Projectile[], alpha: number, dt: number) {
    let n = 0;
    for (const p of projectiles) {
      if (n >= 320) break;
      const a = this.prev.get(p.id);
      const b = this.cur.get(p.id);
      if (a === undefined || b === undefined) continue;
      _p.set(a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha, a.z + (b.z - a.z) * alpha);
      const mz = this.muzzle.get(p.id);
      if (mz !== undefined) {
        mz.t += dt;
        const k = Math.max(0, 1 - mz.t / 0.09);
        _p.x += mz.x * k;
        _p.y += mz.y * k;
        _p.z += mz.z * k;
      }
      const r = p.kind === 'ball' ? Math.max(0.055, p.radius) : p.radius * 1.4;
      _s.set(r, r, r);
      _q.identity();
      _m.compose(_p, _q, _s);
      this.balls.setMatrixAt(n, _m);
      _c.setHex(p.color);
      if (p.kind !== 'ball') _c.multiplyScalar(0.8);
      this.balls.setColorAt(n, _c);
      n++;
    }
    this.balls.count = n;
    this.balls.instanceMatrix.needsUpdate = true;
    if (this.balls.instanceColor) this.balls.instanceColor.needsUpdate = true;
    this.updateDrops(dt);
    this.updateRings(dt);
  }

  /** Paint pop: droplets thrown off along the normal. */
  burst(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    color: number,
    count: number,
    speed = 4,
  ) {
    const nl = Math.hypot(nx, ny, nz) || 1;
    for (let i = 0; i < count; i++) {
      if (this.drops.length >= this.maxDrops) this.drops.shift();
      const life = 0.35 + Math.random() * 0.45;
      const s = speed * (0.4 + Math.random());
      this.drops.push({
        x,
        y,
        z,
        vx: (nx / nl) * s * 0.8 + (Math.random() - 0.5) * s,
        vy: (ny / nl) * s * 0.8 + Math.random() * s * 0.7,
        vz: (nz / nl) * s * 0.8 + (Math.random() - 0.5) * s,
        life,
        max: life,
        size: 0.03 + Math.random() * 0.05,
        color,
      });
    }
  }

  blast(x: number, y: number, z: number, color: number, radius: number) {
    this.burst(x, y + 0.2, z, 0, 1, 0, color, 46, 9);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.08, z);
    this.group.add(mesh);
    inkExcluded.add(mesh);
    this.rings.push({ mesh, life: 0.45, max: 0.45, radius });
  }

  private updateDrops(dt: number) {
    let n = 0;
    const keep: Drop[] = [];
    for (const d of this.drops) {
      d.life -= dt;
      if (d.life <= 0) continue;
      d.vy -= 14 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      if (d.y < 0.02) {
        d.y = 0.02;
        d.vy = 0;
        d.vx *= 0.5;
        d.vz *= 0.5;
      }
      keep.push(d);
      const k = d.size * Math.min(1, (d.life / d.max) * 1.6);
      _p.set(d.x, d.y, d.z);
      _s.set(k, k, k);
      _q.identity();
      _m.compose(_p, _q, _s);
      this.dropsMesh.setMatrixAt(n, _m);
      _c.setHex(d.color);
      this.dropsMesh.setColorAt(n, _c);
      n++;
    }
    this.drops = keep;
    this.dropsMesh.count = n;
    this.dropsMesh.instanceMatrix.needsUpdate = true;
    if (this.dropsMesh.instanceColor) this.dropsMesh.instanceColor.needsUpdate = true;
  }

  private updateRings(dt: number) {
    this.rings = this.rings.filter(r => {
      r.life -= dt;
      const k = 1 - r.life / r.max;
      const s = 0.4 + k * r.radius;
      r.mesh.scale.set(s, s, s);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.85 * (1 - k));
      if (r.life <= 0) {
        this.group.remove(r.mesh);
        inkExcluded.delete(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });
  }

  clear() {
    this.drops = [];
    this.prev.clear();
    this.cur.clear();
    this.muzzle.clear();
  }

  dispose() {
    this.balls.geometry.dispose();
    (this.balls.material as THREE.Material).dispose();
    this.dropsMesh.geometry.dispose();
    (this.dropsMesh.material as THREE.Material).dispose();
    this.ringGeo.dispose();
    for (const r of this.rings) (r.mesh.material as THREE.Material).dispose();
    inkExcluded.delete(this.balls);
    inkExcluded.delete(this.dropsMesh);
  }
}
