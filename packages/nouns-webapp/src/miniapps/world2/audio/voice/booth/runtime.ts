// ── Voice Booth in game: the player's own voice + everyone else's ─────────
//
// Owned by Game. Three jobs:
//   own     the rider's OwnVoice (RiderVoice.ts): decoded recordings from
//           myVoice, and the player's own trained model engine (a second
//           TtsEngine that loads the .onnx from IndexedDB) when "use my
//           voice model" is on. A model that fails to load just leaves the
//           stock seed voice in charge.
//   remote  other riders' callouts and voiced chat: fetched lazily from the
//           world-voice function, cached, played panned by where they are.
//           "Hear other players' voices" off, or a muted / reported player,
//           falls back to their stock TTS voice for callouts (silence for chat).
//   chat    the player's own typed chat in their model voice, played from
//           their rider, and (with "let other players hear my voice") recorded
//           to a short clip and uploaded for others.

import type { OwnVoice } from '../RiderVoice';
import type { ClipPlay, VoiceBox } from '../VoiceBox';

import { settings } from '../../../settings/store';
import { defaultWorker, TtsEngine } from '../TtsEngine';
import { MODEL_VOICE } from '../ttsVoice';

import { bleep, CHAT_CLIP_MAX_S, chatSwears, type ClipMeta } from './clips';
import { myVoice } from './myVoice';
import { recordBuffer } from './recorder';
import { chatUrl, clipUrl, manifestOf, uploadChat, voiceNet } from './voiceSync';

const MUTED_KEY = 'noun-world-voice-muted';

/** Players this browser has muted or reported (by voice tag). */
export const voiceMutes = {
  list(): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(MUTED_KEY) ?? '[]') as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  },
  has(tag: string): boolean {
    return voiceMutes.list().includes(tag);
  },
  set(tag: string, muted: boolean) {
    const l = new Set(voiceMutes.list());
    if (muted) l.add(tag);
    else l.delete(tag);
    try {
      localStorage.setItem(MUTED_KEY, JSON.stringify([...l].slice(-500)));
    } catch {
      // session only
    }
  },
};

export interface RemoteHear {
  /** Distance gain 0..1 and stereo pan -1..1 from the listener. */
  gain: number;
  pan: number;
}

/** How far a rider's voice carries (m). */
export const HEAR_RANGE = 70;

export class PlayerVoices {
  /** Dev / browser checks. */
  readonly log = {
    remoteClips: 0,
    remoteFallbacks: 0,
    chatSpoken: 0,
    chatUploads: 0,
    lastError: '',
  };
  private decoded = new Map<string, Promise<AudioBuffer | null>>();
  private remote = new Map<string, Promise<AudioBuffer | null>>();
  private engine: TtsEngine | null = null;
  private engineFor = 0;

  constructor(
    private ctx: () => AudioContext | null,
    private voice: VoiceBox,
  ) {
    void myVoice.load();
  }

  // ── Own voice ───────────────────────────────────────────────────────

  readonly own: OwnVoice = {
    useClips: () => settings.get().myVoice,
    has: key => myVoice.get().clips.has(key),
    any: () => myVoice.get().clips.size > 0,
    clip: async key => {
      const c = myVoice.get().clips.get(key);
      const ctx = this.ctx();
      if (c === undefined || ctx === null) return null;
      const id = `${key}@${c.at}`;
      let p = this.decoded.get(id);
      if (p === undefined) {
        p = c.blob
          .arrayBuffer()
          .then(b => ctx.decodeAudioData(b))
          .catch(() => null);
        this.decoded.set(id, p);
      }
      const buf = await p;
      return buf === null ? null : { buf, play: { t0: c.t0, t1: c.t1, gain: c.gain } };
    },
    model: () => {
      const e = this.modelEngine();
      if (e === null) return null;
      if (!e.ready) {
        e.load();
        return null;
      }
      return e;
    },
  };

  /** The player's own model engine, while "use my voice model" is on and one is loaded. */
  modelEngine(): TtsEngine | null {
    const m = myVoice.get().model;
    if (!settings.get().modelVoice || m === null) {
      if (this.engine !== null) this.dropEngine();
      return null;
    }
    if (this.engine === null || this.engineFor !== m.at) {
      this.dropEngine();
      this.engineFor = m.at;
      this.engine = new TtsEngine(defaultWorker, async () => {
        const d = await myVoice.modelData();
        return d === null ? null : { t: 'init-bytes', model: d.model, config: d.config };
      });
    }
    return this.engine.status.state === 'failed' ? null : this.engine;
  }

