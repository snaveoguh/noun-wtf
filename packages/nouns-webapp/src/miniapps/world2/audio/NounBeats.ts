// ── NOUN BEATS: the rider's own hip-hop station (real tracks) ────────────
//
// Plays hip-hop from the NOUN FM playlist (public/fm/playlist.json, picked
// in beatsPicker.ts) through the same YouTube machinery as COMMUNITY RADIO
// and the site-wide NOUN FM: the official IFrame player (YouTubeDeck) in a
// visible deck screen of at least 200×200 px, which goes away (and the
// video with it) while the world is hidden. Per player, never synced; no
// jingles. GameRadio falls back to the generated worklet beats when this
// reports `source === 'offline'` (?offline=1, the app refusing embeds, or
// three tracks in a row erroring).

import { parsePlaylist, type FmItem } from '@/components/NounFm/station';

import { YouTubeDeck, YT_PLAYING } from '../radio/YouTubeDeck';

import {
  afterBeat,
  BEATS_RECENT_MAX,
  beatsSource,
  beatsTrackLabel,
  hipHopPool,
  pickBeat,
  type BeatsPickState,
  type BeatsSource,
  type BeatsTrack,
} from './beatsPicker';

const PLAYLIST_URL = '/fm/playlist.json';
const STORE = 'noun-beats-v1';
const YT_ENDED = 0;
const YT_BUFFERING = 3;
/** YouTube errors that mean the video will never play here: gone, or embedding off. */
const YT_DEAD = new Set([100, 101, 150]);
/** A loaded video that hasn't started by then is waiting on a click (autoplay blocked). */
const START_WATCHDOG_MS = 12_000;
/**
 * Whether the Capacitor app's webview refuses YouTube embeds outright. It
 * loads the live site from https://noun.wtf, so embeds are expected to
 * work; if they don't, the three-strikes rule takes the station offline.
 */
export const NATIVE_EMBEDS_BLOCKED = false;

export type BeatsPhase = 'off' | 'loading' | 'track' | 'blocked' | 'offline';

export interface BeatsView {
  phase: BeatsPhase;
  item: FmItem | null;
  /** "artist – title" (or a status line). */
  label: string;
  /** The YouTube deck screen must be showing. */
  screen: boolean;
}

interface Stored {
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

export interface NounBeatsOptions {
  offline: boolean;
  native: boolean;
  /** Playlist loader (tests). */
  fetchPlaylist?: () => Promise<FmItem[]>;
  deck?: YouTubeDeck;
}

export class NounBeats {
  readonly deck: YouTubeDeck;
  /** The label changed (a new track, a status line). */
  onChange?: () => void;
  /** The station just gave up on YouTube: play the generated beats instead. */
  onOffline?: () => void;

  private readonly offline: boolean;
  private readonly native: boolean;
  private readonly fetchPlaylist: () => Promise<FmItem[]>;
  private pool: BeatsTrack[] = [];
  private loaded: Promise<void> | null = null;
  private playlistFailed = false;
  private pick: BeatsPickState;
  /** Tracks in a row that errored or were refused. */
  strikes = 0;
  private on = false;
  private hidden = false;
  private gameHidden = false;
  private docHidden = false;
  private resumeAt = 0;
  private gen = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private volume = 0.6;
  private view: BeatsView = { phase: 'off', item: null, label: 'tuning in', screen: false };
  private listeners = new Set<() => void>();

  constructor(o: NounBeatsOptions) {
    this.offline = o.offline;
    this.native = o.native;
    this.deck = o.deck ?? new YouTubeDeck();
    this.fetchPlaylist =
      o.fetchPlaylist ??
      (() =>
        fetch(PLAYLIST_URL)
          .then(r => (r.ok ? r.json() : null))
          .then(parsePlaylist)
          .catch(() => [] as FmItem[]));
    const s = load();
    this.pick = {
      recent: Array.isArray(s.recent) ? s.recent.slice(0, BEATS_RECENT_MAX) : [],
      blocked: new Set(Array.isArray(s.blocked) ? s.blocked : []),
      lastArtist: '',
    };
    this.deck.onState = st => this.onDeckState(st);
    this.deck.onError = code => this.onDeckError(code);
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = () => {
    this.docHidden = document.visibilityState === 'hidden';
    this.applyHidden();
  };

  /** YouTube, or the generated beats (GameRadio plays those). */
  get source(): BeatsSource {
    if (this.playlistFailed) return 'offline';
    return beatsSource({
      offline: this.offline,
      native: this.native,
      nativeEmbedsBlocked: NATIVE_EMBEDS_BLOCKED,
      strikes: this.strikes,
    });
  }

  // ── React store ──────────────────────────────────────────────────────

  getView = (): BeatsView => this.view;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<BeatsView>) {
    const v = { ...this.view, ...patch };
    const o = this.view;
    if (v.phase === o.phase && v.item === o.item && v.label === o.label && v.screen === o.screen)
      return;
    this.view = v;
    for (const l of this.listeners) l();
    if (v.label !== o.label) this.onChange?.();
  }

