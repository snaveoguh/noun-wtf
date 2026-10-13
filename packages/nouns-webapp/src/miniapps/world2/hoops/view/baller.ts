// ── A baller: NounCharacter on foot + procedural basketball poses ───────
//
// The rig's clips (idle / run / sprint / jump_air / celebrate / dance …)
// drive the body; on top, every frame, the arms, spine and hips are posed
// procedurally from the BallerState's action + actionT (two-bone IK on the
// arms and legs, like NounCharacter's climbing arms and scooter hands).
// The ball, when held, is placed from where the hands actually ended up.
//
// Character frame: +Z forward, +X = the character's LEFT, so the right
// hand is on −X. The rig is small (shoulders ~1.0 m, arms ~0.42 m) under a
// metre-tall Noun head, so overhead poses go out to the side of the head.

import type { BallSimState, BallerState } from '../contract';

import * as THREE from 'three';

import { parseSeedKey, type NounSeed } from '../../character/NounAppearance';
import {
  NounCharacter,
  solveTwoBone,
  turnBone,
  type CharacterAssets,
} from '../../character/NounCharacter';

export type DunkStyle = 'tomahawk' | 'windmill' | 'reverse' | 'oneHand' | 'threeSixty';
const DUNKS: DunkStyle[] = ['tomahawk', 'windmill', 'oneHand', 'threeSixty'];

interface Arm {
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
  /** +1 left (+X), −1 right (−X). */
  sx: number;
  len: number;
}

interface Leg {
  thigh: THREE.Object3D;
  shin: THREE.Object3D;
  foot: THREE.Object3D;
}

/** Arm targets for one frame (character-local), null = leave the clip's arm. */
interface Pose {
  L: THREE.Vector3 | null;
  R: THREE.Vector3 | null;
  wL: number;
  wR: number;
  /** Elbow pole (local): defaults out + down + back. */
  poleL?: THREE.Vector3;
  poleR?: THREE.Vector3;
  /** Forward bend of the spine (rad) and hips drop (m, legs IK'd to keep the feet). */
  lean: number;
  crouch: number;
  /** Ball (local) when held; 'R' / 'L' / 'both' = from the hands. */
  ball: THREE.Vector3 | 'R' | 'L' | 'both' | null;
  /** Wrist flick (follow-through), rad. */
  flick?: number;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seedFor(seedKey: string, id: string): NounSeed {
  const s = parseSeedKey(seedKey);
  if (s !== null) return s;
  // Deterministic stand-in from the id (bots without a key)
  const h = hashStr(id);
  const h2 = hashStr(`${id}#`);
  return {
    background: h % 2,
    body: (h >>> 3) % 30,
    accessory: (h >>> 9) % 140,
    head: h2 % 240,
    glasses: (h2 >>> 11) % 20,
  };
}

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

export interface BallerFrame {
  dt: number;
  time: number;
  /** Both rims (court space): index 0 = −z, 1 = +z. */
  rims: [THREE.Vector3, THREE.Vector3];
  ball: BallSimState;
  ballR: number;
}

export class BallerView {
  readonly ch: NounCharacter;
  readonly root: THREE.Group;
  /** Ball position (court space) from this baller's hands, valid while `holding`. */
  readonly ballAt = new THREE.Vector3();
  holding = false;
  /** Last state drawn. */
  s: BallerState | null = null;
  dunk: DunkStyle = 'tomahawk';
  /** Hand that dribbles: −1 right, +1 left. */
  dribbleSide = -1;
  /** Floor contact this frame (dribble bounce, for audio). */
  bounced = false;
  /** Squeak trigger (hard cut / stop), for audio. */
  squeaked = false;
  private arms: Arm[] = [];
  private legs: Leg[] = [];
  private hips: THREE.Object3D | null = null;
  private spine: THREE.Object3D | null = null;
  private chest: THREE.Object3D | null = null;
  private rest: { o: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion }[] = [];
  private headBox = new THREE.Box3();
  private phase = Math.random();
  private lastAction = '';
  private airborne = false;
  private landT = 1;
  private yawExtra = 0;
  /** 0..1 hanging on the rim (dunk finish), for the hoop's rim pull. */
  hang = 0;
  private tilt = 0;
  private lastVel = new THREE.Vector2();
  private dunks = 0;
  private seedHash: number;
  private celebrateClip: 'celebrate' | 'dance' | 'wave';

