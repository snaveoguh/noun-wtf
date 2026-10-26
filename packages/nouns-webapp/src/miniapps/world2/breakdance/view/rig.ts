// ── Noun Breaks: pose specs → the Noun rig's bones ──────────────────────
//
// Runs after NounCharacter's mixer every frame (every clip keys all 23
// bones, so the mixer rewrites them each frame and nothing accumulates).
// Each PoseSpec is applied from the bind pose up: hips placed and turned,
// spine / neck bent, FK limbs aimed (segment by segment, any bone axis
// convention), then the ground solve, then IK limbs reaching for the floor
// at the height the solve settled on. Every evaluated pose is snapshotted
// (local quaternions + hips position) and layers are blended bone by bone,
// so moves crossfade, a crash slumps in over a move and the procedural
// pose fades in and out over the mixer's clip.
//
// The PoseDriver only needs an Object3D tree with the rig's bone names, so
// tests can build one from plain THREE.Bones.

import * as THREE from 'three';

import { aimBone, solveTwoBone } from '../../character/NounCharacter';

import {
  chestOf,
  isIK,
  isMix,
  type GroundMode,
  type IK,
  type Limb,
  type PoseOut,
  type PoseSpec,
} from './pose';

interface ArmBones {
  shoulder: THREE.Object3D | null;
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
}
interface LegBones {
  thigh: THREE.Object3D;
  shin: THREE.Object3D;
  foot: THREE.Object3D;
  toe: THREE.Object3D | null;
}

/** One evaluated pose: every bone's local rotation + the hips position + how it sits on the floor. */
interface Snap {
  q: Float32Array;
  hips: THREE.Vector3;
  ground: GroundMode;
  air: number;
  /** IK-planted limbs [armL, armR, legL, legR] (left out of the ground solve). */
  planted: [boolean, boolean, boolean, boolean];
}

export interface Layer {
  out: PoseOut;
  /** Blend weight over the layers below it (0..1). */
  w: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const ID = new THREE.Quaternion();

const findIn = (root: THREE.Object3D, name: string) => {
  let hit: THREE.Object3D | null = null;
  root.traverse(o => {
    if (hit === null && o.name.replace(/[.:_]/g, '').toLowerCase() === name) hit = o;
  });
  return hit as THREE.Object3D | null;
};

/** Joint radius: bones are points, the mesh around them isn't. */
const PAD = 0.055;

export class PoseDriver {
  readonly ok: boolean;
  /** Ground lift applied this frame (m), for the camera / shadows. */
  lift = 0;
  private bones: THREE.Object3D[] = [];
  private bind: THREE.Quaternion[] = [];
  private bindPos: THREE.Vector3[] = [];
  private rootBone: THREE.Object3D | null;
  private hips: THREE.Object3D;
  private spine: THREE.Object3D | null;
  private chest: THREE.Object3D | null;
  private neck: THREE.Object3D | null;
  private headBone: THREE.Object3D | null;
  private arms: ArmBones[] = [];
  private legs: LegBones[] = [];
  private headCorners: THREE.Vector3[] = [];
  private toeRest = new THREE.Vector3(0, -0.5, 1);
  private snaps: Snap[] = [];
  private mixSnap: Snap;
  private smoothLift = 0;
  private primed = false;
  private inv = new THREE.Matrix4();

