// ── The Player on foot as the parkour engine's body (PkBody) ─────────────

import type { PkBody, PkEvent, PkInput } from './contract';
import type { InputFrame } from '../core/Input';
import type { Player } from '../skate/Player';

import * as THREE from 'three';

/** Player on foot → the engine's body. */
export class PlayerBody implements PkBody {
  constructor(
    private p: Player,
    private onEvent: (e: PkEvent) => void,
  ) {}
  get pos() {
    return this.p.pos;
  }
  get vel() {
    return this.p.vel;
  }
  get yaw() {
    return this.p.footYaw;
  }
  set yaw(v: number) {
    this.p.footYaw = v;
  }
  get grounded() {
    return this.p.footGrounded;
  }
  set grounded(v: boolean) {
    this.p.footGrounded = v;
    if (v) {
      this.p.safePos.copy(this.p.pos);
      this.p.safeFwd.set(Math.sin(this.p.footYaw), 0, Math.cos(this.p.footYaw));
    }
  }
  get climbing() {
    return this.p.climb !== null;
  }
  get vaulting() {
    return this.p.vault !== null;
  }
  get respawns() {
    return this.p.respawns;
  }
  startClimb(nx: number, nz: number) {
    return this.p.tryStartClimb(new THREE.Vector3(nx, 0, nz));
  }
  startVault(nx: number, nz: number, carry: number) {
    return this.p.tryStartVault(new THREE.Vector3(nx, 0, nz), carry);
  }
  emit(e: PkEvent) {
    this.onEvent(e);
  }
}

/** The engine's input from a game input frame (written into `i`). */
export function pkInputFrom(f: InputFrame, footYaw: number, camYaw: number, i: PkInput): PkInput {
  i.moveX = f.moveX;
  i.moveY = f.moveY;
  const mag = Math.min(1, Math.hypot(f.moveX, f.moveY));
  if (f.mode === 'keyboard') {
    const s = Math.abs(f.moveY) > 0.05 ? Math.sign(f.moveY) : 0;
    i.wishX = Math.sin(footYaw) * s;
    i.wishZ = Math.cos(footYaw) * s;
  } else {
    const fx = Math.sin(camYaw);
    const fz = Math.cos(camYaw);
    i.wishX = fx * f.moveY - fz * f.moveX;
    i.wishZ = fz * f.moveY + fx * f.moveX;
  }
  i.sprint = f.sprint || (f.mode !== 'keyboard' && mag > 0.85);
  i.jump = f.jumpPressed;
  i.jumpHeld = f.crouch;
  i.duck = f.duck === true;
  i.duckPressed = f.duckPressed === true;
  i.release = f.boardTogglePressed;
  return i;
}
