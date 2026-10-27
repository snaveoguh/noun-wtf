// ── Freestyle: the procedural breaking on a Noun (own rider and remotes) ─
//
// The heavy half of freestyle, its own chunk (FreestyleMode imports it the
// first time anyone dances): the battle view's pose functions (view/pose.ts)
// through a PoseDriver (view/rig.ts) on a NounCharacter, after its mixer.
//
//   FreestyleDancer  a step + the beat → layers, crossfading move to move
//                    the way the battle's DancerView does, and fading the
//                    whole procedural pose in and out over the mixer's clip.
//   RemoteDancers    other riders' `fs` blobs (wire.ts) → a FreestyleDancer
//                    each, on a local beat clock re-locked to every blob.
//   LoopBeat         the quiet break loop (view/audio.ts's drum machine).

import type { MoveId } from '../contract';
import type { FsState } from './wire';
import type { AudioBus } from '../view/audio';

import * as THREE from 'three';

import { BreakAudio } from '../view/audio';
import { moveFamily } from '../view/moves';
import { movePose, type PoseOut } from '../view/pose';
import { PoseDriver, type Layer } from '../view/rig';

/** What the driver needs of a NounCharacter (tests build one from plain bones). */
export interface DancerRig {
  root: THREE.Object3D;
  body: THREE.Object3D;
  head: THREE.Object3D | null;
}

export interface DanceStep {
  move: MoveId;
  /** Beat it started on (on the clock `beat` is read from). */
  start: number;
  n: number;
  seq: number;
}

const smoothK = (x: number) => x * x * (3 - 2 * x);

export class FreestyleDancer {
  readonly driver: PoseDriver;
  /** Procedural weight over the mixer (0..1). */
  procW = 0;
  private lastSeq = -1;
  private prev: DanceStep | null = null;
  private last: DanceStep | null = null;
  private blend = 1;
  private blendDur = 0.2;

  constructor(
    readonly rig: DancerRig,
    readonly mirror = false,
  ) {
    this.driver = new PoseDriver(rig.root, rig.body, rig.body, rig.head);
  }

  get ok() {
    return this.driver.ok;
  }

  /** Faded all the way out (safe to hand the rig back). */
  get idle() {
    return this.procW <= 0.001;
  }

  /**
   * Pose the rig for this frame (call after the character's mixer update).
   * `want` 1 dances, 0 fades back to the clip over ~0.2 s.
   */
  drive(dt: number, step: DanceStep | null, beat: number, bpm: number, want: number) {
    const k = 1 - Math.exp(-12 * Math.max(0, dt));
    this.procW += (want - this.procW) * k;
    if (want === 0 && this.procW < 0.01) this.procW = 0;
    if (want === 1 && this.procW > 0.995) this.procW = 1;
    const s = step ?? this.last;
    if (s === null) return;
    const spb = 60 / Math.max(1, bpm);
    if (s.seq !== this.lastSeq) {
      if (this.last !== null && this.lastSeq >= 0) {
        this.prev = this.last;
        this.blend = 0;
        const same = moveFamily(this.prev.move) === moveFamily(s.move);
        this.blendDur = Math.min(0.3, spb * (same ? 0.3 : 0.5));
      } else this.prev = null;
      this.lastSeq = s.seq;
    }
    this.last = s;
    this.blend = Math.min(1, this.blend + dt / Math.max(0.05, this.blendDur));
    const cur: PoseOut = movePose(s.move, Math.max(0, beat - s.start), s.n, this.mirror);
    const layers: Layer[] = [];
    if (this.prev !== null && this.blend < 1) {
      const p = this.prev;
      layers.push({ out: movePose(p.move, Math.max(0, beat - p.start), p.n, this.mirror), w: 1 });
      layers.push({ out: cur, w: smoothK(this.blend) });
    } else layers.push({ out: cur, w: 1 });
    this.driver.drive(dt, layers, this.procW);
  }

  /** Hand the rig back: bind pose under the mixer, no lift. */
  rest() {
    this.driver.rest();
    this.procW = 0;
    this.prev = null;
    this.last = null;
    this.lastSeq = -1;
  }
}

interface Remote {
  dancer: FreestyleDancer;
  /** Local beat clock for this rider. */
  beat: number;
  bpm: number;
  step: DanceStep | null;
  /** Last blob state seen (identity: a fresh decode is a fresh sample). */
  seen: FsState | null;
}

/** Other riders freestyling: their blob → a dancer on their character. */
export class RemoteDancers {
  readonly map = new Map<string, Remote>();

  /**
   * Per remote, after its character's mixer update. `fs` is its decoded blob
   * (null = not dancing). Costs a map lookup for riders who aren't.
   */
  update(id: string, rig: DancerRig, fs: FsState | null, dt: number) {
    let r = this.map.get(id);
    if (r !== undefined && r.dancer.rig !== rig) {
      // their character was rebuilt (a new look)
      this.map.delete(id);
      r = undefined;
    }
    if (r === undefined) {
      if (fs === null) return;
      const dancer = new FreestyleDancer(rig, hashMirror(id));
      if (!dancer.ok) return;
      r = { dancer, beat: 0, bpm: fs.bpm, step: null, seen: null };
      this.map.set(id, r);
    }
    r.beat += (Math.max(0, dt) * r.bpm) / 60;
    if (fs !== null && fs !== r.seen) {
      r.seen = fs;
      r.bpm = fs.bpm;
      const start = r.beat - fs.b;
      if (r.step === null || r.step.seq !== fs.seq || r.step.move !== fs.move) {
        r.step = { move: fs.move, start, n: fs.n, seq: fs.seq };
      } else {
        // same move: re-lock the phase (snap on a big jump, glide otherwise)
        const err = start - r.step.start;
        r.step = {
          ...r.step,
          n: fs.n,
          start: r.step.start + (Math.abs(err) > 0.5 ? err : err * 0.3),
        };
      }
    }
    r.dancer.drive(dt, r.step, r.beat, r.bpm, fs !== null ? 1 : 0);
    if (fs === null && r.dancer.idle) {
      r.dancer.rest();
      this.map.delete(id);
    }
  }

  /** Forget riders who left. */
  prune(alive: (id: string) => boolean) {
    for (const [id, r] of this.map)
      if (!alive(id)) {
        r.dancer.rest();
        this.map.delete(id);
      }
  }
}

function hashMirror(id: string): boolean {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) & 1) === 1;
}

/** The quiet break loop under a freestyle (BreakAudio's drum machine, no song). */
export class LoopBeat {
  private audio: BreakAudio | null = null;
  private on = false;

  constructor(private bus: () => AudioBus | null) {}

  private offAt = 0;

  /** Per frame: play (or not) at the dancer's beat. */
  update(play: boolean, beat: number, bpm: number, volume: number) {
    if (play && this.audio === null) {
      if (this.bus() === null) return; // the game's audio isn't up yet
      const a = new BreakAudio(this.bus);
      a.volume = volume;
      if (!a.start()) return;
      a.setHype(0);
      this.audio = a;
    }
    const a = this.audio;
    if (a === null) return;
    if (play !== this.on) {
      a.setMusic(play ? 'full' : 'off');
      this.on = play;
      this.offAt = performance.now();
    }
    if (play) a.update(beat, bpm);
    // Faded out for a moment: let go of it (its crowd murmur too)
    else if (performance.now() - this.offAt > 600) this.dispose();
  }

  get playing() {
    return this.on;
  }

  dispose() {
    this.audio?.dispose();
    this.audio = null;
    this.on = false;
  }
}
