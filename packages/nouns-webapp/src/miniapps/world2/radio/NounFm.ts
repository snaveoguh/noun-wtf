// ── NOUN FM: the ice cream van's shared radio station (client) ──────────
//
// The station lives on the PartyKit relay (or in this tab with
// ?offline=1, see transport.ts). This class keeps a copy of its state,
// projects the shared timeline onto the server clock (sync.ts) and plays
// whatever is on air:
//   - Audius / direct audio: an <audio> element, routed through WebAudio
//     when the host allows CORS (spatial van speakers + light pulse),
//     otherwise played straight with distance volume only.
//   - YouTube: the official IFrame player in a visible deck screen
//     (YouTubeDeck.ts), never hidden, ads untouched.
//   - between tracks: one of the owner's recorded Noun F-M stings or a
//     procedural ident (idents.ts), picked by the play key (fmAssets.ts).
//   - nothing queued and no set on: the house programme (house.ts): the
//     owner's songs + library tracks, cut-offs, jingles and WORLDWIDE
//     ALERT news breaks, on a shared deterministic schedule.
//   - nothing at all to play: the procedural pirate station (PirateRadio).
// Tuned in (radio cycle → NOUN FM) you hear it anywhere; otherwise it only
// plays out of the van's speakers when you're within FM_NEAR of it.

import * as THREE from 'three';

import {
  advance,
  classifyUrl,
  FM_GAP_MS,
  FM_MAX_TRACK_S,
  loadState,
  onAir,
  ownerTag,
  type FmOnAir,
  type FmSrc,
  type FmState,
  type FmTrack,
} from '../../../../../nouns-party/src/fmStation';

import { alertSting } from './alertSting';
import { audiusHost, audiusStreamUrl, resolveAudius } from './audius';
import { getDjUpdate, speakDj } from './djUpdate';
import {
  loadBuffer,
  loadFmManifests,
  pickGapSound,
  playBuffer,
  type HouseSong,
  type Interlude,
} from './fmAssets';
import {
  catalogPrint,
  dayStart,
  houseSlot,
  houseDay,
  libraryTracks,
  normCatalog,
  type HouseCatalog,
  type HouseItem,
} from './house';
import { playIdent, talkbox } from './idents';
import { fetchLibrary, type LibSet } from './library';
import { audioDriftFix, ClockSync, expectedPosition, youTubeDriftFix } from './sync';
import { type FmTransport } from './transport';
import { YouTubeDeck, YT_PLAYING } from './YouTubeDeck';

/** The van's speakers reach this far (m) for riders who aren't tuned in. */
export const FM_NEAR = 30;
const KEY_STORE = 'noun-fm-key';

export interface FmView {
  tuned: boolean;
  /** Hello'd with the station (online) / local station (offline). */
  ready: boolean;
  offline: boolean;
  state: FmState | null;
  air: FmOnAir;
  phase: 'off' | 'fallback' | 'ident' | 'track' | 'break';
  /** The house programme's item on air (nothing queued, no set on), else null. */
  house: { kind: 'song' | 'break'; label: string; cut: boolean } | null;
  label: string;
  myTag: string;
  error: { msg: string; at: number } | null;
  notice: { msg: string; at: number } | null;
  /** Show the YouTube deck screen (a YouTube track is on air and you can hear it). */
  screen: boolean;
  near: boolean;
  synced: boolean;
  /** Why the current track can't play here, if it can't. */
  trackError: string | null;
}

export type FmResult = { ok: true } | { ok: false; msg: string };

export type FmInspect =
  | { ok: true; track: FmTrack }
  /** YouTube: title + duration come from a visible preview player in the panel. */
  | { ok: true; preview: FmSrc & { kind: 'youtube' } }
  | { ok: false; reason: string };

function makeKey(): string {
  try {
    const k = localStorage.getItem(KEY_STORE);
    if (k !== null && /^[\w-]{16,64}$/.test(k)) return k;
  } catch {
    // no storage
  }
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const b = new Uint8Array(24);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function')
    crypto.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  const k = Array.from(b, x => abc[x & 63]).join('');
  try {
    localStorage.setItem(KEY_STORE, k);
  } catch {
    // session-only key
  }
  return k;
}

