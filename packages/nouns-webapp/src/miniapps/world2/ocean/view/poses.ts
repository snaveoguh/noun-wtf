// ── Surfing, swimming and paddling poses on the Noun rig ─────────────────
//
// PoseSpecs (breakdance/view/pose.ts: rider space, +Z ahead = the board's
// nose, +X the rider's LEFT, limbs [left, right]) from the `sf` anim key
// alone, so remote riders pose exactly like the local one.
//
//   stance   regular foot (left forward), side-on to the nose, knees bent,
//            head turned to look down the line, arms out; the carve leans
//            the whole body into the turn, crouch drops the hips
//   prone    lying on the board, chin up, arms windmilling (paddle) or
//            holding the rails (duck dive, nose pushed under)
//   sit      sat up astride the board, legs in the water, waiting
//   swim     a front crawl, body inclined, head out of the water
//   tumble   the wipeout: rolled over and over, limbs everywhere
//   pop      prone → stance over the board's pop time
//
// The Noun head is a ~1 m cube on a 0.56 m body, so limbs are spread wider
// than a real surfer's to read past it from the chase camera.

import type { SurfAnim } from '../net/sf';

import * as THREE from 'three';

import { smooth, stand, type FK, type PoseOut, type PoseSpec } from '../../breakdance/view/pose';
import { BOARDS } from '../surf/boards';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const q = (axis: THREE.Vector3, a: number) => new THREE.Quaternion().setFromAxisAngle(axis, a);
const qx = (a: number) => q(V(1, 0, 0), a);
const qy = (a: number) => q(V(0, 1, 0), a);
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

/** Deck height of the board over the rider's root (m). */
export const DECK = 0.07;

/** Stood up surfing: regular foot, side-on, crouched into the carve. */
export function stance(lean: number, crouch: number, t: number, grab = 0): PoseSpec {
  const s = stand();
  s.ground = 'none';
  const c = Math.max(0, Math.min(1, crouch));
  // side-on (facing the board's right rail), leaning into the turn
  s.pelvis = qm(qz(-lean * 0.38), qy(-Math.PI / 2), qx(0.18 + 0.25 * c));
  s.hips = V(0, DECK + 0.47 - 0.15 * c, 0);
  s.spine.set(0.22 + 0.25 * c, 0.55, 0);
  s.neck.set(-0.25, 0.85, 0);
  const sway = Math.sin(t * 2.1) * 0.05;
  // arms: the lead (left) one out over the nose, the back one trailing; a grab reaches the rail
  const lead = fk(V(1, 0.15 + sway, 0.35), V(1, 0.05, 0.5));
  const back = fk(V(1, -0.25 - sway, -0.1), V(0.9, -0.35, 0.25));
  const reach = fk(V(0.2, -0.95, 0.25), V(0.1, -0.95, 0.3));
  const backArm = grab > 0 ? fk(back.a.clone().lerp(reach.a, grab), back.b.clone().lerp(reach.b, grab)) : back;
  s.arms = [lead, { a: mx(backArm.a), b: mx(backArm.b) }];
  // feet planted on the deck: left over the front, right over the tail
  s.legs = [
    { at: V(0, DECK + ANKLE, 0.36), pole: V(0.3, 0.3, 1.2) },
    { at: V(0, DECK + ANKLE, -0.36), pole: V(-0.3, 0.3, -0.2) },
  ];
  s.feet = [V(1, 0, 0.2), V(1, 0, -0.2)];
  return s;
}

/** Lying on the board paddling (stroke: rad), or holding the rails (duck). */
export function prone(stroke: number, duck: number, board: SurfAnim['board']): PoseSpec {
  const s = stand();
  s.ground = 'none';
  const len = board !== null ? BOARDS[board].length : 2.2;
  // flat on the deck, chin up; the duck dive tips the nose down
  s.pelvis = qm(qx(Math.PI / 2 + 0.05 + duck * 0.45));
  s.hips = V(0, DECK + 0.14, -len * 0.18);
  s.spine.set(-0.32 * (1 - duck), 0, 0);
  s.neck.set(-0.55 * (1 - duck * 0.6), 0, 0);
  const arm = (ph: number): FK => {
    // windmill: reach ahead, pull down and back under the board, recover
    const a = ph;
    const dir = V(0.42, Math.cos(a), Math.sin(a) * 0.9 + 0.25);
    return fk(dir, dir.clone().add(V(0, 0.15, 0.3)));
  };
  const hold = fk(V(0.55, 0.65, 0.5), V(0.2, 0.75, 0.6));
  if (duck > 0.5) s.arms = pair(hold);
  else {
    const l = arm(stroke);
    const r = arm(stroke + Math.PI);
    s.arms = [l, { a: mx(r.a), b: mx(r.b) }];
  }
  const kick = Math.sin(stroke * 2) * 0.08;
  s.legs = [fk(V(0.12, -1, 0.05 + kick), V(0.1, -1, 0.2)), fk(V(-0.12, -1, 0.05 - kick), V(-0.1, -1, 0.2))];
  s.feet = [null, null];
  return s;
}

