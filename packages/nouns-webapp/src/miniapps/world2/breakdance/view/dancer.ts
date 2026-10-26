// ── A breaker: NounCharacter + procedural breaking (pose.ts → rig.ts) ───
//
// Follows a DancerPose: walks into the middle for its turn and back to its
// crew's edge after, vibes on the side (the rig's dance clip, on the
// beat), and in the middle plays the sim's move on the view's beat clock.
// A new move crossfades in over a fraction of a beat; a crash slumps the
// dancer onto the floor over whatever it was doing.

import type { DancerPose, MoveId } from '../contract';

import * as THREE from 'three';

import { parseSeedKey, type NounSeed } from '../../character/NounAppearance';
import { NounCharacter, type CharacterAssets } from '../../character/NounCharacter';

import { MoveTracker } from './clock';
import { moveFamily } from './moves';
import { crashPose, movePose, vibePose, type PoseOut } from './pose';
import { PoseDriver, type Layer } from './rig';

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A Noun look from Dancer.seed (a NounSeed object, its JSON, or a seed key), else from the id. */
export function seedOf(seed: unknown, id: string): NounSeed {
  const ok = (o: unknown): o is NounSeed =>
    typeof o === 'object' &&
    o !== null &&
    ['background', 'body', 'accessory', 'head', 'glasses'].every(
      k => typeof (o as Record<string, unknown>)[k] === 'number',
    );
  if (ok(seed)) return seed;
  if (typeof seed === 'string') {
    try {
      const j = JSON.parse(seed) as unknown;
      if (ok(j)) return j;
    } catch {
      /* not JSON */
    }
    const k = parseSeedKey(seed);
    if (k !== null) return k;
  }
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

interface Prev {
  move: MoveId;
  start: number;
  n: number;
}

export interface DancerFrame {
  dt: number;
  /** View beat clock. */
  beat: number;
  bpm: number;
  /** Where this dancer stands when it's not up (cypher space), and its facing there. */
  edge: THREE.Vector3;
  edgeYaw: number;
  /** Facing in the middle (toward the other crew). */
  centreYaw: number;
}

const UP = new THREE.Vector3(0, 1, 0);

export class DancerView {
  readonly ch: NounCharacter;
  readonly root: THREE.Group;
  readonly driver: PoseDriver;
  readonly track = new MoveTracker();
  /** Current pose (last DancerPose). */
  pose: DancerPose | null = null;
  /** Mirror this dancer's moves (style). */
  readonly mirror: boolean;
  private prev: Prev | null = null;
  private lastKey = -1;
  private blend = 1;
  private blendDur = 0.2;
  private crashW = 0;
  private crashT = 0;
  private procW = 0;
  private yaw = 0;
  private placed = false;
  private celebrateT = 0;
  private walking = false;

  constructor(
    readonly id: string,
    seed: unknown,
    assets: CharacterAssets,
  ) {
    this.ch = new NounCharacter(seedOf(seed, id), assets);
    this.root = this.ch.root;
    this.ch.board.visible = false;
    this.mirror = (hashStr(id) & 1) === 1;
    this.driver = new PoseDriver(this.ch.root, this.ch.body, this.ch.body, this.ch.head);
  }

  /** Feed the latest sim pose (sim beat it was taken at). */
  observe(p: DancerPose, simBeat: number) {
    this.pose = p;
    this.track.observe(p.move, p.moveT, p.moveBeats, simBeat);
  }

  /** The other crew bailed / lost: a little celebration on the side. */
  cheer(secs = 1.6) {
    this.celebrateT = secs;
  }

  get isDown() {
    return this.procW > 0.5 && this.crashW < 0.5 && moveFamily(this.track.move) !== 'toprock';
  }

  update(f: DancerFrame) {
    const p = this.pose;
    const dt = f.dt;
    const centre = p?.centre === true;
    // ── where to stand ──
    const target = centre ? new THREE.Vector3(0, 0, 0) : f.edge;
    if (!this.placed) {
      this.root.position.copy(target);
      this.yaw = centre ? f.centreYaw : f.edgeYaw;
      this.placed = true;
    }
    const to = target.clone().sub(this.root.position).setY(0);
    const dist = to.length();
    const dancing = centre && p?.move !== null && p?.move !== undefined;
    // Walk in / out at a stroll; a move already underway slides in faster
    this.walking = dist > 0.25 && !dancing;
    const speed = dancing ? 3.5 : 2.4;
    if (dist > 1e-3) this.root.position.addScaledVector(to, Math.min(1, (speed * dt) / dist));
    const faceTo = this.walking ? Math.atan2(to.x, to.z) : centre ? f.centreYaw : f.edgeYaw;
    let dy = faceTo - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * (1 - Math.exp(-8 * dt));
    this.root.quaternion.setFromAxisAngle(UP, this.yaw);

    // ── procedural weight: on whenever we're in the middle and not walking ──
    const wantProc = centre && !this.walking ? 1 : 0;
    this.procW += (wantProc - this.procW) * (1 - Math.exp(-10 * dt));
    if (wantProc === 0 && this.procW < 0.01) this.procW = 0;

    // ── crash ──
    const crashed = p?.crashed === true && centre;
    if (crashed) this.crashT += dt;
    else this.crashT = 0;
    this.crashW += ((crashed ? 1 : 0) - this.crashW) * (1 - Math.exp(-(crashed ? 9 : 4) * dt));

    // ── clip under it all ──
    this.celebrateT = Math.max(0, this.celebrateT - dt);
    const spb = 60 / f.bpm;
    if (this.walking) {
      this.ch.play({
        clip: 'walk',
        fade: 0.2,
        timeScale: Math.min(2, Math.max(0.8, dist > 1 ? 1.6 : 1)),
      });
    } else if (this.celebrateT > 0) {
      this.ch.play({ clip: 'celebrate', fade: 0.2, once: true });
    } else {
      // The dance clip is two seconds of four bounces: drive it off the beat clock
      const ph = ((((f.beat + (hashStr(this.id) % 4)) / 4) % 1) + 1) % 1;
      this.ch.play({ clip: 'dance', fade: 0.3, time: ph * 2, timeScale: 0 });
    }
    void spb;
    this.ch.update(dt, { lean: 0, travelled: 0, riding: false });

    // ── the move ──
    const s = this.track.sample(f.beat);
    if (s.key !== this.lastKey) {
      if (this.lastKey >= 0 && this.track.move !== null && this.prevMove !== null) {
        this.prev = { move: this.prevMove, start: this.prevStart, n: this.prevN };
        this.blend = 0;
        // Big shape changes take longer than steps within a family
        const same = moveFamily(this.prevMove) === moveFamily(this.track.move);
        this.blendDur = Math.min(0.3, spb * (same ? 0.3 : 0.5));
      } else this.prev = null;
      this.lastKey = s.key;
    }
    this.prevMove = s.move;
    this.prevStart = s.startBeat;
    this.prevN = s.n;
    this.blend = Math.min(1, this.blend + dt / Math.max(0.05, this.blendDur));

    const layers: Layer[] = [];
    const cur: PoseOut =
      s.move !== null ? movePose(s.move, s.b, s.n, this.mirror) : vibePose(f.beat);
    if (this.prev !== null && this.blend < 1) {
      const pb = f.beat - this.prev.start;
      layers.push({ out: movePose(this.prev.move, pb, this.prev.n, this.mirror), w: 1 });
      layers.push({ out: cur, w: smoothK(this.blend) });
    } else layers.push({ out: cur, w: 1 });
    if (this.crashW > 0.01) layers.push({ out: crashPose(f.beat, this.crashT), w: this.crashW });
    this.driver.drive(dt, layers, this.procW);
  }

  private prevMove: MoveId | null = null;
  private prevStart = 0;
  private prevN = 4;

  dispose() {
    this.ch.dispose();
  }
}

const smoothK = (x: number) => x * x * (3 - 2 * x);