/** Duration of an audio file from its metadata (direct links). */
function probeDuration(url: string, ms = 9000): Promise<number> {
  return new Promise(resolve => {
    const el = new Audio();
    el.preload = 'metadata';
    const done = (d: number) => {
      clearTimeout(timer);
      el.removeAttribute('src');
      el.load();
      resolve(d);
    };
    const timer = setTimeout(() => done(0), ms);
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => done(0);
    el.src = url;
  });
}

const OFF_AIR: FmOnAir = {
  source: 'fallback',
  key: '',
  track: null,
  startAt: 0,
  endAt: 0,
  set: null,
};

export class NounFm {
  readonly yt = new YouTubeDeck();
  readonly myTag: string;
  view: FmView;
  /** The van's speaker position (world), set once the van is placed. */
  vanPos: THREE.Vector3 | null = null;
  volume = 0.6;
  /** Mixer gain for outputs outside the WebAudio graph (YouTube, an unrouted <audio>, the spoken ident). */
  extGain = 1;
  /** Light pulse 0..1 (analyser, or a synthetic beat when we can't measure). */
  level = 0;
  /** A track (not the fallback) is on air. */
  live = false;
  /** Play / stop the procedural pirate station as NOUN FM's fallback. */
  onFallback?: (on: boolean) => void;
  /** Skip the fallback's song. */
  onFallbackNext?: () => void;
  /** The fallback's current song name (for the label). */
  fallbackSong?: () => string;
  /** A new track came on air (tuned: through the radio toast; near: a banner). */
  onTrackChange?: (label: string, tuned: boolean) => void;
  /** A house break started (a WORLDWIDE ALERT / a jingle), for the toast. */
  onBreak?: (tag: string, text: string) => void;
  /**
   * Something else owns the radio for a moment (the start-of-game intro,
   * Dry Gulch's theme): the station goes quiet here, then rejoins the live
   * programme at its current position.
   */
  hold = false;

  private key: string;
  private transport: FmTransport;
  private clock = new ClockSync();
  private state: FmState | null = null;
  private listeners = new Set<() => void>();
  private tuned = false;
  private hidden = false;
  private helloed = false;
  private pingAt = 0;
  private pings = 0;
  private acc = 0;
  private time = 0;
  private airKey = '';
  private curAir: FmOnAir = OFF_AIR;
  private identKey = '';
  /** What filled the last gap (dev checks / tests). */
  lastGap: { kind: 'file' | 'synth'; id: string; key: string } | null = null;
  private identUntil = 0;
  private mediaKey = '';
  private screenDismissedFor: string | null = null;
  private fbOn = false;
  private near = false;
  private lastSeekAt = -Infinity;
  private trackError: string | null = null;
  private error: FmView['error'] = null;
  private notice: FmView['notice'] = null;
  /** Callers waiting on the server's answer to an op (oldest first). */
  private waiters: { op: string; done: (r: FmResult) => void }[] = [];

  // audio graph
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private bus: GainNode | null = null;
  private music: GainNode | null = null;
  private direct: GainNode | null = null;
  private spatial: GainNode | null = null;
  private panner: PannerNode | null = null;
  private analyser: AnalyserNode | null = null;
  private wave: Uint8Array<ArrayBuffer> | null = null;
  private el: HTMLAudioElement | null = null;
  private elSrc: MediaElementAudioSourceNode | null = null;
  private elRouted = false;
  private playing: Promise<void> | null = null;

  // recordings + house programme
  private interludes: Interlude[] = [];
  private stings: (AudioBuffer | null)[] = [];
  private songs: HouseSong[] = [];
  private libSets: LibSet[] = [];
  private libAt = -Infinity;
  private djAt = -Infinity;
  private alertLine = '';
  private houseItems: HouseItem[] = [];
  private houseKey = '';
  private houseNow: HouseItem | null = null;
  private breakKey = '';
  private breakStop: (() => void) | null = null;

  constructor(transport: FmTransport) {
    this.transport = transport;
    this.key = makeKey();
    this.myTag = ownerTag(this.key);
    transport.onMessage = m => this.handle(m);
    this.view = this.makeView(OFF_AIR, 'off');
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', this.onVisibility);
  }

  // ── React store ──────────────────────────────────────────────────────

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getView = () => this.view;

