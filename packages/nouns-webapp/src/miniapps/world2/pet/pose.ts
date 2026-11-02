// ── MOCHI's procedural poses (pure) ───────────────────────────────────────
//
// No clips: every gait is a handful of joint angles from the gait, its
// cycle phase (0..1, advanced by distance) and the clock. The system eases
// between poses (`blendPose`), so a gait change never snaps.
//
// Axes (the model faces +z): rotation.x > 0 tips a part's top forward
// (a head nods down, a leg swings back), z > 0 rolls it to the pet's right.

import type { Gait } from './contract';

export type V3 = [number, number, number];

export interface PetPose {
  /** Root lift (m) and extra spin (rad), for hops and the happy spin. */
  lift: number;
  spin: number;
  /** Body lowered (m): sitting, sleeping. */
  drop: number;
  body: V3;
  head: V3;
  /** Noggles hinge (rad): 0 on the eyes, ~ −0.95 pushed up to sleep. */
  noggles: number;
  earL: V3;
  earR: V3;
  wingL: V3;
  wingR: V3;
  /** 0 = open, 1 = folded away (the membrane folds up, by bone scale). */
  fold: number;
  tailUp: number;
  tailCurl: number;
  tailSide: number;
  /** Legs, swing about x: front left, front right, back left, back right. */
  legs: [number, number, number, number];
  mouthOpen: number;
  eyesShut: number;
}

export function restPose(): PetPose {
  return {
    lift: 0,
    spin: 0,
    drop: 0,
    body: [0, 0, 0],
    head: [0, 0, 0],
    noggles: 0,
    earL: [0, -0.35, -0.21],
    earR: [0, 0.35, 0.21],
    wingL: [0, 1.35, -0.35],
    wingR: [0, -1.35, 0.35],
    fold: 1,
    tailUp: 0.55,
    tailCurl: 0.42,
    tailSide: 0,
    legs: [0, 0, 0, 0],
    mouthOpen: 0,
    eyesShut: 0,
  };
}

const TAU = Math.PI * 2;