  constructor(
    readonly id: string,
    seedKey: string,
    assets: CharacterAssets,
  ) {
    this.ch = new NounCharacter(seedFor(seedKey, id), assets);
    this.root = this.ch.root;
    this.ch.board.visible = false;
    this.seedHash = hashStr(id);
    this.celebrateClip = (['celebrate', 'dance', 'wave'] as const)[this.seedHash % 3];
    this.findBones();
  }

  private findBones() {
    const find = (name: string) => {
      let hit: THREE.Object3D | null = null;
      this.ch.body.traverse(o => {
        if (hit === null && o.name.replace(/[.:_]/g, '').toLowerCase() === name) hit = o;
      });
      return hit as THREE.Object3D | null;
    };
    this.hips = find('hips');
    this.spine = find('spine');
    this.chest = find('chest');
    this.root.updateMatrixWorld(true);
    for (const [s, sx] of [
      ['l', 1],
      ['r', -1],
    ] as const) {
      const upper = find(`upperarm${s}`);
      const fore = find(`forearm${s}`);
      const hand = find(`hand${s}`);
      if (upper !== null && fore !== null && hand !== null) {
        const len =
          upper.getWorldPosition(_a).distanceTo(fore.getWorldPosition(_b)) +
          fore.getWorldPosition(_a).distanceTo(hand.getWorldPosition(_b));
        this.arms.push({ upper, fore, hand, sx, len });
      }
      const thigh = find(`thigh${s}`);
      const shin = find(`shin${s}`);
      const foot = find(`foot${s}`);
      if (thigh !== null && shin !== null && foot !== null) this.legs.push({ thigh, shin, foot });
    }
    const bones = [
      this.hips,
      this.spine,
      this.chest,
      ...this.arms.flatMap(a => [a.upper, a.fore, a.hand]),
      ...this.legs.flatMap(l => [l.thigh, l.shin, l.foot]),
    ];
    for (const o of bones)
      if (o !== null) this.rest.push({ o, p: o.position.clone(), q: o.quaternion.clone() });
    if (this.ch.head !== null) {
      this.headBox.setFromObject(this.ch.head);
      // into root-local (root is at the origin, unrotated, at construction)
    }
    if (this.headBox.isEmpty()) this.headBox.set(v(-0.57, 1.0, -0.45), v(0.57, 2.05, 0.45));
  }

  /** Pick a dunk style for the next dunk (varies per baller + per dunk). */
  private pickDunk(facingRim: boolean) {
    if (!facingRim) return 'reverse' as const;
    return DUNKS[(this.seedHash + this.dunks++ * 7) % DUNKS.length];
  }

  /** Character-local → court space. */
  toCourt(p: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(p).applyMatrix4(this.root.matrix);
  }

  /** Court → character-local. */
  toLocal(p: THREE.Vector3, out: THREE.Vector3) {
    _m.copy(this.root.matrix).invert();
    return out.copy(p).applyMatrix4(_m);
  }

  /** Hand (palm centre) in court space. */
  handCourt(side: 'L' | 'R', out: THREE.Vector3) {
    const arm = this.arms[side === 'L' ? 0 : 1];
    if (arm === undefined) return this.toCourt(v(0, 0.9, 0.3), out);
    arm.hand.getWorldPosition(out);
    arm.fore.getWorldPosition(_c);
    out.addScaledVector(_c.subVectors(out, _c).normalize(), 0.05);
    // world → court: the root's parent is the court group
    const parent = this.root.parent;
    if (parent !== null) out.applyMatrix4(_m.copy(parent.matrixWorld).invert());
    return out;
  }