  private makeView(air: FmOnAir, phase: FmView['phase']): FmView {
    const yt = air.track?.src.kind === 'youtube';
    return {
      tuned: this.tuned,
      ready: this.helloed && this.state !== null,
      offline: this.transport.offline,
      state: this.state,
      air,
      phase,
      label: this.labelFor(air),
      myTag: this.myTag,
      error: this.error,
      notice: this.notice,
      screen:
        yt &&
        (this.tuned || this.near) &&
        !this.hidden &&
        !this.hold &&
        this.screenDismissedFor !== air.key,
      near: this.near,
      synced: this.clock.synced || this.transport.offline,
      trackError: this.trackError,
      house:
        this.houseNow !== null
          ? {
              kind: this.houseNow.kind,
              label: this.houseLabel(this.houseNow),
              cut: this.houseNow.kind === 'song' && this.houseNow.cut,
            }
          : null,
    };
  }

  private publish(air: FmOnAir, phase: FmView['phase'], force = false) {
    const v = this.makeView(air, phase);
    const o = this.view;
    if (
      !force &&
      o.tuned === v.tuned &&
      o.ready === v.ready &&
      o.state === v.state &&
      o.air.key === v.air.key &&
      o.phase === v.phase &&
      o.label === v.label &&
      o.error === v.error &&
      o.notice === v.notice &&
      o.screen === v.screen &&
      o.near === v.near &&
      o.synced === v.synced &&
      o.trackError === v.trackError &&
      o.house?.label === v.house?.label &&
      o.house?.kind === v.house?.kind
    )
      return;
    this.view = v;
    for (const l of this.listeners) l();
  }

  labelFor(air: FmOnAir): string {
    const t = air.track;
    const h = this.houseNow;
    if (h !== null && (t === null || air.key === h.key))
      return `NOUN FM · house mix: ${this.houseLabel(h)}`;
    if (t === null) {
      const song = this.fallbackSong?.() ?? '';
      return `NOUN FM · pirate relay${song !== '' ? `: ${song}` : ''}`;
    }
    const who = air.set !== null ? `${air.set.dj}: ` : '';
    return `NOUN FM · ${who}${t.title.slice(0, 40)} — ${t.artist.slice(0, 24)}`;
  }

  /** Fresh label for what's on air right now (the radio chip / toast). */
  get label(): string {
    return this.labelFor(this.curAir);
  }

  // ── Wire ─────────────────────────────────────────────────────────────

  private send(m: Record<string, unknown>) {
    // The key rides on every message so the server can re-identify us
    // after it forgets the connection (restart / eviction)
    this.transport.send({ ...m, key: this.key });
  }

  private handle(m: Record<string, unknown>) {
    switch (m.type) {
      case 'fm:state': {
        const s = loadState(m.s);
        if (s === null) return;
        const now = Number(m.now);
        if (Number.isFinite(now)) this.clock.hint(now, Date.now());
        this.state = s;
        this.helloed = true;
        this.acc = 1; // re-evaluate on the next frame
        break;
      }
      case 'fm:pong': {
        const t = Number(m.t);
        const s = Number(m.s);
        if (Number.isFinite(t) && Number.isFinite(s))
          this.clock.add({ sent: t, received: Date.now(), server: s });
        break;
      }
      case 'fm:err':
        this.settle(String(m.op ?? ''), { ok: false, msg: String(m.msg ?? 'error').slice(0, 140) });
        this.error = { msg: String(m.msg ?? 'error').slice(0, 140), at: performance.now() };
        this.publish(this.view.air, this.view.phase, true);
        break;
      case 'fm:ok':
        this.settle(String(m.op ?? ''), { ok: true });
        this.error = null;
        this.notice = { msg: okText(String(m.op ?? '')), at: performance.now() };
        this.publish(this.view.air, this.view.phase, true);
        break;
      default:
        break;
    }
  }

  private wire(dt: number) {
    if (!this.transport.ready) {
      this.helloed = false;
      this.pings = 0;
      return;
    }
    if (!this.helloed && this.pingAt <= 0) {
      this.send({ type: 'fm:hello', key: this.key });
      this.pingAt = 2; // retry hello until a state comes back
    }
    this.pingAt -= dt;
    if (this.helloed && !this.transport.offline && this.pingAt <= 0) {
      this.send({ type: 'fm:ping', t: Date.now() });
      this.pings++;
      this.pingAt = this.pings < 4 ? 0.6 : 15;
    }
    if (this.transport.offline && this.helloed) this.pingAt = 1e9;
  }

