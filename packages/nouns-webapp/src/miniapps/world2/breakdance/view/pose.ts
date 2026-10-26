// ── Noun Breaks: procedural breaking, as pose specs ─────────────────────
//
// The Noun rig has no breaking clips, so every move is a function of time
// on the beat grid → a PoseSpec: where the hips are and how the pelvis is
// turned (that's the whole-body rotation of the power moves), how the
// spine and neck bend, and each limb either as forward kinematics
// (segment directions in its parent's frame) or as a two-bone IK reach
// (a hand or foot planted on the floor, under its own shoulder / hip if
// asked). rig.ts applies a spec to the bones; this file is pure math.
//
// Dancer space: +Y up, +Z the way the dancer faces, +X the dancer's LEFT
// (glTF / NounCharacter convention). Limb pairs are [left, right].
// The rig is small under a metre-cube Noun head: hips 0.56 m, legs
// ~0.44 m, shoulders ~1.0 m, arms ~0.42 m, head 1.15 × 1.0 × 0.85 m.
// A ground solve (rig.ts) puts the lowest point on the floor, so specs
// don't need to know exactly how tall an upside-down Noun is.

import type { MoveId } from '../contract';

import * as THREE from 'three';

import { moveInfo } from './moves';

/** Segment directions (upper, lower) in the parent's frame (chest for arms, pelvis for legs). */
export interface FK {
  a: THREE.Vector3;
  b: THREE.Vector3;
}

/** Two-bone IK: the hand / foot to a point, the elbow / knee toward `pole` (dancer space). */
export interface IK {
  /** Target (dancer space). With `under`, an offset from the joint's floor spot instead. */
  at: THREE.Vector3;
  pole: THREE.Vector3;
  /** `at.y` is height above the floor (after the ground solve), not raw dancer space. */
  floor?: boolean;
  /**
   * Plant under the limb's own root joint (shoulder / hip): `at` is then an
   * offset (x, z, dancer space) from the joint's spot on the floor + height (y).
   */
  under?: boolean;
}

export type Limb = FK | IK;
export const isIK = (l: Limb): l is IK => (l as IK).at !== undefined;

/**
 * How the rig settles the pose on the floor: 'snap' puts the lowest point
 * on it (power moves, freezes), 'lift' only pushes up out of it (feet
 * planted by IK), 'none' leaves the hips where the spec says.
 */
export type GroundMode = 'snap' | 'lift' | 'none';

export interface PoseSpec {
  /** Hips joint (dancer space). Standing: (0, 0.56, 0). */
  hips: THREE.Vector3;
  /** Pelvis orientation (dancer space): the whole-body rotation. */
  pelvis: THREE.Quaternion;
  /** Spine + chest bend relative to the pelvis (Euler YXZ, rad: x = forward, z = to the right). */
  spine: THREE.Vector3;
  /** Neck + head relative to the chest (same convention). */
  neck: THREE.Vector3;
  arms: [Limb, Limb];
  legs: [Limb, Limb];
  /** Foot heading (dancer space) for a flat foot, or null = pointed along the shin. */
  feet: [THREE.Vector3 | null, THREE.Vector3 | null];
  ground: GroundMode;
  /** Extra lift after the ground solve (m): airflare hops, get-up hop. */
  air: number;
}

/** Two specs the rig blends bone by bone (transitions between shapes). */
export interface PoseMix {
  a: PoseSpec;
  b: PoseSpec;
  k: number;
}

export type PoseOut = PoseSpec | PoseMix;
export const isMix = (p: PoseOut): p is PoseMix => (p as PoseMix).a !== undefined;

// ── tiny math kit ───────────────────────────────────────────────────────

const TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _e = new THREE.Euler();
const qe = (x: number, y: number, z: number) =>
  new THREE.Quaternion().setFromEuler(_e.set(x, y, z, 'YXZ'));
const qx = (a: number) => new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), a);
const qy = (a: number) => new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), a);
const qz = (a: number) => new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), a);
/** a · b · c … (applied right to left). */
const qm = (...qs: THREE.Quaternion[]) =>
  qs.reduce((acc, q) => acc.multiply(q), new THREE.Quaternion());
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const fr = (x: number) => x - Math.floor(x);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpV = (a: THREE.Vector3, b: THREE.Vector3, k: number) => a.clone().lerp(b, k);
/** A world (dancer-space) direction expressed in the frame `q`. */
const inFrame = (q: THREE.Quaternion, d: THREE.Vector3) =>
  d.clone().normalize().applyQuaternion(q.clone().invert());
const mx = (v: THREE.Vector3) => V(-v.x, v.y, v.z);
/** The same FK limb for the right side (mirror x). */
const fkR = (l: FK): FK => ({ a: mx(l.a), b: mx(l.b) });
const fk = (a: THREE.Vector3, b: THREE.Vector3 = a.clone()): FK => ({
  a: a.clone().normalize(),
  b: b.clone().normalize(),
});

