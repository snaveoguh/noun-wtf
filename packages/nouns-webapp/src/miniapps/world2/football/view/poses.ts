// ── Noun Football: every Action as a pose on the Noun rig ───────────────
//
// The rig has no football clips, so like breakdance / parkour / skydive
// each Action is a PoseSpec (breakdance/view/pose.ts) built from the
// PlayerState alone: action + actionT, actionDir, speed, the stride phase
// the view integrates from distance travelled, which foot kicks (the side
// the ball is on) and a per-player variant. Pure: no bones, no clock.
//
// Rider space: +Y up, +Z the way the player faces, +X the player's LEFT.
// Limb pairs are [left, right]. Legs are FK in the pelvis frame, arms FK
// in the chest frame (or IK to a point). The rig is small under a big
// head (hips 0.56 m, legs ~0.44 m, arms ~0.42 m, head ~1.15 × 1.0 ×
// 0.85 m), so arms go wide where overhead would vanish inside the head.

import type { Action } from '../contract';

import * as THREE from 'three';

import {
  smooth,
  stand,
  turnSpec,
  type FK,
  type IK,
  type PoseOut,
  type PoseSpec,
} from '../../breakdance/view/pose';

const TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const qAxis = (x: number, y: number, z: number, a: number) =>
  new THREE.Quaternion().setFromAxisAngle(V(x, y, z), a);
const qx = (a: number) => qAxis(1, 0, 0, a);
const qy = (a: number) => qAxis(0, 1, 0, a);
const qz = (a: number) => qAxis(0, 0, 1, a);
const qm = (...qs: THREE.Quaternion[]) =>
  qs.reduce((acc, r) => acc.multiply(r), new THREE.Quaternion());
const fk = (a: THREE.Vector3, b: THREE.Vector3 = a.clone()): FK => ({
  a: a.clone().normalize(),
  b: b.clone().normalize(),
});
const ik = (at: THREE.Vector3, pole: THREE.Vector3, floor = true): IK => ({ at, pole, floor });
/** Mirror a vector to the other side (x). */
const mx = (v: THREE.Vector3) => V(-v.x, v.y, v.z);
const fkM = (l: FK): FK => ({ a: mx(l.a), b: mx(l.b) });
/** The same FK limb on both sides: [left, right]. */
const pair = (l: FK): [FK, FK] => [l, fkM(l)];
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const fr = (x: number) => x - Math.floor(x);
/** A world (rider-space) direction expressed in the frame `q` (legs on a turned pelvis). */
const inFrame = (q: THREE.Quaternion, d: THREE.Vector3) =>
  d.clone().normalize().applyQuaternion(q.clone().invert());

const ANKLE = 0.085;
const ARM_HANG = fk(V(0.35, -0.94, 0.05), V(0.22, -0.93, 0.3));

// ── what the view hands in ──────────────────────────────────────────────

export interface PoseIn {
  action: Action;
  /** 0..1 through the action. */
  t: number;
  /** PlayerState.actionDir (dive side, skill index …). */
  dir: number;
  /** Ground speed (m/s). */
  speed: number;
  /** Stride phase in cycles (one cycle = a left and a right step), from distance travelled. */
  phase: number;
  /** Kicking / leading foot: +1 left, −1 right (the side the ball is on). */
  side: 1 | -1;
  /** Seconds (breathing, bounces, fist pumps). */
  time: number;
  /** Per-player variant (hash): picks celebrations, dejection, fallen pose. */
  variant: number;
}

export type Gait = 'idle' | 'jog' | 'run' | 'sprint';

/** Gait for a ground speed (m/s). */
export function gaitOf(speed: number): Gait {
  if (speed < 0.3) return 'idle';
  if (speed < 3.6) return 'jog';
  if (speed < 6.4) return 'run';
  return 'sprint';
}

/**
 * Ground covered by one stride cycle (m) at a speed: longer strides as you
 * go faster, so cadence rises gently (2.5 Hz steps jogging, ~4.4 sprinting).
 */
export function strideLength(speed: number): number {
  return 1.1 + 0.32 * Math.max(0, Math.min(10, speed));
}

/** Advance a stride phase (cycles) by `dist` m travelled at `speed`. */
export function advanceStride(phase: number, dist: number, speed: number): number {
  if (dist <= 0) return phase;
  return phase + dist / strideLength(speed);
}

/**
 * Which foot plays the ball: the side of the player's facing it's on
 * (+1 left = +X in rider space, −1 right). Straight ahead → `fallback`.
 */
export function kickSide(
  px: number,
  pz: number,
  yaw: number,
  bx: number,
  bz: number,
  fallback: 1 | -1 = -1,
): 1 | -1 {
  // Rider +X in world: (cos yaw, −sin yaw)
  const lx = (bx - px) * Math.cos(yaw) - (bz - pz) * Math.sin(yaw);
  if (Math.abs(lx) < 0.04) return fallback;
  return lx > 0 ? 1 : -1;
}

