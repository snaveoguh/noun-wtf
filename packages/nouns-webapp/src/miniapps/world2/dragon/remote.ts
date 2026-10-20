// ── Other riders' dragons ─────────────────────────────────────────────────
//
// A rider on a dragon sends `vehicle: 'dragon'` with their seat as the
// position and the dragon's orientation as the quaternion (net/Net.ts
// interpolates both). Here each such rider gets a dragon under them, from a
// small pool of meshes sharing one geometry (mesh.ts), with wings beating to
// their speed and climb. Far away it stops flapping; further still it's
// hidden (their name tag / rider still shows like any remote).

import type { Vehicle } from '../net/Net';

import * as THREE from 'three';

import { buildDragonMesh, dragonFromSeat, flapRate, flapWings, type DragonMesh } from './mesh';

/** Past this (m) from the camera a remote dragon is hidden. */
export const REMOTE_DRAGON_HIDE = 1400;
/** Past this (m) its wings hold still (no per-frame matrix work). */
export const REMOTE_DRAGON_STILL = 350;

export interface RemoteDragonHost {
  scene: THREE.Object3D;
  toon: boolean;
  /** Hide them all (the Upside Down). */
  hidden(): boolean;
}

interface Slot {
  mesh: DragonMesh;
  flap: number;
  vy: number;
  last: THREE.Vector3;
  fresh: boolean;
}

export interface RemoteRiderView {
  current: { pos: THREE.Vector3; quat: THREE.Quaternion; speed: number; vehicle?: Vehicle };
}

const _p = new THREE.Vector3();

export class RemoteDragons {
  private active = new Map<string, Slot>();
  private pool: Slot[] = [];

  constructor(private host: RemoteDragonHost) {}

  /** How many remote dragons are in the scene (tests, diagnostics). */
  get count(): number {
    return this.active.size;
  }

  update(dt: number, players: ReadonlyMap<string, RemoteRiderView>, cam: THREE.Vector3) {
    const hide = this.host.hidden();
    for (const [id, rp] of players) {
      const c = rp.current;
      const on = !hide && c.vehicle === 'dragon';
      let slot = this.active.get(id);
      if (!on) {
        if (slot !== undefined) this.release(id, slot);
        continue;
      }
      if (slot === undefined) slot = this.take(id);
      const g = slot.mesh.group;
      dragonFromSeat(c.pos, c.quat, _p);
      const d = cam.distanceTo(_p);
      g.visible = d < REMOTE_DRAGON_HIDE;
      if (!g.visible) continue;
      // Climb rate from the (interpolated) path, smoothed: drives the wingbeat
      if (slot.fresh) slot.last.copy(_p);
      const vy = dt > 0 ? (_p.y - slot.last.y) / dt : 0;
      slot.vy += (vy - slot.vy) * Math.min(1, dt * 4);
      slot.last.copy(_p);
      slot.fresh = false;
      g.position.copy(_p);
      g.quaternion.copy(c.quat);
      if (d < REMOTE_DRAGON_STILL) {
        slot.flap += dt * flapRate(c.speed, slot.vy);
        flapWings(slot.mesh, slot.flap);
      }
    }
    for (const [id, slot] of this.active) if (!players.has(id)) this.release(id, slot);
  }

  private take(id: string): Slot {
    const slot = this.pool.pop() ?? {
      mesh: buildDragonMesh(this.host.toon, false),
      flap: 0,
      vy: 0,
      last: new THREE.Vector3(),
      fresh: true,
    };
    slot.flap = Math.random() * Math.PI * 2;
    slot.vy = 0;
    slot.fresh = true;
    this.host.scene.add(slot.mesh.group);
    this.active.set(id, slot);
    return slot;
  }

  private release(id: string, slot: Slot) {
    this.host.scene.remove(slot.mesh.group);
    this.active.delete(id);
    if (this.pool.length < 8) this.pool.push(slot);
  }

  dispose() {
    for (const [id, slot] of this.active) this.release(id, slot);
    this.pool.length = 0;
  }
}
