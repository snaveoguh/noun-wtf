// ── Freestyle anywhere: breakdance on the spot, wherever you are ─────────
//
// The Game hook (on `game.freestyle`). Comma (or the 🕺 button) starts it on
// foot, or steps off a slow board first; Comma again, Esc, holding a
// direction or pushing the stick walks off. Never inside, on the Big Drop,
// in hoops / a break battle, a cutscene, a replay, the van or on the dragon.
//
// While it's on, Game.step hands it the frame (`frame`): the skater is
// parked (not stepped), the skate camera keeps running with a slow orbit fed
// into its look input (so entering and leaving never cut), and the rider's
// Noun dances on a beat (beat.ts: the radio's when its tempo is knowable,
// else 95 bpm, plus an optional quiet break loop when nothing else plays).
//
//   planner.ts  the set: auto-dances toprock → drop → footwork → power →
//               freeze …, and keyed moves cut in on the next beat
//   keys.ts     the battle's key patterns (sim/moves.ts) → moves
//   wire.ts     the pose blob's `fs` key, so other riders see the dance
//   dance.ts    pose.ts + rig.ts on a NounCharacter (own chunk, lazy)
//   rules.ts    where it's allowed; the tiny crowd respect bump
//
// Game.updateNetwork calls `remote()` per remote rider: a map lookup for
// riders who aren't dancing, a PoseDriver for those who are.

import type { InputFrame } from '../../core/Input';
import type { Game } from '../../Game';
import type { RespectApi } from '../../interiors/contract';
import type { BreakKey, MoveId } from '../contract';
import type { DancerRig, FreestyleDancer, LoopBeat, RemoteDancers } from './dance';

import * as THREE from 'three';

import { moveFamily, moveName } from '../view/moves';

import { FreeClock, pickBeat, type BeatChoice } from './beat';
import { FreestyleKeys, heldLong } from './input';
import { MoveKeys } from './keys';
import { FreestyleSet, type FreeStep } from './planner';
import { AUDIENCE_R, BLOCKED_TEXT, blockedBy, CrowdRespect, type Blocked } from './rules';
import { encodeFs, type FsState, type FsWire } from './wire';

type DanceModule = typeof import('./dance');

/** The toggle key (every letter is taken; see the report / controls help). */
export const FREESTYLE_CODE = 'Comma';
export const FREESTYLE_LABEL = ',';

const BEAT_PREF = 'noun-world-freestyle-beat';
/** The break loop's level (out of BreakAudio's 0.85 in a battle). */
const LOOP_VOLUME = 0.28;
/** Camera orbit while dancing (rad/s) and the pitch it settles to. */
const ORBIT_RATE = 0.16;
const ORBIT_PITCH = 0.3;
/** Stick past this for this long (s) on touch / gamepad = walk off. */
const STICK_AWAY = 0.55;
const STICK_HOLD = 0.18;

export interface FreestyleUiState {
  on: boolean;
  /** Current move's name, and whether the player keyed it. */
  move: string | null;
  keyed: boolean;
  bpm: number;
  from: BeatChoice['from'];
  /** Keys typed toward the next move. */
  pending: BreakKey[];
  /** "nice!" and friends. */
  flash: { text: string; at: number } | null;
  /** The quiet break loop setting (default on). */
  loop: boolean;
  /** Something's playing, so the loop sits out. */
  music: boolean;
  toast: { text: string; at: number } | null;
}

function loadLoopPref(): boolean {
  try {
    return window.localStorage.getItem(BEAT_PREF) !== '0';
  } catch {
    return true;
  }
}

type Phase = 'off' | 'dancing' | 'leaving';

export class FreestyleMode {
  ui: FreestyleUiState = {
    on: false,
    move: null,
    keyed: false,
    bpm: 95,
    from: 'default',
    pending: [],
    flash: null,
    loop: typeof window === 'undefined' ? true : loadLoopPref(),
    music: false,
    toast: null,
  };
  readonly keys = new FreestyleKeys();
  private phase: Phase = 'off';
  private listeners = new Set<() => void>();
  private mod: DanceModule | null = null;
  private loading: Promise<DanceModule | null> | null = null;
  private dancer: FreestyleDancer | null = null;
  private dancerFor: unknown = null;
  private remotes: RemoteDancers | null = null;
  private loop: LoopBeat | null = null;
  private clock = new FreeClock();
  private set = new FreestyleSet();
  private matcher = new MoveKeys();
  private beatSrc: BeatChoice = { bpm: 95, anchor: null, from: 'default', music: false };
  private endBeat = Infinity;
  private stickT = 0;
  private uiAcc = 0;
  private crowdAcc = 0;
  private audience = false;
  private cheerAt = -Infinity;
  private crowd = new CrowdRespect();
  private lastStep: FreeStep | null = null;
  private pruneAcc = 0;
  private offKey: (() => void) | null = null;