  // ── Actions (panel) ──────────────────────────────────────────────────

  /** Look a pasted link up: validated source + title / artist / length where we can. */
  async inspect(url: string): Promise<FmInspect> {
    const c = classifyUrl(url);
    if (!c.ok) return c;
    const src = c.src;
    try {
      if (src.kind === 'youtube') return { ok: true, preview: src };
      if (src.kind === 'audius') {
        const a = await resolveAudius(src.url);
        return {
          ok: true,
          track: { src: { ...src, id: a.id }, title: a.title, artist: a.artist, dur: a.dur },
        };
      }
      const dur = await probeDuration(src.url);
      if (dur <= 0) return { ok: false, reason: "couldn't read that file's length" };
      const file = decodeURIComponent(src.url.split('/').pop() ?? 'track').replace(/\.\w+$/, '');
      return { ok: true, track: { src, title: file.slice(0, 80), artist: 'direct', dur } };
    } catch (e) {
      return { ok: false, reason: (e as Error).message || 'lookup failed' };
    }
  }

  add(track: FmTrack, by: string) {
    this.send({ type: 'fm:add', track, by });
  }

  remove(id: string) {
    this.send({ type: 'fm:remove', id });
  }

  move(id: string, dir: -1 | 1) {
    this.send({ type: 'fm:move', id, dir });
  }

  skip(token?: string) {
    this.send({ type: 'fm:skip', ...(token !== undefined && token !== '' ? { token } : {}) });
  }

  /** Book (or replace) your set; resolves with the station's answer. */
  bookSet(dj: string, name: string, startAt: number, tracks: FmTrack[]): Promise<FmResult> {
    const r = this.wait('fm:set');
    this.send({ type: 'fm:set', dj, name, startAt, tracks });
    return r;
  }

  /** The private rider key, for the set library (it stores only the public tag). */
  libraryKey(): string {
    return this.key;
  }

  private wait(op: string, ms = 8000): Promise<FmResult> {
    return new Promise(resolve => {
      const w = {
        op,
        done: (r: FmResult) => {
          clearTimeout(timer);
          resolve(r);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(x => x !== w);
        resolve({ ok: false, msg: 'no answer from the station, try again' });
      }, ms);
      this.waiters.push(w);
    });
  }

  private settle(op: string, r: FmResult) {
    const i = this.waiters.findIndex(w => w.op === op);
    if (i < 0) return;
    const [w] = this.waiters.splice(i, 1);
    w!.done(r);
  }

  cancelSet(id: string, token?: string) {
    this.send({ type: 'fm:unset', id, ...(token !== undefined && token !== '' ? { token } : {}) });
  }

  /** Server time now (ms). */
  serverNow(): number {
    return this.clock.serverNow(Date.now());
  }

  // ── Radio integration ────────────────────────────────────────────────

  setTuned(on: boolean) {
    this.tuned = on;
    if (on) this.screenDismissedFor = null;
    this.acc = 1;
    this.publish(this.view.air, this.view.phase);
  }

  /** "Next track" while tuned: skip your own track, or the fallback's song. */
  next() {
    const air = this.view.air;
    if (air.source === 'fallback') this.onFallbackNext?.();
    else if (air.source === 'queue' && air.track?.owner === this.myTag) this.skip();
    else {
      this.error = { msg: 'only whoever queued a track can skip it', at: performance.now() };
      this.publish(air, this.view.phase, true);
    }
  }

  /** Close the YouTube deck screen: that video stops for you until the next track. */
  dismissScreen() {
    this.screenDismissedFor = this.view.air.key;
    this.yt.stop();
    this.publish(this.view.air, this.view.phase);
  }

  /** The world is hidden (paused under the desk / tab in the background): YouTube pauses. */
  setHidden(h: boolean) {
    if (this.hidden === h) return;
    this.hidden = h;
    if (h) this.yt.pause();
    else this.yt.videoId = ''; // reload at the live position when we're back
    this.publish(this.view.air, this.view.phase);
  }

  private onVisibility = () => this.setHidden(document.visibilityState === 'hidden');

  // ── Audio graph ──────────────────────────────────────────────────────