export const CELEBRATIONS = ['kneeslide', 'airplane', 'backflip', 'fistpump'] as const;
export type Celebration = (typeof CELEBRATIONS)[number];
export const SKILLS = ['stepover', 'flick', 'roulette', 'elastico'] as const;
export type Skill = (typeof SKILLS)[number];

export const celebrationOf = (variant: number): Celebration =>
  CELEBRATIONS[Math.abs(Math.floor(variant)) % CELEBRATIONS.length];
export const skillOf = (dir: number): Skill => SKILLS[Math.abs(Math.round(dir)) % SKILLS.length];

/** Is the ball in this player's hands at this point of the action (keepers, throw-ins)? */
export function holdsBall(action: Action, t: number): boolean {
  switch (action) {
    case 'gk_hold':
      return true;
    case 'gk_catch':
      return t > 0.35;
    case 'gk_throw':
      return t < 0.62;
    case 'gk_kick':
      return t < 0.3;
    case 'throw_in':
      return t < 0.66;
    default:
      return false;
  }
}

/** Actions whose pose is all about the moment (crossfade into them fast). */
export function snappy(action: Action): boolean {
  return (
    action === 'pass' ||
    action === 'lob' ||
    action === 'shoot' ||
    action === 'volley' ||
    action === 'header' ||
    action === 'gk_dive' ||
    action === 'tackle' ||
    action === 'slide' ||
    action === 'gk_kick'
  );
}

// ── building blocks ─────────────────────────────────────────────────────

/** Arms swinging like a runner's (phase in cycles, opposite to the legs). */
function runArms(phase: number, amt: number, wide = 0): [FK, FK] {
  const s = Math.sin(phase * TAU) * amt;
  const l = fk(V(0.32 + wide, -0.8, -0.5 * s), V(0.18 + wide, 0.1 + 0.35 * Math.max(0, -s), 0.95));
  const r = fk(V(-0.32 - wide, -0.8, 0.5 * s), V(-0.18 - wide, 0.1 + 0.35 * Math.max(0, s), 0.95));
  return [l, r];
}

/** A leg cycling (phase in cycles; +1 left / −1 right); `amp` 0..1 how far it swings. */
function cycleLeg(phase: number, x: number, amp: number): FK {
  const a = phase * TAU;
  const swing = (0.25 + 0.55 * amp) * Math.sin(a);
  // Knee folds on the recovery (leg coming through behind → in front)
  const knee = (0.25 + 1.15 * amp) * Math.max(0, -Math.cos(a)) + 0.12;
  return fk(
    V(0.06 * x, -Math.cos(swing), Math.sin(swing)),
    V(0.03 * x, -Math.cos(swing - knee), Math.sin(swing - knee)),
  );
}

/** Running / jogging at `speed` (m/s), stride phase `phase` (cycles). */
export function gait(
  speed: number,
  phase: number,
  o: { crouch?: number; head?: number } = {},
): PoseSpec {
  const s = stand();
  const k = clamp01((speed - 0.3) / 7.5);
  const lean = 0.06 + 0.32 * k;
  s.pelvis = qm(qy(0.12 * k * Math.sin(phase * TAU)), qx(0.06 + 0.1 * k));
  s.spine.set(lean, -0.14 * k * Math.sin(phase * TAU), 0);
  s.neck.set(-lean * 0.6 + (o.head ?? 0), 0, 0);
  s.legs = [cycleLeg(phase, 1, k), cycleLeg(phase + 0.5, -1, k)];
  s.feet = [null, null];
  s.arms = runArms(phase, 0.35 + 0.65 * k);
  s.ground = 'snap';
  // Flight on each step (twice a cycle) once running
  s.air = (0.015 + 0.06 * k * k) * Math.abs(Math.sin(phase * TAU)) * (1 - (o.crouch ?? 0));
  if (o.crouch !== undefined && o.crouch > 0) s.spine.x += 0.25 * o.crouch;
  return s;
}

function idle(time: number, variant: number): PoseSpec {
  const s = stand();
  const br = Math.sin(time * 1.6 + variant) * 0.5 + 0.5;
  s.hips = V(0, 0.54 - 0.008 * br, 0);
  s.spine.set(0.04 + 0.02 * br, 0, 0);
  s.neck.set(-0.04, 0.15 * Math.sin(time * 0.37 + variant * 1.7), 0);
  s.legs = [ik(V(0.13, ANKLE, 0.03), V(0.2, 0.2, 1)), ik(V(-0.13, ANKLE, -0.02), V(-0.2, 0.2, 1))];
  s.arms = [
    fk(V(0.4, -0.9, 0.08), V(0.28, -0.9, 0.3)),
    fk(V(-0.4, -0.9, 0.08), V(-0.28, -0.9, 0.3)),
  ];
  return s;
}

/** A leg kicking: thigh angle θ forward of straight down, knee bend k (rad), x = outward lean. */
function kickLeg(theta: number, knee: number, x: number, inside = 0): FK {
  return fk(
    V(x + inside, -Math.cos(theta), Math.sin(theta)),
    V(x * 0.6 + inside * 1.4, -Math.cos(theta - knee), Math.sin(theta - knee)),
  );
}