  /**
   * @param space  the dancer-space object (NounCharacter.root)
   * @param model  holds the bones (NounCharacter.body)
   * @param shift  moved up / down by the ground solve (NounCharacter.body)
   * @param head   the Noun head mesh group (its box is the biggest thing touching the floor)
   */
  constructor(
    readonly space: THREE.Object3D,
    model: THREE.Object3D,
    readonly shift: THREE.Object3D,
    head: THREE.Object3D | null,
  ) {
    const f = (n: string) => findIn(model, n);
    const hips = f('hips');
    this.rootBone = f('root');
    this.spine = f('spine');
    this.chest = f('chest');
    this.neck = f('neck');
    this.headBone = f('head');
    for (const s of ['l', 'r']) {
      const upper = f(`upperarm${s}`);
      const fore = f(`forearm${s}`);
      const hand = f(`hand${s}`);
      if (upper !== null && fore !== null && hand !== null)
        this.arms.push({ shoulder: f(`shoulder${s}`), upper, fore, hand });
      const thigh = f(`thigh${s}`);
      const shin = f(`shin${s}`);
      const foot = f(`foot${s}`);
      if (thigh !== null && shin !== null && foot !== null)
        this.legs.push({ thigh, shin, foot, toe: f(`toe${s}`) });
    }
    this.ok = hips !== null && this.arms.length === 2 && this.legs.length === 2;
    this.hips = hips ?? model;
    const list = [
      this.rootBone,
      hips,
      this.spine,
      this.chest,
      this.neck,
      this.headBone,
      ...this.arms.flatMap(a => [a.shoulder, a.upper, a.fore, a.hand]),
      ...this.legs.flatMap(l => [l.thigh, l.shin, l.foot, l.toe]),
    ];
    for (const b of list) if (b !== null && !this.bones.includes(b)) this.bones.push(b);
    for (const b of this.bones) {
      this.bind.push(b.quaternion.clone());
      this.bindPos.push(b.position.clone());
    }
    this.mixSnap = this.newSnap();
    // Bind-pose measurements, in dancer space
    space.updateMatrixWorld(true);
    this.inv.copy(space.matrixWorld).invert();
    const l0 = this.legs[0];
    if (l0?.toe != null) {
      const ankle = l0.foot.getWorldPosition(_a).applyMatrix4(this.inv);
      const toe = l0.toe.getWorldPosition(_b).applyMatrix4(this.inv);
      this.toeRest.copy(toe).sub(ankle).normalize();
    }
    if (head !== null) {
      const box = new THREE.Box3().setFromObject(head);
      const hinv = new THREE.Matrix4().copy(head.matrixWorld).invert();
      if (!box.isEmpty() && box.max.x - box.min.x > 0.4) {
        for (const x of [box.min.x, box.max.x])
          for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z])
              this.headCorners.push(new THREE.Vector3(x, y, z).applyMatrix4(hinv));
      }
      this.headObj = head;
    }
  }

  private headObj: THREE.Object3D | null = null;

  private newSnap(): Snap {
    return {
      q: new Float32Array(this.bones.length * 4),
      hips: new THREE.Vector3(),
      ground: 'none',
      air: 0,
      planted: [false, false, false, false],
    };
  }

  private snap(i: number): Snap {
    while (this.snaps.length <= i) this.snaps.push(this.newSnap());
    return this.snaps[i];
  }

  private read(s: Snap) {
    this.bones.forEach((b, i) => {
      s.q[i * 4] = b.quaternion.x;
      s.q[i * 4 + 1] = b.quaternion.y;
      s.q[i * 4 + 2] = b.quaternion.z;
      s.q[i * 4 + 3] = b.quaternion.w;
    });
    s.hips.copy(this.hips.position);
  }

  /** s := slerp(s, o, k). */
  private blendInto(s: Snap, o: Snap, k: number) {
    if (k <= 0) return;
    for (let i = 0; i < this.bones.length; i++) {
      _q.set(s.q[i * 4], s.q[i * 4 + 1], s.q[i * 4 + 2], s.q[i * 4 + 3]);
      _q2.set(o.q[i * 4], o.q[i * 4 + 1], o.q[i * 4 + 2], o.q[i * 4 + 3]);
      _q.slerp(_q2, Math.min(1, k));
      s.q[i * 4] = _q.x;
      s.q[i * 4 + 1] = _q.y;
      s.q[i * 4 + 2] = _q.z;
      s.q[i * 4 + 3] = _q.w;
    }
    s.hips.lerp(o.hips, Math.min(1, k));
    s.air += (o.air - s.air) * Math.min(1, k);
    if (k >= 0.5) {
      s.ground = o.ground;
      s.planted = [...o.planted];
    }
  }

  private copySnap(dst: Snap, src: Snap) {
    dst.q.set(src.q);
    dst.hips.copy(src.hips);
    dst.ground = src.ground;
    dst.air = src.air;
    dst.planted = [...src.planted];
  }

  private write(s: Snap) {
    this.bones.forEach((b, i) => {
      b.quaternion.set(s.q[i * 4], s.q[i * 4 + 1], s.q[i * 4 + 2], s.q[i * 4 + 3]);
    });
    this.hips.position.copy(s.hips);
  }

  private resetBind() {
    this.bones.forEach((b, i) => {
      b.quaternion.copy(this.bind[i]);
      b.position.copy(this.bindPos[i]);
    });
  }

  /**
   * Pose the rig. `layers` blend bottom-up; `procW` (0..1) fades the whole
   * procedural pose over whatever the mixer left in the bones this frame.
   */
  drive(dt: number, layers: readonly Layer[], procW: number) {
    if (!this.ok) return;
    this.shift.position.y = 0;
    if (procW <= 0.001 || layers.length === 0) {
      this.settle(dt, 0, 'none', [false, false, false, false]);
      return;
    }
    const keepMixer = procW < 0.999;
    if (keepMixer) this.read(this.mixSnap);
    // Evaluate every layer (mixes expand to two) into snapshots, then fold them
    let n = 0;
    const result = this.snap(n++);
    this.evalOut(layers[0].out, result, () => this.snap(n++));
    for (let i = 1; i < layers.length; i++) {
      if (layers[i].w <= 0.001) continue;
      const s = this.snap(n++);
      this.evalOut(layers[i].out, s, () => this.snap(n++));
      this.blendInto(result, s, layers[i].w);
    }
    if (keepMixer) {
      // mixer → result by procW (the clip's pose sits on the floor as authored;
      // blendInto hands over the ground mode once the procedural side dominates)
      const out = this.snap(n++);
      this.copySnap(out, this.mixSnap);
      out.ground = 'none';
      out.planted = [false, false, false, false];
      this.blendInto(out, result, procW);
      this.write(out);
      this.settle(dt, out.air * procW, out.ground, out.planted, procW);
    } else {
      this.write(result);
      this.settle(dt, result.air, result.ground, result.planted);
    }
  }

  private evalOut(out: PoseOut, into: Snap, more: () => Snap) {
    if (!isMix(out)) {
      this.apply(out, into);
      return;
    }
    this.apply(out.a, into);
    if (out.k > 0.001) {
      const s = more();
      this.apply(out.b, s);
      this.blendInto(into, s, out.k);
    }
  }

  /** Apply one spec from the bind pose up and snapshot it into `s`. */
  private apply(spec: PoseSpec, s: Snap) {
    this.resetBind();
    this.shift.position.y = 0;
    const space = this.space;
    space.updateMatrixWorld(true);
    const sq = space.getWorldQuaternion(new THREE.Quaternion());
    // Hips: dancer space → the hips' parent
    const hp = this.hips.parent!;
    _a.copy(spec.hips);
    space.localToWorld(_a);
    hp.updateMatrixWorld(true);
    hp.worldToLocal(_a);
    this.hips.position.copy(_a);
    hp.getWorldQuaternion(_q);
    this.hips.quaternion.copy(_q.invert().multiply(sq.clone().multiply(spec.pelvis)));
    // Spine + chest share the bend, neck + head share theirs
    const half = (v: THREE.Vector3) =>
      new THREE.Quaternion().slerp(
        new THREE.Quaternion().setFromEuler(_e.set(v.x, v.y, v.z, 'YXZ')),
        0.5,
      );
    const hs = half(spec.spine);
    const hn = half(spec.neck);
    if (this.spine !== null) this.spine.quaternion.multiply(hs);
    if (this.chest !== null) this.chest.quaternion.multiply(hs);
    if (this.neck !== null) this.neck.quaternion.multiply(hn);
    if (this.headBone !== null) this.headBone.quaternion.multiply(hn);
    space.updateMatrixWorld(true);
    // FK limbs
    const chestQ = sq.clone().multiply(chestOf(spec.pelvis, spec.spine));
    const pelvisQ = sq.clone().multiply(spec.pelvis);
    const planted: Snap['planted'] = [false, false, false, false];
    const fkLimb = (
      l: Limb,
      up: THREE.Object3D,
      mid: THREE.Object3D,
      end: THREE.Object3D,
      frame: THREE.Quaternion,
    ) => {
      if (isIK(l)) return;
      aimBone(up, mid, _c.copy(l.a).applyQuaternion(frame).normalize(), 1);
      aimBone(mid, end, _c.copy(l.b).applyQuaternion(frame).normalize(), 1);
    };
    this.arms.forEach((a, i) => {
      const l = spec.arms[i];
      planted[i] = isIK(l) && l.floor === true;
      fkLimb(l, a.upper, a.fore, a.hand, chestQ);
    });
    this.legs.forEach((g, i) => {
      const l = spec.legs[i];
      planted[2 + i] = isIK(l) && l.floor === true;
      fkLimb(l, g.thigh, g.shin, g.foot, pelvisQ);
    });
    space.updateMatrixWorld(true);
    // Where the floor will be once the pose settles (IK limbs not counted yet)
    const d = this.groundOffset(spec.ground, planted, false);
    // IK limbs
    const ikLimb = (l: Limb, up: THREE.Object3D, mid: THREE.Object3D, end: THREE.Object3D) => {
      if (!isIK(l)) return;
      const t = this.ikTarget(l, up, d, _b);
      space.localToWorld(t);
      const pole = _c.copy(l.pole).applyQuaternion(sq);
      solveTwoBone(up, mid, end, t, pole, 1);
    };
    this.arms.forEach((a, i) => ikLimb(spec.arms[i], a.upper, a.fore, a.hand));
    this.legs.forEach((g, i) => ikLimb(spec.legs[i], g.thigh, g.shin, g.foot));
    // Feet: flat (heading) or pointed along the shin
    this.legs.forEach((g, i) => {
      if (g.toe === null) return;
      const h = spec.feet[i];
      g.foot.updateMatrixWorld(true);
      if (h !== null) {
        const hz = Math.hypot(h.x, h.z) || 1;
        const rh = Math.hypot(this.toeRest.x, this.toeRest.z);
        _c.set((h.x / hz) * rh, this.toeRest.y + h.y * 0.5, (h.z / hz) * rh)
          .normalize()
          .applyQuaternion(sq);
      } else {
        const knee = g.shin.getWorldPosition(_a);
        _c.copy(g.foot.getWorldPosition(_b)).sub(knee).normalize();
      }
      aimBone(g.foot, g.toe, _c, 1);
    });
    this.read(s);
    s.ground = spec.ground;
    s.air = spec.air;
    s.planted = planted;
  }

  private ikTarget(l: IK, up: THREE.Object3D, d: number, out: THREE.Vector3) {
    if (l.under === true) {
      up.getWorldPosition(out).applyMatrix4(this.inv.copy(this.space.matrixWorld).invert());
      out.set(out.x + l.at.x, l.at.y - d, out.z + l.at.z);
    } else out.set(l.at.x, l.at.y - (l.floor === true ? d : 0), l.at.z);
    return out;
  }

  /** The lift (m) that settles the current bone pose on the floor. */
  private groundOffset(mode: GroundMode, planted: Snap['planted'], solved: boolean): number {
    if (mode === 'none') return 0;
    const space = this.space;
    this.inv.copy(space.matrixWorld).invert();
    let low = Infinity;
    // Planted hands / feet: only once their IK has run (then they may hold the body up too)
    let lowPlanted = Infinity;
    const at = (o: THREE.Object3D | null, pad: number) => {
      if (o === null) return;
      o.getWorldPosition(_a).applyMatrix4(this.inv);
      low = Math.min(low, _a.y - pad);
    };
    const atP = (o: THREE.Object3D | null, pad: number) => {
      if (o === null || !solved) return;
      o.getWorldPosition(_a).applyMatrix4(this.inv);
      lowPlanted = Math.min(lowPlanted, _a.y - pad);
    };
    at(this.hips, 0.09);
    at(this.spine, 0.1);
    at(this.chest, 0.11);
    at(this.neck, 0.06);
    this.arms.forEach((a, i) => {
      at(a.upper, PAD);
      if (planted[i]) {
        atP(a.fore, PAD * 0.8);
        atP(a.hand, PAD * 0.7);
        return;
      }
      at(a.fore, PAD * 0.8);
      at(a.hand, PAD * 0.7);
    });
    this.legs.forEach((g, i) => {
      at(g.thigh, PAD + 0.02);
      if (planted[2 + i]) {
        atP(g.shin, PAD);
        atP(g.foot, PAD);
        atP(g.toe, 0.03);
        return;
      }
      at(g.shin, PAD);
      at(g.foot, PAD);
      at(g.toe, 0.03);
    });
    if (this.headObj !== null && this.headCorners.length > 0) {
      this.headObj.updateMatrixWorld(true);
      _m.multiplyMatrices(this.inv, this.headObj.matrixWorld);
      for (const c of this.headCorners) low = Math.min(low, _a.copy(c).applyMatrix4(_m).y);
    }
    if (!Number.isFinite(low)) return 0;
    // A planted limb can hold the body up (blends), never pull it down
    const up = Number.isFinite(lowPlanted) ? -lowPlanted - 0.01 : -Infinity;
    return mode === 'snap' ? Math.max(-low, up) : Math.max(0, -low, up);
  }

  /** Final ground solve on the blended pose (smoothed so a mode change doesn't pop). */
  private settle(dt: number, air: number, mode: GroundMode, planted: Snap['planted'], w = 1) {
    this.space.updateMatrixWorld(true);
    const target = this.groundOffset(mode, planted, true) * Math.min(1, w) + air;
    if (!this.primed) {
      this.smoothLift = target;
      this.primed = true;
    } else {
      const k = 1 - Math.exp(-28 * Math.max(dt, 0));
      this.smoothLift += (target - this.smoothLift) * k;
      // Never more than a couple of cm into the floor
      if (mode !== 'none') this.smoothLift = Math.max(this.smoothLift, target - 0.025);
    }
    this.lift = this.smoothLift;
    this.shift.position.y = this.lift;
    this.shift.updateMatrixWorld(true);
  }

  /** Lowest point of the body right now (dancer space), for tests. */
  lowest(): number {
    this.space.updateMatrixWorld(true);
    return -this.groundOffset('snap', [false, false, false, false], true);
  }

  /** Hips (dancer space) for the camera. */
  hipsAt(out: THREE.Vector3) {
    this.hips.getWorldPosition(out);
    return out.applyMatrix4(this.inv.copy(this.space.matrixWorld).invert());
  }

  /** Every bone rotation finite? (tests) */
  finite(): boolean {
    return this.bones.every(
      b =>
        Number.isFinite(b.quaternion.x) &&
        Number.isFinite(b.quaternion.y) &&
        Number.isFinite(b.quaternion.z) &&
        Number.isFinite(b.quaternion.w) &&
        Number.isFinite(b.position.x) &&
        Number.isFinite(b.position.y) &&
        Number.isFinite(b.position.z),
    );
  }

  /** Back to the bind pose (tests, disposal). */
  rest() {
    this.resetBind();
    this.shift.position.y = 0;
    void ID;
  }
}
