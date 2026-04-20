// ── Audio FX routing — SFX slomo filter + voice crisp bypass ────────
//
// Audio graph:
//
//   sound emitters  ─►  sfxBus  ─►  sfxLowpass (Biquad)  ─┐
//                                                          ├─►  masterGain  ─►  destination
//   VOIP remote streams  ─►  voiceBus  ────────────────────┘
//
// During slomo, we sweep the sfxLowpass cutoff from 20000 Hz down to
// 400 Hz so punches/gunshots/footsteps muffle into a "Matrix" timbre.
// Voice stream routing goes through voiceBus, which NEVER gets touched
// by the filter — so talking with peers stays crisp regardless of
// slomo factor.
//
// Everything is lazy-initialized on first use. `getSfxContext()` is the
// canonical shared AudioContext; `sounds.ts` pulls from here.

// ── Singletons ──────────────────────────────────────────────────────

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let sfxBusInternal: GainNode | null = null;
let sfxLowpass: BiquadFilterNode | null = null;
let voiceBusInternal: GainNode | null = null;

// Cutoff frequencies for slomo sweep.
const SFX_CUTOFF_MAX = 20000; // Hz — effectively bypass
const SFX_CUTOFF_MIN = 400; // Hz — deeply muffled
const SFX_RAMP_TIME_CONST = 0.05; // setTargetAtTime time constant

function ensureGraph(): void {
  if (ctx) return;

  ctx = new AudioContext();

  masterGain = ctx.createGain();
  masterGain.gain.value = 1.0;
  masterGain.connect(ctx.destination);

  // SFX chain: sfxBus → biquad lowpass → masterGain
  sfxBusInternal = ctx.createGain();
  sfxBusInternal.gain.value = 1.0;

  sfxLowpass = ctx.createBiquadFilter();
  sfxLowpass.type = 'lowpass';
  sfxLowpass.frequency.value = SFX_CUTOFF_MAX;
  sfxLowpass.Q.value = 0.707; // neutral Q — no resonant peak

  sfxBusInternal.connect(sfxLowpass);
  sfxLowpass.connect(masterGain);

  // Voice chain: voiceBus → masterGain (bypasses slomo filter entirely)
  voiceBusInternal = ctx.createGain();
  voiceBusInternal.gain.value = 1.0;
  voiceBusInternal.connect(masterGain);
}

/** Shared AudioContext. sounds.ts + any emitter should use this one. */
export function getSfxContext(): AudioContext {
  ensureGraph();
  // Resume on user-gesture — mirrors the behavior sounds.ts had.
  if (ctx!.state === 'suspended') {
    ctx!.resume().catch(() => {});
  }
  return ctx!;
}

/** Final sink — emitters connect gain nodes here. Filtered by slomo. */
export function getSfxBus(): GainNode {
  ensureGraph();
  return sfxBusInternal!;
}

/** Voice sink — VOIP streams connect here. NEVER touched by slomo. */
export function getVoiceBus(): GainNode {
  ensureGraph();
  return voiceBusInternal!;
}

/** Master gain — final stage before the destination. Public for volume control. */
export function getMasterGain(): GainNode {
  ensureGraph();
  return masterGain!;
}

/**
 * Apply slomo to the SFX bus. Sweeps the biquad lowpass cutoff
 * exponentially toward a frequency derived from `factor`:
 *   factor 1.0  -> 20000 Hz (effectively bypass)
 *   factor 0.2  -> 400 Hz   (heavy muffle)
 * Values in between interpolate logarithmically for a musical sweep.
 *
 * Uses `setTargetAtTime` so the filter glides rather than clicks when
 * slomo enters/exits. Safe to call every frame.
 */
export function applySlomoAudio(factor: number): void {
  ensureGraph();
  if (!ctx || !sfxLowpass) return;

  const clamped = factor < 0.2 ? 0.2 : factor > 1 ? 1 : factor;
  // Remap factor ∈ [0.2, 1.0] to t ∈ [0, 1] where t=0 is full slomo, t=1 is normal.
  const t = (clamped - 0.2) / 0.8;

  // Log-scale interpolation for a perceptually linear frequency sweep.
  const logMin = Math.log(SFX_CUTOFF_MIN);
  const logMax = Math.log(SFX_CUTOFF_MAX);
  const cutoff = Math.exp(logMin + (logMax - logMin) * t);

  try {
    sfxLowpass.frequency.setTargetAtTime(cutoff, ctx.currentTime, SFX_RAMP_TIME_CONST);
  } catch {
    // Some Safari versions throw if called before the context is running.
  }
}

// ── Named getters exposed as singletons (lazy-compatible) ───────────

// Usage note: because `sfxBus` is a *lazy* singleton, export-at-module-
// top-level patterns like `import { sfxBus } from './audioFx'` won't
// work — it would be evaluated at import time, before AudioContext can
// legally be constructed (Safari blocks pre-gesture construction in
// some modes). Callers should use `getSfxBus()` / `getVoiceBus()` each
// time they need the node. The spec talks about `sfxBus` / `voiceBus`;
// we export the getters under those names as a convenience alias for
// clarity at call sites, but the actual creation is still lazy.

export const sfxBus = {
  get node(): GainNode {
    return getSfxBus();
  },
};

export const voiceBus = {
  get node(): GainNode {
    return getVoiceBus();
  },
};