  constructor(private game: Game) {
    this.keys.onPress = (k, ms) => this.onKey(k, ms);
    this.keys.onEscape = () => this.leave();
    if (typeof window !== 'undefined') {
      const kd = (e: KeyboardEvent) => {
        if (e.code !== FREESTYLE_CODE || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target as HTMLElement | null;
        if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable === true)
          return;
        if (this.game.paused || this.game.showroom) return;
        e.preventDefault();
        this.toggle();
      };
      window.addEventListener('keydown', kd);
      this.offKey = () => window.removeEventListener('keydown', kd);
    }
  }

  // ── Store (React reads `ui`) ──

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setUi(p: Partial<FreestyleUiState>) {
    this.ui = { ...this.ui, ...p };
    for (const l of this.listeners) l();
  }

  /** True while the freestyle owns the frame (Game.step hands over). */
  get active() {
    return this.phase !== 'off';
  }

  /** Why it can't start right now (null = it can). */
  blocked(): Blocked | null {
    const g = this.game;
    const p = g.player;
    return blockedBy({
      inside: g.interiors.inside,
      bigDrop: g.missions.ud.active,
      busy:
        g.hoops.active ||
        g.breaks.active ||
        g.breaks.ui.phase !== 'idle' ||
        g.cutscene.active ||
        g.replay.active ||
        g.showroom ||
        g.paused ||
        g.van2.driving ||
        g.dragon.riding ||
        g.me === null,
      mode: p.mode,
      state: p.state,
      speed: p.speed,
      climbing: p.climb !== null || p.vault !== null,
      grounded: p.mode === 'board' || p.footGrounded,
    });
  }

  toggle() {
    if (this.phase === 'dancing') this.leave();
    else if (this.phase === 'off') this.start();
  }

  start(): boolean {
    if (this.phase !== 'off') return true;
    const why = this.blocked();
    if (why !== null) {
      this.setUi({ toast: { text: BLOCKED_TEXT[why], at: performance.now() } });
      return false;
    }
    const g = this.game;
    const p = g.player;
    if (p.mode === 'board') p.toggleBoard(); // step off first
    p.vel.set(0, 0, 0);
    g.unlockAudio();
    void this.load();
    const now = performance.now();
    this.syncBeat(now, true);
    this.set = new FreestyleSet();
    this.matcher.reset();
    this.crowd.reset();
    this.endBeat = Infinity;
    this.stickT = 0;
    this.lastStep = null;
    this.phase = 'dancing';
    this.keys.attach();
    this.setUi({ on: true, move: null, keyed: false, pending: [], flash: null });
    return true;
  }

  /** Walk off: a quick get-up if down, then the pose fades back to the skater. */
  leave() {
    if (this.phase !== 'dancing') return;
    const beat = this.clock.beat(performance.now());
    // ~0.35 s to get up, whatever the tempo
    this.endBeat = this.set.finish(beat, Math.max(0.35, 0.6 * this.clock.spb) / this.clock.spb);
    this.phase = 'leaving';
    this.keys.detach();
    this.matcher.reset();
    this.setUi({ pending: [] });
  }

  /** Hand everything back right now. */
  private release() {
    const g = this.game;
    this.phase = 'off';
    this.keys.detach();
    this.dancer?.rest();
    if (g.me !== null) {
      g.me.body.position.set(0, 0, 0);
      g.me.body.quaternion.identity();
    }
    g.net.freestyle = null;
    this.loop?.update(false, 0, this.clock.bpm, LOOP_VOLUME);
    const loop = this.loop;
    setTimeout(() => {
      if (this.phase === 'off') loop?.dispose();
    }, 700);
    this.setUi({ on: false, move: null, pending: [], flash: null });
  }

  setLoop(on: boolean) {
    try {
      window.localStorage.setItem(BEAT_PREF, on ? '1' : '0');
    } catch {
      /* this page only */
    }
    this.setUi({ loop: on });
  }

  /** Fetch the dancing chunk (once). */
  load(): Promise<DanceModule | null> {
    this.loading ??= import('./dance').then(
      m => (this.mod = m),
      () => null,
    );
    return this.loading;
  }

  // ── The beat ──