  update(s: BallerState, f: BallerFrame) {
    const dt = f.dt;
    const ch = this.ch;
    this.s = s;
    this.bounced = false;
    this.squeaked = false;
    // ── undo last frame's procedural pose (bones a clip doesn't key) ──
    for (const r of this.rest) {
      r.o.position.copy(r.p);
      r.o.quaternion.copy(r.q);
    }
    const speed = Math.hypot(s.vx, s.vz);
    const fwd = speed > 0.05 ? (s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw)) / speed : 1;
    const air = s.y > 0.06;
    const action = s.action;
    const t = s.actionT;
    // Squeaks: hard cuts at speed
    const accel = Math.hypot(s.vx - this.lastVel.x, s.vz - this.lastVel.y) / Math.max(dt, 1e-3);
    if (!air && speed > 2 && accel > 28) this.squeaked = true;
    this.lastVel.set(s.vx, s.vz);
    // Landing
    if (this.airborne && !air) this.landT = 0;
    this.airborne = air;
    this.landT += dt;
    // Action edges
    if (action !== this.lastAction) {
      if (this.lastAction === 'crossover') this.dribbleSide = -this.dribbleSide;
      if (action === 'dunk' || action === 'alleyoop') {
        const rim = this.nearRim(f, s);
        const toRim = Math.atan2(rim.x - s.x, rim.z - s.z);
        const d = Math.cos(toRim - s.yaw);
        this.dunk = this.pickDunk(d > -0.2);
      }
      if (action === 'jumpshot' || action === 'dunk' || action === 'stumble' || action === 'steal')
        this.squeaked = true;
      this.lastAction = action;
    }

    // ── clip ──
    let clip = 'idle';
    let ts = 1;
    let once = false;
    let fade = 0.18;
    if (action === 'celebrate') {
      clip = t < 0.5 || this.celebrateClip === 'dance' ? this.celebrateClip : 'dance';
      once = clip !== 'dance';
    } else if (action === 'stumble') {
      clip = 'fall';
    } else if (air) {
      clip = 'jump_air';
      fade = 0.1;
    } else if (this.landT < 0.22 && action !== 'dunk') {
      clip = 'land';
      once = true;
      fade = 0.06;
    } else if (action === 'gather') {
      clip = 'idle';
    } else if (speed > 0.35) {
      const sideways = Math.abs(fwd) < 0.55 || action === 'defend';
      if (sideways) {
        clip = 'walk';
        ts = THREE.MathUtils.clamp(speed / 1.4, 0.6, 2.2);
      } else if (speed > 5.2) {
        clip = 'sprint';
        ts = THREE.MathUtils.clamp(speed / 6, 0.8, 1.8);
      } else if (speed > 1.8) {
        clip = 'run';
        ts = THREE.MathUtils.clamp(speed / 3.6, 0.7, 2);
      } else {
        clip = 'walk';
        ts = THREE.MathUtils.clamp(speed / 1.3, 0.6, 1.8);
      }
    }
    ch.play({ clip, fade, once, timeScale: ts });
    ch.update(dt, { lean: 0, travelled: 0, riding: false });