/** Sat up astride the board, legs dangling, waiting for a set. */
export function sit(t: number): PoseSpec {
  const s = stand();
  s.ground = 'none';
  s.pelvis = qx(-0.08);
  s.hips = V(0, DECK + 0.06, -0.15);
  s.spine.set(0.12, 0, 0);
  s.neck.set(-0.12 + Math.sin(t * 0.7) * 0.05, Math.sin(t * 0.4) * 0.35, 0);
  s.arms = pair(fk(V(0.45, -0.85, 0.35), V(0.15, -0.6, 0.75)));
  const sw = Math.sin(t * 1.3) * 0.12;
  s.legs = [fk(V(0.75, -0.35, 0.55), V(0.25, -1, 0.1 + sw)), fk(V(-0.75, -0.35, 0.55), V(-0.25, -1, 0.1 - sw))];
  s.feet = [null, null];
  return s;
}

/** Front crawl, head out of the water. */
export function swim(stroke: number, moving: number): PoseSpec {
  const s = stand();
  s.ground = 'none';
  s.pelvis = qx(0.65 + 0.55 * moving);
  s.hips = V(0, 0.15, -0.25);
  s.spine.set(-0.2, Math.sin(stroke) * 0.12 * moving, 0);
  s.neck.set(-0.75 * (0.4 + 0.6 * moving), 0, 0);
  const arm = (ph: number): FK => {
    const dir = V(0.45, Math.cos(ph), Math.sin(ph) * 0.8 + 0.2);
    return fk(dir, dir.clone().add(V(0, 0.2, 0.25)));
  };
  // treading water when still: small sculls
  const scull = fk(V(0.85, -0.3, 0.35 + Math.sin(stroke * 2) * 0.2), V(0.5, -0.2, 0.8));
  const l = moving > 0.3 ? arm(stroke) : scull;
  const r = moving > 0.3 ? arm(stroke + Math.PI) : scull;
  s.arms = [l, { a: mx(r.a), b: mx(r.b) }];
  const kick = Math.sin(stroke * 3) * 0.25;
  s.legs = [fk(V(0.12, -1, 0.05 + kick), V(0.1, -1, 0.1)), fk(V(-0.12, -1, 0.05 - kick), V(-0.1, -1, 0.1))];
  s.feet = [null, null];
  return s;
}

/** Wiped out: tumbling under the whitewater. */
export function tumble(t: number): PoseSpec {
  const s = stand();
  s.ground = 'none';
  const k = Math.min(1, t / 1.6);
  s.pelvis = qm(qx(t * 6.5 * (1 - 0.6 * k)), qz(Math.sin(t * 3.1) * 1.4));
  s.hips = V(0, 0.4, 0);
  s.spine.set(0.4, 0, 0.3 * Math.sin(t * 4));
  s.neck.set(0.3, 0, 0);
  const f = Math.sin(t * 9) * 0.4;
  s.arms = [fk(V(1, 0.6 + f, 0.2), V(0.8, 0.9, -0.3)), fk(V(-1, -0.2 - f, 0.4), V(-0.6, 0.6, 0.6))];
  s.legs = [fk(V(0.6, -0.6, 0.5 + f), V(0.3, -0.8, -0.4)), fk(V(-0.3, -0.9, -0.5 - f), V(-0.5, -0.4, 0.6))];
  s.feet = [null, null];
  return s;
}

/** The pose for an `sf` key (null: none; wading uses the walk clip). `t`: seconds (sway). */
export function surfPose(a: SurfAnim, t: number): PoseOut | null {
  switch (a.phase) {
    case 'off':
    case 'wade':
      return null;
    case 'swim':
      return swim(a.stroke, a.sit > 0.5 ? 0 : 1);
    case 'paddle': {
      const p = prone(a.stroke, 0, a.board);
      if (a.sit <= 0.02) return p;
      if (a.sit >= 0.98) return sit(t);
      return { a: p, b: sit(t), k: smooth(0, 1, a.sit) };
    }
    case 'duck':
      return prone(a.stroke, 1, a.board);
    case 'pop': {
      const pop = a.board !== null ? BOARDS[a.board].pop : 0.45;
      const k = smooth(0.1, 1, a.t / pop);
      return { a: prone(0, 0, a.board), b: stance(0, 1, t), k };
    }
    case 'ride':
      return stance(a.lean, a.crouch, t);
    case 'air':
      return stance(a.lean * 0.5, Math.max(0.6, a.crouch), t, a.crouch > 0.85 ? 1 : 0);
    case 'wipeout':
      return tumble(a.t);
  }
}