/** Chest orientation for a pelvis + spine bend (the rig splits the bend evenly). */
const chestOf = (pelvis: THREE.Quaternion, spine: THREE.Vector3) =>
  pelvis.clone().multiply(qe(spine.x, spine.y, spine.z));

// ── building blocks ─────────────────────────────────────────────────────

const ANKLE = 0.085;
const WRIST = 0.035;

const ARM_HANG = fk(V(0.35, -0.94, 0.05), V(0.22, -0.93, 0.3));

/** Standing tall, arms loose. */
export function stand(): PoseSpec {
  return {
    hips: V(0, 0.54, 0),
    pelvis: new THREE.Quaternion(),
    spine: V(),
    neck: V(),
    arms: [fk(ARM_HANG.a, ARM_HANG.b), fkR(ARM_HANG)],
    legs: [
      { at: V(0.11, ANKLE, 0.02), pole: V(0.15, 0.2, 1), floor: true },
      { at: V(-0.11, ANKLE, 0.02), pole: V(-0.15, 0.2, 1), floor: true },
    ],
    feet: [V(0.25, 0, 1), V(-0.25, 0, 1)],
    ground: 'lift',
    air: 0,
  };
}

/** Mirror a pose left ↔ right (style variety per dancer). */
export function mirrorSpec(s: PoseSpec): PoseSpec {
  const ml = (l: Limb): Limb =>
    isIK(l) ? { ...l, at: mx(l.at), pole: mx(l.pole) } : { a: mx(l.a), b: mx(l.b) };
  return {
    hips: mx(s.hips),
    pelvis: new THREE.Quaternion(s.pelvis.x, -s.pelvis.y, -s.pelvis.z, s.pelvis.w),
    spine: V(s.spine.x, -s.spine.y, -s.spine.z),
    neck: V(s.neck.x, -s.neck.y, -s.neck.z),
    arms: [ml(s.arms[1]), ml(s.arms[0])],
    legs: [ml(s.legs[1]), ml(s.legs[0])],
    feet: [s.feet[1] !== null ? mx(s.feet[1]) : null, s.feet[0] !== null ? mx(s.feet[0]) : null],
    ground: s.ground,
    air: s.air,
  };
}

/** Turn a whole pose about the vertical (spins, facing). */
export function turnSpec(s: PoseSpec, yaw: number): PoseSpec {
  if (Math.abs(yaw) < 1e-6) return s;
  const q = qy(yaw);
  const tl = (l: Limb): Limb =>
    isIK(l)
      ? { ...l, at: l.at.clone().applyQuaternion(q), pole: l.pole.clone().applyQuaternion(q) }
      : l;
  return {
    ...s,
    hips: s.hips.clone().applyQuaternion(q),
    pelvis: q.clone().multiply(s.pelvis),
    arms: [tl(s.arms[0]), tl(s.arms[1])],
    legs: [tl(s.legs[0]), tl(s.legs[1])],
    feet: [
      s.feet[0] !== null ? s.feet[0].clone().applyQuaternion(q) : null,
      s.feet[1] !== null ? s.feet[1].clone().applyQuaternion(q) : null,
    ],
  };
}

export function mapMix(p: PoseOut, f: (s: PoseSpec) => PoseSpec): PoseOut {
  return isMix(p) ? { a: f(p.a), b: f(p.b), k: p.k } : f(p);
}

// ── toprock ─────────────────────────────────────────────────────────────

interface RockStyle {
  /** Where the stepping right foot goes (the left mirrors it). */
  step: THREE.Vector3;
  /** Forward lean while stepped (+ = forward). */
  lean: number;
  /** Arm shape while stepped: [left, right] targets for the right foot's step. */
  armsOut: [FK, FK];
  /** Pelvis yaw toward the step. */
  twist: number;
  /** Kick: the stepping foot goes up in the air instead of down. */
  kick?: boolean;
  /** Hips sway sideways toward the step (m). */
  sway?: number;
}

const ROCKS: Record<string, RockStyle> = {
  // Cross the front foot over on each beat, arms brushing open
  indian_step: {
    step: V(0.1, 0, 0.34),
    lean: -0.1,
    twist: 0.32,
    armsOut: [
      fk(V(0.85, -0.15, 0.5), V(0.35, 0.35, 0.87)),
      fk(V(-0.7, -0.45, 0.55), V(-0.1, 0.1, 1)),
    ],
  },
  // Rock back diagonally, chest over the front foot, arms pumping low
  salsa_rock: {
    step: V(-0.24, 0, -0.28),
    lean: 0.28,
    twist: -0.35,
    armsOut: [
      fk(V(0.55, -0.55, 0.62), V(-0.2, 0.25, 0.95)),
      fk(V(-0.6, -0.75, -0.25), V(-0.3, -0.5, 0.8)),
    ],
  },
  // Cross in front and across, hips swaying with it, arms crossed in an X
  cross_step: {
    step: V(0.2, 0, 0.12),
    lean: 0.05,
    twist: -0.45,
    sway: 0.07,
    armsOut: [
      fk(V(0.2, -0.45, 0.87), V(-0.75, 0.35, 0.55)),
      fk(V(-0.2, -0.4, 0.9), V(0.75, 0.4, 0.5)),
    ],
  },
  // Kick out front on the beat, arms thrown back
  kick_step: {
    step: V(-0.06, 0.26, 0.42),
    lean: -0.18,
    twist: 0.15,
    kick: true,
    armsOut: [
      fk(V(0.75, -0.3, -0.6), V(0.5, 0.2, -0.85)),
      fk(V(-0.75, -0.3, -0.6), V(-0.5, 0.2, -0.85)),
    ],
  },
};

