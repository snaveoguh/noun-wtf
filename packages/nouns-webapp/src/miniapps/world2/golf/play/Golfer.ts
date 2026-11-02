// ── Noun Golf: your Noun with a club (address, swing, follow-through) ────
//
// Poses the rider's own NounCharacter at the ball: stood side-on (target
// on their left), club shaft from the hands to the ball, and a swing that
// is one number, θ, the club's turn about the target line (0 = address,
// − = back, + = through). Both hands follow the grip with two-bone IK and
// the body turns with the club. Putts are a short pendulum.
//
//   swing timeline (s):  back 0 → BACK · down → IMPACT · through → END
//
// The ball leaves at IMPACT (GolfMode waits for it before flying the shot).

import type { NounCharacter } from '../../character/NounCharacter';

import * as THREE from 'three';

import { solveTwoBone, turnBone } from '../../character/NounCharacter';

export const SWING = { BACK: 0.75, IMPACT: 1.0, END: 1.55 } as const;
export const PUTT = { BACK: 0.55, IMPACT: 0.85, END: 1.3 } as const;

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

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const UP = new THREE.Vector3(0, 1, 0);

/** The club's turn θ (rad) at time t into a swing of `power` (0..1.1). */
export function swingAngle(t: number, power: number, putt: boolean): number {
  const T = putt ? PUTT : SWING;
  const top = putt ? -(0.18 + power * 0.7) : -(0.9 + Math.min(1, power) * 1.65);
  const fin = putt ? 0.15 + power * 0.65 : 1.2 + Math.min(1, power) * 1.4;
  if (t < T.BACK) return top * ease(t / T.BACK);
  if (t < T.IMPACT) {
    const k = (t - T.BACK) / (T.IMPACT - T.BACK);
    return top * (1 - k * k);
  }
  return fin * ease((t - T.IMPACT) / (T.END - T.IMPACT));
}

export class Golfer {
  readonly club: THREE.Group;
  private shaft: THREE.Mesh;
  private head: THREE.Mesh;
  private ch: NounCharacter | null = null;
  private arms: [Arm | null, Arm | null] = [null, null];
  private spine: THREE.Object3D | null = null;
  private mats: THREE.Material[] = [];
  private readonly _a = new THREE.Vector3();
  private readonly _b = new THREE.Vector3();
  private readonly _g = new THREE.Vector3();
  private readonly _h = new THREE.Vector3();
  private readonly _d = new THREE.Vector3();
  private readonly _pole = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();

  constructor(parent: THREE.Object3D) {
    const steel = new THREE.MeshStandardMaterial({
      color: 0xd8dde3,
      metalness: 0.6,
      roughness: 0.35,
    });
    const grip = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.9 });
    this.mats.push(steel, grip);
    this.club = new THREE.Group();
    this.club.name = 'golf-club';
    // Shaft along +Y from the grip (0) to the head (1), scaled to length
    const sg = new THREE.CylinderGeometry(0.012, 0.009, 1, 6);
    sg.translate(0, 0.5, 0);
    this.shaft = new THREE.Mesh(sg, steel);
    const gg = new THREE.CylinderGeometry(0.02, 0.018, 0.26, 6);
    gg.translate(0, 0.13, 0);
    this.club.add(this.shaft, new THREE.Mesh(gg, grip));
    this.head = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.05), steel);
    this.club.add(this.head);
    this.club.visible = false;
    parent.add(this.club);
  }

  get meshes(): THREE.Object3D[] {
    return [this.club];
  }

  bind(ch: NounCharacter | null) {
    if (ch === this.ch) return;
    this.ch = ch;
    this.arms = ch !== null ? [findArm(ch, 'l'), findArm(ch, 'r')] : [null, null];
    this.spine = null;
    ch?.body.traverse(o => {
      const n = o.name.toLowerCase();
      if (this.spine === null && (n.includes('spine') || n.includes('chest'))) this.spine = o;
    });
  }

  hide() {
    this.club.visible = false;
  }

  /**
   * Pose: the golfer stands at `root` facing `faceYaw` (the target on
   * their left), club length `len`, turned θ. Call after the character's
   * own update (it adds to the clip's pose).
   */
  pose(theta: number, len: number, putt: boolean) {
    const ch = this.ch;
    if (ch === null) return;
    const root = ch.root;
    root.updateMatrixWorld(true);
    const yaw = new THREE.Euler().setFromQuaternion(root.quaternion, 'YXZ').y;
    // Body frames: f forward (towards the ball), t target (their left)
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const tx = -fz;
    const tz = fx;
    // Turn the chest with the club
    if (this.spine !== null) turnBone(this.spine, UP, -theta * (putt ? 0.15 : 0.32));
    // The grip swings round a centre between the shoulders, about the target line
    const centre = this._a.set(
      root.position.x + fx * 0.18,
      root.position.y + 1.02,
      root.position.z + fz * 0.18,
    );
    const armR = putt ? 0.42 : 0.5;
    // Down-and-out at address (towards the ball), rotated θ about the target axis
    this._d.set(fx * 0.55, -0.83, fz * 0.55).normalize();
    this._q.setFromAxisAngle(this._b.set(tx, 0, tz), -theta);
    this._d.applyQuaternion(this._q);
    const g = this._g.copy(centre).addScaledVector(this._d, armR);
    // The shaft: from the hands on down the same swing direction (a little steeper)
    const h = this._h.copy(this._d).multiplyScalar(len).add(g);
    this.club.visible = true;
    this.club.position.copy(g);
    this.club.quaternion.setFromUnitVectors(UP, this._b.subVectors(h, g).normalize());
    this.shaft.scale.set(1, len, 1);
    this.head.position.set(0, len, 0);
    // Hands on the grip, elbows out
    this._pole.set(-fx, -0.3, -fz);
    const [l, r] = this.arms;
    if (r !== null)
      solveTwoBone(
        r.upper,
        r.fore,
        r.hand,
        this._b.copy(g).addScaledVector(this._d, 0.07),
        this._pole,
        1,
      );
    if (l !== null) solveTwoBone(l.upper, l.fore, l.hand, g, this._pole, 1);
  }

  dispose() {
    this.club.removeFromParent();
    this.club.traverse(o => (o as THREE.Mesh).geometry?.dispose());
    for (const m of this.mats) m.dispose();
  }
}
