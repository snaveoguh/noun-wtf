// ── NOUN TAXI chatter at runtime: who's talking, the voice, the radio ─────
//
// `game.taxi.chatter`. While someone's in a cab with you (a fare or a
// hitchhiker you drive, or the cabbie of a cab you hired) they never stop
// talking: ChatterGen writes the lines (never the same twice a session),
// this speaks them one after another with a breath between, and holds:
//   • while the radio's on (COMMUNITY RADIO, NOUN BEATS, a stream, or the
//     site's NOUN FM player), picking up a beat after it goes off;
//   • while muted (the cab HUD's 🗣 button, remembered);
//   • while an event line ("WOOO!", "OW!") is said: event() cuts the line
//     short, says the shout in the same voice, then the chatter resumes.
//
// Voice (rules.voicePlan): the house Piper voice, tuned per speaker
// (houseTuning). Desktop with real voices on borrows the game's engine;
// touch / auto loads a private copy for the ride and frees it
// RELEASE_AFTER_S after the last cab (terminating the worker frees the model
// and its WASM heap). Each next line is synthesized in the background while
// the current one plays, and its audio is dropped from the engine's cache
// once played (TtsEngine.forget). Until the house is ready, or where it
// can't load, lines go to VoiceBox with the Noun's seed voice (stock real
// voice where on, else babble).

import type { Persona, Role } from './bank';
import type { ChatContext, ChatLine, ChatPlace, StuntTally, Tod } from './generator';
import type { ChatGate, VoiceLoad, VoicePlanIn, VoiceStatus } from './rules';
import type { TtsEngine } from '../../audio/voice/TtsEngine';
import type { VoiceHandle, VoiceLine } from '../../audio/voice/VoiceBox';

import { seedVoice } from '../../audio/voice/cast';
import { HOUSE_VOICE, hyped, type TtsVoice } from '../../audio/voice/ttsVoice';

import { ChatterGen, EMPTY_TALLY, sessionSeed, spokenName } from './generator';
import { cleanLines, LLM_BATCH, LLM_PATH, type LlmAsk } from './llm';
import {
  FIRST_LINE_S,
  gapAfter,
  gate,
  houseTuning,
  readMuted,
  RELEASE_AFTER_S,
  RESUME_S,
  spokenSeconds,
  SYNTH_WAIT_S,
  voicePlan,
  voiceStatus,
  writeMuted,
} from './rules';

export interface ChatterStart {
  speaker: Role;
  /** Their Noun seed [background, body, accessory, head, glasses] (voice + persona). */
  seed: readonly number[];
  /** Shown over their lines. */
  name?: string;
  /** Where the ride's going (registry names like "DRY GULCH" are fine). */
  dest?: string | null;
  /** Live ride info, asked before each line (overrides `dest`). */
  context?: () => Partial<{ dest: string | null; kmh: number }>;
}

export interface ChatterUi {
  name: string;
  role: Role;
  /** The line being said (null between lines). */
  text: string | null;
  at: number;
  state: ChatGate;
  voice: VoiceStatus;
  muted: boolean;
}

export interface ChatterHost {
  speak(line: VoiceLine): VoiceHandle;
  audioCtx(): AudioContext | null;
  /** The game's house engine (starts it loading; null until ready). */
  sharedHouse(): TtsEngine | null;
  /** A private house engine (not loaded yet). */
  makeHouse(): TtsEngine;
  plan(): Omit<VoicePlanIn, 'houseFailed'>;
  radioOn(): boolean;
  places(): readonly ChatPlace[];
  tod(): Tod;
  /** Seconds (any monotonic clock). */
  now(): number;
  get(k: string): string | null;
  set(k: string, v: string): void;
  /** Optional LLM batches (llm.ts); null = off. */
  fetchLines?: ((ask: LlmAsk) => Promise<string[] | null>) | null;
}

interface Speaker {
  role: Role;
  name: string;
  seed: readonly number[];
  tts: TtsVoice;
  shout: TtsVoice;
  start: ChatterStart;
}

interface Current {
  line: ChatLine;
  h: VoiceHandle;
  /** host.now() when it was issued, and our estimate of its length (s). */
  at: number;
  est: number;
  /** Spoken by the house engine (forget its audio when done). */
  eng: TtsEngine | null;
}

const ctxNow = (c: AudioContext | null) => (c !== null ? c.currentTime : null);

