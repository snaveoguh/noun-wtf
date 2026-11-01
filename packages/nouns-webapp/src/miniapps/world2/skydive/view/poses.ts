// ── Skydiving poses on the Noun rig ──────────────────────────────────────
//
// PoseSpecs (breakdance/view/pose.ts: rider space, +Z ahead, +X the
// rider's LEFT, limbs [left, right]) built from the `sk` anim key alone, so
// remote riders pose exactly like the local one.
//
//   belly   the box-man arch: body flat, face down, head forward; arms out
//           wide and bent up toward the head, knees bent, shins up
//   track   flatter and longer: arms swept back by the hips, legs straight
//   dive    head down ~50° under the horizon, arms tight back, legs together
//   flare   pitched up, arms and legs spread wide (slow)
//   canopy  hanging upright in the harness, hands up on the toggles; the
//           turning side's toggle pulls down
//   board   (skysurfing) stood on the board in a crouch, arms out
//
// The Noun head is a ~1 m cube sitting on a 0.56 m body, so from the chase
// camera above and behind, a flat body is mostly hidden by the head: the
// arms and legs spread wider than a real skydiver's so they read past it.

import type { SkyAnim } from '../net/sk';

import * as THREE from 'three';

import { smooth, stand, type FK, type PoseOut, type PoseSpec } from '../../breakdance/view/pose';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const q = (axis: THREE.Vector3, a: number) => new THREE.Quaternion().setFromAxisAngle(axis, a);
const qx = (a: number) => q(V(1, 0, 0), a);
const qz = (a: number) => q(V(0, 0, 1), a);
const qm = (...qs: THREE.Quaternion[]) =>
  qs.reduce((acc, r) => acc.multiply(r), new THREE.Quaternion());
const fk = (a: THREE.Vector3, b: THREE.Vector3 = a.clone()): FK => ({
  a: a.clone().normalize(),
  b: b.clone().normalize(),
});
const mx = (v: THREE.Vector3) => V(-v.x, v.y, v.z);
const pair = (l: FK): [FK, FK] => [l, { a: mx(l.a), b: mx(l.b) }];
const ANKLE = 0.085;

/** Body pitch (rad forward from upright) per freefall position. */
export const PITCH = { belly: Math.PI / 2, track: 1.5, dive: 2.45, flare: 1.15 } as const;

/** Wind buffet on the limbs (t in s). */
const buffet = (t: number, k: number) => Math.sin(t * 9.3) * k + Math.sin(t * 15.1 + 1) * k * 0.5;

function freefall(posture: SkyAnim['posture'], steer: number, t: number): PoseSpec {
  const s = stand();
  s.ground = 'none';
  s.feet = [null, null];
  // A turn drops a shoulder (roll round the body's own long axis)
  s.pelvis = qm(qz(-steer * 0.32), qx(PITCH[posture]));
  // The body pivots round its middle, near the rider's position
  s.hips = V(0, 0.95, -0.35);
  const w = buffet(t, 0.05);
  switch (posture) {
    case 'belly':
      s.spine.set(-0.3, 0, 0);
      s.neck.set(-0.55, 0, 0);
      s.arms = pair(fk(V(1, 0.08, -0.25), V(0.55, 0.75 + w, -0.3)));
      s.legs = pair(fk(V(0.28, -0.95, 0.05), V(0.18, -0.4, -0.9 + w)));
      break;
    case 'track':
      s.spine.set(-0.08, 0, 0);
      s.neck.set(-0.45, 0, 0);
      s.arms = pair(fk(V(0.45, -0.85, -0.3), V(0.35, -0.9, -0.2 + w)));
      s.legs = pair(fk(V(0.1, -1, -0.05), V(0.08, -1, -0.12 + w)));
      break;
    case 'dive':
      s.spine.set(0.05, 0, 0);
      s.neck.set(-0.25, 0, 0);
      s.hips = V(0, 1.1, -0.1);
      s.arms = pair(fk(V(0.28, -0.92, -0.25), V(0.18, -0.97, -0.15 + w * 0.5)));
      s.legs = pair(fk(V(0.07, -1, -0.04), V(0.05, -1, -0.05)));
      break;
    case 'flare':
      s.spine.set(-0.4, 0, 0);
      s.neck.set(-0.35, 0, 0);
      s.arms = pair(fk(V(1, 0.3, -0.3), V(0.7, 0.65 + w, -0.25)));
      s.legs = pair(fk(V(0.55, -0.8, 0.25), V(0.4, -0.55, -0.7 + w)));
      break;
  }
  return s;
}

