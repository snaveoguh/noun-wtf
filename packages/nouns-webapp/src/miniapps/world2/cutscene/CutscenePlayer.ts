// ── Cutscenes at runtime: the camera, the world clock, the cast, the hand-off ──
//
// Plays a script (scenes.ts) against the running game through a narrow host
// (host.ts builds it from the Game; tests pass a fake):
//
//   start   the scene opens from wherever the gameplay camera is; player input
//           is paused; the stats tracker is suspended exactly as the Upside Down
//           and the van do (no records, no ride trace: a fresh one starts after);
//   frame   the scripted camera (anchor frame → world), handheld wobble, and the
//           world's time scale (Game.stepCutscene scales the world's dt by it);
//           voices, sounds, music and game cues fire as the clock passes them;
//   end     the last step eases from the scripted camera into the live gameplay
//           camera (computed every frame, so it's exactly where play resumes),
//           then suspension and input go back to what the game says they should
//           be now (the door's scene leaves you in the Upside Down, suspended).
//
// Skipping (Esc / the SKIP button) fires the cues the scene can't do without
// (`must`: entering the Upside Down), hushes everything and blends back in
// under half a second. A replay of the ride (ReplayView) aborts a scene, and a
// scene never starts during one.

import type { NpcId } from '../missions/defs';

import * as THREE from 'three';

import { npcVoice } from '../audio/voice/cast';
import { charTimes, revealed } from '../audio/voice/voiceParams';

import { scene, SCENE_ANCHOR, type SceneId } from './scenes';
import {
  crossed,
  evalAt,
  skipCues,
  toLocal,
  toWorld,
  type Anchor,
  type CamPose,
  type Frame,
  type Instant,
  type Reveal,
  type Script,
  type Step,
} from './timeline';

/** What a scene may tell a character to do. */
export interface Directable {
  direct: { look: THREE.Vector3 | null; clip: string | null } | null;
  /** Crystal-ball glow target (the Oracle), 0..1. */
  glowTo?: (k: number) => void;
}

export interface VoiceOut {
  speak(line: { text: string; voice: ReturnType<typeof npcVoice>; lineId?: string }): {
    stop(): void;
  };
  stopAll(): void;
}

export interface SoundOut {
  play(id: string, o?: { gain?: number; rate?: number }): void;
  music(cue: string, dur: number): () => void;
}

export interface CutsceneHost {
  camera: THREE.PerspectiveCamera;
  stats: { suspended: boolean };
  /** Input on / off. */
  setInput(on: boolean): void;
  /** Run the gameplay camera for a frame (it writes `camera`). */
  liveCamera(dt: number): void;
  /** No replay, hoops, van, showroom or pause in the way. */
  canPlay(): boolean;
  /** What stats suspension should be once the scene's over (Upside Down, driving). */
  suspendedAfter(): boolean;
  /** Whether input should be on once the scene's over (no panel open, not paused). */
  inputAfter(): boolean;
  /** Where a scene's anchor is right now (null: not in the world, use the rider). */
  anchorOf(what: NpcId | 'door' | 'rider'): Anchor | null;
  rider(): THREE.Vector3;
  npc(who: string): Directable | null;
  voice: VoiceOut;
  sound: SoundOut;
  /** Game hooks named by `cue` steps. */
  cue(name: string, o: { replay: boolean; dur: number }): void;
  /** Undo anything a replay's cues previewed (the Upside Down's colour drain). */
  endCues(replay: boolean): void;
  reduceMotion(): boolean;
  markSeen(id: SceneId): void;
}

export interface PlayOpts {
  /** From the journal: nothing in the world changes, the seen-flag isn't touched. */
  replay?: boolean;
  /** Runs once the scene has handed back (open the panel, start the race...). */
  then?: () => void;
}

const _dir = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function poseOf(cam: THREE.PerspectiveCamera): {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
} {
  cam.getWorldDirection(_dir);
  const pos = cam.position.clone();
  return { pos, look: pos.clone().addScaledVector(_dir, 10), fov: cam.fov };
}