export class ChatterSystem {
  readonly gen: ChatterGen;
  /** Dev / browser checks. */
  readonly log = {
    lines: 0,
    house: 0,
    fallback: 0,
    events: 0,
    llm: 0,
    held: { radio: 0, muted: 0 } as Record<string, number>,
    last: '',
    transcript: [] as string[],
  };
  ui: ChatterUi | null = null;
  private sp: Speaker | null = null;
  private active = false;
  private muted_: boolean;
  private cur: Current | null = null;
  private queued: { line: ChatLine; asked: number } | null = null;
  private nextAt = 0;
  private eventUntil = 0;
  private lastGate: ChatGate = 'off';
  private stunts: StuntTally = { ...EMPTY_TALLY };
  private kmh = 0;
  private load: VoiceLoad = 'none';
  private priv: TtsEngine | null = null;
  private releaseAt = Infinity;
  private houseFailed = false;
  private placesAt = -Infinity;
  private placesCache: readonly ChatPlace[] = [];
  private llmQueue: string[] = [];
  private llmBusy = false;
  private llmOffUntil = 0;
  private n = 0;
  private r = Math.random;
  private listeners = new Set<() => void>();

  constructor(
    private host: ChatterHost,
    seed = sessionSeed(),
  ) {
    this.gen = new ChatterGen(seed);
    this.muted_ = readMuted(k => host.get(k));
  }

  get muted(): boolean {
    return this.muted_;
  }

  get talking(): boolean {
    return this.active;
  }

  /** Engine state, for dev checks: which load, and whether a private copy is held. */
  get voiceLoad(): { load: VoiceLoad; private: boolean; ready: boolean } {
    const e = this.engine();
    return { load: this.load, private: this.priv !== null, ready: e?.ready === true };
  }

