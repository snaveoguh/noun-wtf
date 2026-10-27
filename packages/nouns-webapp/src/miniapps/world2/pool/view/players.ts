// ── The two players at the table ────────────────────────────────────────
//
// Real Noun characters (the player's own look, the opponent's or a CPU's).
// The one shooting stands behind the cue ball outside the rail, faces the
// shot, leans in over the table and puts both hands on the cue (two-bone
// IK: bridge hand by the tip, back hand on the wrap). The other waits at a
// corner of the table watching. Positions ease, so walking round to the
// next shot reads as a step, not a jump.

import type { NounSeed } from '../../character/NounAppearance';
import type { CharacterAssets } from '../../character/NounCharacter';

import * as THREE from 'three';

import { NounCharacter, solveTwoBone } from '../../character/NounCharacter';
import { toonify } from '../../render/Toon';

import { HX, HZ } from './table';

interface Arm {
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
}

function findArm(ch: NounCharacter, s: 'l' | 'r'): Arm | null {
  const f = (n: string) => {
    let hit: THREE.Object3D | null = null;
    ch.body.traverse(o => {
      if (hit === null && o.name.replace(/[.:_]/g, '').toLowerCase() === n) hit = o;
    });
    return hit as THREE.Object3D | null;
  };
  const upper = f(`upperarm${s}`);
  const fore = f(`forearm${s}`);
  const hand = f(`hand${s}`);
  return upper !== null && fore !== null && hand !== null ? { upper, fore, hand } : null;
}

interface Body {
  ch: NounCharacter;
  left: Arm | null;
  right: Arm | null;
  pos: THREE.Vector3;
  yaw: number;
  goal: THREE.Vector3;
  goalYaw: number;
  lean: number;
  aim: number;
}

/** A body closer than this (m, across the floor) to the camera is hidden: a Noun head is ~1.3 m wide. */
const EYE_CLEAR = 0.8;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Where the shooter stands: back along the shot from the cue ball, outside the rail. */
export function stance(cx: number, cz: number, dx: number, dz: number): { x: number; z: number } {
  // Ray back from the cue ball to the outside of the table
  const bx = -dx;
  const bz = -dz;
  const tx = bx > 1e-6 ? (HX - cx) / bx : bx < -1e-6 ? (-HX - cx) / bx : Infinity;
  const tz = bz > 1e-6 ? (HZ - cz) / bz : bz < -1e-6 ? (-HZ - cz) / bz : Infinity;
  const exit = Math.min(tx, tz);
  const d = Math.max(0.95, Math.min(1.7, exit + 0.3));
  return { x: cx + bx * d, z: cz + bz * d };
}

export class TablePlayers {
  readonly group = new THREE.Group();
  private bodies: (Body | null)[] = [null, null];

  constructor(
    private assets: CharacterAssets | null,
    private toon: boolean,
  ) {
    this.group.name = 'pool-players';
  }

  /** (Re)dress seat `i`. */
  set(i: 0 | 1, seed: NounSeed) {
    const old = this.bodies[i];
    if (old !== null) {
      old.ch.root.removeFromParent();
      old.ch.dispose();
    }
    this.bodies[i] = null;
    if (this.assets === null) return;
    const ch = new NounCharacter(seed, this.assets);
    ch.board.visible = false;
    if (this.toon) toonify(ch.root);
    this.group.add(ch.root);
    const w = this.waitSpot(i);
    this.bodies[i] = {
      ch,
      left: findArm(ch, 'l'),
      right: findArm(ch, 'r'),
      pos: new THREE.Vector3(w.x, 0, w.z),
      yaw: w.yaw,
      goal: new THREE.Vector3(w.x, 0, w.z),
      goalYaw: w.yaw,
      lean: 0,
      aim: 0,
    };
    ch.root.position.copy(this.bodies[i]!.pos);
  }

  /** The non-shooter's corner (seat 0 at the head end, seat 1 at the foot), back off the rail. */
  waitSpot(i: 0 | 1) {
    const x = (i === 0 ? -1 : 1) * (HX + 0.75);
    const z = (i === 0 ? 1 : -1) * (HZ + 0.55);
    return { x, z, yaw: Math.atan2(-x, -z) };
  }

  /**
   * Per frame. `shooter`: the seat at the table and where it stands / faces
   * (null: everyone waits); `hands`: where its hands go on the cue (local),
   * or null when it isn't holding one up. `eye`: the camera (local); a
   * body it's inside (the low cue view stands right in the shooter's big
   * Noun head) isn't drawn.
   */
  update(
    dt: number,
    shooter: { seat: 0 | 1; x: number; z: number; dx: number; dz: number } | null,
    hands: { bridge: THREE.Vector3; back: THREE.Vector3 } | null,
    eye?: THREE.Vector3,
  ) {
    const k = 1 - Math.exp(-5 * dt);
    for (const i of [0, 1] as const) {
      const b = this.bodies[i];
      if (b === null) continue;
      const shooting = shooter !== null && shooter.seat === i;
      if (shooting) {
        b.goal.set(shooter.x, 0, shooter.z);
        b.goalYaw = Math.atan2(shooter.dx, shooter.dz);
      } else {
        const w = this.waitSpot(i);
        b.goal.set(w.x, 0, w.z);
        b.goalYaw = w.yaw;
      }
      const moving = b.pos.distanceTo(b.goal) > 0.05;
      b.pos.lerp(b.goal, k);
      let dy = b.goalYaw - b.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      b.yaw += dy * k;
      const want = shooting && hands !== null && !moving ? 1 : 0;
      b.aim += (want - b.aim) * (1 - Math.exp(-8 * dt));
      b.lean = b.aim * 0.42;
      const ch = b.ch;
      ch.root.visible =
        eye === undefined || Math.hypot(eye.x - b.pos.x, eye.z - b.pos.z) > EYE_CLEAR;
      ch.root.position.copy(b.pos);
      ch.root.rotation.set(0, b.yaw, 0);
      ch.play(moving ? { clip: 'walk', fade: 0.2, timeScale: 0.9 } : { clip: 'idle', fade: 0.3 });
      ch.update(dt, { lean: 0, travelled: 0, riding: false });
      ch.body.rotation.x = b.lean;
      if (shooting && hands !== null && b.aim > 0.02) {
        ch.root.updateMatrixWorld(true);
        ch.root.getWorldQuaternion(_q);
        const pole = _b.set(0, -1, -0.4).applyQuaternion(_q);
        // Right hand on the wrap, left hand making the bridge
        if (b.right !== null) {
          _a.copy(hands.back);
          this.group.localToWorld(_a);
          solveTwoBone(b.right.upper, b.right.fore, b.right.hand, _a, pole, b.aim);
        }
        if (b.left !== null) {
          _a.copy(hands.bridge);
          this.group.localToWorld(_a);
          solveTwoBone(b.left.upper, b.left.fore, b.left.hand, _a, pole, b.aim);
        }
      }
    }
  }

  /** A little cheer for the winner. */
  celebrate(i: 0 | 1) {
    const b = this.bodies[i];
    b?.ch.play({ clip: 'celebrate', fade: 0.2 });
  }

  dispose() {
    for (const b of this.bodies) {
      if (b === null) continue;
      b.ch.root.removeFromParent();
      b.ch.dispose();
    }
    this.bodies = [null, null];
    this.group.removeFromParent();
  }
}