const v3 = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z];

/** Typewriter timing from the speaker's voice (the same clock the babble uses). */
const timesCache = new Map<string, number[]>();
export const voiceReveal: Reveal = (st, e) => {
  const key = `${st.voice}|${st.text}`;
  let times = timesCache.get(key);
  if (times === undefined) {
    let speed = 30;
    try {
      speed = npcVoice(st.voice as NpcId).speed;
    } catch {
      // not a cast member: plain speed
    }
    times = charTimes(st.text, speed).times;
    timesCache.set(key, times);
  }
  return revealed(times, e);
};

export class CutscenePlayer {
  /** The scene playing (null when none). */
  id: SceneId | null = null;
  script: Script | null = null;
  replay = false;
  /** Scene clock (s, real time: slow-mo only slows the world). */
  t = 0;
  frame: Frame | null = null;
  anchor: Anchor = { x: 0, y: 0, z: 0, yaw: 0 };
  /** Bumped when a scene starts or ends (the overlay subscribes). */
  version = 0;
  /** Scenes asked for while something was in the way: played when it clears. */
  queue: { id: SceneId; until: number; opts: PlayOpts }[] = [];
  private startPose: CamPose = { pos: [0, 0, 5], look: [0, 0, 0], fov: 60 };
  private then: (() => void) | undefined;
  private stopMusic: (() => void) | null = null;
  private line: { stop(): void } | null = null;
  private skipped = false;
  private listeners = new Set<() => void>();

  constructor(private host: CutsceneHost) {}

  get active() {
    return this.script !== null;
  }

