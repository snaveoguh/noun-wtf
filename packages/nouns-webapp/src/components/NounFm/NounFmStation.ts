// ── NOUN FM (site-wide): the player ──────────────────────────────────────
//
// One personal stream per visitor, playing on every page: a NOUN FM jingle,
// then a random YouTube pick from public/fm/playlist.json, then a jingle...
//
// YouTube plays only through the official IFrame player in a visible deck
// (YouTubeDeck: at least 200×200 px, ads untouched); the widget keeps that
// screen on show whenever a video is playing. The jingles are our own files
// (public/world2/fm/interludes). Pauses while Noun World's own radio has the
// floor (lib/nounFmBus).

import { audioClaimed, onClaimsChange } from '@/lib/nounFmBus';
import { YouTubeDeck, YT_PLAYING } from '@/miniapps/world2/radio/YouTubeDeck';

import {
  afterPlay,
  jingleFor,
  parsePlaylist,
  pickNext,
  type FmItem,
  type FmJingle,
  type PickState,
} from './station';

export const PLAYLIST_URL = '/fm/playlist.json';
const JINGLE_BASE = '/world2/fm/interludes';
const STORE = 'noun-fm-v1';
/** A loaded video that hasn't started by then is waiting on a click (autoplay blocked). */
const START_WATCHDOG_MS = 12_000;
const YT_ENDED = 0;
const YT_BUFFERING = 3;
/** YouTube errors that mean this video will never play here: gone, or embedding off. */
const YT_DEAD = new Set([100, 101, 150]);
/** The YouTube player script didn't load (blocker, offline): try again after this. */
const YT_RETRY_MS = 30_000;

export type FmPhase = 'off' | 'loading' | 'jingle' | 'track' | 'held' | 'blocked' | 'empty';

export interface FmView {
  phase: FmPhase;
  item: FmItem | null;
  /** What the strip says. */
  label: string;
  minimized: boolean;
  volume: number;
  /** Tuned in on a previous visit (offer a one-tap resume). */
  wasOn: boolean;
  /** The YouTube screen must be showing (a video is loaded). */
  screen: boolean;
}

interface Stored {
  on?: boolean;
  min?: boolean;
  vol?: number;
  recent?: readonly string[];
  blocked?: string[];
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}

function parseJingles(raw: unknown): FmJingle[] {
  const rows = (raw as { interludes?: unknown } | null)?.interludes;
  if (!Array.isArray(rows)) return [];
  return (rows as Record<string, unknown>[])
    .filter(r => typeof r?.id === 'string' && typeof r.file === 'string')
    .map(r => ({
      id: r.id as string,
      title: typeof r.title === 'string' ? r.title : 'NOUN FM',
      sting: `${JINGLE_BASE}/${r.file as string}`,
      full: `${JINGLE_BASE}/${typeof r.full === 'string' ? r.full : (r.file as string)}`,
    }));
}

export class NounFmStation {
  readonly deck = new YouTubeDeck();
  private items: FmItem[] = [];
  private jingles: FmJingle[] = [];
  private loaded: Promise<void> | null = null;
  private pick: PickState;
  private lastJingle = '';
  private jingleEl: HTMLAudioElement | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on every transition so stale callbacks drop out. */
  private gen = 0;
  private on = false;
  private heldPhase: FmPhase | null = null;
  private view: FmView;
  private listeners = new Set<() => void>();

  constructor() {
    const s = load();
    this.pick = {
      recent: Array.isArray(s.recent) ? s.recent.slice(0, 400) : [],
      blocked: new Set(Array.isArray(s.blocked) ? s.blocked : []),
      sinceTalk: 0,
      lastArtist: '',
    };
    this.view = {
      phase: 'off',
      item: null,
      label: 'NOUN FM',
      minimized: s.min === true,
      volume: typeof s.vol === 'number' ? Math.max(0, Math.min(1, s.vol)) : 0.7,
      wasOn: s.on === true,
      screen: false,
    };
    this.deck.setVolume(this.view.volume);
    this.deck.onState = st => this.onDeckState(st);
    this.deck.onError = code => this.onDeckError(code);
    onClaimsChange(() => this.syncHold());
  }