    // ── place the root (court space; the court group carries the world map) ──
    this.yawExtra = 0;
    if ((action === 'dunk' || action === 'alleyoop') && this.dunk === 'threeSixty')
      this.yawExtra = Math.PI * 2 * smooth(0.04, 0.42, t);
    if (action === 'spin') this.yawExtra = 0; // the sim spins the yaw itself
    const tiltTo =
      action === 'stumble'
        ? Math.sin(Math.min(1, t * 2.2) * Math.PI * 0.5) * 1.15 * (t < 0.8 ? 1 : 1 - (t - 0.8) * 5)
        : 0;
    this.tilt += (tiltTo - this.tilt) * (1 - Math.exp(-14 * dt));
    // Rim magnet: dunkers finish at the rim and hang off it, swung back
    // under it (the sim's numbers never quite line the hands up with it)
    const dunking = action === 'dunk' || action === 'alleyoop';
    let hangTo = 0;
    const rim = this.nearRim(f, s);
    if (dunking && s.y > 0.3 && Math.hypot(rim.x - s.x, rim.z - s.z) < 1.6)
      hangTo = s.hasBall ? smooth(0.26, 0.42, t) * 0.85 : 1;
    this.hang += (hangTo - this.hang) * (1 - Math.exp(-(hangTo > this.hang ? 14 : 6) * dt));
    let yaw = s.yaw + this.yawExtra;
    this.root.position.set(s.x, s.y, s.z);
    if (this.hang > 0.01) {
      let face = Math.atan2(rim.x - s.x, rim.z - s.z);
      if (this.dunk === 'reverse') face += Math.PI;
      let dy = face - yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      yaw += dy * this.hang;
    }
    this.root.quaternion.setFromAxisAngle(UP, yaw);
    if (this.hang > 0.01) {
      _q.setFromAxisAngle(_a.set(1, 0, 0), -0.4 * this.hang);
      this.root.quaternion.multiply(_q);
      // Hands (local, arms up and forward) onto the rim's near edge
      _b.set(rim.x - s.x, 0, rim.z - s.z);
      const d = _b.length();
      if (d > 1e-3) _b.divideScalar(d);
      _c.copy(rim).addScaledVector(_b, -0.14);
      _w.set(0, 1.34, 0.24).applyQuaternion(this.root.quaternion);
      _c.sub(_w);
      this.root.position.lerp(_c, this.hang);
    }
    if (Math.abs(this.tilt) > 1e-3) {
      // Fall back on the seat (ankles broken)
      _q.setFromAxisAngle(_a.set(1, 0, 0), -this.tilt);
      this.root.quaternion.multiply(_q);
    }
    this.root.updateMatrix();
    this.root.updateMatrixWorld(true);

    // ── procedural pose ──
    const pose = this.pose(s, f, speed);
    this.applyPose(pose, s);

    // ── ball ──
    this.holding = pose.ball !== null && s.hasBall;
    if (this.holding) {
      const b = pose.ball!;
      if (b instanceof THREE.Vector3) this.toCourt(b, this.ballAt);
      else if (b === 'both') {
        this.handCourt('L', _a);
        this.handCourt('R', _b);
        this.ballAt.addVectors(_a, _b).multiplyScalar(0.5);
        // a touch forward of the palms
        _c.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
        this.ballAt.addScaledVector(_c, 0.03);
      } else {
        this.handCourt(b, this.ballAt);
        // sits on the palm: above it for set shots / dunks
        this.ballAt.y += f.ballR * 0.85;
        _c.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
        this.ballAt.addScaledVector(_c, 0.04);
      }
    }
  }

  private nearRim(f: BallerFrame, s: BallerState) {
    const a = f.rims[0];
    const b = f.rims[1];
    return (s.x - a.x) ** 2 + (s.z - a.z) ** 2 < (s.x - b.x) ** 2 + (s.z - b.z) ** 2 ? a : b;
  }

  /** Shoulder of an arm (character-local). */
  private shoulder(i: number, out: THREE.Vector3) {
    const arm = this.arms[i];
    if (arm === undefined) return out.set(i === 0 ? 0.27 : -0.27, 1, 0);
    arm.upper.getWorldPosition(out);
    return this.root.worldToLocal(out);
  }

  /** Point from the shoulder along dir (local), at `reach` × arm length. */
  private reachTo(i: number, dx: number, dy: number, dz: number, reach = 0.95) {
    const arm = this.arms[i];
    const len = arm?.len ?? 0.42;
    const sh = this.shoulder(i, v());
    return sh.add(
      _w
        .set(dx, dy, dz)
        .normalize()
        .multiplyScalar(len * reach),
    );
  }