/** How far a foot is "out" on its beat: 1 on the beat, home by the "and". */
export function stepOut(b: number, foot: 0 | 1): number {
  // The right foot owns the even beats, the left the odd ones
  const c = fr((b - (foot === 1 ? 0 : 1)) / 2) * 2;
  return c < 0.55 ? 1 - smooth(0.15, 0.5, c) : smooth(1.55, 1.95, c);
}

/** Down on the beat (1), up on the "and" (0). */
export const bounce = (b: number) => 0.5 + 0.5 * Math.cos(TAU * b);

export function toprock(id: string, b: number, amount = 1): PoseSpec {
  const st = ROCKS[id] ?? ROCKS.indian_step;
  const s = stand();
  const down = bounce(b) * amount;
  const oR = stepOut(b, 1) * amount;
  const oL = stepOut(b, 0) * amount;
  const net = oR - oL;
  s.hips.set((st.sway ?? 0.03) * net, 0.52 - 0.055 * down, 0);
  s.pelvis = qm(qy(st.twist * net), qx(st.lean * Math.max(oR, oL)), qz(-0.06 * net));
  s.spine.set(0.06 * down + 0.04, -st.twist * net * 0.5, 0);
  s.neck.set(0.14 * down - 0.05, 0, 0.05 * net);
  const homeL = V(0.12, ANKLE, 0.02);
  const homeR = V(-0.12, ANKLE, 0.02);
  const outR = st.step.clone().add(V(0, ANKLE, 0));
  const outL = mx(outR);
  const lift = (o: number) => (st.kick === true ? 0 : 0.13 * 4 * o * (1 - o));
  const footR = lerpV(homeR, outR, oR).add(V(0, lift(oR), 0));
  const footL = lerpV(homeL, outL, oL).add(V(0, lift(oL), 0));
  s.legs = [
    { at: footL, pole: V(0.25, 0.3, 1), floor: true },
    { at: footR, pole: V(-0.25, 0.3, 1), floor: true },
  ];
  s.feet = [V(0.3 - oL * 0.3, 0, 1), V(-0.3 + oR * 0.3, 0, 1)];
  // Arms: the right foot's shape when it steps, mirrored for the left
  const [aL, aR] = st.armsOut;
  const pumpL = fk(
    ARM_HANG.a.clone().add(V(0, 0.15 * down, 0.2)),
    ARM_HANG.b.clone().add(V(0, 0.2, 0.3)),
  );
  const pumpR = fkR(pumpL);
  const mixFk = (base: FK, a: FK, b2: FK, ka: number, kb: number): FK => ({
    a: base.a.clone().lerp(a.a, ka).lerp(b2.a, kb).normalize(),
    b: base.b.clone().lerp(a.b, ka).lerp(b2.b, kb).normalize(),
  });
  // Left arm: aL when the right foot steps, mirror(aR) when the left does
  s.arms = [mixFk(pumpL, aL, fkR(aR), oR, oL), mixFk(pumpR, aR, fkR(aL), oR, oL)];
  return s;
}

// ── footwork ────────────────────────────────────────────────────────────

/** Foot angles (deg) round the hands: 0 = under / in front, 90 = left side, 180 = behind (push-up). */
interface StepKeys {
  L: number[];
  R: number[];
  /** Beats per step. */
  step: number;
  /** Legs reach (1 normal; < 1 tucked tighter). */
  reach?: number;
  /** Extra crouch (m) lower. */
  low?: number;
}

const STEPS: Record<string, StepKeys> = {
  // The classic: legs walk all the way round the hands in six steps
  six_step: {
    L: [30, 30, 150, 150, 285, 285, 390],
    R: [-30, 75, 75, 210, 210, 330, 330],
    step: 0.5,
  },
  // Push-up → one leg through → the other: half the circle, then back
  three_step: { L: [150, 150, 20, 150], R: [210, 40, 40, 210], step: 0.5 },
  // CC's: the legs swap through, one under, one kicked back
  cc: { L: [10, 175, 10], R: [-175, -10, -175], step: 0.5 },
  // Pretzel: tangled and low, both legs crossing side to side
  pretzel: {
    L: [60, -40, -40, 60, 60],
    R: [80, 80, -60, -60, 80],
    step: 0.5,
    reach: 0.85,
    low: 0.04,
  },
  // Kick out: squat, shoot both legs back, squat
  kick_out: { L: [25, 165, 25], R: [-25, -165, -25], step: 0.5 },
};