/** Hanging in the harness; steer > 0 turns right (the right toggle down). */
function canopy(steer: number, t: number): PoseSpec {
  const s = stand();
  s.ground = 'none';
  s.pelvis = qm(qz(-steer * 0.12), qx(0.18));
  s.hips = V(0, 0.62, 0);
  s.spine.set(0.02, 0, 0);
  s.neck.set(-0.1, 0, 0);
  const up = fk(V(0.38, 0.9, 0.05), V(0.18, 0.98, 0.1));
  const down = fk(V(0.45, -0.2, 0.55), V(0.2, 0.25, 0.95));
  const l = Math.max(0, -steer);
  const r = Math.max(0, steer);
  const mix = (a: FK, b: FK, k: number): FK =>
    fk(a.a.clone().lerp(b.a, k), a.b.clone().lerp(b.b, k));
  const right = mix(up, down, r);
  s.arms = [mix(up, down, l), { a: mx(right.a), b: mx(right.b) }];
  const sw = Math.sin(t * 1.7) * 0.06;
  s.legs = pair(fk(V(0.1, -0.95, 0.22 + sw), V(0.08, -0.97, 0.05)));
  s.feet = [V(0.15, -0.6, 1), V(-0.15, -0.6, 1)];
  return s;
}

/** Skysurfing: stood on the board, crouched, arms out for balance. */
function surf(steer: number, t: number, hang: number): PoseSpec {
  const s = stand();
  s.ground = 'none';
  s.pelvis = qm(qz(-steer * 0.2), qx(0.3 * (1 - hang)));
  s.hips = V(0, 0.44 + 0.12 * hang, 0.02);
  s.spine.set(0.25 * (1 - hang), 0, 0);
  s.neck.set(-0.2, 0, 0);
  const w = buffet(t, 0.06);
  const out = fk(V(1, 0.1 + w, 0.1), V(1, 0.25, 0.2));
  const up = fk(V(0.38, 0.9, 0.05), V(0.18, 0.98, 0.1));
  const arm = fk(out.a.clone().lerp(up.a, hang), out.b.clone().lerp(up.b, hang));
  s.arms = pair(arm);
  s.legs = [
    { at: V(0.13, ANKLE, 0.02), pole: V(0.3, 0.2, 1) },
    { at: V(-0.13, ANKLE, 0.02), pole: V(-0.3, 0.2, 1) },
  ];
  s.feet = [V(0.25, 0, 1), V(-0.25, 0, 1)];
  return s;
}

/**
 * The pose for an `sk` key (null: off). `board`: stood on the board. `t`:
 * seconds, for the wind buffet and the harness sway.
 */
export function skyPose(a: SkyAnim, board: boolean, t: number): PoseOut | null {
  if (a.phase === 'off') return null;
  if (board) return surf(a.steer, t, a.phase === 'canopy' ? smooth(0, 1, a.open) : 0);
  if (a.phase === 'freefall') return freefall(a.posture, a.steer, t);
  // The canopy swings the body upright as it opens
  const k = smooth(0.15, 0.9, a.open);
  if (k >= 1) return canopy(a.steer, t);
  return { a: freefall('belly', 0, t), b: canopy(a.steer, t), k };
}
