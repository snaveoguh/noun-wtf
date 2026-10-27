// ── Parkour poses on the Noun rig ────────────────────────────────────────
//
// Every move as a PoseSpec (breakdance/view/pose.ts: hips, pelvis, spine,
// FK or IK limbs, in rider space: +Z ahead, +X the rider's left), built
// from the anim key alone (kind, phase, side, amt). The same key goes over
// the network, so remote riders pose exactly like the local one.
//
// The rig is small under a big head: hips 0.56 m, shoulders ~1.0 m, arms
// ~0.42 m, a head ~1.15 × 1.0 × 0.85 m from the shoulders up. Hands that
// touch a wall in front put the face of the head on it, so wall distances
// in contract.ts (hangDist, wallUpDist…) are set from these numbers, and
// hands spread wide where they'd vanish behind the head.

import type { PkAnim } from '../contract';

import * as THREE from 'three';

import {
  mirrorSpec,
  stand,
  type FK,
  type IK,
  type PoseOut,
  type PoseSpec,
} from '../../breakdance/view/pose';
import { PK } from '../contract';

const TAU = Math.PI * 2;
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
const fkR = (l: FK): FK => ({ a: mx(l.a), b: mx(l.b) });
const ik = (at: THREE.Vector3, pole: THREE.Vector3, floor = false): IK => ({ at, pole, floor });
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const sm = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const fr = (x: number) => x - Math.floor(x);

const ANKLE = 0.085;
/** Hands stop a wrist short of the surface they hold. */
const WRIST = 0.04;

/** Arms swinging like a runner's (phase in cycles). */
function runArms(phase: number, amt = 1): [FK, FK] {
  const s = Math.sin(phase * TAU) * amt;
  const l = fk(V(0.3, -0.75, 0.55 * s), V(0.15, 0.1 + 0.3 * Math.max(0, s), 0.95));
  const r = fk(V(-0.3, -0.75, -0.55 * s), V(-0.15, 0.1 + 0.3 * Math.max(0, -s), 0.95));
  return [l, r];
}

/** A leg cycling like a sprinter's, in the pelvis frame (phase in cycles). */
function runLeg(phase: number, side: 1 | -1): FK {
  const a = phase * TAU;
  const knee = Math.max(0, -Math.cos(a)) * 1.1 + 0.2;
  return fk(
    V(0.08 * side, -0.75, 0.65 * Math.sin(a)),
    V(0.04 * side, -0.9, 0.3 * Math.sin(a) - knee),
  );
}

// ── Wall run ────────────────────────────────────────────────────────────

/** Running along a wall on the LEFT (+X); the right side is the mirror. */
function wallRunLeft(phase: number, amt: number): PoseSpec {
  const s = stand();
  const wallX = PK.wallRunDist - 0.05;
  // Feet go to the wall, the body tips away from it
  const tilt = 0.55;
  s.pelvis = qm(qz(tilt), qx(0.12));
  s.hips = V(0.06, 0.66, 0);
  s.spine.set(0.18, 0, -0.32);
  s.neck.set(-0.05, -0.15, -0.3);
  const leg = (off: number): IK | FK => {
    const ph = fr(phase + off);
    if (ph < 0.55) {
      // Planted: the foot pushes back along the wall
      const u = ph / 0.55;
      return ik(V(wallX, 0.32 - 0.08 * Math.sin(u * Math.PI), lerp(0.42, -0.4, u)), V(0, 0.2, 1));
    }
    // Recovering: knee drives up and through
    const u = (ph - 0.55) / 0.45;
    return ik(
      V(wallX - 0.18, 0.42 + 0.2 * Math.sin(u * Math.PI), lerp(-0.4, 0.42, u)),
      V(0, 0.4, 1),
    );
  };
  s.legs = [leg(0), leg(0.5)];
  s.feet = [V(0.6, 0.3, 1), V(0.6, 0.3, 1)];
  // Wall arm low and back, skimming the wall; the outside arm out for balance
  const sw = Math.sin(phase * TAU) * 0.4 * (0.4 + 0.6 * amt);
  s.arms = [
    fk(V(0.75, -0.5, -0.35 + sw), V(0.6, -0.3, 0.7)),
    fk(V(-0.85, 0.15, 0.3 - sw), V(-0.6, 0.45, 0.65)),
  ];
  s.ground = 'none';
  return s;
}

// ── Up the wall ─────────────────────────────────────────────────────────