  setMuted(m: boolean) {
    this.muted_ = m;
    writeMuted((k, v) => this.host.set(k, v), m);
    if (m) this.hush();
    this.push();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Someone starts talking (a new passenger, or the cabbie of a hired cab). */
  start(s: ChatterStart) {
    const seed = s.seed.length > 0 ? s.seed : [0];
    const t = houseTuning(seed, s.speaker);
    const tts: TtsVoice = { ...HOUSE_VOICE, pitch: t.pitch, rate: t.rate, gap: 0.45 };
    this.hush();
    this.forgetQueued();
    this.sp = {
      role: s.speaker,
      name: s.name ?? (s.speaker === 'cabbie' ? 'CABBIE' : 'PASSENGER'),
      seed,
      tts,
      shout: hyped(tts, 1.08),
      start: s,
    };
    this.gen.cast({ role: s.speaker, name: spokenName(this.sp.name), seed });
    this.active = true;
    this.stunts = { ...EMPTY_TALLY };
    this.llmQueue = [];
    this.n = 0;
    this.nextAt = this.host.now() + FIRST_LINE_S;
    this.releaseAt = Infinity;
    this.lease();
    this.push();
  }

  /** They've gone quiet (got out, the ride's over). */
  stop() {
    if (!this.active) return;
    this.active = false;
    this.hush();
    this.forgetQueued();
    this.sp = null;
    this.ui = null;
    if (this.priv !== null) this.releaseAt = this.host.now() + RELEASE_AFTER_S;
    this.push();
  }

  /** A stunt happened (TaxiSystem): the next line may well be about it. */
  note(stunt: 'air' | 'drift' | 'nearMiss' | 'crash') {
    this.stunts[stunt]++;
  }

  /**
   * An event line (lines.ts) is being said by the person who's talking:
   * cut the current line, say it in their voice. Returns false when the
   * chatter isn't running (the caller voices it the old way).
   */
  event(text: string): boolean {
    if (!this.active || this.sp === null) return false;
    this.log.events++;
    this.cur?.h.stop();
    this.finish(true);
    if (this.muted_) return true;
    const eng = this.engine();
    this.host.speak({
      text,
      voice: seedVoice(this.seedLike()),
      tts: eng !== null ? this.sp.shout : undefined,
      engine: eng ?? undefined,
      gain: 0.95,
    });
    // shouts are short; allow for a synthesis on the house voice
    this.eventUntil = this.host.now() + spokenSeconds(text) + (eng !== null ? 0.9 : 0.2);
    this.nextAt = Math.max(this.nextAt, this.eventUntil + RESUME_S);
    return true;
  }

  /** Every frame (TaxiSystem.update). */
  tick() {
    const now = this.host.now();
    if (!this.active || this.sp === null) {
      if (this.priv !== null && now >= this.releaseAt) this.release();
      return;
    }
    const g = gate({
      active: this.active,
      muted: this.muted_,
      radioOn: this.host.radioOn(),
      eventLeft: this.eventUntil - now,
    });
    if (g !== this.lastGate) {
      if (g === 'muted' || g === 'radio') {
        this.hush();
        this.log.held[g] = (this.log.held[g] ?? 0) + 1;
      }
      if (g === 'talk' && this.lastGate !== 'event')
        this.nextAt = Math.max(this.nextAt, now + RESUME_S);
      this.lastGate = g;
      this.push();
    }
    if (g !== 'talk') return;

    const eng = this.engine();
    if (this.cur !== null) {
      if (!this.done(this.cur, now)) return;
      const dur = now - this.cur.at;
      this.finish(false);
      this.nextAt = now + gapAfter(dur, this.n, this.r());
      this.push();
    }
    this.queued ??= this.make();
    const q = this.queued;
    if (q === null) return;
    // synthesize the next line while waiting / while this one plays
    if (eng !== null && q.asked < 0) {
      const ctx = this.host.audioCtx();
      if (ctx !== null) {
        void eng.synth(ctx, q.line.text, this.sp.tts, 'bg');
        q.asked = now;
      }
    }
    if (now < this.nextAt) return;
    if (eng !== null && q.asked >= 0 && eng.peek(q.line.text, this.sp.tts) === null) {
      if (now - q.asked < SYNTH_WAIT_S) return;
    }
    this.say(q.line, eng);
    this.queued = null;
  }

  dispose() {
    this.stop();
    this.release();
    this.listeners.clear();
  }

  // ── internals ──

  private seedLike() {
    const s = this.sp?.seed ?? [0];
    return {
      background: s[0] ?? 0,
      body: s[1] ?? 0,
      accessory: s[2] ?? 0,
      head: s[3] ?? 0,
      glasses: s[4] ?? 0,
    };
  }

  /** Decide the voice for this ride, and start the house loading if we're using it. */
  private lease() {
    this.load = voicePlan({ ...this.host.plan(), houseFailed: this.houseFailed });
    if (this.load === 'private') {
      this.priv ??= this.host.makeHouse();
      this.priv.load();
    }
    if (this.load === 'shared') this.host.sharedHouse();
  }

  /** The ready house engine, or null (loading, failed, not used). */
  private engine(): TtsEngine | null {
    if (this.load === 'shared') return this.host.sharedHouse();
    if (this.load === 'private' && this.priv !== null) {
      if (this.priv.status.state === 'failed') {
        this.houseFailed = true;
        this.load = 'none';
        this.release();
        this.push();
        return null;
      }
      return this.priv.ready ? this.priv : null;
    }
    return null;
  }

  private release() {
    if (this.priv === null) return;
    this.priv.dispose();
    this.priv = null;
    this.releaseAt = Infinity;
    if (this.load === 'private' && !this.active) this.load = 'none';
  }

  private context(): ChatContext {
    const now = this.host.now();
    if (now - this.placesAt > 10) {
      this.placesAt = now;
      this.placesCache = this.host.places();
    }
    const live = this.sp?.start.context?.() ?? {};
    if (live.kmh !== undefined) this.kmh = live.kmh;
    const destRaw = live.dest !== undefined ? live.dest : (this.sp?.start.dest ?? null);
    return {
      dest: destRaw === null || destRaw === undefined ? null : spokenName(destRaw),
      tod: this.host.tod(),
      kmh: this.kmh,
      stunts: this.stunts,
      places: this.placesCache,
    };
  }

  private make(): { line: ChatLine; asked: number } | null {
    if (this.sp === null) return null;
    const ctx = this.context();
    this.askLlm(ctx);
    let line: ChatLine | null = null;
    // an LLM line, if there's one waiting (driving banter stays ours: it's about now)
    const stunted = ctx.stunts.air + ctx.stunts.drift + ctx.stunts.nearMiss + ctx.stunts.crash > 0;
    while (!stunted && line === null && this.llmQueue.length > 0) {
      const t = this.llmQueue.shift()!;
      if (this.gen.hasSaid(t)) continue;
      this.gen.markSaid(t);
      line = {
        id: -1,
        text: t,
        topic: 'story',
        role: this.sp.role,
        persona: this.gen.persona,
        refs: [],
      };
      this.log.llm++;
    }
    line ??= this.gen.next(ctx);
    if (line === null) return null;
    if (line.topic === 'drive') this.stunts = { ...EMPTY_TALLY };
    return { line, asked: -1 };
  }

  private askLlm(ctx: ChatContext) {
    const f = this.host.fetchLines;
    const sp = this.sp;
    if (f === undefined || f === null || sp === null) return;
    const now = this.host.now();
    if (this.llmBusy || this.llmQueue.length > 1 || now < this.llmOffUntil) return;
    this.llmBusy = true;
    const ask: LlmAsk = {
      role: sp.role,
      persona: this.gen.persona as Persona,
      name: spokenName(sp.name),
      dest: ctx.dest,
      tod: ctx.tod,
      places: ctx.places.filter(p => p.kind !== 'door').map(p => p.name),
      recent: this.log.transcript.slice(-6).map(l => l.replace(/^[^:]*: /, '')),
    };
    void f(ask)
      .then(lines => {
        if (lines === null) {
          this.llmOffUntil = Infinity; // off on the server: stop asking
          return;
        }
        const ok = cleanLines(lines, t => this.gen.hasSaid(t)).slice(0, LLM_BATCH);
        if (ok.length === 0) this.llmOffUntil = this.host.now() + 60;
        if (this.sp === sp) this.llmQueue.push(...ok);
      })
      .catch(() => {
        this.llmOffUntil = this.host.now() + 60;
      })
      .finally(() => {
        this.llmBusy = false;
      });
  }

  private say(line: ChatLine, eng: TtsEngine | null) {
    const sp = this.sp!;
    const h = this.host.speak({
      text: line.text,
      voice: seedVoice(this.seedLike()),
      tts: eng !== null ? sp.tts : undefined,
      engine: eng ?? undefined,
      gain: 0.85,
    });
    const now = this.host.now();
    this.cur = { line, h, at: now, est: spokenSeconds(line.text), eng };
    this.n++;
    this.log.lines++;
    if (eng !== null) this.log.house++;
    else this.log.fallback++;
    this.log.last = line.text;
    this.log.transcript.push(`${spokenName(sp.name)}: ${line.text}`);
    if (this.log.transcript.length > 400) this.log.transcript.splice(0, 100);
    this.push(line.text);
  }

  /** Whether the line's audio has finished. */
  private done(c: Current, now: number): boolean {
    const h = c.h;
    const t = ctxNow(this.host.audioCtx());
    if (h.startedAt === null || t === null) return now - c.at >= c.est;
    // still waiting for VoiceBox's synthesis (it babbles after 2.2 s anyway)
    if (!Number.isFinite(h.startedAt)) return now - c.at >= c.est + 6;
    return t >= h.startedAt + h.plan.total * h.stretch + 0.05;
  }

  /** The current line's over (or cut): free its audio from the engine's cache. */
  private finish(cut: boolean) {
    const c = this.cur;
    if (c === null) return;
    this.cur = null;
    if (cut) c.h.stop();
    if (c.eng !== null && this.sp !== null) c.eng.forget(c.line.text, this.sp.tts);
    if (this.ui !== null) this.push(null);
  }

  private hush() {
    if (this.cur !== null) this.finish(true);
  }

  /** Drop the pre-synthesized next line (its audio would never be played). */
  private forgetQueued() {
    const q = this.queued;
    this.queued = null;
    if (q === null || this.sp === null) return;
    const eng = this.engine();
    eng?.forget(q.line.text, this.sp.tts);
  }

  private push(text?: string | null) {
    const sp = this.sp;
    if (!this.active || sp === null) {
      if (this.ui !== null) this.ui = null;
    } else {
      const eng = this.load === 'none' ? null : this.engine();
      this.ui = {
        name: sp.name,
        role: sp.role,
        text: text === undefined ? (this.ui?.text ?? null) : text,
        at: text === undefined ? (this.ui?.at ?? 0) : performance.now(),
        state: gate({
          active: true,
          muted: this.muted_,
          radioOn: this.host.radioOn(),
          eventLeft: this.eventUntil - this.host.now(),
        }),
        voice: voiceStatus(this.load, eng !== null),
        muted: this.muted_,
      };
    }
    for (const fn of this.listeners) fn();
  }
}

/** The LLM fetcher for the browser: null on a 404 (off on the server). */
export async function fetchLlmLines(ask: LlmAsk): Promise<string[] | null> {
  const res = await fetch(LLM_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ask),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(String(res.status));
  const v = (await res.json()) as { lines?: unknown };
  return Array.isArray(v.lines) ? v.lines.filter((x): x is string => typeof x === 'string') : [];
}