  /** World time scale (1 when no scene). */
  get timeScale() {
    return this.frame?.timeScale ?? 1;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Play now if nothing's in the way; false if it couldn't. */
  play(id: SceneId, opts: PlayOpts = {}): boolean {
    if (this.active || !this.host.canPlay()) return false;
    const s = scene(id);
    return this.begin(id, s, opts);
  }

  /** Play as soon as nothing's in the way (for up to `wait` seconds). */
  request(id: SceneId, opts: PlayOpts = {}, wait = 90) {
    if (this.play(id, opts)) return;
    if (!this.queue.some(q => q.id === id))
      this.queue.push({ id, until: performance.now() + wait * 1000, opts });
  }

  /** Per gameplay frame: a queued scene starts once it can. */
  tick() {
    if (this.queue.length === 0 || this.active) return;
    const now = performance.now();
    this.queue = this.queue.filter(q => q.until > now);
    const q = this.queue[0];
    if (q !== undefined && this.host.canPlay()) {
      this.queue.shift();
      this.play(q.id, q.opts);
    }
  }

  private begin(id: SceneId, s: Script, opts: PlayOpts): boolean {
    const h = this.host;
    const rider = h.rider();
    const want = SCENE_ANCHOR[id];
    this.anchor = h.anchorOf(want) ??
      h.anchorOf('rider') ?? { x: rider.x, y: rider.y, z: rider.z, yaw: 0 };
    const p = poseOf(h.camera);
    this.startPose = {
      pos: toLocal(this.anchor, v3(p.pos)),
      look: toLocal(this.anchor, v3(p.look)),
      fov: p.fov,
    };
    this.id = id;
    this.script = s;
    this.replay = opts.replay === true;
    this.then = opts.then;
    this.t = 0;
    this.skipped = false;
    this.frame = null;
    h.voice.stopAll();
    h.setInput(false);
    // Nothing counts during a scene (exactly like the Upside Down / the van)
    h.stats.suspended = true;
    if (!this.replay) h.markSeen(id);
    this.fire(crossed(s, -1, 0));
    this.emit();
    return true;
  }

  /** Advance by real seconds and pose the camera. */
  update(dt: number) {
    const s = this.script;
    if (s === null) return;
    const h = this.host;
    // The gameplay camera keeps running underneath: it's where we hand back to
    h.liveCamera(dt);
    const live = poseOf(h.camera);
    const t0 = this.t;
    this.t += dt;
    this.fire(crossed(s, t0, this.t));
    if (this.script !== s) return; // a cue ended it
    const f = evalAt(s, this.t, this.startPose, {
      reveal: voiceReveal,
      motion: h.reduceMotion() ? 0 : 1,
    });
    this.frame = f;
    const pos = toWorld(this.anchor, f.cam.pos);
    const look = toWorld(this.anchor, f.cam.look);
    _a.set(pos[0], pos[1], pos[2]).lerp(live.pos, f.blend);
    _b.set(look[0], look[1], look[2]).lerp(live.look, f.blend);
    const cam = h.camera;
    cam.position.copy(_a);
    cam.lookAt(_b);
    const fov = f.cam.fov + (live.fov - f.cam.fov) * f.blend;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    if (f.done) this.finish();
  }

  private fire(steps: Instant[]) {
    const h = this.host;
    for (const st of steps) {
      switch (st.k) {
        case 'say':
          this.line?.stop();
          this.line = h.voice.speak({
            text: st.text,
            voice: npcVoice(st.voice as NpcId),
            lineId: st.lineId,
          });
          break;
        case 'sfx':
          h.sound.play(st.id, { gain: st.gain, rate: st.rate });
          break;
        case 'music':
          this.stopMusic?.();
          this.stopMusic = h.sound.music(st.cue, st.dur);
          break;
        case 'act': {
          const n = h.npc(st.who);
          if (n === null) break;
          if (st.do === 'release') n.direct = null;
          else
            n.direct = {
              look:
                st.do === 'look' || st.do === 'wave' ? h.rider().clone() : (n.direct?.look ?? null),
              clip: st.do === 'wave' ? 'wave' : st.do === 'clip' ? (st.clip ?? 'idle') : 'idle',
            };
          break;
        }
        case 'cue':
          h.cue(st.name, { replay: this.replay, dur: st.dur ?? 1 });
          break;
      }
    }
  }

  /** Esc / SKIP: run what must happen, hush, and blend back quickly. */
  skip() {
    const s = this.script;
    if (s === null || this.skipped) return;
    this.skipped = true;
    for (const c of skipCues(s, this.t)) this.host.cue(c.name, { replay: this.replay, dur: 0 });
    this.host.voice.stopAll();
    this.line = null;
    this.stopMusic?.();
    this.stopMusic = null;
    // Continue from exactly where the camera is now, in a tiny closing script
    const p = poseOf(this.host.camera);
    const here: CamPose = {
      pos: toLocal(this.anchor, v3(p.pos)),
      look: toLocal(this.anchor, v3(p.look)),
      fov: p.fov,
    };
    const bars = this.frame?.bars ?? 1;
    const steps: Step[] = [
      { k: 'shot', at: 0, dur: 0, from: here, to: here },
      { k: 'bars', at: 0, on: bars > 0.5, dur: 0 },
      { k: 'bars', at: 0, on: false, dur: 0.3 },
      { k: 'blendOut', at: 0, dur: 0.45 },
    ];
    for (const n of ['oracle', 'keymaker', 'twins']) {
      const npc = this.host.npc(n);
      if (npc !== null) npc.direct = null;
    }
    this.script = { id: `${s.id}:skip`, title: s.title, steps };
    this.startPose = here;
    this.t = 0;
    this.emit();
  }

  /** Stop dead (a replay started): no blend, everything restored. */
  abort() {
    if (this.script === null) return;
    this.host.voice.stopAll();
    this.finish(false);
  }

  private finish(handBack = true) {
    const h = this.host;
    this.stopMusic?.();
    this.stopMusic = null;
    this.line = null;
    for (const n of ['oracle', 'keymaker', 'twins']) {
      const npc = h.npc(n);
      if (npc !== null) npc.direct = null;
      npc?.glowTo?.(0);
    }
    h.endCues(this.replay);
    h.stats.suspended = h.suspendedAfter();
    h.setInput(h.inputAfter());
    const then = this.then;
    this.script = null;
    this.id = null;
    this.frame = null;
    this.then = undefined;
    this.emit();
    if (handBack) then?.();
  }
}