/** Running up the wall ahead (+Z): feet on it, arms pumping, reaching at the top. */
function wallUp(phase: number, amt: number): PoseSpec {
  const s = stand();
  const wallZ = PK.wallUpDist - 0.06;
  s.pelvis = qx(-0.2);
  s.hips = V(0, 0.62, 0.02);
  s.spine.set(0.32, 0, 0);
  s.neck.set(-0.45, 0, 0);
  const leg = (off: number, side: 1 | -1): IK => {
    const ph = fr(phase + off);
    if (ph < 0.5) {
      const u = ph / 0.5;
      // Planted high, pushed down as the body rises
      return ik(V(0.11 * side, lerp(0.62, 0.12, u), wallZ), V(0.15 * side, 0.3, 1));
    }
    const u = (ph - 0.5) / 0.5;
    return ik(
      V(0.11 * side, lerp(0.12, 0.62, u), wallZ - 0.22 * Math.sin(u * Math.PI)),
      V(0.15 * side, 0.5, 1),
    );
  };
  s.legs = [leg(0, 1), leg(0.5, -1)];
  s.feet = [V(0.2, 1.2, 1), V(-0.2, 1.2, 1)];
  const reach = sm(0.55, 0.95, amt);
  const [l, r] = runArms(phase, 1 - reach);
  const up: FK = fk(V(0.55, 0.65, 0.5), V(0.3, 0.75, 0.6));
  s.arms = [mixFk(l, up, reach), mixFk(r, fkR(up), reach)];
  s.ground = 'none';
  return s;
}

function mixFk(a: FK, b: FK, k: number): FK {
  return { a: a.a.clone().lerp(b.a, k).normalize(), b: a.b.clone().lerp(b.b, k).normalize() };
}

// ── Climb (the Player's wall climb) ─────────────────────────────────────

/**
 * Hand over hand up the wall ahead: each hand plants high while the other
 * pulls down to the chest, the feet step up the wall under them, the body
 * bobs with every pull. `phase` in cycles (one cycle = left + right pull),
 * `amt` how fast (0 = holding still).
 */
function climb(phase: number, amt: number): PoseSpec {
  const s = stand();
  const wallZ = 0.52 - WRIST;
  const a = phase * TAU;
  const pull = Math.sin(a) * amt;
  s.pelvis = qm(qx(0.18), qz(-0.08 * pull));
  s.hips = V(0.04 * pull, 0.6 + 0.04 * Math.abs(pull), 0.1);
  s.spine.set(-0.2, 0, 0.06 * pull);
  s.neck.set(-0.3, 0, 0);
  // Hands: wide (clear of the head), one high, one low; still: both level
  const hand = (side: 1 | -1) => {
    const up = side * pull; // + = this hand is the high one
    return ik(V(0.4 * side, 1.18 + 0.16 * up, wallZ), V(0.9 * side, -0.4, -0.3));
  };
  s.arms = [hand(1), hand(-1)];
  // Feet: on the wall under the hands, the opposite foot high
  const foot = (side: 1 | -1) => {
    const up = -side * pull;
    return ik(V(0.16 * side, 0.3 + 0.2 * up, wallZ + 0.02), V(0.5 * side, 0.2, 1));
  };
  s.legs = [foot(1), foot(-1)];
  s.feet = [V(0.3, 1, 1), V(-0.3, 1, 1)];
  s.ground = 'none';
  return s;
}

/** Topping out over the lip (Player mantle and the hang's pull-up). */
function pullUp(k: number): PoseSpec {
  const s = stand();
  // 0–0.55: pull the chest up to the lip; 0.45–0.85: a knee onto it; then stand
  const pull = sm(0, 0.55, k);
  const knee = sm(0.4, 0.8, k);
  const rise = sm(0.75, 1, k);
  const lipY = lerp(PK.hangDrop, 0.05, pull);
  s.pelvis = qx(lerp(0.15, 0.75, knee) * (1 - rise));
  s.hips = V(0, lerp(0.62, 0.5, knee) + 0.06 * rise, lerp(0.14, 0.05, rise));
  s.spine.set(lerp(-0.05, 0.45, pull) * (1 - rise), 0, 0);
  s.neck.set(-0.2 * (1 - pull), 0, 0);
  const handsZ = lerp(0.48, 0.15, knee);
  const hands = (side: 1 | -1) =>
    ik(V(0.36 * side, Math.max(0.05, lipY), handsZ), V(0.9 * side, -0.3 + pull, -0.5));
  s.arms = rise > 0.6 ? s.arms : [hands(1), hands(-1)];
  // Left knee comes up onto the edge, the right leg trails, then both stand
  s.legs = [
    ik(
      V(0.12, lerp(0.15, Math.max(ANKLE, lipY + 0.05), knee), lerp(0.45, 0.25, knee)),
      V(0.2, 0.5, 1),
      rise > 0.5,
    ),
    ik(V(-0.12, lerp(0.15, ANKLE, rise), lerp(0.4, 0.02, rise)), V(-0.2, 0.3, 1), rise > 0.5),
  ];
  s.ground = rise > 0.5 ? 'lift' : 'none';
  return s;
}