const HANDS_C = V(0, 0, 0.36);

function footAt(deg: number, reach: number): THREE.Vector3 {
  const a = (deg * Math.PI) / 180;
  const r = (0.3 + 0.22 * (1 - Math.cos(a)) * 0.5 + 0.08 * Math.abs(Math.sin(a))) * reach;
  return V(Math.sin(a) * r, ANKLE, -0.14 + Math.cos(a) * r);
}

function keyAngle(keys: number[], k: number): { deg: number; moving: number } {
  const m = keys.length - 1;
  const span = keys[m] - keys[0];
  const cyc = Math.floor(k / m);
  const i = Math.floor(k) - cyc * m;
  const u = k - Math.floor(k);
  const a0 = keys[i] + cyc * span;
  const a1 = keys[i + 1] + cyc * span;
  // Move over the first 70% of the step, plant for the rest
  const e = smooth(0, 0.7, u);
  return { deg: lerp(a0, a1, e), moving: a1 !== a0 ? Math.sin(Math.PI * Math.min(1, u / 0.7)) : 0 };
}

/** A footwork frame from the two foot angles (+ how much each foot is in the air). */
export function footworkFrame(
  degL: number,
  degR: number,
  liftL = 0,
  liftR = 0,
  reach = 1,
  low = 0,
): PoseSpec {
  const fL = footAt(degL, reach).add(V(0, 0.12 * liftL, 0));
  const fR = footAt(degR, reach).add(V(0, 0.12 * liftR, 0));
  const mid = fL.clone().add(fR).multiplyScalar(0.5);
  // Front = squat (feet under), back = push-up (legs long)
  const front = THREE.MathUtils.clamp(
    (Math.cos((degL * Math.PI) / 180) + Math.cos((degR * Math.PI) / 180)) / 2,
    -1,
    1,
  );
  const fk01 = (front + 1) / 2;
  const hips = V(
    mid.x * 0.75,
    lerp(0.22, 0.27, fk01) - low,
    lerp(mid.z + 0.45, mid.z - 0.12, fk01),
  );
  const toHands = HANDS_C.clone().sub(hips).setY(0);
  const yaw = Math.atan2(toHands.x, toHands.z);
  const pitch = lerp(1.32, 1.12, fk01);
  const s = stand();
  s.hips = hips;
  s.pelvis = qm(qy(yaw), qx(pitch), qz(-mid.x * 0.6));
  s.spine.set(0.12, -yaw * 0.5, 0);
  s.neck.set(-pitch * 0.85, -yaw * 0.25, 0);
  // Hands: planted under the shoulders; one lifts as a leg sweeps through its side
  const side = (deg: number, sgn: number) => smooth(25, 70, sgn * (((deg + 540) % 360) - 180));
  const liftHandL = Math.max(side(degL, 1) * liftL, side(degR, 1) * liftR);
  const liftHandR = Math.max(side(degL, -1) * liftL, side(degR, -1) * liftR);
  const hand = (sx: number, lift: number): IK => ({
    at: V(sx * (0.06 + 0.25 * lift), WRIST + 0.32 * lift, 0.05 - 0.1 * lift).applyQuaternion(
      qy(yaw),
    ),
    pole: V(sx * 0.6, 0.2, -1).applyQuaternion(qy(yaw)),
    floor: true,
    under: true,
  });
  s.arms = [hand(1, liftHandL), hand(-1, liftHandR)];
  const knee = (f: THREE.Vector3) =>
    V(f.x - hips.x, 0, f.z - hips.z)
      .normalize()
      .multiplyScalar(0.6)
      .add(V(0, 1, 0));
  s.legs = [
    { at: fL, pole: knee(fL), floor: true },
    { at: fR, pole: knee(fR), floor: true },
  ];
  // Feet on their balls, toes out from the circle
  s.feet = [V(fL.x, 0, fL.z + 0.14).normalize(), V(fR.x, 0, fR.z + 0.14).normalize()];
  s.ground = 'lift';
  return s;
}

export function footwork(id: string, b: number): PoseSpec {
  const k = STEPS[id] ?? STEPS.six_step;
  const n = b / k.step;
  const l = keyAngle(k.L, n);
  const r = keyAngle(k.R, n);
  return footworkFrame(l.deg, r.deg, l.moving, r.moving, k.reach ?? 1, k.low ?? 0);
}

/** The squat a drop lands in and a get-up starts from. */
export const crouch = () => footworkFrame(30, -30);

// ── power moves ─────────────────────────────────────────────────────────

const ARMS_TUCK: [FK, FK] = [
  fk(V(0.25, -0.55, 0.8), V(-0.55, 0.15, 0.82)),
  fk(V(-0.3, -0.7, 0.65), V(0.5, 0.1, 0.86)),
];