  private pose(s: BallerState, f: BallerFrame, speed: number): Pose {
    const t = s.actionT;
    const R = f.ballR;
    const p: Pose = { L: null, R: null, wL: 0, wR: 0, lean: 0, crouch: 0, ball: null };
    const hb = s.hasBall;
    const side = this.dribbleSide; // −1 right / +1 left
    const iD = side > 0 ? 0 : 1; // dribble arm index
    const iO = 1 - iD;
    const set = (i: number, target: THREE.Vector3, w = 1) => {
      if (i === 0) {
        p.L = target;
        p.wL = w;
      } else {
        p.R = target;
        p.wR = w;
      }
    };
    const handKey = (i: number) => (i === 0 ? 'L' : 'R') as 'L' | 'R';
    const rim = this.toLocal(this.nearRim(f, s), v());
    const dribble = (rate: number, lowness: number) => {
      // Bounce: hand up top, ball to the floor and back (|cos| V at contact)
      const prev = this.phase;
      this.phase = (this.phase + f.dt * rate) % 1;
      if (prev < 0.5 && this.phase >= 0.5) this.bounced = true;
      const top = 0.5 - lowness * 0.12;
      const y = R + (top - R) * Math.abs(Math.cos(Math.PI * this.phase));
      const ball = v(side * 0.36, y, 0.24 + Math.min(speed, 7) * 0.025);
      // Hand rides the ball's top down to waist height
      const hand = v(side * 0.34, Math.max(top + R + 0.02, y + R + 0.03) - 0.02, ball.z - 0.03);
      set(iD, hand, 1);
      p.ball = ball;
      // Off hand: out front, guarding the dribble
      set(iO, v(-side * 0.48, 0.82, 0.22), 0.55);
    };

    switch (s.action) {
      case 'idle':
      case 'run': {
        if (hb) {
          // Triple threat: ball on the hip, both hands
          set(0, v(0.1, 0.8, 0.3));
          set(1, v(-0.18, 0.8, 0.3));
          p.ball = 'both';
          p.crouch = 0.04;
        }
        p.lean = s.action === 'run' ? 0.08 : 0;
        break;
      }
      case 'dribble': {
        dribble(speed > 3 ? 3.0 : 2.3, speed > 3 ? 1 : 0);
        p.lean = 0.12 + Math.min(speed, 7) * 0.02;
        p.crouch = 0.06;
        break;
      }
      case 'crossover': {
        // Ball whips across low in front, hand to hand
        const k = t;
        const x = side * 0.36 * Math.cos(Math.PI * k);
        const y = R + (0.42 - R) * Math.abs(Math.cos(Math.PI * k));
        if (this.phase < 0.5 && k >= 0.5) this.bounced = true;
        this.phase = k;
        const ball = v(x, y, 0.3);
        p.ball = ball;
        set(iD, v(side * 0.34, Math.max(0.5, y + R), 0.26), 1 - smooth(0.4, 0.6, k));
        set(iO, v(-side * 0.34, Math.max(0.5, y + R), 0.26), smooth(0.35, 0.55, k));
        p.crouch = 0.16;
        p.lean = 0.3;
        break;
      }
      case 'spin': {
        set(iD, v(side * 0.3, 0.72, 0.18));
        set(iO, v(-side * 0.46, 0.92, 0.1), 0.5);
        p.ball = handKey(iD);
        p.crouch = 0.1;
        p.lean = 0.15;
        break;
      }
      case 'catch': {
        set(0, v(0.12, 0.88, 0.34));
        set(1, v(-0.12, 0.88, 0.34));
        p.ball = hb ? 'both' : null;
        p.lean = 0.05;
        break;
      }
      case 'pass': {
        // Chest pass: snap both hands forward, then relax
        const push = smooth(0.0, 0.35, t) * (1 - smooth(0.6, 1, t));
        set(0, v(0.12, 0.86, 0.26 + push * 0.14));
        set(1, v(-0.12, 0.86, 0.26 + push * 0.14));
        p.ball = hb ? 'both' : null;
        p.lean = 0.1 + push * 0.12;
        break;
      }
      case 'gather': {
        // Dip with the ball at the chest, rising to the set point beside the head
        const k = smooth(0, 1, t);
        p.crouch = 0.2 * Math.sin(Math.min(1, t * 1.1) * Math.PI * 0.85);
        const set0 = v(-0.1, 0.8, 0.32);
        const set1 = v(-0.62, 1.08, 0.14);
        const ball = set0.clone().lerp(set1, k * 0.6);
        set(1, ball.clone().add(v(0, -0.02, -0.02)));
        set(0, v(0.14, 0.82 + k * 0.08, 0.3), 1 - k * 0.5);
        p.ball = 'R';
        p.lean = 0.05;
        break;
      }
      case 'jumpshot': {
        // Set point beside the head → release up at the rim → follow-through
        const rel = smooth(0.12, 0.42, t);
        const dirR = _a.copy(rim).sub(this.shoulder(1, _b));
        dirR.y = Math.max(dirR.y, 1.5);
        dirR.normalize();
        const setPt = v(-0.64, 1.1, 0.14);
        const outPt = this.reachTo(1, dirR.x - 0.9, dirR.y + 0.6, dirR.z + 0.4, 0.98);
        set(1, setPt.lerp(outPt, rel));
        set(0, v(0.52, 1.0, 0.18), 0.6);
        p.ball = 'R';
        p.flick = smooth(0.35, 0.6, t) * 1.0;
        p.lean = -0.06;
        break;
      }
      case 'layup': {
        // Finger roll: shooting hand reaching for the rim, off knee up
        const k = smooth(0, 0.45, t);
        const toRim = _a.copy(rim).sub(this.shoulder(1, _b)).normalize();
        set(1, this.reachTo(1, toRim.x - 0.6 * k, toRim.y + 0.4, toRim.z, 0.97));
        set(0, v(0.5, 0.95, 0.2), 0.5);
        p.ball = 'R';
        break;
      }
      case 'dunk':
      case 'alleyoop':
        this.dunkPose(p, s, t, rim, set);
        break;
      case 'rebound': {
        // Both arms up and out for the board, then chin it
        if (!hb) {
          set(0, this.reachTo(0, 0.9, 0.6, 0.25));
          set(1, this.reachTo(1, -0.9, 0.6, 0.25));
        } else {
          set(0, v(0.13, 0.88, 0.32));
          set(1, v(-0.13, 0.88, 0.32));
          p.ball = 'both';
        }
        break;
      }
      case 'block': {
        // Swat: the arm on the ball's side goes up at it
        const ball = this.toLocal(_c.set(f.ball.x, f.ball.y, f.ball.z), v());
        const i = ball.x >= 0 ? 0 : 1;
        const sh = this.shoulder(i, v());
        const d = ball.clone().sub(sh);
        const near = d.length() < 2.2 && ball.y > 0.6;
        const dir = near ? d.normalize() : v(i === 0 ? 0.8 : -0.8, 0.7, 0.3).normalize();
        const swat = smooth(0.15, 0.4, t);
        set(i, this.reachTo(i, dir.x, dir.y, dir.z + swat * 0.3, 0.98));
        set(1 - i, this.reachTo(1 - i, i === 0 ? -0.9 : 0.9, 0.5, 0.2, 0.9), 0.7);
        p.lean = -0.1;
        break;
      }
      case 'steal': {
        // Lunge and poke at the ball
        const k = Math.sin(Math.min(1, t * 1.6) * Math.PI);
        const ball = this.toLocal(_c.set(f.ball.x, f.ball.y, f.ball.z), v());
        const tgt = ball.z > 0.1 && ball.length() < 1.6 ? ball : v(-0.25, 0.6, 0.6);
        set(1, v(-0.2, 0.7, 0.35).lerp(tgt, k));
        set(0, v(0.5, 0.95, -0.1), 0.6);
        p.lean = 0.25 + 0.35 * k;
        p.crouch = 0.1 + 0.1 * k;
        p.ball = hb ? 'R' : null;
        break;
      }
      case 'defend': {
        // Low stance, arms wide, hands active
        const flick = Math.sin(f.time * 7 + this.seedHash) * 0.05;
        set(0, v(0.6, 0.98 + flick, 0.2));
        set(1, v(-0.6, 0.98 - flick, 0.2));
        p.crouch = 0.16;
        p.lean = 0.2;
        break;
      }
      case 'stumble': {
        set(0, this.reachTo(0, 0.7, 0.7, 0.2), 0.9);
        set(1, this.reachTo(1, -0.7, 0.7, 0.2), 0.9);
        p.ball = hb ? 'both' : null;
        break;
      }
      case 'celebrate': {
        if (this.celebrateClip === 'celebrate' && t > 0.5) {
          // Fist pumps beside the head
          const pump = Math.abs(Math.sin(f.time * 6));
          set(0, this.reachTo(0, 0.85, 0.35 + pump * 0.4, 0.1), 0.9);
          set(1, this.reachTo(1, -0.85, 0.35 + pump * 0.4, 0.1), 0.9);
        }
        p.ball = hb ? 'both' : null;
        break;
      }
      case 'dejected': {
        // Hands on knees, head down
        set(0, v(0.14, 0.5, 0.2));
        set(1, v(-0.14, 0.5, 0.2));
        p.crouch = 0.1;
        p.lean = 0.55;
        p.ball = hb ? 'both' : null;
        break;
      }
    }
    // Holding without a pose for it (mid-transition): carry it at the chest
    if (hb && p.ball === null) {
      set(0, v(0.13, 0.86, 0.32));
      set(1, v(-0.13, 0.86, 0.32));
      p.ball = 'both';
    }
    return p;
  }