interface KickStyle {
  wind: number;
  follow: number;
  /** Spine lean (forward +) at the strike. */
  lean: number;
  /** Inside of the foot (turns the foot out). */
  inside: number;
  /** Whole body tips away from the kicking side (volleys). */
  tilt: number;
}

const KICKS: Record<'pass' | 'lob' | 'shoot' | 'volley' | 'gk_kick', KickStyle> = {
  pass: { wind: -0.6, follow: 1.05, lean: 0.12, inside: 0.32, tilt: 0 },
  lob: { wind: -0.9, follow: 1.45, lean: -0.22, inside: 0.05, tilt: 0 },
  shoot: { wind: -1.1, follow: 1.4, lean: 0.3, inside: 0, tilt: 0.12 },
  volley: { wind: -0.8, follow: 1.2, lean: -0.05, inside: -0.2, tilt: 0.7 },
  gk_kick: { wind: -0.85, follow: 1.7, lean: -0.15, inside: 0, tilt: 0 },
};

/** The kicking thigh angle + knee through wind-up → strike → follow-through → recover. */
export function kickCurve(
  t: number,
  wind: number,
  follow: number,
): { theta: number; knee: number } {
  if (t < 0.35) {
    const u = smooth(0, 0.35, t);
    return { theta: lerp(0, wind, u), knee: lerp(0.15, 1.55, u) };
  }
  if (t < 0.48) {
    const u = smooth(0.35, 0.48, t);
    return { theta: lerp(wind, 0.3, u), knee: lerp(1.55, 0.12, u) };
  }
  if (t < 0.85) {
    const u = smooth(0.48, 0.8, t);
    return { theta: lerp(0.3, follow, u), knee: lerp(0.12, 0.3, u) };
  }
  const u = smooth(0.85, 1, t);
  return { theta: lerp(follow, 0.05, u), knee: lerp(0.3, 0.15, u) };
}

/** Strike moment (0..1 of the action) for kicks: the ball leaves the foot here. */
export const STRIKE_T = 0.45;

function kick(kind: keyof typeof KICKS, t: number, side: 1 | -1): PoseSpec {
  const st = KICKS[kind];
  const s = stand();
  const { theta, knee } = kickCurve(t, st.wind, st.follow);
  const strike = smooth(0.25, 0.48, t) * (1 - smooth(0.85, 1, t));
  const wound = smooth(0, 0.35, t) * (1 - smooth(0.35, 0.5, t));
  // Kick leg (built for the left, mirrored for the right)
  const leg = kickLeg(theta, knee, 0.07, st.inside * strike);
  const plant = ik(V(-0.14, ANKLE, 0.05 * strike - 0.02), V(-0.2, 0.25, 1));
  const tilt = st.tilt * strike;
  s.pelvis = qm(qy(-0.32 * wound + 0.3 * strike), qz(-tilt), qx(0.05));
  s.spine.set(lerp(0.08, st.lean, strike), 0.2 * strike, tilt * 0.6);
  s.neck.set(0.25 * (1 - strike) + 0.1, 0, -tilt * 0.4);
  // Arms: the far arm sweeps forward + out, the near arm back
  const far = fk(V(-0.85, -0.2 + 0.4 * strike, 0.35 * strike), V(-0.75, 0.15, 0.6));
  const near = fk(V(0.75, -0.45, -0.45 * strike), V(0.6, -0.2, -0.2));
  s.arms = [near, far];
  s.legs = [leg, plant];
  s.feet = [st.inside > 0.2 ? V(0.9, -0.2, 0.4) : null, V(-0.2, 0, 1)];
  s.ground = 'lift';
  if (kind === 'volley') {
    // Off the ground into it: the standing leg folds too
    s.legs[1] = kickLeg(0.15, 0.6 * strike, -0.06);
    s.feet[1] = null;
    s.ground = 'snap';
  }
  if (kind === 'gk_kick' && t < 0.3) {
    // Ball held out in both hands, dropped onto the foot
    const hold = 1 - smooth(0.18, 0.3, t);
    const out = fk(V(0.3, -0.35, 0.9), V(0.05, -0.1, 1));
    s.arms = [out, fkM(out)];
    s.spine.x += 0.15 * hold;
  }
  return side === 1 ? s : mirror(s);
}