/** Revolutions on the beat grid: whole turns per move so repeats loop seamlessly. */
export function revs(b: number, n: number, perBeat: number): number {
  const turns = Math.max(1, Math.round(n * perBeat));
  return (b / Math.max(n, 1e-3)) * turns;
}

function windmill(b: number, n: number): PoseSpec {
  const r = revs(b, n, 1);
  const psi = TAU * r;
  const lift = 0.42;
  const s = stand();
  // Long axis horizontal, head toward the spin centre, legs up and out in a V;
  // the body rolls once round its long axis per lap (back → shoulder → chest)
  s.pelvis = qm(qy(psi), qx(Math.PI / 2 + lift), qy(-psi));
  s.hips = V(0, 0.5, -0.5).applyQuaternion(qy(psi));
  s.spine.set(0.15, 0, 0);
  s.neck.set(0.35, 0, 0);
  // Legs: a wide V up in the air, sweeping round with the body (aimed in the
  // world, not the pelvis, so the roll underneath doesn't drag them through the floor)
  const out = V(0, 0, -1).applyQuaternion(qy(psi));
  const side = V(1, 0, 0).applyQuaternion(qy(psi));
  const spread = 0.75 + 0.1 * Math.sin(TAU * r * 2);
  const leg = (sx: number) => {
    const up = 1.25 + 0.4 * Math.sin(TAU * r + sx * 1.2);
    const d = out
      .clone()
      .multiplyScalar(Math.cos(spread))
      .addScaledVector(side, sx * Math.sin(spread))
      .add(V(0, up, 0));
    return fk(inFrame(s.pelvis, d));
  };
  s.legs = [leg(1), leg(-1)];
  s.arms = [ARMS_TUCK[0], ARMS_TUCK[1]];
  s.feet = [null, null];
  s.ground = 'snap';
  return s;
}

function flare(b: number, n: number): PoseSpec {
  const r = revs(b, n, 1);
  const psi = TAU * r;
  const s = stand();
  const pitch = 0.95;
  // Rocking hand to hand: the body tips side to side, so the legs swing out from under the head
  s.pelvis = qm(qy(psi), qz(0.5 * Math.sin(psi)), qx(pitch));
  s.hips = V(0, 0.2 + 0.04 * Math.sin(psi * 2), -0.2).applyQuaternion(qy(psi));
  s.spine.set(0.1, 0, 0);
  s.neck.set(-0.85, 0, 0);
  // Straddle: legs wide, back and swinging up as they pass the front
  const leg = (sx: number) => {
    // Each leg circles: whipped high as it comes round the front, low behind
    const swing = 0.4 * Math.sin(psi + sx * 1.4);
    return fk(inFrame(s.pelvis, V(sx * 0.8, 0.95 + swing, -0.3).applyQuaternion(qy(psi))));
  };
  s.legs = [leg(1), leg(-1)];
  // Hands planted, each lifting as the legs sweep past its side
  const lift = (sx: number) => smooth(0.25, 0.85, sx * Math.sin(psi));
  const hand = (sx: number): IK => {
    const l = lift(sx);
    return {
      at: V(sx * (0.05 + 0.25 * l), WRIST + 0.28 * l, 0.06).applyQuaternion(qy(psi)),
      pole: V(sx, 0, -0.6).applyQuaternion(qy(psi)),
      floor: true,
      under: true,
    };
  };
  s.arms = [hand(1), hand(-1)];
  s.feet = [null, null];
  s.ground = 'lift';
  return s;
}

function headspin(b: number, n: number): PoseSpec {
  const r = revs(b, n, 1);
  const s = stand();
  s.pelvis = qm(qy(TAU * r), qx(Math.PI));
  s.hips = V(0, 2.2, 0);
  const sc = 0.18 * Math.sin((TAU * b) / 2);
  s.legs = [fk(V(0.42, -0.9, 0.05 + sc)), fk(V(-0.42, -0.9, 0.05 - sc))];
  // Arms out for balance, hands toward the floor
  s.arms = [fk(V(0.95, 0.15, 0.25), V(0.7, 0.7, 0.1)), fk(V(-0.95, 0.15, 0.25), V(-0.7, 0.7, 0.1))];
  s.feet = [null, null];
  s.ground = 'snap';
  return s;
}

function backspin(b: number, n: number): PoseSpec {
  const r = revs(b, n, 1.5);
  const s = stand();
  // On the back, sat up a little, knees hugged to the chest
  s.pelvis = qm(qy(TAU * r), qx(-Math.PI / 2 + 0.45));
  s.hips = V(0, 0.4, 0);
  s.spine.set(0.4, 0, 0);
  s.neck.set(0.3, 0, 0);
  s.legs = [fk(V(0.22, 0.25, 1), V(0.1, -1, 0.15)), fk(V(-0.22, 0.25, 1), V(-0.1, -1, 0.15))];
  s.arms = [
    fk(V(0.3, -0.25, 0.92), V(-0.45, 0.35, 0.8)),
    fk(V(-0.3, -0.25, 0.92), V(0.45, 0.35, 0.8)),
  ];
  s.feet = [null, null];
  s.ground = 'snap';
  return s;
}

