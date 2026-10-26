// ── The rider talks: callouts on bails, speed and new records ────────────
//
// Lines are picked and rate-limited by CalloutBrain (callouts.ts: at least
// 30 s between any two). Who says the picked line (booth/clips.ts pickSource):
//   1. the player's own recording of it (Voice Booth, "use my voice" on)
//   2. the player's own trained voice model, if they loaded one and turned
//      "use my voice model" on (sentence pauses as RIDER_VOICE: MODEL_VOICE)
//   3. the house voice (ttsVoice HOUSE_*: the site owner's own trained
//      model, every rider's default), or until it's loaded / if it can't
//      load, one hand-picked deep male speaker (RIDER_VOICE), revved up a
//      little; the babble fallback still comes from their Noun seed
// Recordings play even with real voices off (nothing to download); the TTS
// sources only when real voices are on, as before. Once voices are ready the
// whole bank for the current mode is synthesized in the background, so a
// bail is heard the instant it happens.

import type { TtsEngine } from './TtsEngine';
import type { ClipPlay, VoiceBox } from './VoiceBox';

import { clipKey, pickSource, type VoiceSource } from './booth/clips';
import { bank, CalloutBrain, type CalloutEvent, type CalloutPick } from './callouts';
import { seedVoice } from './cast';
import { HOUSE_VOICE, hyped, lineKey, MODEL_VOICE, RIDER_VOICE, type TtsVoice } from './ttsVoice';
import { type SeedLike } from './voiceParams';

/** The player's own voice, as the rider sees it (Game wires it to booth/myVoice). */
export interface OwnVoice {
  /** "Use my voice" (recordings) is on. */
  useClips(): boolean;
  /** A recording exists for this line key. */
  has(key: string): boolean;
  /** Any recordings at all (callouts may fire with real voices off). */
  any(): boolean;
  /** The decoded recording (null: none, or decoding failed). */
  clip(key: string): Promise<{ buf: AudioBuffer; play: ClipPlay } | null>;
  /** The player's own model engine when "use my voice model" is on (else null). */
  model(): TtsEngine | null;
}

export interface RiderVoiceHost {
  voice: VoiceBox;
  tts: TtsEngine;
  seed(): SeedLike;
  audioCtx(): AudioContext | null;
  /** Real voices allowed right now (settings + device). */
  realOn(): boolean;
  /** Something else owns the soundstage (a cutscene). */
  busy(): boolean;
  own?: OwnVoice;
  /** The house voice engine once it's ready (null: loading, failed or not wired). */
  house?: () => TtsEngine | null;
  /** A callout fired (Game relays it so other players hear it too). */
  onSay?: (pick: CalloutPick) => void;
}

export class RiderVoice {
  readonly brain = new CalloutBrain();
  /** Settings: callouts on. */
  enabled = true;
  /** Dev / browser checks: what the rider said, and with which source. */
  readonly log: {
    said: number;
    last: string;
    ev: CalloutEvent | '';
    source: VoiceSource | '';
    key: string;
  } = {
    said: 0,
    last: '',
    ev: '',
    source: '',
    key: '',
  };
  private t = 0;
  private warmed = '';
  private warmedModel = '';
  private warmedHouse = '';

  constructor(private host: RiderVoiceHost) {}

  /** The rider's real voice: the one hand-picked deep male speaker, a touch hyped. */
  ttsVoice(): TtsVoice {
    return hyped(RIDER_VOICE, 1.04);
  }

  /** Every frame: the clock, the speed callout and background pre-warming. */
  tick(dt: number, speedMs: number, riding: boolean) {
    this.t += dt;
    if (!this.active()) return;
    const line = this.brain.speed(riding ? speedMs * 3.6 : 0, this.t);
    if (line !== null) this.say('speed', line);
    this.prewarm();
  }

  bail() {
    this.trigger('bail');
  }

  /** A personal best was just beaten. */
  record() {
    this.trigger('record');
  }

  /** Fire an event now (dev handle too). */
  trigger(ev: CalloutEvent): string | null {
    if (!this.active()) return null;
    const line = this.brain.fire(ev, this.t);
    if (line !== null) this.say(ev, line);
    return line;
  }

  private active(): boolean {
    if (!this.enabled || this.host.busy()) return false;
    const own = this.host.own;
    return (
      this.host.realOn() ||
      (own !== undefined && ((own.useClips() && own.any()) || own.model() !== null))
    );
  }

  /** Which source says a line right now. */
  sourceFor(key: string): VoiceSource | null {
    const own = this.host.own;
    return pickSource({
      hasClip: own?.has(key) === true,
      allowClip: own?.useClips() === true,
      localModel: own?.model() != null,
      tts: this.host.realOn(),
    });
  }

  private say(ev: CalloutEvent, text: string) {
    const pick = this.brain.lastPick;
    const key = pick !== null ? clipKey(ev, pick.index, pick.clean) : '';
    const source = this.sourceFor(key);
    if (source === null) return;
    const seed = this.host.seed();
    const own = this.host.own;
    if (source === 'recording' && own !== undefined) {
      void own.clip(key).then(c => {
        if (c !== null) this.host.voice.playClip(c.buf, c.play, { text });
        else if (this.host.realOn()) this.speakStock(text, seed);
      });
    } else if (source === 'local-model' && own !== undefined) {
      const engine = own.model()!;
      this.host.voice.speak({ text, voice: seedVoice(seed), tts: MODEL_VOICE, engine });
    } else this.speakStock(text, seed);
    this.log.said++;
    this.log.last = text;
    this.log.ev = ev;
    this.log.source = source;
    this.log.key = key;
    if (pick !== null) this.host.onSay?.(pick);
  }

  /** The house voice if it's ready, else the stock rider voice. */
  private speakStock(text: string, seed: SeedLike) {
    const house = this.host.house?.() ?? null;
    if (house !== null)
      this.host.voice.speak({ text, voice: seedVoice(seed), tts: HOUSE_VOICE, engine: house });
    else this.host.voice.speak({ text, voice: seedVoice(seed), tts: this.ttsVoice() });
  }

  /** Once voices are ready: synthesize this rider's whole bank (again if the seed or mode changes). */
  private prewarm() {
    const ctx = this.host.audioCtx();
    if (ctx === null) return;
    const mode = this.brain.clean ? 'clean' : 'spicy';
    const model = this.host.own?.model() ?? null;
    if (model?.ready === true && this.warmedModel !== mode) {
      this.warmedModel = mode;
      for (const ev of ['bail', 'record', 'speed'] as const)
        for (const text of bank(ev, this.brain.clean))
          void model.synth(ctx, text, MODEL_VOICE, 'bg');
    }
    if (!this.host.realOn()) return;
    const house = this.host.house?.() ?? null;
    if (house !== null && this.warmedHouse !== mode) {
      this.warmedHouse = mode;
      for (const ev of ['bail', 'record', 'speed'] as const)
        for (const text of bank(ev, this.brain.clean))
          void house.synth(ctx, text, HOUSE_VOICE, 'bg');
    }
    const tts = this.host.tts;
    if (!tts.ready || house !== null) return;
    const tv = this.ttsVoice();
    const key = `${lineKey('', tv)}|${mode}`;
    if (key === this.warmed) return;
    this.warmed = key;
    for (const ev of ['bail', 'record', 'speed'] as const)
      for (const text of bank(ev, this.brain.clean)) void tts.synth(ctx, text, tv, 'bg');
  }
}