/** The pose for a gait at cycle `phase` and time `t` (s). `drop` scales with the pet's hip height. */
export function poseFor(gait: Gait, phase: number, t: number, hip = 0.06): PetPose {
  const p = restPose();
  const w = phase * TAU;
  const breathe = Math.sin(t * 2.4) * 0.03;
  switch (gait) {
    case 'stand':
      break;
    case 'idle':
      p.head = [breathe, Math.sin(t * 0.7) * 0.25, 0.1];
      p.earL = [0, -0.35, -0.3 + Math.max(0, Math.sin(t * 3.1)) * 0.12];
      p.tailSide = Math.sin(t * 1.6) * 0.4;
      p.tailUp = 0.7;
      p.tailCurl = 0.45;
      p.fold = 0.92;
      break;
    case 'walk':
    case 'trot':
    case 'run': {
      const run = gait === 'run';
      const amp = run ? 1.0 : gait === 'trot' ? 0.75 : 0.45;
      const bob = Math.abs(Math.sin(w)) * (run ? 0.05 : 0.025);
      p.lift = bob;
      p.body = [run ? 0.22 : 0.1, 0, Math.sin(w) * 0.05];
      p.head = [-0.15 + Math.sin(w * 2) * 0.04, 0, 0];
      p.legs = run
        ? // a bounding run: fronts together, backs together
          [
            Math.sin(w) * amp,
            Math.sin(w + 0.5) * amp,
            Math.sin(w + Math.PI) * amp,
            Math.sin(w + Math.PI + 0.5) * amp,
          ]
        : // a diagonal trot
          [
            Math.sin(w) * amp,
            Math.sin(w + Math.PI) * amp,
            Math.sin(w + Math.PI) * amp,
            Math.sin(w) * amp,
          ];
      p.earL = [-0.25 - amp * 0.3, -0.35, -0.21];
      p.earR = [-0.25 - amp * 0.3, 0.35, 0.21];
      p.tailUp = run ? -0.1 : 0.2;
      p.tailCurl = run ? -0.05 : 0.15;
      p.tailSide = Math.sin(w) * 0.3;
      p.fold = 0.85;
      p.mouthOpen = run ? 1 : 0;
      break;
    }
    case 'hop':
      p.body = [-0.15, 0, 0];
      p.head = [-0.2, 0, 0];
      p.legs = [-0.7, -0.7, 0.6, 0.6];
      p.fold = 0.5;
      p.wingL = [0, 0.6, 0.3];
      p.wingR = [0, -0.6, -0.3];
      p.tailUp = 0.9;
      p.earL = [-0.5, -0.35, -0.3];
      p.earR = [-0.5, 0.35, 0.3];
      break;
    case 'sit':
    case 'perch':
    case 'ride':
      p.drop = hip * 0.9;
      p.body = [-0.32, 0, 0];
      p.head = [0.26 + breathe, Math.sin(t * 0.5) * 0.3, -0.08];
      p.legs = [-0.35, -0.2, -1.3, -1.3];
      p.tailUp = -0.6;
      p.tailCurl = -0.15;
      p.tailSide = 0.6 + Math.sin(t * 1.3) * 0.25;
      p.fold = 0.95;
      if (gait === 'perch') p.earL = [0, -0.35, -0.35 + Math.max(0, Math.sin(t * 2.3)) * 0.2];
      break;
    case 'sleep': {
      const snore = Math.sin(t * 1.4) * 0.025;
      p.drop = hip * 1.0;
      p.body = [snore, 0, 0];
      p.head = [0.22, 0, 0.12];
      p.noggles = -0.95;
      p.earL = [-0.3, -0.35, -0.8];
      p.earR = [-0.3, 0.35, 0.8];
      p.legs = [-1.45, -1.45, 1.45, 1.45];
      p.tailUp = -0.35;
      p.tailCurl = 0;
      p.tailSide = 1.0;
      p.fold = 1.05;
      p.eyesShut = 1;
      break;
    }
    case 'happy': {
      // a hop and a full spin over the happy time; phase = 0..1 through it
      const k = Math.min(1, Math.max(0, phase));
      p.lift = Math.sin(Math.min(1, k * 1.6) * Math.PI) * 0.16;
      p.spin = easeInOut(k) * TAU;
      p.body = [-0.12, 0, 0];
      p.head = [-0.25, 0, 0];
      p.wingL = [0, 0.1, 0.55 + Math.sin(t * 22) * 0.35];
      p.wingR = [0, -0.1, -0.55 - Math.sin(t * 22) * 0.35];
      p.fold = 0;
      p.legs = [-1.6, -1.3, 0.5, 0.3];
      p.tailUp = 1.0;
      p.tailCurl = 0.45;
      p.earL = [0, -0.35, -0.6];
      p.earR = [0, 0.35, 0.6];
      p.mouthOpen = 1;
      break;
    }
    case 'fly': {
      const flap = Math.sin(w) * 0.75 + 0.15;
      p.lift = Math.sin(w) * 0.03;
      p.body = [0.4, 0, 0];
      p.head = [-0.38, 0, 0];
      p.wingL = [0, 0.15, flap];
      p.wingR = [0, -0.15, -flap];
      p.fold = 0;
      p.legs = [0.9, 0.9, 0.9, 0.9];
      p.earL = [-0.45, -0.35, -0.21];
      p.earR = [-0.45, 0.35, 0.21];
      p.tailUp = -0.3;
      p.tailCurl = -0.12;
      p.tailSide = Math.sin(t * 2) * 0.2;
      break;
    }
  }
  return p;
}

function easeInOut(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerp3 = (out: V3, b: V3, k: number) => {
  out[0] = lerp(out[0], b[0], k);
  out[1] = lerp(out[1], b[1], k);
  out[2] = lerp(out[2], b[2], k);
};

/** Ease `cur` toward `to` by k (0..1), in place. Spin is taken as is (it's a one-off). */
export function blendPose(cur: PetPose, to: PetPose, k: number): PetPose {
  cur.lift = lerp(cur.lift, to.lift, k);
  cur.spin = to.spin;
  cur.drop = lerp(cur.drop, to.drop, k);
  lerp3(cur.body, to.body, k);
  lerp3(cur.head, to.head, k);
  cur.noggles = lerp(cur.noggles, to.noggles, k);
  lerp3(cur.earL, to.earL, k);
  lerp3(cur.earR, to.earR, k);
  lerp3(cur.wingL, to.wingL, k);
  lerp3(cur.wingR, to.wingR, k);
  cur.fold = lerp(cur.fold, to.fold, k);
  cur.tailUp = lerp(cur.tailUp, to.tailUp, k);
  cur.tailCurl = lerp(cur.tailCurl, to.tailCurl, k);
  cur.tailSide = lerp(cur.tailSide, to.tailSide, k);
  for (let i = 0; i < 4; i++) cur.legs[i] = lerp(cur.legs[i]!, to.legs[i]!, k);
  cur.mouthOpen = to.mouthOpen;
  cur.eyesShut = to.eyesShut;
  return cur;
}