function swipe(b: number, n: number): PoseSpec {
  const r = revs(b, n, 0.5);
  const psi = TAU * r;
  // Each swipe: face-down on the hands, whip round onto the back (feet down)
  const w = 0.5 + 0.5 * Math.cos(TAU * fr(r) * 2); // 1 face-down, 0 arched
  const tilt = lerp(-0.85, 1.2, w);
  const s = stand();
  s.pelvis = qm(qy(psi), qx(tilt));
  s.hips = V(0, 0.5, 0);
  s.spine.set(lerp(-0.35, 0.1, w), 0, 0);
  s.neck.set(lerp(0.3, -0.9, w), 0, 0);
  const legDown = fk(V(0.3, -0.9, 0.3));
  const legUp = fk(V(0.4, -0.55, -0.75), V(0.35, -0.3, -0.9));
  const L: FK = {
    a: lerpV(legDown.a, legUp.a, w).normalize(),
    b: lerpV(legDown.b, legUp.b, w).normalize(),
  };
  s.legs = [L, fkR(L)];
  const arm = (sx: number): IK => ({
    at: lerpV(V(sx * 0.5, 0.7, -0.1), V(sx * 0.08, WRIST, 0.06), w).applyQuaternion(qy(psi)),
    pole: V(sx, -0.2, -0.6).applyQuaternion(qy(psi)),
    floor: true,
    under: true,
  });
  s.arms = [arm(1), arm(-1)];
  s.feet = [null, null];
  s.ground = 'snap';
  return s;
}

function turtle(b: number, n: number): PoseSpec {
  const r = revs(b, n, 0.5);
  const psi = TAU * r;
  const s = stand();
  // Face down, flat, balanced on the elbows; rocking hand to hand round the circle
  s.pelvis = qm(qy(psi), qx(Math.PI / 2 - 0.08), qy(0.25 * Math.sin(TAU * b)));
  s.hips = V(0, 0.42, -0.35).applyQuaternion(qy(psi));
  s.spine.set(-0.15, 0, 0);
  s.neck.set(-0.45, 0, 0);
  // Knees out wide and up, feet tucked over the back
  s.legs = [
    fk(V(0.75, -0.35, -0.55), V(0.2, 0.2, -0.96)),
    fk(V(-0.75, -0.35, -0.55), V(-0.2, 0.2, -0.96)),
  ];
  const arm = (sx: number): IK => ({
    at: V(sx * 0.02, WRIST, 0.12 + 0.03 * sx * Math.sin(TAU * b)).applyQuaternion(qy(psi)),
    pole: V(sx * 0.4, 0, -1).applyQuaternion(qy(psi)),
    floor: true,
    under: true,
  });
  s.arms = [arm(1), arm(-1)];
  s.feet = [null, null];
  s.ground = 'lift';
  return s;
}

function airflare(b: number, n: number): PoseSpec {
  const r = revs(b, n, 1);
  const psi = TAU * r;
  const s = stand();
  // A tilted flip round the hands, airborne between the hand changes
  s.pelvis = qm(qy(psi), qx(Math.PI / 2 - 0.55), qy(-psi + Math.PI / 2));
  s.hips = V(0, 0.7, -0.25).applyQuaternion(qy(psi));
  s.spine.set(0.1, 0, 0);
  s.neck.set(-0.2, 0, 0);
  s.legs = [fk(V(0.75, -0.66, 0)), fk(V(-0.75, -0.66, 0))];
  const reach = (sx: number): IK => {
    const down = smooth(-0.1, 0.6, sx * Math.cos(psi));
    return {
      at: V(sx * (0.1 + 0.3 * (1 - down)), lerp(0.55, WRIST, down), 0.05).applyQuaternion(qy(psi)),
      pole: V(sx, 0, -0.6).applyQuaternion(qy(psi)),
      floor: true,
      under: true,
    };
  };
  s.arms = [reach(1), reach(-1)];
  s.feet = [null, null];
  s.ground = 'snap';
  s.air = 0.22 * Math.abs(Math.sin(psi));
  return s;
}

// ── freezes ─────────────────────────────────────────────────────────────

function babyFreeze(b: number): PoseSpec {
  const s = stand();
  // Tipped onto the right side of the head, hips up, knee resting on the elbow
  s.pelvis = qm(qy(0.4), qz(-2.05), qx(0.45));
  s.hips = V(0, 1.2, 0);
  s.spine.set(0.35, 0, -0.15);
  s.neck.set(0.15, 0, -0.2);
  s.legs = [
    fk(V(0.1, -0.2, 0.98), V(0.1, -0.95, 0.15)),
    fk(V(-0.25, -0.35, 0.9), V(-0.15, -0.9, -0.35)),
  ];
  s.arms = [
    { at: V(0.1, WRIST, 0.15), pole: V(0.5, 1, 0), floor: true, under: true },
    { at: V(-0.05, WRIST, 0.2), pole: V(-0.3, 1, 0.5), floor: true, under: true },
  ];
  s.feet = [null, null];
  s.ground = 'snap';
  return breathe(s, b);
}