  attach(ctx: AudioContext, destination: AudioNode, noise: AudioBuffer | null) {
    if (this.ctx !== null) return;
    this.ctx = ctx;
    this.noise = noise;
    this.bus = ctx.createGain();
    this.music = ctx.createGain();
    this.music.connect(this.bus);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.wave = new Uint8Array(this.analyser.fftSize);
    this.bus.connect(this.analyser);
    this.direct = ctx.createGain();
    this.direct.gain.value = 0;
    this.bus.connect(this.direct).connect(destination);
    this.panner = ctx.createPanner();
    this.panner.panningModel = 'equalpower';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 3;
    this.panner.rolloffFactor = 1.3;
    this.panner.maxDistance = 80;
    this.spatial = ctx.createGain();
    this.spatial.gain.value = 0;
    this.bus.connect(this.panner).connect(this.spatial).connect(destination);
    void loadFmManifests().then(m => {
      this.interludes = m.interludes;
      this.songs = m.songs;
      this.houseKey = ''; // rebuild with the songs
      // stings are tiny: decode them all up front so a gap never waits
      void Promise.all(m.interludes.map(i => loadBuffer(ctx, i.sting))).then(b => {
        this.stings = b;
      });
    });
  }

  /** The owner's recordings (for the intro / panel). */
  get recordings(): { interludes: Interlude[]; songs: HouseSong[] } {
    return { interludes: this.interludes, songs: this.songs };
  }

  // ── House programme ──────────────────────────────────────────────────

  /** Refresh the library (every 30 min) and the alert line (every 10 min). */
  private refreshHouse() {
    if (this.time - this.libAt > 1800) {
      this.libAt = this.time;
      void fetchLibrary().then(r => {
        if (r.ok) {
          this.libSets = r.sets;
          this.houseKey = '';
        }
      });
    }
    if (this.time - this.djAt > 600) {
      this.djAt = this.time;
      void getDjUpdate().then(d => {
        if (d !== null) this.alertLine = d.alert;
      });
    }
  }

  private houseCatalog(day: number): HouseCatalog {
    return {
      owner: this.songs.map(s => ({
        src: { kind: 'direct' as const, url: s.url },
        title: s.title,
        artist: s.artist,
        dur: s.dur,
        origin: 'owner' as const,
      })),
      library: libraryTracks(this.libSets, day),
      breaks: this.interludes.map(i => i.fullDur),
    };
  }

  /** Today's programme (rebuilt at midnight UTC or when the catalogue changes). */
  private houseItemsFor(now: number): HouseItem[] {
    const day = dayStart(now);
    const cat = this.houseCatalog(day);
    const key = `${day}|${catalogPrint(normCatalog(cat))}`;
    if (key !== this.houseKey) {
      this.houseKey = key;
      this.houseItems = houseDay(cat, day);
    }
    return this.houseItems;
  }

  private houseLabel(it: HouseItem): string {
    if (it.kind === 'break')
      return it.brk.type === 'alert'
        ? '⚠ WORLDWIDE ALERT'
        : (this.interludes[it.brk.index]?.title ?? 'Noun F-M');
    const t = it.track;
    const from = t.dj !== undefined ? ` (from ${t.dj}'s set)` : '';
    return `${t.title.slice(0, 40)} — ${t.artist.slice(0, 24)}${from}`;
  }

  private stopBreak() {
    this.breakStop?.();
    this.breakStop = null;
  }