  // ── view / subscription ────────────────────────────────────────────────

  getView = (): FmView => this.view;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<FmView>) {
    this.view = { ...this.view, ...patch };
    for (const l of this.listeners) l();
  }

  private save() {
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify({
          on: this.on,
          min: this.view.minimized,
          vol: this.view.volume,
          recent: this.pick.recent,
          blocked: [...this.pick.blocked],
        } satisfies Stored),
      );
    } catch {
      // no storage
    }
  }

  // ── controls ───────────────────────────────────────────────────────────

  /** Start the stream (call from a click: browsers need one for sound). */
  tuneIn() {
    if (this.on) return;
    this.on = true;
    this.set({ phase: 'loading', wasOn: true, label: 'tuning in…' });
    this.save();
    void this.ensureLoaded().then(() => {
      if (!this.on) return;
      if (this.items.length === 0) {
        this.set({ phase: 'empty', label: 'NOUN FM · playlist unavailable' });
        return;
      }
      this.startBreak();
    });
  }

  tuneOut() {
    this.on = false;
    this.gen++;
    this.clearTimers();
    this.stopJingle();
    this.deck.stop();
    this.heldPhase = null;
    this.set({ phase: 'off', item: null, label: 'NOUN FM', screen: false, wasOn: false });
    this.save();
  }

  /** Next pick for this listener only (a sting, then the next track). */
  skip() {
    if (!this.on || this.view.phase === 'held') return;
    this.startBreak(true);
  }

  setMinimized(min: boolean) {
    this.set({ minimized: min });
    this.save();
  }

  setVolume(v: number) {
    const vol = Math.max(0, Math.min(1, v));
    this.deck.setVolume(vol);
    if (this.jingleEl) this.jingleEl.volume = vol;
    this.set({ volume: vol });
    this.save();
  }

  // ── programme ──────────────────────────────────────────────────────────

  private ensureLoaded(): Promise<void> {
    this.loaded ??= Promise.all([
      fetch(PLAYLIST_URL)
        .then(r => (r.ok ? r.json() : null))
        .then(parsePlaylist)
        .catch(() => [] as FmItem[]),
      fetch(`${JINGLE_BASE}/manifest.json`)
        .then(r => (r.ok ? r.json() : null))
        .then(parseJingles)
        .catch(() => [] as FmJingle[]),
    ]).then(([items, jingles]) => {
      this.items = items;
      this.jingles = jingles;
      if (items.length === 0) this.loaded = null; // try again next time
    });
    return this.loaded;
  }

  private clearTimers() {
    if (this.watchdog) clearTimeout(this.watchdog);
    if (this.retry) clearTimeout(this.retry);
    this.watchdog = null;
    this.retry = null;
  }

  private stopJingle() {
    if (!this.jingleEl) return;
    this.jingleEl.onended = null;
    this.jingleEl.onerror = null;
    this.jingleEl.pause();
    this.jingleEl = null;
  }

  /** A NOUN FM jingle between picks (a sting on skips). */
  private startBreak(forceSting = false) {
    const gen = ++this.gen;
    this.clearTimers();
    this.stopJingle();
    this.deck.stop();
    const j = jingleFor(this.jingles, forceSting, this.lastJingle, Math.random);
    if (j === null || audioClaimed()) {
      this.startTrack(gen);
      return;
    }
    this.lastJingle = j.jingle.id;
    const el = new Audio(j.url);
    el.volume = this.view.volume;
    this.jingleEl = el;
    const next = () => {
      if (gen === this.gen && this.jingleEl === el) {
        this.jingleEl = null;
        this.startTrack(gen);
      }
    };
    el.onended = next;
    el.onerror = next;
    this.set({ phase: 'jingle', item: null, label: `♪ ${j.jingle.title}`, screen: false });
    void el.play().catch(next);
  }

  private startTrack(gen: number) {
    if (gen !== this.gen || !this.on) return;
    const item = pickNext(this.items, this.pick, Math.random);
    if (item === null) {
      this.set({ phase: 'empty', label: 'NOUN FM · nothing playable', screen: false });
      return;
    }
    this.pick = afterPlay(this.pick, item);
    this.save();
    const kind = item.kind === 'music' ? '' : item.kind === 'podcast' ? '🎙 ' : '📺 ';
    this.set({
      phase: 'track',
      item,
      label: `${kind}${item.artist ? `${item.artist} — ` : ''}${item.title}`,
      screen: true,
    });
    this.load(gen, item, 0);
  }

  /** The screen mounts a frame after `screen: true`; retry until it's there. */
  private load(gen: number, item: FmItem, tries: number, at = 0) {
    if (gen !== this.gen) return;
    if (audioClaimed()) {
      this.hold();
      return;
    }
    if (!this.deck.play(item.id, at)) {
      if (tries > 20) {
        // the screen never became playable: say so and retry, rather than
        // looping jingle → refused track → jingle
        this.set({ phase: 'blocked', label: 'NOUN FM · the video screen is hidden or too small' });
        this.retry = setTimeout(() => this.load(gen, item, 0, at), YT_RETRY_MS);
        return;
      }
      this.retry = setTimeout(() => this.load(gen, item, tries + 1, at), 250);
      return;
    }
    this.watchdog = setTimeout(() => {
      if (gen !== this.gen) return;
      const st = this.deck.state;
      if (st !== YT_PLAYING && st !== YT_BUFFERING && this.view.phase === 'track')
        this.set({ phase: 'blocked', label: '▶ press play on the video to start NOUN FM' });
    }, START_WATCHDOG_MS);
  }

  private onDeckState(st: number) {
    if (!this.on) return;
    if (st === YT_ENDED && (this.view.phase === 'track' || this.view.phase === 'blocked')) {
      this.startBreak();
      return;
    }
    if (st === YT_PLAYING && this.view.phase === 'blocked') {
      const item = this.view.item;
      this.set({
        phase: 'track',
        label: item ? `${item.artist ? `${item.artist} — ` : ''}${item.title}` : 'NOUN FM',
      });
    }
  }

  /**
   * Video gone / embedding off: remember it and move straight on (no jingle).
   * The player itself failing to load (-1: a blocker, offline) is the
   * browser's problem, not the track's: say so and retry, blocking nothing.
   */
  private onDeckError(code: number) {
    const item = this.view.item;
    if (!this.on || item === null) return;
    const gen = ++this.gen;
    this.clearTimers();
    if (code === -1) {
      this.set({ phase: 'blocked', label: "NOUN FM · YouTube didn't load here (blocker?)" });
      this.retry = setTimeout(() => this.startTrack(gen), YT_RETRY_MS);
      return;
    }
    if (YT_DEAD.has(code)) {
      const blocked = new Set(this.pick.blocked);
      blocked.add(item.id);
      this.pick = { ...this.pick, blocked };
      this.save();
    }
    this.startTrack(gen);
  }

  // ── Noun World's radio has the floor ───────────────────────────────────

  private syncHold() {
    if (!this.on) return;
    if (audioClaimed()) this.hold();
    else this.release();
  }

  private hold() {
    if (this.view.phase === 'held') return;
    this.heldPhase = this.view.phase;
    this.deck.pause();
    this.jingleEl?.pause();
    this.set({ phase: 'held', label: 'NOUN FM · paused while Noun World radio plays' });
  }

  private release() {
    if (this.view.phase !== 'held') return;
    const was = this.heldPhase;
    this.heldPhase = null;
    const item = this.view.item;
    if (was === 'jingle' && this.jingleEl) {
      this.set({ phase: 'jingle', label: '♪ NOUN FM' });
      const el = this.jingleEl;
      void el.play().catch(() => el.onended?.(new Event('ended')));
      return;
    }
    if (item !== null) {
      this.set({
        phase: 'track',
        label: `${item.artist ? `${item.artist} — ` : ''}${item.title}`,
        screen: true,
      });
      this.load(this.gen, item, 0, this.deck.time);
      return;
    }
    this.startBreak(true);
  }
}

let station: NounFmStation | null = null;

/** The one station for this tab. */
export function nounFm(): NounFmStation {
  if (station === null) {
    station = new NounFmStation();
    if (import.meta.env.DEV) (window as unknown as { __nounFm: NounFmStation }).__nounFm = station;
  }
  return station;
}