function chairFreeze(b: number): PoseSpec {
  const s = stand();
  // On one hand, body tipped sideways and back, legs in a figure four ("the chair")
  s.pelvis = qm(qy(-0.5), qz(1.15), qx(-0.35));
  s.hips = V(0, 0.9, 0);
  s.spine.set(0.1, 0.2, 0.2);
  s.neck.set(0.2, 0.2, 0.35);
  s.legs = [
    fk(V(0.05, -0.25, 0.97), V(0.05, -0.97, 0.2)),
    fk(V(-0.2, -0.3, 0.93), V(0.85, -0.2, 0.45)),
  ];
  s.arms = [
    { at: V(0.04, WRIST, 0.0), pole: V(0, 1, -0.5), floor: true, under: true },
    fk(V(-0.85, 0.35, 0.4), V(-0.6, 0.75, 0.25)),
  ];
  s.feet = [null, null];
  s.ground = 'snap';
  return breathe(s, b);
}

function headstand(b: number): PoseSpec {
  const s = stand();
  s.pelvis = qm(qy(0.5), qx(Math.PI + 0.06));
  s.hips = V(0, 2.2, 0);
  s.legs = [fk(V(0.14, -1, 0.02)), fk(V(-0.08, -1, -0.04))];
  // Elbows out, hands down by the head
  s.arms = [fk(V(0.9, 0.35, 0.3), V(0.2, 0.95, 0.25)), fk(V(-0.9, 0.35, 0.3), V(-0.2, 0.95, 0.25))];
  s.feet = [null, null];
  s.ground = 'snap';
  return breathe(s, b);
}

function airchair(b: number): PoseSpec {
  const s = stand();
  // Leaning way back on one straight arm, legs piked up at the sky
  s.pelvis = qm(qy(0.6), qz(-0.55), qx(-1.2));
  s.hips = V(0, 0.75, 0);
  s.spine.set(0.25, 0, -0.2);
  s.neck.set(0.95, 0, -0.2);
  s.legs = [fk(V(0.12, -0.15, 1), V(0.1, -0.05, 1)), fk(V(-0.18, -0.35, 0.92), V(0.2, -0.9, 0.35))];
  s.arms = [
    fk(V(0.9, 0.2, 0.35), V(0.8, 0.55, 0.2)),
    { at: V(-0.08, WRIST, -0.05), pole: V(-0.4, 0.6, -1), floor: true, under: true },
  ];
  s.feet = [null, null];
  s.ground = 'snap';
  return breathe(s, b);
}

function hollowback(b: number): PoseSpec {
  const s = stand();
  // Upside down, back arched hard, legs bent over the head
  // (pelvis tipped past upside down, the spine bends back so the chest hangs plumb)
  s.pelvis = qm(qy(-0.3), qx(Math.PI + 0.6));
  s.hips = V(0, 2.0, 0);
  s.spine.set(-0.55, 0, 0);
  s.neck.set(-0.2, 0, 0);
  s.legs = [
    fk(V(0.2, -0.8, -0.55), V(0.12, 0.2, -0.97)),
    fk(V(-0.12, -0.85, -0.5), V(-0.1, 0.1, -0.99)),
  ];
  s.arms = [fk(V(0.4, 0.85, 0.3), V(0.15, 0.98, 0.1)), fk(V(-0.4, 0.85, 0.3), V(-0.15, 0.98, 0.1))];
  s.feet = [null, null];
  s.ground = 'snap';
  return breathe(s, b);
}

/** A freeze is still, but alive: a little sway with the music. */
function breathe(s: PoseSpec, b: number): PoseSpec {
  const k = 0.025 * Math.sin(TAU * b * 0.5);
  s.pelvis = s.pelvis.clone().multiply(qx(k));
  s.neck = s.neck.clone().add(V(0.04 * bounce(b), 0, 0));
  return s;
}

// ── transitions ─────────────────────────────────────────────────────────

function dropPose(t: number, b: number): PoseOut {
  // From toprock down onto the hands: a knee-drop with the leg sweeping out
  const top = toprock('indian_step', b, 1 - t);
  const low = footworkFrame(lerp(-40, 30, smooth(0.3, 1, t)), -30, 0, Math.sin(Math.PI * t));
  return { a: top, b: low, k: smooth(0.05, 0.85, t) };
}

function spinDown(t: number, b: number): PoseOut {
  const spin = TAU * smooth(0, 0.85, t);
  return mapMix(dropPose(t, b), s => turnSpec(s, spin));
}