  /** A house break: a full Noun F-M jingle, or a WORLDWIDE ALERT (sting + the DJ's line). */
  private playBreak(it: HouseItem & { kind: 'break' }, now: number) {
    const ctx = this.ctx;
    const bus = this.bus;
    if (ctx === null || bus === null) return;
    const into = Math.max(0, (now - it.at) / 1000);
    const alert = it.brk.type === 'alert' && this.alertLine !== '';
    const tag = alert ? '⚠ WORLDWIDE ALERT' : '📻 NOUN FM';
    const text = alert ? this.alertLine : this.houseLabel(it);
    this.onBreak?.(tag, text);
    if (!alert) {
      // (an alert with no news to read plays a jingle instead)
      const n = this.interludes.length;
      if (n === 0) return;
      const idx = it.brk.type === 'interlude' ? it.brk.index % n : 0;
      const il = this.interludes[idx]!;
      let stopped = false;
      let h: { stop: (f?: number) => void } | null = null;
      this.breakStop = () => {
        stopped = true;
        h?.stop(0.3);
      };
      void loadBuffer(ctx, il.full).then(b => {
        if (b !== null && !stopped) h = playBuffer(ctx, bus, b, { gain: 0.9, offset: into });
      });
      this.identUntil = this.time + il.fullDur - into;
      return;
    }
    if (into > 3) return; // joined mid-alert: just the toast
    const sting = alertSting(ctx, bus, ctx.currentTime + 0.05);
    const signal = { cancelled: false };
    this.breakStop = () => {
      signal.cancelled = true;
    };
    setTimeout(() => {
      if (signal.cancelled || this.ctx === null || this.bus === null) return;
      const c = this.ctx;
      const b = this.bus;
      if (this.tuned)
        void speakDj(this.alertLine, {
          volume: this.volume * this.extGain,
          urgent: true,
          signal,
        }).then(ok => {
          if (!ok && !signal.cancelled) talkbox(c, b, c.currentTime + 0.05, 1.1);
        });
      else talkbox(c, b, c.currentTime + 0.05, 1.1);
    }, sting * 1000);
    this.identUntil = this.time + sting + 4;
  }