// ── Ledge hang ──────────────────────────────────────────────────────────

/**
 * Hanging from a lip ahead (hands at hangDrop above the feet, the face of
 * the head on the wall). Shimmying: hand-over-hand sideways, legs swinging.
 * side = shimmy direction (+1 = rider's right).
 */
function hang(phase: number, side: 1 | -1, amt: number): PoseSpec {
  const s = stand();
  const lipZ = PK.hangDist - WRIST;
  const a = phase * TAU;
  // Shimmy: the leading hand reaches, then the trailing one closes up
  const lead = Math.max(0, Math.sin(a)) * amt;
  const trail = Math.max(0, -Math.sin(a)) * amt;
  // −X is the rider's right
  const dir = -side;
  s.pelvis = qm(qx(0.12), qz(0.08 * dir * (lead - trail)));
  s.hips = V(0.05 * dir * (lead - trail), 0.6, 0.12);
  s.spine.set(-0.1, 0, 0);
  s.neck.set(-0.3, 0, 0);
  const handX = (h: 1 | -1) => {
    const leading = h === dir;
    return 0.34 * h + dir * 0.18 * (leading ? lead : -trail);
  };
  s.arms = [
    ik(V(handX(1), PK.hangDrop - 0.02, lipZ), V(0.9, -0.2, -0.3)),
    ik(V(handX(-1), PK.hangDrop - 0.02, lipZ), V(-0.9, -0.2, -0.3)),
  ];
  // Feet against the wall, a little swing while moving
  const sw = Math.sin(a) * 0.1 * amt;
  s.legs = [
    ik(V(0.13 + sw, 0.12, lipZ - 0.04), V(0.3, 0.2, 1)),
    ik(V(-0.13 + sw, 0.2, lipZ - 0.06), V(-0.3, 0.2, 1)),
  ];
  s.feet = [V(0.2, 1.2, 1), V(-0.2, 1.2, 1)];
  s.ground = 'none';
  return s;
}

/** Between ledges: arms thrown at the next lip (dx right, up), legs trailing. */
function leap(k: number, side: 1 | -1, up: number): PoseSpec {
  const s = stand();
  const dir = -side;
  const reach = sm(0.1, 0.7, k);
  s.pelvis = qm(qz(0.25 * dir * (1 - k)), qx(0.1));
  s.hips = V(0, 0.62, 0.12);
  s.neck.set(-0.35, 0, 0.15 * dir);
  const hand = (h: 1 | -1) =>
    fk(
      V(0.3 * h + 0.6 * dir, 0.7 + 0.3 * up, 0.5).lerp(V(0.5 * h, -0.6, 0.3), 1 - reach),
      V(0.2 * h + 0.5 * dir, 0.8, 0.4),
    );
  s.arms = [hand(1), hand(-1)];
  s.legs = [
    fk(V(0.15, -0.9, 0.3), V(0.1, -0.7, -0.6)),
    fk(V(-0.1, -0.95, -0.2), V(-0.05, -0.8, -0.5)),
  ];
  s.feet = [null, null];
  s.ground = 'none';
  return s;
}

/** Long jump through the air (gap jumps): running in the air, arms windmilling. */
function airRun(phase: number): PoseSpec {
  const s = stand();
  s.pelvis = qx(0.15);
  s.hips = V(0, 0.6, 0);
  s.spine.set(0.2, 0, 0);
  s.neck.set(-0.2, 0, 0);
  s.legs = [runLeg(phase, 1), runLeg(phase + 0.5, -1)];
  const a = phase * TAU;
  s.arms = [
    fk(V(0.55, 0.3 * Math.sin(a), 0.6 * Math.cos(a)), V(0.4, 0.5 * Math.sin(a + 0.6), 0.7)),
    fk(V(-0.55, -0.3 * Math.sin(a), -0.6 * Math.cos(a)), V(-0.4, -0.5 * Math.sin(a + 0.6), 0.7)),
  ];
  s.feet = [null, null];
  s.ground = 'none';
  return s;
}

