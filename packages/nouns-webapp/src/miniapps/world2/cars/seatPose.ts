// ── A Noun in a car seat: placed from the car's pose, sat down, hands on ──
//
// The rig has no seated clip, so (like interiors/pose.ts) the pose goes on
// top of the clip after the character's own update each frame: every clip
// keys every bone, the mixer resets them next frame, nothing accumulates.
//   sit     thighs level, shins down, hips on the cushion (seats.ts);
//           the driver's hands reach for the wheel and follow the steering,
//           a passenger's rest on their lap;
//   stand   the STOMPA's bed: upright, one hand up on the roll bar.

import type { CarId } from './specs';
import type { NounCharacter } from '../character/NounCharacter';

import * as THREE from 'three';

import { turnBone } from '../character/NounCharacter';

import { RIDER_SCALE, seatRoot, seatsOf } from './seats';

interface Bones {
  thigh: THREE.Object3D[];
  shin: THREE.Object3D[];
  upper: THREE.Object3D[];
  fore: THREE.Object3D[];
}

const cache = new WeakMap<NounCharacter, Bones>();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _side = new THREE.Vector3();
const _fwd = new THREE.Vector3();

function bones(ch: NounCharacter): Bones {
  let b = cache.get(ch);
  if (b !== undefined) return b;
  const find = (n: string) => {
    let hit: THREE.Object3D | null = null;
    ch.body.traverse(o => {
      if (hit === null && o.name.replace(/[.:_]/g, '').toLowerCase() === n) hit = o;
    });
    return hit as THREE.Object3D | null;
  };
  const both = (n: string) =>
    [find(`${n}l`), find(`${n}r`)].filter((o): o is THREE.Object3D => o !== null);
  b = { thigh: both('thigh'), shin: both('shin'), upper: both('upperarm'), fore: both('forearm') };
  cache.set(ch, b);
  return b;
}

export interface SeatPoseOpts {
  /** Seat 0: hands on the wheel. */
  driver: boolean;
  /** Steering −1…1 (the driver's hands turn the wheel). */
  steer?: number;
  scale?: number;
}

/**
 * Put `ch` in seat `seat` of the car whose model group is `car` (at the
 * scene root), facing forward, and pose it. Call after `ch.update()`.
 */
export function poseInSeat(
  ch: NounCharacter,
  car: THREE.Object3D,
  id: CarId,
  seat: number,
  opts: SeatPoseOpts,
) {
  const scale = opts.scale ?? RIDER_SCALE;
  const at = seatRoot(id, seat, scale);
  if (at === null) return;
  const r = ch.root;
  car.updateMatrixWorld();
  r.position.copy(car.localToWorld(_v.set(at[0], at[1], at[2])));
  r.quaternion.copy(car.getWorldQuaternion(_q));
  r.scale.setScalar(scale);
  ch.board.visible = false;
  r.updateMatrixWorld(true);
  const b = bones(ch);
  _side.set(1, 0, 0).applyQuaternion(r.quaternion);
  if (seatsOf(id)[seat]?.stand === true) {
    // Feet planted, the left hand up on the roll bar
    if (b.upper[0] !== undefined) turnBone(b.upper[0], _side, -2.5);
    if (b.fore[0] !== undefined) turnBone(b.fore[0], _side, -0.4);
    return;
  }
  for (const t of b.thigh) turnBone(t, _side, -Math.PI / 2);
  for (const s of b.shin) turnBone(s, _side, (Math.PI / 2) * 0.95);
  if (opts.driver) {
    // Arms out to the wheel; the wheel turns them about the car's forward axis
    const steer = THREE.MathUtils.clamp(opts.steer ?? 0, -1, 1);
    _fwd.set(0, 0, 1).applyQuaternion(r.quaternion);
    b.upper.forEach((u, i) => {
      turnBone(u, _side, -0.95);
      // left hand (i 0) rises as the wheel turns left, the right one dips
      turnBone(u, _fwd, (i === 0 ? -1 : 1) * steer * 0.25);
    });
    for (const f of b.fore) turnBone(f, _side, -0.45);
  } else {
    for (const u of b.upper) turnBone(u, _side, -0.55);
    for (const f of b.fore) turnBone(f, _side, -0.6);
  }
}

/** Undo the car's scale on a character leaving a seat (pose resets itself). */
export function leaveSeat(ch: NounCharacter) {
  ch.root.scale.setScalar(1);
}
