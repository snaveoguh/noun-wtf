// ── NOUN FM "spots": the rider's own moments on the radio ────────────────
//
// Things that take the radio over for one rider, locally (not the shared
// station timeline):
//   - the start-of-game intro: the main Noun F-M jingle → "Noun City" (the
//     first song) → a different Noun F-M jingle → the DJ's on-chain update,
//     then the live programme carries on at its current position,
//   - "▶ intro" / "▶ latest DJ update" replays from the FM panel,
//   - Dry Gulch's theme (townTheme.ts).
// While a spot plays, NOUN FM holds (goes quiet here) and the pirate radio
// is ducked; spot audio goes into the mixer's radio bus, so the radio slider
// and mute govern it. Everything is skippable.

import type { NounFm } from './NounFm';

import { getDjUpdate, speakDj } from './djUpdate';
import {
  loadBuffer,
  loadFmManifests,
  pickSecondJingle,
  playBuffer,
  type HouseSong,
} from './fmAssets';
import { talkbox } from './idents';

export type SpotStage = 'jingle' | 'dj' | 'song' | 'town';

export interface SpotView {
  stage: SpotStage | null;
  /** What's playing ("Noun F-M", "♪ Sell It Cold", "DJ update"). */
  title: string;
  /** The DJ's words while they're spoken. */
  subtitle: string | null;
  /** Part of the start-of-game intro (the skip chip shows). */
  intro: boolean;
  at: number;
}

const IDLE: SpotView = { stage: null, title: '', subtitle: null, intro: false, at: 0 };

const INTRO_STORE = 'noun-fm-intro';
export const FIRST_SONG = 'noun-city';

/** "Station intro on start" (default on). */
export function introEnabled(): boolean {
  try {
    return localStorage.getItem(INTRO_STORE) !== '0';
  } catch {
    return true;
  }
}

export function setIntroEnabled(on: boolean) {
  try {
    localStorage.setItem(INTRO_STORE, on ? '1' : '0');
  } catch {
    // no storage: session default
  }
}

/**
 * Should the intro play on PRESS START? Once per page load, when the rider
 * hasn't switched it off, on NOUN FM, not in a replay; never in offline
 * test runs unless `?fmintro=1` forces it.
 */
export function introAllowed(o: {
  enabled: boolean;
  played: boolean;
  offline: boolean;
  forced: boolean;
  replay: boolean;
  fmMode: boolean;
}): boolean {
  if (o.played || o.replay) return false;
  if (o.forced) return true;
  return o.enabled && !o.offline && o.fmMode;
}