  /** Status of the own-model engine (booth / settings show it). */
  modelState(): 'off' | 'idle' | 'loading' | 'ready' | 'failed' {
    if (!settings.get().modelVoice || myVoice.get().model === null) return 'off';
    return this.engine?.status.state ?? 'idle';
  }

  private dropEngine() {
    this.engine?.dispose();
    this.engine = null;
    this.engineFor = 0;
  }

  /**
   * The player sent a chat line: speak it in their model voice (if that's on
   * and ready) and, if they share it, upload a clip. Resolves with the clip's
   * id for the multiplayer blob, or null.
   */
  async speakChat(text: string, rider: string): Promise<{ tag: string; id: string } | null> {
    const s = settings.get();
    const ctx = this.ctx();
    if (!s.modelVoice || ctx === null) return null;
    const eng = this.modelEngine();
    if (eng === null) return null;
    eng.load();
    if (!eng.ready) {
      await Promise.race([eng.whenReady(), new Promise(r => setTimeout(r, 15_000))]);
      if (!eng.ready) return null;
    }
    // Clean mode applies before anything is synthesised
    const say = s.cleanVoices ? bleep(text) : text;
    const buf = await eng.synth(ctx, say, MODEL_VOICE, 'now');
    if (buf === null) return null;
    this.voice.playClip(buf, { t0: 0, t1: buf.duration, gain: 1 }, { text: say });
    this.log.chatSpoken++;
    if (!s.modelShare || !voiceNet.enabled || buf.duration > CHAT_CLIP_MAX_S) return null;
    const take = await recordBuffer(ctx, buf);
    if (take === null) return null;
    try {
      const r = await uploadChat(rider, take.blob, take.mime, buf.duration, say);
      this.log.chatUploads++;
      return r;
    } catch (err) {
      this.log.lastError = err instanceof Error ? err.message : String(err);
      return null;
    }
  }

  // ── Other riders ────────────────────────────────────────────────────

  /** Whether this rider's custom voice may play here. */
  canHear(tag: string | undefined): tag is string {
    return tag !== undefined && tag !== '' && settings.get().hearVoices && !voiceMutes.has(tag);
  }

  private fetchClip(url: string): Promise<AudioBuffer | null> {
    let p = this.remote.get(url);
    if (p === undefined) {
      const ctx = this.ctx();
      if (ctx === null) return Promise.resolve(null);
      p = fetch(url)
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then(b => ctx.decodeAudioData(b))
        .catch(() => null);
      this.remote.set(url, p);
      if (this.remote.size > 120) {
        const first = this.remote.keys().next().value;
        if (first !== undefined) this.remote.delete(first);
      }
    }
    return p;
  }

  /** A remote rider's manifest (visible clips), or {} when we may not hear them. */
  manifest(tag: string | undefined): Promise<Record<string, ClipMeta>> {
    return this.canHear(tag) ? manifestOf(tag) : Promise.resolve({});
  }

  /** Play another rider's recording of a line (true if it played). */
  async playRemoteClip(tag: string, key: string, meta: ClipMeta, hear: RemoteHear, text: string) {
    const buf = await this.fetchClip(clipUrl(tag, key, meta.v));
    if (buf === null) return false;
    const play: ClipPlay = { t0: meta.t0, t1: meta.t1, gain: meta.gain };
    this.voice.playClip(buf, play, { text, gain: hear.gain, pan: hear.pan });
    this.log.remoteClips++;
    return true;
  }

  /** Another rider's chat line in their voice (only if we may hear them). */
  async playRemoteChat(tag: string, id: string, text: string, hear: RemoteHear) {
    if (!this.canHear(tag) || hear.gain <= 0) return false;
    if (settings.get().cleanVoices && chatSwears(text)) return false;
    const buf = await this.fetchClip(chatUrl(tag, id));
    if (buf === null) return false;
    this.voice.playClip(
      buf,
      { t0: 0, t1: buf.duration, gain: 1 },
      {
        text,
        gain: hear.gain,
        pan: hear.pan,
      },
    );
    this.log.remoteClips++;
    return true;
  }

  dispose() {
    this.dropEngine();
  }
}
