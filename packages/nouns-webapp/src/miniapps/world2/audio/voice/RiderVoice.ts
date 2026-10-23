// ── The rider talks: callouts on bails, speed and new records ────────────
//
// The rider's voice comes from their own Noun seed like everyone else's,
// revved up a little. Lines are picked and rate-limited by CalloutBrain
// (callouts.ts); once real voices are ready the whole bank for the current
// mode is synthesized in the background, so a bail is heard the instant it
// happens. Callouts only play when real voices are on (babbling while the
// model loads); with voices off the rider stays quiet as before.

import type { TtsEngine } from './TtsEngine';
import type { VoiceBox } from './VoiceBox';

import { bank, CalloutBrain, type CalloutEvent } from './callouts';
import { seedVoice } from './cast';
import { hyped, lineKey, ttsVoiceOf, type TtsVoice } from './ttsVoice';
import { type SeedLike } from './voiceParams';

export interface RiderVoiceHost {
  voice: VoiceBox;
  tts: TtsEngine;
  seed(): SeedLike;
  audioCtx(): AudioContext | null;
  /** Real voices allowed right now (settings + device). */
  realOn(): boolean;
  /** Something else owns the soundstage (a cutscene). */
  busy(): boolean;
}

export class RiderVoice {
  readonly brain = new CalloutBrain();
  /** Settings: callouts on. */
  enabled = true;
  /** Dev / browser checks: what the rider said. */
  readonly log: { said: number; last: string; ev: CalloutEvent | '' } = {
    said: 0,
    last: '',
    ev: '',
  };
  private t = 0;
  private warmed = '';

  constructor(private host: RiderVoiceHost) {}

  /** The rider's real voice (from their seed). */
  ttsVoice(): TtsVoice {
    return hyped(ttsVoiceOf(seedVoice(this.host.seed())));
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
    return this.enabled && this.host.realOn() && !this.host.busy();
  }

  private say(ev: CalloutEvent, text: string) {
    const seed = this.host.seed();
    this.host.voice.speak({ text, voice: seedVoice(seed), tts: this.ttsVoice() });
    this.log.said++;
    this.log.last = text;
    this.log.ev = ev;
  }

  /** Once voices are ready: synthesize this rider's whole bank (again if the seed or mode changes). */
  private prewarm() {
    const tts = this.host.tts;
    const ctx = this.host.audioCtx();
    if (!tts.ready || ctx === null) return;
    const tv = this.ttsVoice();
    const key = `${lineKey('', tv)}|${this.brain.clean ? 'clean' : 'spicy'}`;
    if (key === this.warmed) return;
    this.warmed = key;
    for (const ev of ['bail', 'record', 'speed'] as const)
      for (const text of bank(ev, this.brain.clean)) void tts.synth(ctx, text, tv, 'bg');
  }
}