// ── Pole ────────────────────────────────────────────────────────────────

/**
 * On a pole ahead (+Z): hands one above the other, knees gripping it,
 * leaning out with the swing. `amt` = how fast it's sliding (legs grip
 * looser, arms higher), side = swing direction.
 */
function pole(phase: number, side: 1 | -1, amt: number): PoseSpec {
  const s = stand();
  const pz = 0.08 + PK.poleGap - WRIST - 0.04;
  const swing = 0.3 * side;
  // −X is the rider's right: the body swings out to the outside of the turn
  s.pelvis = qm(qz(-swing * 0.6), qx(-0.08 - 0.12 * amt));
  s.hips = V(-swing * 0.12, 0.66, 0.16);
  s.spine.set(-0.12, 0, swing * 0.3);
  s.neck.set(-0.2, 0, 0);
  const wob = Math.sin(phase * TAU * 3) * 0.02 * amt;
  s.arms = [
    ik(V(0.05, 1.32 + 0.06 * amt + wob, pz), V(0.9, -0.3, -0.2)),
    ik(V(-0.05, 1.08 + 0.06 * amt, pz), V(-0.9, -0.4, -0.2)),
  ];
  const grip = 1 - 0.5 * amt;
  s.legs = [
    ik(V(0.1 * grip, 0.3, pz - 0.02), V(0.9, 0.2, 0.5)),
    ik(V(-0.06 * grip, 0.18 + 0.12 * (1 - grip), pz - 0.06), V(-0.9, 0.2, 0.5)),
  ];
  s.feet = [V(-0.4, 0.4, 1), V(0.4, 0.4, 1)];
  s.ground = 'none';
  return s;
}

// ── Vaults ──────────────────────────────────────────────────────────────

/**
 * Over a low wall: k = progress. side +1 'over' (amt 0: speed vault, one
 * hand, legs swung sideways; amt 1: kong, both hands, legs tucked through),
 * side −1 a step-up onto a thick top.
 */
function vault(k: number, side: 1 | -1, amt: number): PoseSpec {
  const s = stand();
  const mid = Math.sin(Math.PI * Math.min(1, k * 1.15));
  if (side < 0) {
    // Step-up: hands push off the top, left knee up onto it
    s.pelvis = qx(0.35 * mid);
    s.hips = V(0, 0.56 - 0.06 * mid, 0.05);
    s.spine.set(0.35 * mid, 0, 0);
    s.arms = [fk(V(0.3, -0.8, 0.5), V(0.1, -0.8, 0.6)), fk(V(-0.3, -0.8, 0.5), V(-0.1, -0.8, 0.6))];
    s.legs = [
      fk(V(0.1, -0.5 + 0.6 * mid, 0.6 * mid), V(0.05, -0.9, -0.2 * mid)),
      fk(V(-0.08, -1, -0.2 * mid), V(-0.05, -0.9, -0.4 * mid)),
    ];
    s.feet = [null, null];
    s.ground = 'none';
    return s;
  }
  if (amt > 0.5) {
    // Kong: dive forward onto both hands, knees through to the chest
    s.pelvis = qx(0.95 * mid);
    s.hips = V(0, 0.6, 0.05);
    s.spine.set(0.25 * mid, 0, 0);
    s.neck.set(-0.5 * mid, 0, 0);
    s.arms = [
      fk(V(0.25, -0.5, 0.85), V(0.15, -0.95, 0.2)),
      fk(V(-0.25, -0.5, 0.85), V(-0.15, -0.95, 0.2)),
    ];
    s.legs = [
      fk(V(0.12, -0.3, 0.95 * mid + 0.1), V(0.08, -0.95, 0.1)),
      fk(V(-0.12, -0.3, 0.95 * mid + 0.1), V(-0.08, -0.95, 0.1)),
    ];
    s.feet = [null, null];
    s.ground = 'none';
    return s;
  }
  // Speed vault: body turns side-on, left hand on the top, legs swing over to the right
  s.pelvis = qm(qy(0.8 * mid), qz(-0.7 * mid));
  s.hips = V(0, 0.6, 0);
  s.spine.set(0.2 * mid, 0, 0.35 * mid);
  s.neck.set(-0.1, -0.5 * mid, 0);
  s.arms = [
    fk(V(0.2, -0.95, 0.25), V(0.1, -0.95, 0.15)),
    fk(V(-0.85, 0.35, 0.4), V(-0.5, 0.7, 0.5)),
  ];
  s.legs = [
    fk(V(-0.1, -0.35, 0.9), V(-0.15, -0.65, 0.7)),
    fk(V(-0.25, -0.45, 0.85), V(-0.2, -0.75, 0.6)),
  ];
  s.feet = [null, null];
  s.ground = 'none';
  return s;
}