  private dunkPose(
    p: Pose,
    s: BallerState,
    t: number,
    rim: THREE.Vector3,
    set: (i: number, v: THREE.Vector3, w?: number) => void,
  ) {
    const hb = s.hasBall;
    // Rim grips (local): its near edge, either side
    const toMe = v(-rim.x, 0, -rim.z).normalize();
    const side = v(toMe.z, 0, -toMe.x);
    const grip = (sg: number) =>
      rim
        .clone()
        .addScaledVector(toMe, 0.18)
        .addScaledVector(side, sg * 0.16)
        .add(v(0, 0.02, 0));
    if (!hb) {
      // After the slam: hang on the rim (if it's in reach), legs swinging
      const g0 = grip(1);
      const g1 = grip(-1);
      const reach = (i: number, g: THREE.Vector3) =>
        g.distanceTo(this.shoulder(i, _a)) < 1.2 ? 1 : 0.0;
      set(0, g0, reach(0, g0));
      set(1, g1, reach(1, g1));
      if (p.wL === 0) set(0, this.reachTo(0, 0.8, 0.6, 0.2), 0.8);
      if (p.wR === 0) set(1, this.reachTo(1, -0.8, 0.6, 0.2), 0.8);
      p.lean = 0;
      return;
    }
    const k = smooth(0, 0.42, t);
    switch (this.dunk) {
      case 'tomahawk': {
        // Cocked back behind the head on the right, then hammered down
        const cock = this.reachTo(1, -0.85, 0.45, -0.45, 0.97);
        const slam = rim.clone().add(v(0, 0.1, 0));
        set(1, cock.lerp(slam, smooth(0.32, 0.48, t)));
        set(0, this.reachTo(0, 0.9, 0.3, 0.2), 0.7);
        p.ball = 'R';
        p.lean = -0.25 + smooth(0.32, 0.5, t) * 0.5;
        break;
      }
      case 'windmill': {
        // Right arm circles down, back, up and over into the rim
        const ph = smooth(0, 0.45, t) * Math.PI * 1.35;
        const dir = v(-0.55, -Math.cos(ph), -Math.sin(ph) * 0.9 + 0.15);
        const tgt = this.reachTo(1, dir.x, dir.y, dir.z, 0.97);
        if (t > 0.38) tgt.lerp(rim, smooth(0.38, 0.5, t));
        set(1, tgt);
        set(0, this.reachTo(0, 0.9, 0.2, 0.3), 0.6);
        p.ball = 'R';
        p.lean = -0.1 + smooth(0.35, 0.5, t) * 0.4;
        break;
      }
      case 'reverse': {
        // Back to the rim: both hands up and back over the head side
        const up = this.reachTo(1, -0.8, 0.6, -0.3, 0.97);
        set(1, up.lerp(rim, smooth(0.35, 0.5, t)));
        set(0, this.reachTo(0, 0.8, 0.6, -0.3, 0.97), 0.8);
        p.ball = 'R';
        p.lean = -0.35;
        break;
      }
      case 'threeSixty':
      case 'oneHand':
      default: {
        // Ball up beside the head, then thrown down through the rim
        const up = this.reachTo(1, -0.9, 0.55, 0.15, 0.97);
        set(1, up.lerp(rim, smooth(0.34, 0.5, t)));
        set(0, this.reachTo(0, 0.85, 0.4, 0.3), 0.7);
        p.ball = 'R';
        p.lean = -0.1 + smooth(0.34, 0.5, t) * 0.35;
        break;
      }
    }
    void k;
  }