  private set(p: AudioParam | undefined, v: number, tc = 0.2) {
    if (p === undefined || this.ctx === null) return;
    p.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  private placeListener(pos: THREE.Vector3, fwd: THREE.Vector3) {
    const ctx = this.ctx;
    if (ctx === null || this.panner === null || this.vanPos === null) return;
    const l = ctx.listener;
    const v = this.vanPos;
    if (l.positionX !== undefined) {
      const t = ctx.currentTime;
      l.positionX.setTargetAtTime(pos.x, t, 0.05);
      l.positionY.setTargetAtTime(pos.y, t, 0.05);
      l.positionZ.setTargetAtTime(pos.z, t, 0.05);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.05);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.05);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.05);
      this.panner.positionX.value = v.x;
      this.panner.positionY.value = v.y;
      this.panner.positionZ.value = v.z;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
      this.panner.setPosition(v.x, v.y, v.z);
    }
  }

  // ── Media ────────────────────────────────────────────────────────────

  private dropEl() {
    const el = this.el;
    if (el !== null) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.elSrc?.disconnect();
    this.el = null;
    this.elSrc = null;
    this.elRouted = false;
    this.playing = null;
  }

  private stopMedia() {
    this.dropEl();
    if (this.yt.videoId !== '') this.yt.stop();
    this.mediaKey = '';
    this.trackError = null;
  }

  private makeEl(url: string, key: string, cors: boolean) {
    const el = new Audio();
    el.preload = 'auto';
    if (cors) el.crossOrigin = 'anonymous';
    el.addEventListener('error', () => {
      if (this.el !== el) return;
      this.dropEl();
      // No CORS on that host: play it straight (no spatial / analyser)
      if (cors) this.makeEl(url, key, false);
      else this.trackError = "couldn't load this track";
    });
    el.src = url;
    this.el = el;
    if (cors && this.ctx !== null && this.music !== null) {
      try {
        this.elSrc = this.ctx.createMediaElementSource(el);
        this.elSrc.connect(this.music);
        this.elRouted = true;
      } catch {
        this.elRouted = false;
      }
    }
  }

  private prepare(src: FmSrc, key: string) {
    this.mediaKey = key;
    this.trackError = null;
    if (src.kind === 'youtube') return;
    if (src.kind === 'direct') {
      this.makeEl(src.url, key, true);
      return;
    }
    void audiusHost()
      .then(host => {
        if (this.mediaKey === key) this.makeEl(audiusStreamUrl(host, src.id), key, true);
      })
      .catch(() => {
        if (this.mediaKey === key) this.trackError = 'Audius is unreachable';
      });
  }

  private ident(key: string) {
    if (this.ctx === null || this.bus === null || this.noise === null) return;
    const pick = pickGapSound(key, this.interludes.length);
    const buf = pick.kind === 'file' ? this.stings[pick.index] : null;
    if (pick.kind === 'file' && buf !== undefined && buf !== null) {
      const h = playBuffer(this.ctx, this.bus, buf, { gain: 0.9 });
      this.identUntil = this.time + h.seconds;
      this.lastGap = { kind: 'file', id: this.interludes[pick.index]?.id ?? '', key };
      return;
    }
    this.lastGap = { kind: 'synth', id: '', key };
    const r = playIdent(this.ctx, this.bus, this.noise, key, {
      speech: this.tuned,
      volume: this.volume * this.extGain,
    });
    this.identUntil = this.time + r.seconds;
  }

  // ── Frame ────────────────────────────────────────────────────────────

  update(dt: number, listener: THREE.Vector3, fwd: THREE.Vector3) {
    this.time += dt;
    this.updateLevel(dt);
    this.placeListener(listener, fwd);
    this.acc += dt;
    if (this.acc < 0.1) return;
    const step = Math.min(1, this.acc);
    this.acc = 0;
    this.wire(step);

    const dist = this.vanPos !== null ? listener.distanceTo(this.vanPos) : Infinity;
    this.near = dist < FM_NEAR;
    const audible = (this.tuned || this.near) && !this.hold;
    const now = this.clock.serverNow(Date.now());
    let air = OFF_AIR;
    if (this.state !== null) {
      advance(this.state, now);
      air = onAir(this.state, now);
    }
    // Nothing queued, no set on: the house programme
    this.refreshHouse();
    const house = houseSlot(air.track !== null, this.houseItemsFor(now), now);
    this.houseNow = house;
    if (house !== null && house.kind === 'song')
      air = {
        source: 'fallback',
        key: house.key,
        track: house.track,
        startAt: house.startAt,
        endAt: house.endAt,
        set: null,
      };
    const brk = house !== null && house.kind === 'break' ? house : null;
    if (brk === null || !audible) {
      if (this.breakKey !== '') {
        this.stopBreak();
        this.breakKey = '';
      }
    } else if (this.breakKey !== brk.key) {
      this.stopBreak();
      this.breakKey = brk.key;
      this.playBreak(brk, now);
    }
    this.live = air.track !== null;
    this.curAir = air;

    if (air.key !== this.airKey) {
      this.airKey = air.key;
      this.screenDismissedFor = null;
      if (air.track !== null && audible) this.onTrackChange?.(this.labelFor(air), this.tuned);
    }

    // the pirate generator only when the house has nothing at all
    const fb = this.tuned && air.track === null && house === null && !this.hold;
    if (fb !== this.fbOn) {
      this.fbOn = fb;
      this.onFallback?.(fb);
    }

    let phase: FmView['phase'] = brk !== null ? 'break' : this.tuned ? 'fallback' : 'off';
    const tr = air.track;
    if (!audible || tr === null) {
      if (this.mediaKey !== '') this.stopMedia();
    } else {
      if (this.mediaKey !== air.key) {
        this.stopMedia();
        this.prepare(tr.src, air.key);
      }
      const inIdent = now < air.startAt;
      phase = inIdent ? 'ident' : 'track';
      if (this.identKey !== air.key) {
        this.identKey = air.key;
        // only a fresh gap: joining mid-song goes straight to the music
        if (inIdent && air.startAt - now > 1500) this.ident(air.key);
      }
      this.drive(tr.src, air, now, dist);
    }
    // routing: tuned = straight to the mix, near = out of the van's speakers
    const g = this.volume;
    this.set(this.direct?.gain, this.tuned ? g : 0, 0.25);
    this.set(this.spatial?.gain, !this.tuned && this.near ? g * 1.4 : 0, 0.25);
    this.publish(air, phase);
  }

  /** Fade in after the ident, out over the last second and a half. */
  private fade(air: FmOnAir, now: number): number {
    const into = (now - air.startAt) / 400;
    // a house cut-off drops out fast (the tape-stop does the rest)
    const left = (air.endAt - now) / (this.cutting(air) ? 450 : 1500);
    return Math.max(0, Math.min(1, into, left));
  }

  /** This play is a house song cut short. */
  private cutting(air: FmOnAir): boolean {
    const h = this.houseNow;
    return h !== null && h.kind === 'song' && h.cut && h.key === air.key;
  }

  private distGain(dist: number): number {
    if (this.tuned) return 1;
    const k = Math.max(0, Math.min(1, 1 - (dist - 3) / (FM_NEAR - 3)));
    return k * k;
  }

  private drive(src: FmSrc, air: FmOnAir, now: number, dist: number) {
    const before = now < air.startAt;
    const exp = Math.max(0, expectedPosition(air.startAt, now));
    const fade = before ? 0 : this.fade(air, now);
    if (src.kind === 'youtube') {
      if (!this.view.screen || this.hidden) return; // no screen, no YouTube
      if (!this.yt.mounted) return; // React mounts it next frame
      if (this.yt.error !== null) {
        this.trackError =
          this.yt.error === 101 || this.yt.error === 150
            ? "this video's owner doesn't allow embedding"
            : "YouTube couldn't play this one";
        return;
      }
      if (this.yt.videoId !== src.id) {
        if (this.yt.play(src.id, exp, before)) this.lastSeekAt = this.time;
      } else if (!before) {
        const st = this.yt.state;
        if (st === 5) this.yt.play(src.id, exp); // cued during the ident: go
        const seek = youTubeDriftFix(
          exp,
          this.yt.time,
          this.time - this.lastSeekAt,
          st === YT_PLAYING,
        );
        if (seek !== null) {
          this.yt.seek(seek);
          this.lastSeekAt = this.time;
        }
      }
      this.yt.setVolume(this.volume * this.extGain * fade * this.distGain(dist) * 1.3);
      return;
    }
    const el = this.el;
    if (el === null) return;
    this.set(this.music?.gain, fade, 0.08);
    el.volume = this.elRouted
      ? 1
      : Math.min(1, this.volume * this.extGain * 1.4 * fade * this.distGain(dist));
    if (before || el.readyState < 1) return;
    if (exp > (Number.isFinite(el.duration) ? el.duration : FM_MAX_TRACK_S)) return;
    if (el.paused) {
      if (this.playing !== null) return;
      if (seekable(el, exp)) el.currentTime = exp;
      el.playbackRate = 1;
      const p = el.play();
      this.playing = p;
      p.then(
        () => {
          if (this.playing === p) this.playing = null;
        },
        () => {
          // autoplay blocked: the next gesture (unlockAudio) lets the next try through
          if (this.playing === p) this.playing = null;
        },
      );
      return;
    }
    // house cut-off: a tape-stop over the last 0.7 s
    const left = air.endAt - now;
    if (this.cutting(air) && left < 700) {
      el.preservesPitch = false;
      el.playbackRate = Math.max(0.25, left / 700);
      return;
    }
    const fix = audioDriftFix(exp, el.currentTime);
    // (a host without byte ranges can't seek: let it play rather than thrash)
    if (fix.seek !== null && seekable(el, fix.seek)) el.currentTime = fix.seek;
    el.playbackRate = fix.rate;
  }

  private updateLevel(dt: number) {
    let target = 0.05;
    const measurable = this.analyser !== null && this.wave !== null;
    const routedNow =
      (this.elRouted && this.el !== null && !this.el.paused) || this.time < this.identUntil;
    if (measurable && routedNow) {
      this.analyser!.getByteTimeDomainData(this.wave!);
      let sum = 0;
      for (const v of this.wave!) {
        const x = (v - 128) / 128;
        sum += x * x;
      }
      target = Math.min(1, Math.sqrt(sum / this.wave!.length) * 4.5);
    } else if (this.live) {
      // can't hear inside the YouTube iframe or a no-CORS file: a 120 bpm pump
      const ph = (this.time * 2) % 1;
      target = 0.25 + 0.75 * Math.pow(1 - ph, 3);
    } else if (this.fbOn) target = 0.2 + 0.15 * Math.sin(this.time * 3);
    this.level += (target - this.level) * Math.min(1, dt * 20);
  }

  dispose() {
    this.stopMedia();
    this.yt.unmount();
    this.transport.dispose();
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', this.onVisibility);
    this.listeners.clear();
  }
}

function seekable(el: HTMLMediaElement, t: number): boolean {
  const r = el.seekable;
  for (let i = 0; i < r.length; i++) if (t >= r.start(i) && t <= r.end(i)) return true;
  return false;
}

function okText(op: string): string {
  switch (op) {
    case 'fm:add':
      return 'queued on NOUN FM';
    case 'fm:remove':
      return 'removed';
    case 'fm:move':
      return 'moved';
    case 'fm:skip':
      return 'skipped';
    case 'fm:set':
      return 'your set is booked';
    case 'fm:unset':
      return 'set cancelled';
    default:
      return 'done';
  }
}

export { FM_GAP_MS };