// ── Ground ──────────────────────────────────────────────────────────────

/** Baseball slide: leaning back, lead leg straight, trailing leg tucked, a hand skimming the floor. */
function slide(k: number, amt: number): PoseSpec {
  const s = stand();
  const inK = sm(0, 0.15, k);
  const outK = sm(0.85, 1, k) * (1 - amt * 0.5);
  const low = inK * (1 - outK);
  s.pelvis = qx(-0.7 * low);
  s.hips = V(0, lerp(0.54, 0.26, low), 0);
  s.spine.set(0.45 * low, 0, 0);
  s.neck.set(0.3 * low, 0, 0);
  s.legs = [
    fk(V(0.08, -0.15, 1), V(0.08, -0.1, 1)),
    fk(V(-0.12, -0.6, 0.75), V(-0.1, -0.5, -0.85)),
  ];
  s.arms = [fk(V(0.6, -0.65, -0.45), V(0.4, -0.8, -0.4)), fk(V(-0.5, 0.2, 0.8), V(-0.3, 0.5, 0.8))];
  s.feet = [null, null];
  s.ground = low > 0.3 ? 'snap' : 'lift';
  return s;
}

/** Forward roll: tucked ball turning one full turn about the shoulders. */
function roll(k: number): PoseSpec {
  const s = stand();
  const turn = TAU * sm(0.08, 0.9, k);
  const tuck = Math.sin(Math.PI * Math.min(1, k * 1.1));
  s.pelvis = qx(turn);
  s.hips = V(0, 0.55, 0);
  s.spine.set(0.6 * tuck, 0, 0);
  s.neck.set(0.4 * tuck, 0, 0);
  s.legs = [
    fk(V(0.12, -0.6 + 0.6 * tuck, 0.8 * tuck), V(0.08, -0.95, -0.3 * tuck)),
    fk(V(-0.12, -0.6 + 0.6 * tuck, 0.8 * tuck), V(-0.08, -0.95, -0.3 * tuck)),
  ];
  s.arms = [fk(V(0.4, -0.5, 0.75), V(0.1, -0.6, 0.8)), fk(V(-0.4, -0.5, 0.75), V(-0.1, -0.6, 0.8))];
  s.feet = [null, null];
  s.ground = 'snap';
  return s;
}

/** A bad landing: buckled knees, arms flailing, then straightening up. */
function stumble(k: number): PoseSpec {
  const s = stand();
  const hit = Math.exp(-k * 5) * 1.0 + sm(0, 0.15, k) * 0.0;
  const wob = Math.sin(k * 22) * Math.exp(-k * 3);
  const down = sm(0, 0.12, k) * (1 - sm(0.55, 1, k));
  s.pelvis = qm(qx(0.6 * down), qz(0.2 * wob));
  s.hips = V(0.04 * wob, lerp(0.54, 0.3, down), -0.05 * down);
  s.spine.set(0.4 * down, 0, 0.2 * wob);
  s.neck.set(0.3 * down + 0.2 * hit, 0, -0.2 * wob);
  s.legs = [
    ik(V(0.16, ANKLE, 0.12), V(0.4, 0.2, 1), true),
    ik(V(-0.14, ANKLE, -0.08), V(-0.4, 0.2, 1), true),
  ];
  s.arms = [
    fk(V(0.85, 0.2 + 0.4 * wob, 0.35), V(0.7, 0.5, 0.4)),
    fk(V(-0.85, 0.2 - 0.4 * wob, 0.35), V(-0.7, 0.5, 0.4)),
  ];
  s.ground = 'lift';
  return s;
}

/** Stuck a landing: a deep crouch, arms forward, rising. */
function stick(k: number): PoseSpec {
  const s = stand();
  const d = 1 - sm(0.25, 1, k);
  s.pelvis = qx(0.45 * d);
  s.hips = V(0, lerp(0.54, 0.3, d), -0.04 * d);
  s.spine.set(0.3 * d, 0, 0);
  s.neck.set(-0.3 * d, 0, 0);
  s.legs = [
    ik(V(0.13, ANKLE, 0.06), V(0.3, 0.2, 1), true),
    ik(V(-0.13, ANKLE, 0.06), V(-0.3, 0.2, 1), true),
  ];
  s.arms = [fk(V(0.3, -0.3, 0.9), V(0.2, -0.2, 0.95)), fk(V(-0.3, -0.3, 0.9), V(-0.2, -0.2, 0.95))];
  s.ground = 'lift';
  return s;
}