/** Mirror a pose left ↔ right (breakdance mirrorSpec without the import cycle). */
function mirror(s: PoseSpec): PoseSpec {
  const ml = (l: FK | IK): FK | IK =>
    (l as IK).at !== undefined
      ? { ...(l as IK), at: mx((l as IK).at), pole: mx((l as IK).pole) }
      : fkM(l as FK);
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

function dribble(speed: number, phase: number, side: 1 | -1): PoseSpec {
  const s = gait(Math.min(speed, 6.5) * 0.85, phase, { crouch: 0.35, head: 0.28 });
  // A touch every cycle with the ball foot: it reaches forward, toe down
  const own = side === 1 ? 0 : 1;
  const ph = fr(phase + (own === 0 ? 0 : 0.5));
  const touch = smooth(0.05, 0.22, ph) * (1 - smooth(0.28, 0.42, ph));
  if (touch > 0) {
    const reach = kickLeg(0.55 * touch + 0.15, 0.25, 0.08 * side);
    const cur = s.legs[own] as FK;
    s.legs[own] = fk(cur.a.clone().lerp(reach.a, touch), cur.b.clone().lerp(reach.b, touch));
  }
  s.arms = runArms(phase, 0.4, 0.18);
  return s;
}

function trap(t: number, side: 1 | -1): PoseSpec {
  const s = stand();
  const up = smooth(0, 0.3, t) * (1 - smooth(0.55, 0.95, t));
  const leg = kickLeg(0.75 * up, 0.35 + 0.5 * up, 0.08, 0.25 * up);
  s.legs = [leg, ik(V(-0.13, ANKLE, -0.03), V(-0.2, 0.2, 1))];
  s.feet = [V(0.8 * up + 0.2, 0.2 * up, 1), V(-0.2, 0, 1)];
  s.spine.set(0.1 + 0.15 * up, 0, 0);
  s.neck.set(0.35 * up, 0, 0);
  const bal = fk(V(0.85, -0.35, 0.15), V(0.75, 0, 0.3));
  s.arms = [bal, fkM(bal)];
  s.ground = 'lift';
  return side === 1 ? s : mirror(s);
}

function header(t: number): PoseSpec {
  const s = stand();
  const load = smooth(0, 0.4, t) * (1 - smooth(0.42, 0.55, t));
  const snap = smooth(0.4, 0.56, t) * (1 - smooth(0.8, 1, t));
  s.spine.set(-0.3 * load + 0.4 * snap, 0, 0);
  s.neck.set(-0.55 * load + 0.65 * snap, 0, 0);
  const tuck = smooth(0, 0.3, t) * (1 - smooth(0.75, 1, t));
  const leg = fk(V(0.09, -0.95, 0.2 + 0.3 * tuck), V(0.05, -0.75 + 0.45 * tuck, -0.6 * tuck));
  s.legs = [
    leg,
    fkM(fk(V(0.09, -0.97, 0.05 + 0.15 * tuck), V(0.05, -0.85 + 0.4 * tuck, -0.5 * tuck))),
  ];
  s.feet = [null, null];
  // Arms up and out for lift, thrown down on the snap
  const wing = fk(V(0.9, 0.35 * (1 - snap) - 0.2 * snap, 0.1), V(0.6, 0.6 * (1 - snap), 0.4));
  s.arms = pair(wing);
  s.ground = 'snap';
  return s;
}

function tackle(t: number, side: 1 | -1): PoseSpec {
  const s = stand();
  const go = smooth(0, 0.28, t) * (1 - smooth(0.72, 1, t));
  const leg = fk(
    V(0.12 + 0.4 * go, -0.95 + 0.4 * go, 0.65 * go),
    V(0.12 + 0.45 * go, -0.95 + 0.3 * go, 0.5 * go),
  );
  s.legs = [leg, ik(V(-0.13, ANKLE, -0.15 * go), V(-0.2, 0.3, 1))];
  s.hips = V(0, 0.54 - 0.14 * go, -0.05 * go);
  s.feet = [V(0.9, 0, 0.4), V(-0.2, 0, 1)];
  s.spine.set(0.1 + 0.35 * go, 0.2 * go, 0.15 * go);
  s.neck.set(0.15 * go, 0, 0);
  const bal = fk(V(-0.85, -0.1, 0.2), V(-0.7, 0.15, 0.4));
  s.arms = [fk(V(0.6, -0.6, -0.3), V(0.4, -0.5, 0.2)), bal];
  s.ground = 'snap';
  return side === 1 ? s : mirror(s);
}

/** On the deck, sliding in with the left leg out (mirror for the right). */
function slideLie(t: number): PoseSpec {
  const s = stand();
  s.pelvis = qm(qz(0.35), qx(-1.15));
  s.hips = V(0, 0.3, 0);
  s.spine.set(0.45, 0, 0.1);
  s.neck.set(0.35, 0, 0);
  const p = s.pelvis;
  s.legs = [
    fk(inFrame(p, V(0.12, -0.12, 1)), inFrame(p, V(0.1, -0.1, 1))),
    fk(inFrame(p, V(-0.25, -0.2, 0.7)), inFrame(p, V(-0.15, -0.35, -0.6))),
  ];
  s.feet = [null, null];
  const wob = Math.sin(t * 20) * 0.04;
  s.arms = [
    fk(V(0.75, -0.35, -0.55), V(0.5, -0.6, -0.6)),
    fk(V(-0.8, 0.45 + wob, 0.2), V(-0.5, 0.75, 0.3)),
  ];
  s.ground = 'snap';
  return s;
}

function slide(t: number, side: 1 | -1): PoseOut {
  const lie = side === 1 ? slideLie(t) : mirror(slideLie(t));
  const up = stand();
  if (t < 0.15) return { a: up, b: lie, k: smooth(0, 0.15, t) };
  if (t > 0.78) return { a: lie, b: up, k: smooth(0.78, 1, t) };
  return lie;
}

function lying(variant: number, time: number): PoseSpec {
  const s = stand();
  const back = variant % 2 === 0;
  s.pelvis = qm(qz(0.15), qx(back ? -1.5 : 1.45));
  s.hips = V(0, 0.2, 0);
  s.spine.set(back ? -0.1 : 0.1, 0, 0.1);
  s.neck.set(back ? 0.25 + 0.08 * Math.sin(time * 2) : -0.3, 0.2, 0);
  const p = s.pelvis;
  s.legs = [
    fk(
      inFrame(p, V(0.35, -0.1, back ? 0.95 : -0.95)),
      inFrame(p, V(0.3, back ? 0.2 : -0.2, back ? 0.9 : -0.9)),
    ),
    fk(
      inFrame(p, V(-0.2, -0.05, back ? 1 : -1)),
      inFrame(p, V(-0.25, back ? -0.3 : 0.3, back ? 0.8 : -0.8)),
    ),
  ];
  s.feet = [null, null];
  s.arms = [
    fk(V(1, 0.2, back ? 0.1 : -0.1), V(0.8, 0.5, 0)),
    fk(V(-0.8, -0.2, 0.5), V(-0.4, 0.3, 0.8)),
  ];
  s.ground = 'snap';
  return s;
}

function fallen(t: number, variant: number, time: number): PoseOut {
  const lie = lying(variant, time);
  const up = stand();
  if (t < 0.22) return { a: up, b: lie, k: smooth(0, 0.22, t) };
  if (t > 0.75) return { a: lie, b: up, k: smooth(0.75, 1, t) };
  return lie;
}

function jockey(speed: number, phase: number): PoseSpec {
  const s = stand();
  const shuffle = Math.sin(phase * TAU) * Math.min(1, speed / 2.5);
  s.pelvis = qm(qy(0.65), qx(0.12));
  s.hips = V(0, 0.42, 0);
  s.spine.set(0.32, -0.45, 0);
  s.neck.set(-0.2, -0.25, 0);
  s.legs = [
    ik(V(0.2 + 0.05 * shuffle, ANKLE, 0.18), V(0.4, 0.3, 1)),
    ik(V(-0.2 + 0.05 * shuffle, ANKLE, -0.14), V(-0.3, 0.3, 1)),
  ];
  s.feet = [V(0.6, 0, 1), V(0.3, 0, 1)];
  const low = fk(V(0.75, -0.6, 0.25), V(0.55, -0.35, 0.65));
  s.arms = pair(low);
  s.ground = 'lift';
  return s;
}

function shield(speed: number, phase: number): PoseSpec {
  const s = stand();
  const sh = Math.sin(phase * TAU) * Math.min(1, speed / 2);
  s.hips = V(0.03 * sh, 0.45, -0.03);
  s.spine.set(0.12, 0, 0.06 * sh);
  s.neck.set(0.2, 0, 0);
  s.legs = [
    ik(V(0.22, ANKLE, 0.06 + 0.06 * sh), V(0.35, 0.3, 1)),
    ik(V(-0.22, ANKLE, 0.06 - 0.06 * sh), V(-0.35, 0.3, 1)),
  ];
  s.feet = [V(0.4, 0, 1), V(-0.4, 0, 1)];
  const back = fk(V(0.85, -0.25, -0.45), V(0.55, -0.1, -0.8));
  s.arms = pair(back);
  s.ground = 'lift';
  return s;
}

function skill(t: number, dir: number, side: 1 | -1, phase: number, speed: number): PoseOut {
  const which = skillOf(dir);
  const s = gait(Math.min(speed, 4), phase, { crouch: 0.4, head: 0.2 });
  const k = smooth(0, 0.15, t) * (1 - smooth(0.85, 1, t));
  const own = side === 1 ? 0 : 1;
  const x = side;
  switch (which) {
    case 'stepover': {
      // The foot circles out round the front of the ball
      const a = smooth(0.1, 0.8, t) * TAU;
      const leg = fk(
        V(x * (0.15 + 0.45 * Math.sin(a)), -0.8, 0.45 + 0.2 * Math.cos(a)),
        V(x * (0.1 + 0.5 * Math.sin(a)), -0.85, 0.3),
      );
      s.legs[own] = blendFk(s.legs[own] as FK, leg, k);
      s.pelvis = qm(qz(-x * 0.25 * Math.sin(a) * k), qx(0.1));
      s.spine.z = -x * 0.2 * k;
      break;
    }
    case 'flick': {
      // Heel flick up behind (rainbow): lean forward, heel high
      const up = smooth(0.25, 0.5, t) * (1 - smooth(0.65, 0.95, t));
      const leg = fk(
        V(x * 0.06, -0.95, -0.35 * up),
        V(x * 0.05, 0.4 * up - 0.9 * (1 - up), -0.9 * up),
      );
      s.legs[own] = blendFk(s.legs[own] as FK, leg, k);
      s.spine.x += 0.35 * up;
      s.air += 0.08 * up;
      break;
    }
    case 'roulette': {
      // A 360 spin over the ball
      const spin = smooth(0.08, 0.92, t) * TAU * -x;
      const base = idle(0, 0);
      base.hips = V(0, 0.48, 0);
      base.spine.set(0.3, 0, 0);
      base.neck.set(0.25, 0, 0);
      const out = fk(V(0.8, -0.4, 0.1), V(0.6, -0.1, 0.4));
      base.arms = pair(out);
      return turnSpec(base, spin);
    }
    case 'elastico': {
      // Push out with the outside of the foot, snap back in
      const o = smooth(0.15, 0.4, t) * (1 - smooth(0.42, 0.62, t));
      const i = smooth(0.42, 0.62, t) * (1 - smooth(0.8, 1, t));
      const leg = fk(
        V(x * (0.15 + 0.5 * o - 0.25 * i), -0.85, 0.4),
        V(x * (0.2 + 0.6 * o - 0.35 * i), -0.85, 0.35),
      );
      s.legs[own] = blendFk(s.legs[own] as FK, leg, k);
      s.spine.z = x * 0.25 * (o - i);
      break;
    }
  }
  return s;
}

function blendFk(a: FK, b: FK, k: number): FK {
  return fk(a.a.clone().lerp(b.a, k), a.b.clone().lerp(b.b, k));
}

function throwIn(t: number): PoseSpec {
  const s = stand();
  const back = smooth(0, 0.5, t);
  const thr = smooth(0.52, 0.7, t);
  const down = smooth(0.75, 1, t);
  s.legs = [
    ik(V(0.12, ANKLE, 0.08 * thr), V(0.2, 0.2, 1)),
    ik(V(-0.12, ANKLE, -0.05), V(-0.2, 0.2, 1)),
  ];
  s.spine.set(-0.32 * back * (1 - thr) + 0.35 * thr * (1 - down), 0, 0);
  s.neck.set(-0.2 * back * (1 - thr), 0, 0);
  // Hands behind the head → over and forward → down
  const behind = fk(V(0.45, 0.8, -0.3), V(0.1, 0.55, -0.85));
  const fwd = fk(V(0.35, 0.6, 0.75), V(0.12, 0.35, 0.95));
  const rest = fk(V(0.35, -0.7, 0.6), V(0.22, -0.5, 0.85));
  const l = thr < 1 ? blendFk(blendFk(ARM_HANG, behind, back), fwd, thr) : blendFk(fwd, rest, down);
  s.arms = pair(l);
  s.ground = 'lift';
  return s;
}

function celebrate(
  t: number,
  variant: number,
  phase: number,
  speed: number,
  time: number,
): PoseOut {
  switch (celebrationOf(variant)) {
    case 'kneeslide': {
      const s = stand();
      const k = smooth(0, 0.18, t);
      s.pelvis = qx(-0.35 * k);
      s.legs = [
        fk(V(0.14, -1, 0.15), V(0.06, -0.12, -1)),
        fk(V(-0.14, -1, 0.15), V(-0.06, -0.12, -1)),
      ];
      s.feet = [null, null];
      s.spine.set(-0.4 * k, 0, 0);
      s.neck.set(-0.55 * k, 0, 0);
      const roar = fk(V(0.85, 0.45, 0.15), V(0.65, 0.75, 0.15));
      s.arms = pair(blendFk(ARM_HANG, roar, k));
      s.ground = 'snap';
      if (t < 0.18) return { a: gait(speed, phase), b: s, k };
      return s;
    }
    case 'airplane': {
      const s = gait(Math.max(speed, 3), phase);
      const bank = Math.sin(time * 1.8) * 0.4;
      s.pelvis = qm(qz(bank), qx(0.1));
      s.spine.set(0.2, 0, bank * 0.3);
      const wing = fk(V(1, 0.05, -0.05), V(1, 0.08, 0));
      s.arms = pair(wing);
      return s;
    }
    case 'backflip': {
      const s = stand();
      const crouch = smooth(0, 0.22, t) * (1 - smooth(0.25, 0.32, t));
      const u = smooth(0.25, 0.75, t);
      const land = smooth(0.72, 0.85, t) * (1 - smooth(0.88, 1, t));
      s.pelvis = qx(-TAU * u);
      const tuck = Math.sin(Math.PI * u);
      s.legs = [
        fk(
          V(0.1, -1 + 0.6 * tuck, 0.8 * tuck + 0.1 * (crouch + land)),
          V(0.05, -1 + 0.2 * tuck, -0.7 * tuck - 0.6 * (crouch + land)),
        ),
        fk(
          V(-0.1, -1 + 0.6 * tuck, 0.8 * tuck + 0.1 * (crouch + land)),
          V(-0.05, -1 + 0.2 * tuck, -0.7 * tuck - 0.6 * (crouch + land)),
        ),
      ];
      s.feet = [null, null];
      s.spine.set(0.3 * (crouch + land) + 0.35 * tuck, 0, 0);
      const arm = fk(V(0.7, 0.6 * tuck - 0.5 * crouch, 0.3), V(0.5, 0.7 * tuck, 0.5));
      s.arms = pair(arm);
      s.ground = 'snap';
      s.air = 1.3 * Math.sin(Math.PI * u);
      return s;
    }
    case 'fistpump': {
      const s = idle(time, variant);
      const pump = 0.5 + 0.5 * Math.sin(time * 7);
      s.hips = V(0, 0.52 - 0.04 * pump, 0);
      s.arms = [
        fk(V(0.55, 0.55 + 0.3 * pump, 0.25), V(0.3, 0.9, 0.15)),
        fk(V(-0.6, -0.55, 0.45), V(-0.1, 0.3, 0.95)),
      ];
      s.spine.set(-0.12, 0, 0);
      s.neck.set(-0.35, 0, 0);
      return s;
    }
  }
}

function dejected(variant: number, time: number): PoseSpec {
  const s = idle(time, variant);
  switch (Math.abs(Math.floor(variant / 4)) % 3) {
    case 0:
      // Hands on head
      s.arms = [
        fk(V(0.75, 0.55, 0.15), V(-0.35, 0.85, 0.2)),
        fk(V(-0.75, 0.55, 0.15), V(0.35, 0.85, 0.2)),
      ];
      s.neck.set(0.35, 0, 0);
      break;
    case 1:
      // Hands on knees
      s.hips = V(0, 0.48, -0.08);
      s.spine.set(0.75, 0, 0);
      s.neck.set(0.1, 0, 0);
      s.arms = [
        ik(V(0.13, 0.33, 0.14), V(0.8, 0, 0), false),
        ik(V(-0.13, 0.33, 0.14), V(-0.8, 0, 0), false),
      ];
      break;
    default:
      // Head down, hands on hips
      s.arms = [
        fk(V(0.8, -0.45, -0.1), V(-0.55, -0.6, 0.2)),
        fk(V(-0.8, -0.45, -0.1), V(0.55, -0.6, 0.2)),
      ];
      s.neck.set(0.5, 0.2 * Math.sin(time * 0.6), 0);
      s.spine.set(0.15, 0, 0);
  }
  return s;
}

// ── keepers ─────────────────────────────────────────────────────────────

function gkReady(time: number, speed: number, phase: number): PoseSpec {
  const s = stand();
  const bob = Math.sin(time * 6) * 0.012;
  const sh = Math.sin(phase * TAU) * Math.min(1, speed / 2);
  s.hips = V(0, 0.43 + bob, 0);
  s.spine.set(0.38, 0, 0);
  s.neck.set(-0.3, 0, 0);
  s.legs = [
    ik(V(0.22 + 0.04 * sh, ANKLE, 0.04), V(0.4, 0.3, 1)),
    ik(V(-0.22 + 0.04 * sh, ANKLE, 0.04), V(-0.4, 0.3, 1)),
  ];
  s.feet = [V(0.3, 0, 1), V(-0.3, 0, 1)];
  const hands = fk(V(0.6, -0.42, 0.68), V(0.35, 0.05, 0.95));
  s.arms = pair(hands);
  s.ground = 'lift';
  return s;
}

/** Diving to the keeper's right (−X) for dir +1, left for −1; t through the dive. */
function gkDive(t: number, dir: number): PoseOut {
  const d = dir >= 0 ? 1 : -1;
  const load = smooth(0, 0.15, t);
  const fly = smooth(0.12, 0.55, t);
  const s = stand();
  // Roll about +Z: positive tips the head toward −X (the keeper's right)
  s.pelvis = qm(qz(d * (1.4 * fly + 0.12 * smooth(0.6, 0.85, t))), qx(0.15 * fly));
  s.spine.set(0.1, 0, d * 0.25 * fly);
  s.neck.set(-0.1, 0, d * 0.2 * fly);
  // Legs together along the body (pelvis frame), pushed apart off the far leg in the load
  s.legs = [
    fk(V(0.1 * (1 - fly), -1, 0.05), V(0.05 * (1 - fly), -1, -0.05)),
    fk(V(-0.1 * (1 - fly), -1, 0.05 + 0.12 * fly), V(-0.05 * (1 - fly), -1, -0.02)),
  ];
  s.feet = [null, null];
  // Arms reach past the head toward the ball side (wide: the head's huge)
  const reach = fk(V(0.6, 0.75, 0.3), V(0.35, 0.9, 0.3));
  const r = blendFk(ARM_HANG, reach, fly);
  s.arms = [r, fkM(r)];
  s.ground = 'snap';
  if (load < 1) {
    const r0 = gkReady(0, 0, 0);
    return { a: r0, b: s, k: Math.max(load, fly) };
  }
  return s;
}

function gkCatch(t: number): PoseSpec {
  const s = stand();
  const k = smooth(0, 0.35, t);
  s.spine.set(0.15 + 0.25 * k, 0, 0);
  s.neck.set(0.2 * k, 0, 0);
  const reach = fk(V(0.4, -0.15, 0.9), V(0.1, 0.1, 1));
  const hug = fk(V(0.45, -0.45, 0.75), V(-0.55, 0.3, 0.75));
  s.arms = pair(blendFk(reach, hug, k));
  s.legs = [ik(V(0.15, ANKLE, 0.05), V(0.3, 0.3, 1)), ik(V(-0.15, ANKLE, -0.05), V(-0.3, 0.3, 1))];
  s.hips = V(0, 0.5, 0);
  return s;
}

function gkHold(time: number, speed: number, phase: number): PoseSpec {
  const s = speed > 0.3 ? gait(speed, phase) : idle(time, 3);
  // Ball cradled at the chest in both hands
  s.arms = [
    fk(V(0.45, -0.5, 0.72), V(-0.45, 0.3, 0.85)),
    fk(V(-0.45, -0.5, 0.72), V(0.45, 0.3, 0.85)),
  ];
  return s;
}

/** An overarm throw with the right arm. */
function gkThrow(t: number): PoseSpec {
  const s = stand();
  // Arm angle from straight down, round the back, over the top, forward
  const a = -1.5 * Math.PI * smooth(0.05, 0.62, t) + 0.6 * smooth(0.62, 1, t);
  const arm = fk(
    V(-0.25, -Math.cos(a), Math.sin(a)),
    V(-0.18, -Math.cos(a + 0.2), Math.sin(a + 0.2)),
  );
  const step = smooth(0.3, 0.6, t);
  s.arms = [fk(V(0.7, -0.1 + 0.4 * (1 - step), 0.5), V(0.5, 0.2, 0.8)), arm];
  s.legs = [
    ik(V(0.13, ANKLE, 0.3 * step), V(0.2, 0.2, 1)),
    ik(V(-0.13, ANKLE, -0.15), V(-0.2, 0.2, 1)),
  ];
  s.pelvis = qy(-0.35 * (1 - step) + 0.25 * step);
  s.spine.set(-0.1 + 0.35 * step, 0.3 * step, 0);
  s.ground = 'lift';
  return s;
}

// ── the table ───────────────────────────────────────────────────────────

/** The pose for a player this frame. */
export function footballPose(p: PoseIn): PoseOut {
  const t = clamp01(p.t);
  switch (p.action) {
    case 'idle':
      return p.speed > 0.3 ? gait(p.speed, p.phase) : idle(p.time, p.variant);
    case 'jog':
    case 'run':
    case 'sprint': {
      if (p.speed <= 0.3) return idle(p.time, p.variant);
      const s = gait(p.speed, p.phase);
      if (p.action === 'sprint') s.spine.x += 0.08;
      return s;
    }
    case 'dribble':
      return dribble(p.speed, p.phase, p.side);
    case 'trap':
      return trap(t, p.side);
    case 'pass':
    case 'lob':
    case 'shoot':
    case 'volley':
    case 'gk_kick':
      return kick(p.action, t, p.side);
    case 'header':
      return header(t);
    case 'tackle':
      return tackle(t, p.side);
    case 'slide':
      return slide(t, p.side);
    case 'fallen':
      return fallen(t, p.variant, p.time);
    case 'jockey':
      return jockey(p.speed, p.phase);
    case 'shield':
      return shield(p.speed, p.phase);
    case 'skill':
      return skill(t, p.dir, p.side, p.phase, p.speed);
    case 'throw_in':
      return throwIn(t);
    case 'celebrate':
      return celebrate(t, p.variant, p.phase, p.speed, p.time);
    case 'dejected':
      return dejected(p.variant, p.time);
    case 'gk_ready':
      return p.speed > 2.5 ? gait(p.speed, p.phase) : gkReady(p.time, p.speed, p.phase);
    case 'gk_dive':
      return gkDive(t, p.dir);
    case 'gk_catch':
      return gkCatch(t);
    case 'gk_hold':
      return gkHold(p.time, p.speed, p.phase);
    case 'gk_throw':
      return gkThrow(t);
    default:
      return idle(p.time, p.variant);
  }
}

/** Every Action (the contact sheet + tests walk this). */
export const ALL_ACTIONS: Action[] = [
  'idle',
  'jog',
  'run',
  'sprint',
  'dribble',
  'trap',
  'pass',
  'lob',
  'shoot',
  'volley',
  'header',
  'tackle',
  'slide',
  'fallen',
  'jockey',
  'shield',
  'skill',
  'throw_in',
  'celebrate',
  'dejected',
  'gk_ready',
  'gk_dive',
  'gk_catch',
  'gk_hold',
  'gk_throw',
  'gk_kick',
];

/** A speed that suits an action when showing it off (contact sheet, mock). */
export function showSpeed(a: Action): number {
  switch (a) {
    case 'jog':
      return 2.6;
    case 'run':
      return 5;
    case 'sprint':
      return 8;
    case 'dribble':
      return 4;
    case 'jockey':
    case 'shield':
      return 1;
    case 'celebrate':
      return 4;
    default:
      return 0;
  }
}