  private applyPose(p: Pose, s: BallerState) {
    const root = this.root;
    const rq = root.getWorldQuaternion(_q);
    // Crouch: drop the hips, IK the legs to keep the feet where the clip put them
    if (p.crouch > 0.005 && this.hips !== null && this.legs.length === 2 && s.y < 0.06) {
      const feet = this.legs.map(l => l.foot.getWorldPosition(v()));
      const hp = this.hips.getWorldPosition(v());
      hp.y -= p.crouch;
      const parent = this.hips.parent!;
      this.hips.position.copy(parent.worldToLocal(hp));
      this.hips.updateMatrixWorld(true);
      const knee = v(0, 0.2, 1).applyQuaternion(rq);
      this.legs.forEach((l, i) => solveTwoBone(l.thigh, l.shin, l.foot, feet[i], knee, 1));
    }
    // Spine lean (forward = about the character's +X)
    if (Math.abs(p.lean) > 0.003) {
      const axis = v(1, 0, 0).applyQuaternion(rq);
      if (this.spine !== null) turnBone(this.spine, axis, p.lean * 0.55);
      if (this.chest !== null) turnBone(this.chest, axis, p.lean * 0.45);
    }
    // Arms
    const targets: [THREE.Vector3 | null, number, THREE.Vector3 | undefined][] = [
      [p.L, p.wL, p.poleL],
      [p.R, p.wR, p.poleR],
    ];
    targets.forEach(([tgt, w, pole], i) => {
      const arm = this.arms[i];
      if (arm === undefined || tgt === null || w < 0.01) return;
      const local = this.avoidHead(tgt.clone(), arm.sx);
      // Aim the wrist a palm's length short of the point
      const sh = this.shoulder(i, v());
      const dir = local.clone().sub(sh);
      const dl = dir.length();
      if (dl > 0.06) local.addScaledVector(dir, -0.05 / dl);
      const wpt = root.localToWorld(local);
      const wpole = (pole ?? v(arm.sx * 0.9, -0.5, -0.5))
        .clone()
        .applyQuaternion(_q.copy(root.getWorldQuaternion(new THREE.Quaternion())));
      solveTwoBone(arm.upper, arm.fore, arm.hand, wpt, wpole, w);
    });
    if (p.flick !== undefined && p.flick > 0.01 && this.arms[1] !== undefined) {
      const axis = v(1, 0, 0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
      turnBone(this.arms[1].hand, axis, p.flick);
    }
  }

  /** Push a hand target out of the Noun head (sideways or forward). */
  private avoidHead(p: THREE.Vector3, sx: number) {
    const b = this.headBox;
    const m = 0.07;
    if (p.y < b.min.y - 0.02) return p;
    if (p.x > b.min.x - m && p.x < b.max.x + m && p.z > b.min.z - m && p.z < b.max.z + m) {
      const outX = sx > 0 ? b.max.x + m - p.x : p.x - (b.min.x - m);
      const outZ = b.max.z + m - p.z;
      if (outX < outZ) p.x = sx > 0 ? b.max.x + m : b.min.x - m;
      else p.z = b.max.z + m;
    }
    return p;
  }

  private lit: THREE.Material[] = [];

  /**
   * Court floodlights: own copies of the body / head materials with a
   * little emissive lift, so ballers read from the broadcast camera even
   * in the late-afternoon shade (call after toonify).
   */
  floodlight(k: number) {
    this.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const lift = (src: THREE.Material) => {
        const mat = src as THREE.MeshToonMaterial;
        if (mat.emissive === undefined) return src;
        const c = mat.clone();
        c.emissive.copy(mat.color).multiplyScalar(k);
        if (mat.map !== null) c.emissiveMap = mat.map;
        this.lit.push(c);
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(lift) : lift(m.material);
    });
  }

  /** Top of the Noun head (character-local y). */
  get headTop() {
    return this.headBox.max.y;
  }

  dispose() {
    this.ch.dispose();
    for (const m of this.lit) m.dispose();
  }
}