/** On a rail / post / wall top: arms out wide, swaying. */
function balance(phase: number, amt: number): PoseSpec {
  const s = stand();
  const sway = Math.sin(phase * TAU);
  s.pelvis = qz(0.08 * sway);
  s.hips = V(0.03 * sway, 0.5, 0);
  s.spine.set(0.1, 0, -0.14 * sway);
  s.neck.set(0, 0, 0.1 * sway);
  s.legs = [
    ik(V(0.04, ANKLE, 0.08 + 0.1 * amt), V(0.3, 0.2, 1), true),
    ik(V(-0.04, ANKLE, -0.08), V(-0.3, 0.2, 1), true),
  ];
  s.feet = [V(0.05, 0, 1), V(-0.05, 0, 1)];
  s.arms = [
    fk(V(1, 0.05 + 0.25 * sway, 0.05), V(1, 0.15 + 0.2 * sway, 0.2)),
    fk(V(-1, 0.05 - 0.25 * sway, 0.05), V(-1, 0.15 - 0.2 * sway, 0.2)),
  ];
  s.ground = 'lift';
  return s;
}

/**
 * The air flourish after a wall jump / tic-tac / pole launch (k = progress):
 * amt 0 a full twist (side picks the way), 1 a backflip, 0.5 a front flip.
 */
function flip(k: number, side: 1 | -1, amt: number): PoseSpec {
  const s = stand();
  const e = sm(0.05, 0.9, k);
  const tuck = Math.sin(Math.PI * Math.min(1, k));
  s.hips = V(0, 0.6, 0);
  if (amt > 0.75) s.pelvis = qx(-TAU * e);
  else if (amt > 0.25) s.pelvis = qx(TAU * e);
  else s.pelvis = qm(qy(TAU * e * side), qx(0.2 * tuck));
  s.spine.set(0.4 * tuck, 0, 0);
  s.neck.set(0.2 * tuck, 0, 0);
  s.legs = [
    fk(V(0.12, -0.7 + 0.6 * tuck, 0.6 * tuck), V(0.08, -0.95, -0.2 * tuck)),
    fk(V(-0.12, -0.7 + 0.6 * tuck, 0.6 * tuck), V(-0.08, -0.95, -0.2 * tuck)),
  ];
  s.arms = [
    fk(V(0.6, 0.3 - 0.6 * tuck, 0.5), V(0.3, 0.2 - 0.5 * tuck, 0.8)),
    fk(V(-0.6, 0.3 - 0.6 * tuck, 0.5), V(-0.3, 0.2 - 0.5 * tuck, 0.8)),
  ];
  s.feet = [null, null];
  s.ground = 'none';
  return s;
}

/** The pose for an anim key (null: no parkour pose, the clip shows). */
export function pkPose(a: PkAnim): PoseOut | null {
  const p = a.phase;
  switch (a.kind) {
    case 'none':
      return null;
    case 'wallrun': {
      const s = wallRunLeft(p, a.amt);
      return a.side > 0 ? s : mirrorSpec(s);
    }
    case 'wallup':
      return wallUp(p, a.amt);
    case 'climb':
      return climb(p, a.amt);
    case 'mantle':
    case 'pullup':
      return pullUp(p);
    case 'hang':
      return hang(p, a.side, a.amt);
    case 'leap':
      return a.amt > 0.25 && a.amt < 0.75 ? airRun(p) : leap(p, a.side, a.amt);
    case 'pole':
      return pole(p, a.side, a.amt);
    case 'vault':
      return vault(p, a.side, a.amt);
    case 'slide':
      return slide(p, a.amt);
    case 'roll':
      return roll(p);
    case 'stumble':
      return stumble(p);
    case 'stick':
      return stick(p);
    case 'balance':
      return balance(p, a.amt);
    case 'flip':
      return flip(p, a.side, a.amt);
  }
}

/** Moves that blend in fast (the body's already committed). */
export function snapIn(kind: PkAnim['kind']): boolean {
  return kind === 'roll' || kind === 'flip' || kind === 'vault' || kind === 'stumble';
}