  get label(): string {
    return this.view.label;
  }

  private save() {
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify({
          recent: this.pick.recent,
          blocked: [...this.pick.blocked],
        } satisfies Stored),
      );
    } catch {
      // no storage
    }
  }

  // ── controls (GameRadio) ─────────────────────────────────────────────

  start() {
    if (this.on) return;
    // a fresh pick of the station gives YouTube another go
    if (this.strikes > 0 && !this.playlistFailed) this.strikes = 0;
    if (this.source === 'offline') return;
    this.on = true;
    const gen = ++this.gen;
    this.set({ phase: 'loading', label: 'tuning in', screen: false });
    void this.ensureLoaded().then(() => {
      if (gen !== this.gen || !this.on) return;
      if (this.pool.length === 0) {
        this.playlistFailed = true;
        this.goOffline();
        return;
      }
      this.startTrack(gen);
    });
  }

  stop() {
    this.on = false;
    this.gen++;
    this.clearTimers();
    this.deck.stop();
    this.set({ phase: 'off', item: null, screen: false });
  }

  /** Skip to the next pick (`.` / ⏭). */
  next() {
    if (!this.on) return;
    this.resumeAt = 0;
    this.startTrack(++this.gen);
  }

  /** The world is hidden (paused under the desk, tab in the background): the video stops. */
  setHidden(h: boolean) {
    this.gameHidden = h;
    this.applyHidden();
  }

  private applyHidden() {
    const h = this.gameHidden || this.docHidden;
    if (this.hidden === h) return;
    this.hidden = h;
    if (!this.on) return;
    if (h) {
      this.resumeAt = this.deck.time;
      this.clearTimers();
      this.deck.pause();
      this.set({ screen: false });
    } else if (this.view.item !== null && this.view.phase !== 'offline') {
      this.set({ screen: true });
      this.load(this.gen, this.view.item, 0, this.resumeAt);
    }
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    this.deck.setVolume(this.volume);
  }

  dispose() {
    this.stop();
    this.deck.unmount();
    this.listeners.clear();
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', this.onVisibility);
  }

  // ── programme ────────────────────────────────────────────────────────

  private ensureLoaded(): Promise<void> {
    this.loaded ??= this.fetchPlaylist().then(items => {
      this.pool = hipHopPool(items);
    });
    return this.loaded;
  }

  private clearTimers() {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.timer = null;
    this.watchdog = null;
  }

  private startTrack(gen: number) {
    if (gen !== this.gen || !this.on) return;
    this.clearTimers();
    const item = pickBeat(this.pool, this.pick, Math.random);
    if (item === null) {
      this.playlistFailed = true;
      this.goOffline();
      return;
    }
    this.pick = afterBeat(this.pick, item);
    this.save();
    this.resumeAt = 0;
    this.set({ phase: 'track', item, label: beatsTrackLabel(item), screen: !this.hidden });
    if (!this.hidden) this.load(gen, item, 0, 0);
  }

  /** The screen mounts a frame after `screen: true`; retry until it's there. */
  private load(gen: number, item: FmItem, tries: number, at: number) {
    if (gen !== this.gen || this.hidden) return;
    if (!this.deck.play(item.id, at)) {
      if (tries > 20) {
        // the screen never became playable: that's a refused track
        this.strike(item, null);
        return;
      }
      this.timer = setTimeout(() => this.load(gen, item, tries + 1, at), 250);
      return;
    }
    this.deck.setVolume(this.volume);
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (gen !== this.gen) return;
      const st = this.deck.state;
      if (st !== YT_PLAYING && st !== YT_BUFFERING && this.view.phase === 'track')
        this.set({ phase: 'blocked', label: '▶ press play on the video' });
    }, START_WATCHDOG_MS);
  }

  private onDeckState(st: number) {
    if (!this.on) return;
    if (st === YT_PLAYING) {
      this.strikes = 0;
      const item = this.view.item;
      if (this.view.phase === 'blocked' && item !== null)
        this.set({ phase: 'track', label: beatsTrackLabel(item) });
      return;
    }
    if (st === YT_ENDED && (this.view.phase === 'track' || this.view.phase === 'blocked'))
      this.next();
  }

  private onDeckError(code: number) {
    const item = this.view.item;
    if (!this.on || item === null) return;
    this.strike(item, code);
  }

  /** The deck errored on / refused `item`: move on, or give up after three in a row. */
  private strike(item: FmItem, code: number | null) {
    this.clearTimers();
    this.strikes++;
    if (code !== null && YT_DEAD.has(code)) {
      const blocked = new Set(this.pick.blocked);
      blocked.add(item.id);
      this.pick = { ...this.pick, blocked };
      this.save();
    }
    if (this.source === 'offline') {
      this.goOffline();
      return;
    }
    this.startTrack(++this.gen);
  }

  private goOffline() {
    this.on = false;
    this.gen++;
    this.clearTimers();
    this.deck.stop();
    this.set({ phase: 'offline', item: null, screen: false });
    this.onOffline?.();
  }
}