export class FmSpots {
  view: SpotView = IDLE;
  /** The intro ran (or was skipped) this page load. */
  introPlayed = false;
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private run = 0;
  private stopCur: ((fade: number) => void) | null = null;
  private skipCur: (() => void) | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private fm: NounFm,
    private hooks: { duck: (on: boolean) => void; volume: () => number },
  ) {}

  attach(ctx: AudioContext, radioBus: AudioNode) {
    if (this.ctx !== null) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(radioBus);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getView = () => this.view;

  get busy(): boolean {
    return this.view.stage !== null;
  }

  private set(v: Partial<SpotView>) {
    this.view = { ...this.view, ...v, at: performance.now() };
    for (const l of this.listeners) l();
    if (import.meta.env.DEV && v.stage !== undefined)
      console.info('[fm] spot', v.stage ?? 'end', v.title ?? '');
  }

  private begin(intro: boolean): number {
    this.stopCur?.(0.3);
    this.stopCur = null;
    this.skipCur = null;
    const token = ++this.run;
    this.fm.hold = true;
    this.hooks.duck(true);
    this.set({ intro, subtitle: null });
    return token;
  }

  private end(token: number) {
    if (token !== this.run) return;
    this.stopCur = null;
    this.skipCur = null;
    this.fm.hold = false;
    this.hooks.duck(false);
    this.view = { ...IDLE, at: performance.now() };
    for (const l of this.listeners) l();
    if (import.meta.env.DEV) console.info('[fm] spot end');
  }

  /** Skip what's playing now (the intro moves on to its next part). */
  skip() {
    this.skipCur?.();
  }

  /** Stop everything (the whole intro). */
  skipAll() {
    const token = this.run;
    this.stopCur?.(0.3);
    this.end(token);
    this.run++;
  }

  // ── Stages ───────────────────────────────────────────────────────────

  /** Resolve when `wait` ends or the stage is skipped / superseded. */
  private stage(
    token: number,
    v: Partial<SpotView>,
    start: (done: () => void) => (fade: number) => void,
  ): Promise<void> {
    if (token !== this.run) return Promise.resolve();
    this.set(v);
    return new Promise(resolve => {
      let over = false;
      const done = () => {
        if (over) return;
        over = true;
        resolve();
      };
      const stop = start(done);
      this.stopCur = f => {
        stop(f);
        done();
      };
      this.skipCur = () => {
        stop(0.25);
        done();
      };
    });
  }

  private file(token: number, title: string, url: string, stage: SpotStage): Promise<void> {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null) return Promise.resolve();
    return loadBuffer(ctx, url).then(buf => {
      if (buf === null) return;
      return this.stage(token, { stage, title }, done => {
        const h = playBuffer(ctx, out, buf, { onEnded: done });
        return f => h.stop(f);
      });
    });
  }

  private song(token: number, s: HouseSong, stage: SpotStage): Promise<void> {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null) return Promise.resolve();
    return this.stage(token, { stage, title: `♪ ${s.title}`, subtitle: null }, done => {
      const el = new Audio();
      el.preload = 'auto';
      const g = ctx.createGain();
      g.connect(out);
      let routed = false;
      try {
        ctx.createMediaElementSource(el).connect(g);
        routed = true;
      } catch {
        el.volume = Math.min(1, this.hooks.volume());
      }
      el.onended = done;
      el.onerror = done;
      el.src = s.url;
      void el.play().catch(done);
      return fade => {
        const t = ctx.currentTime;
        const f = Math.max(0.02, fade);
        if (routed) {
          g.gain.setValueAtTime(g.gain.value, t);
          g.gain.linearRampToValueAtTime(0, t + f);
        }
        const v0 = el.volume;
        const t0 = performance.now();
        const tick = () => {
          const k = Math.min(1, (performance.now() - t0) / (f * 1000));
          if (!routed) el.volume = v0 * (1 - k);
          if (k < 1) requestAnimationFrame(tick);
          else {
            el.pause();
            el.removeAttribute('src');
            el.load();
            g.disconnect();
          }
        };
        tick();
      };
    });
  }

  private async dj(token: number): Promise<void> {
    const ctx = this.ctx;
    const out = this.out;
    if (ctx === null || out === null || token !== this.run) return;
    const d = await Promise.race([
      getDjUpdate(),
      new Promise<null>(r => setTimeout(() => r(null), 5000)),
    ]);
    // no news fetched: no update (never invent one)
    if (d === null || token !== this.run) return;
    const audio = d.audioUrl !== null ? await loadBuffer(ctx, d.audioUrl) : null;
    await this.stage(
      token,
      { stage: 'dj', title: 'NOUN FM · DJ update', subtitle: d.script },
      done => {
        if (audio !== null) {
          const h = playBuffer(ctx, out, audio, { onEnded: done });
          return f => h.stop(f);
        }
        const signal = { cancelled: false };
        void speakDj(d.script, { volume: this.hooks.volume(), signal }).then(ok => {
          if (ok) return done();
          // no browser voice: the talkbox calls the station, subtitles carry the words
          talkbox(ctx, out, ctx.currentTime + 0.05, 1);
          const ms = (d.script.split(/\s+/).length / 2.6) * 1000;
          setTimeout(done, Math.max(4000, ms));
        });
        return () => {
          signal.cancelled = true;
        };
      },
    );
  }

  // ── Programmes ───────────────────────────────────────────────────────

  /** Main jingle → the first song → another jingle → the DJ update. */
  async intro(): Promise<void> {
    this.introPlayed = true;
    const token = this.begin(true);
    const m = await loadFmManifests();
    const main = m.interludes[0];
    if (main !== undefined) await this.file(token, main.title, main.full, 'jingle');
    const s = m.songs.find(x => x.id === FIRST_SONG) ?? m.songs[0];
    if (s !== undefined) await this.song(token, s, 'song');
    const second = pickSecondJingle(m.interludes, Math.random());
    if (second !== null) await this.file(token, second.title, second.full, 'jingle');
    await this.dj(token);
    this.end(token);
  }

  /** Replay just the DJ update. */
  async djUpdate(): Promise<void> {
    const token = this.begin(false);
    await this.dj(token);
    this.end(token);
  }

  /** A town's theme (fades out on `stopTown`). */
  async town(songId: string): Promise<void> {
    const m = await loadFmManifests();
    const s = m.songs.find(x => x.id === songId);
    if (s === undefined) return;
    const token = this.begin(false);
    await this.song(token, s, 'town');
    this.end(token);
  }

  stopTown(fadeS: number) {
    if (this.view.stage !== 'town') return;
    const token = this.run;
    this.stopCur?.(fadeS);
    // the station comes back as the theme finishes fading
    setTimeout(() => this.end(token), fadeS * 1000);
  }
}