  private syncBeat(now: number, fresh = false) {
    const g = this.game;
    const r = g.radio;
    const ctx = g.audio.ctx;
    const lat =
      ctx === null
        ? 0
        : ((ctx as { outputLatency?: number }).outputLatency ?? ctx.baseLatency ?? 0);
    const song =
      r.beatsSong !== null
        ? { bpm: r.beatsSong.bpm, at: r.beatsSong.at + Math.min(0.2, Math.max(0, lat)) * 1000 }
        : null;
    const b = pickBeat({
      radioMode: r.mode,
      beatsOffline: r.beatsOffline,
      song,
      vanLive: g.fm.live && g.fm.view.near,
    });
    if (fresh) {
      this.clock = new FreeClock(b.bpm, b.anchor ?? now);
    } else if (!this.clock.matches(b.bpm, b.anchor)) this.clock.retime(b.bpm, now, b.anchor);
    if (
      b.bpm !== this.beatSrc.bpm ||
      b.from !== this.beatSrc.from ||
      b.music !== this.beatSrc.music
    )
      this.setUi({ bpm: Math.round(b.bpm), from: b.from, music: b.music });
    this.beatSrc = b;
  }

  // ── Keys ──

  private onKey(k: BreakKey, ms: number) {
    if (this.phase !== 'dancing') return;
    const beat = this.clock.beat(ms);
    const hit = this.matcher.press(k, beat, this.clock.spb);
    if (hit === null) {
      this.setUi({ pending: [...this.matcher.pending] });
      return;
    }
    const queued = this.set.request(hit.move, this.clock.beat(performance.now()));
    const p: Partial<FreestyleUiState> = { pending: [] };
    if (queued.length > 0 && hit.clean) {
      this.crowd.hit();
      p.flash = { text: `nice! ${moveName(hit.move).toLowerCase()}`, at: performance.now() };
    } else if (queued.length > 0)
      p.flash = { text: moveName(hit.move).toLowerCase(), at: performance.now() };
    this.setUi(p);
  }

  // ── The frame (Game.step, while active) ──

  /**
   * Run the freestyle's part of the frame: false when it had to stop (the
   * frame then runs as normal).
   */
  frame(dt: number, input: InputFrame, now: number): boolean {
    const g = this.game;
    const me = g.me;
    const why = this.blocked();
    if (me === null || (why !== null && why !== 'air')) {
      this.release();
      return false;
    }
    this.syncBeat(now);
    const beat = this.clock.beat(now);
    // ── walking off ──
    if (this.phase === 'dancing') {
      const stick = Math.hypot(input.moveX, input.moveY);
      this.stickT = input.mode !== 'keyboard' && stick > STICK_AWAY ? this.stickT + dt : 0;
      if (heldLong(this.keys.down, now) || this.stickT > STICK_HOLD) this.leave();
      else this.matcher.expire(beat);
    }
    // ── the step ──
    const step = this.set.at(beat);
    if (step !== this.lastStep && (this.lastStep === null || step.seq !== this.lastStep.seq)) {
      this.onStep(step);
    }
    this.lastStep = step;
    // ── my Noun: parked on the spot, the dance clip under the procedural pose ──
    const p = g.player;
    me.root.position.copy(p.pos);
    me.root.quaternion.setFromAxisAngle(UP, p.footYaw);
    me.board.visible = false;
    me.body.position.set(0, 0, 0);
    me.body.quaternion.identity();
    const ph = (((beat / 4) % 1) + 1) % 1;
    me.play({ clip: 'dance', fade: 0.3, time: ph * 2, timeScale: 0 });
    me.update(dt, { lean: 0, travelled: 0, riding: false, grounded: true });
    const leaving = this.phase === 'leaving';
    const want = leaving && beat >= this.endBeat ? 0 : 1;
    const d = this.ensureDancer(me);
    if (d !== null) {
      d.drive(dt, step, beat, this.clock.bpm, want);
      if (leaving && want === 0 && d.idle) {
        this.release();
        // the clip pose is already in the bones this frame
        return this.finishFrame(dt, input, now, true);
      }
    } else if (leaving && want === 0) {
      this.release();
      return this.finishFrame(dt, input, now, true);
    }
    // ── the room sees it ──
    const fs = encodeFs({
      move: step.move,
      seq: step.seq,
      b: Math.max(0, beat - step.start),
      n: step.n,
      bpm: this.clock.bpm,
    });
    g.net.freestyle = fs;
    // ── the loop ──
    const loopOn = this.ui.loop && !this.beatSrc.music && !leaving && !g.paused;
    if (loopOn || this.loop !== null) {
      this.loop ??= this.mod !== null ? new this.mod.LoopBeat(() => this.bus()) : null;
      this.loop?.update(loopOn, beat, this.clock.bpm, LOOP_VOLUME);
    }
    // ── people around ──
    this.crowdAcc += dt;
    if (this.crowdAcc >= 0.5) {
      this.crowdAcc = 0;
      this.audience = this.hasAudience();
    }
    if (!leaving && this.crowd.tick(dt, this.audience)) {
      const respect = (g as Game & { respect?: RespectApi }).respect;
      const got = respect?.add({ kind: 'custom', label: 'freestyled for a crowd', amount: 1 }) ?? 0;
      if (got > 0) this.setUi({ flash: { text: `+${got} respect`, at: performance.now() } });
    }
    this.uiAcc += dt;
    if (this.uiAcc > 0.25) {
      this.uiAcc = 0;
      const pend = this.matcher.pending;
      if (pend.length !== this.ui.pending.length) this.setUi({ pending: [...pend] });
    }
    return this.finishFrame(dt, input, now, false);
  }

