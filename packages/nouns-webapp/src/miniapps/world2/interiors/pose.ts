// ── Procedural poses on a Noun (the rig has no seated clip) ──────────────
//
// Applied after the character's own update each frame (every clip keys
// every bone, so the mixer resets them next frame; nothing accumulates):
//   sit:  thighs swung forward level, shins back down, arms resting on the
//         lap, the whole rider lowered so the hips sit on the seat;
//   eat:  the right arm brought up to the mouth on a bite cycle.

import type { NounCharacter } from '../character/NounCharacter';

import * as THREE from 'three';

import { turnBone } from '../character/NounCharacter';

const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Rest hip height above the character's origin (noun_character.glb). */
export const HIP_HEIGHT = 0.56;

interface Bones {
  thighL: THREE.Object3D | null;
  thighR: THREE.Object3D | null;
  shinL: THREE.Object3D | null;
  shinR: THREE.Object3D | null;
  upperarmL: THREE.Object3D | null;
  upperarmR: THREE.Object3D | null;
  forearmL: THREE.Object3D | null;
  forearmR: THREE.Object3D | null;
  handR: THREE.Object3D | null;
}

const cache = new WeakMap<NounCharacter, Bones>();

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
  b = {
    thighL: find('thighl'),
    thighR: find('thighr'),
    shinL: find('shinl'),
    shinR: find('shinr'),
    upperarmL: find('upperarml'),
    upperarmR: find('upperarmr'),
    forearmL: find('forearml'),
    forearmR: find('forearmr'),
    handR: find('handr'),
  };
  cache.set(ch, b);
  return b;
}

/** The character's own sideways axis (its +X) in world space. */
function sideAxis(ch: NounCharacter): THREE.Vector3 {
  ch.root.getWorldQuaternion(_q);
  return _axis.set(1, 0, 0).applyQuaternion(_q);
}

/**
 * Sit `ch` (already placed at the seat, facing out of it) with its hips at
 * world height `seatY`. `k` 0…1 blends in (standing up / sitting down).
 */
export function poseSit(ch: NounCharacter, floorY: number, seatY: number, k = 1) {
  const b = bones(ch);
  if (b.thighL === null || b.shinL === null) return;
  const ax = sideAxis(ch);
  ch.root.position.y = THREE.MathUtils.lerp(floorY, seatY - HIP_HEIGHT + 0.05, k);
  ch.root.updateMatrixWorld(true);
  const a = (-Math.PI / 2) * k;
  for (const t of [b.thighL, b.thighR]) if (t !== null) turnBone(t, ax, a);
  for (const s of [b.shinL, b.shinR]) if (s !== null) turnBone(s, ax, -a * 0.95);
  // Hands on the lap
  for (const u of [b.upperarmL, b.upperarmR]) if (u !== null) turnBone(u, ax, -0.55 * k);
  for (const f of [b.forearmL, b.forearmR]) if (f !== null) turnBone(f, ax, -0.6 * k);
}

/** Bring the right hand up to the mouth; `bite` 0…1 is the arm's travel. */
export function poseEat(ch: NounCharacter, bite: number) {
  const b = bones(ch);
  if (b.upperarmR === null || b.forearmR === null) return;
  const ax = sideAxis(ch);
  turnBone(b.upperarmR, ax, -0.6 - 0.7 * bite);
  turnBone(b.forearmR, ax, -0.9 - 1.0 * bite);
}

/** World position of the right hand (for the food in it). */
export function handPos(ch: NounCharacter, out: THREE.Vector3): THREE.Vector3 | null {
  const hand = bones(ch).handR;
  return hand === null ? null : hand.getWorldPosition(out);
}