function getUp(t: number, b: number): PoseOut {
  const low = crouch();
  const top = toprock('indian_step', b, smooth(0.6, 1, t));
  top.air = 0.1 * Math.sin(Math.PI * smooth(0.2, 0.9, t));
  return { a: low, b: top, k: smooth(0.1, 0.8, t) };
}

// ── crash + idle ────────────────────────────────────────────────────────

/** Bailed: sat down hard on the floor, arms back, legs out. */
export function crashPose(b: number, t: number): PoseSpec {
  const s = stand();
  const wob = Math.sin(t * 9) * Math.exp(-t * 2) * 0.25;
  s.pelvis = qm(qz(wob), qx(-0.75));
  s.hips = V(0, 0.25, -0.05);
  s.spine.set(0.3, 0, -wob);
  s.neck.set(0.25 + 0.1 * Math.sin(t * 3), 0, 0.2);
  s.legs = [
    fk(inFrame(s.pelvis, V(0.35, -0.12, 0.92)), inFrame(s.pelvis, V(0.4, -0.3, 0.86))),
    fk(inFrame(s.pelvis, V(-0.3, -0.05, 0.95)), inFrame(s.pelvis, V(-0.2, -0.35, 0.9))),
  ];
  s.arms = [
    { at: V(0.12, WRIST, -0.2), pole: V(0.6, 0.4, -0.2), floor: true, under: true },
    { at: V(-0.12, WRIST, -0.2), pole: V(-0.6, 0.4, -0.2), floor: true, under: true },
  ];
  s.feet = [V(0.3, 0.6, 1), V(-0.3, 0.6, 1)];
  s.ground = 'snap';
  void b;
  return s;
}

/** In the middle with no move: rocking to the beat. */
export const vibePose = (b: number) => toprock('indian_step', b, 0.55);

// ── the table ───────────────────────────────────────────────────────────

/**
 * A move's pose `b` beats in (of `n`). `mirror` flips it left ↔ right
 * (a dancer's style). Unknown ids fall back to their family's default.
 */
export function movePose(id: MoveId | string, b: number, n: number, mirror = false): PoseOut {
  const t = THREE.MathUtils.clamp(b / Math.max(n, 1e-3), 0, 1);
  let out: PoseOut;
  switch (id) {
    case 'indian_step':
    case 'salsa_rock':
    case 'cross_step':
    case 'kick_step':
      out = toprock(id, b);
      break;
    case 'six_step':
    case 'three_step':
    case 'cc':
    case 'pretzel':
    case 'kick_out':
      out = footwork(id, b);
      break;
    case 'windmill':
      out = windmill(b, n);
      break;
    case 'flare':
      out = flare(b, n);
      break;
    case 'headspin':
      out = headspin(b, n);
      break;
    case 'backspin':
      out = backspin(b, n);
      break;
    case 'swipe':
      out = swipe(b, n);
      break;
    case 'turtle':
      out = turtle(b, n);
      break;
    case 'airflare':
      out = airflare(b, n);
      break;
    case 'baby_freeze':
      out = babyFreeze(b);
      break;
    case 'chair_freeze':
      out = chairFreeze(b);
      break;
    case 'headstand':
      out = headstand(b);
      break;
    case 'airchair':
      out = airchair(b);
      break;
    case 'hollowback':
      out = hollowback(b);
      break;
    case 'drop':
      out = dropPose(t, b);
      break;
    case 'spin_down':
      out = spinDown(t, b);
      break;
    case 'get_up':
      out = getUp(t, b);
      break;
    default: {
      const fam = moveInfo(id)?.family;
      out =
        fam === 'footwork'
          ? footwork('six_step', b)
          : fam === 'power'
            ? windmill(b, n)
            : fam === 'freeze'
              ? babyFreeze(b)
              : fam === 'transition'
                ? dropPose(t, b)
                : toprock('indian_step', b);
    }
  }
  return mirror ? mapMix(out, mirrorSpec) : out;
}

/** Every number in a spec, for tests (all must stay finite). */
export function specNumbers(p: PoseOut): number[] {
  const one = (s: PoseSpec): number[] => {
    const v = (x: THREE.Vector3) => [x.x, x.y, x.z];
    const l = (x: Limb) => (isIK(x) ? [...v(x.at), ...v(x.pole)] : [...v(x.a), ...v(x.b)]);
    return [
      ...v(s.hips),
      s.pelvis.x,
      s.pelvis.y,
      s.pelvis.z,
      s.pelvis.w,
      ...v(s.spine),
      ...v(s.neck),
      ...l(s.arms[0]),
      ...l(s.arms[1]),
      ...l(s.legs[0]),
      ...l(s.legs[1]),
      ...(s.feet[0] !== null ? v(s.feet[0]) : []),
      ...(s.feet[1] !== null ? v(s.feet[1]) : []),
      s.air,
    ];
  };
  return isMix(p) ? [...one(p.a), ...one(p.b), p.k] : one(p);
}

export { chestOf };