  /** The camera: the skate camera, a slow orbit fed into its look input. */
  private finishFrame(dt: number, input: InputFrame, now: number, done: boolean): true {
    const g = this.game;
    const cam = g.cam;
    const orbit = done ? 0 : (ORBIT_RATE * dt) / 1.2;
    const pitch = done ? 0 : ((ORBIT_PITCH - cam.pitch) * (1 - Math.exp(-1.2 * dt))) / 0.9;
    cam.update(dt, g.player, input.lookX + orbit, input.lookY + pitch, now);
    return true;
  }

  private onStep(step: FreeStep) {
    const fam = moveFamily(step.move);
    this.setUi({ move: moveName(step.move), keyed: step.keyed });
    // The crew nearby waves you on for the big stuff (every few seconds at most)
    const now = performance.now();
    if ((fam === 'power' || fam === 'freeze') && now - this.cheerAt > 6000) {
      const n = this.game.crew?.cheer(this.game.player.pos, AUDIENCE_R) ?? 0;
      if (n > 0) this.cheerAt = now;
    }
  }

  private hasAudience(): boolean {
    const g = this.game;
    const at = g.player.pos;
    const r2 = AUDIENCE_R * AUDIENCE_R;
    for (const rp of g.net.players.values()) {
      const q = rp.current.pos;
      if ((q.x - at.x) ** 2 + (q.z - at.z) ** 2 < r2 && Math.abs(q.y - at.y) < 6) return true;
    }
    for (const npc of g.crew?.npcs ?? []) {
      if ((npc.pos.x - at.x) ** 2 + (npc.pos.z - at.z) ** 2 < r2) return true;
    }
    return false;
  }

  private bus() {
    const a = this.game.audio;
    return a.ctx !== null && a.master !== null ? { ctx: a.ctx, out: a.master } : null;
  }

  private ensureDancer(me: DancerRig): FreestyleDancer | null {
    if (this.mod === null) return null;
    if (this.dancer === null || this.dancerFor !== me) {
      this.dancer?.rest();
      const d = new this.mod.FreestyleDancer(me);
      this.dancer = d.ok ? d : null;
      this.dancerFor = me;
    }
    return this.dancer;
  }

  // ── Other riders (Game.updateNetwork, per remote, after its mixer) ──

  /** A remote rider's character this frame, with their blob's `fs` (decoded by Net). */
  remote(id: string, rig: DancerRig, fs: FsState | null, dt: number) {
    if (fs === null && (this.remotes === null || !this.remotes.map.has(id))) return;
    if (this.mod === null) {
      void this.load();
      return;
    }
    this.remotes ??= new this.mod.RemoteDancers();
    this.remotes.update(id, rig, fs, dt);
    this.pruneAcc += dt;
    if (this.pruneAcc > 2) {
      this.pruneAcc = 0;
      const players = this.game.net.players;
      this.remotes.prune(pid => players.has(pid));
    }
  }

  /** Test / dev seam: what I'm sending. */
  get wire(): FsWire | null {
    return this.game.net.freestyle;
  }

  /** Dev: the move playing (and the beat). */
  debug(): { move: MoveId | null; beat: number; bpm: number; phase: Phase } {
    return {
      move: this.lastStep?.move ?? null,
      beat: this.clock.beat(performance.now()),
      bpm: this.clock.bpm,
      phase: this.phase,
    };
  }

  dispose() {
    if (this.active) this.release();
    this.loop?.dispose();
    this.offKey?.();
    this.offKey = null;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
