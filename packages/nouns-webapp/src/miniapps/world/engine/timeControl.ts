// ── Time Control — Matrix-style bullet-time / focus meter ───────────
//
// Reuses the existing `combat.slowMo` field so callers that already
// read `combatRef.current.slowMo?.factor` pick up the new behavior for
// free. Adds ramp curves (easeOutCubic entry, easeInOutQuad exit), a
// focus meter with passive fill + drain during slomo, and a per-reason
// duration/intensity table for procedural triggers (dash, double-jump,
// wall-run launch, hard landing, aim burst) and a held manual mode.
//
// State is module-scope. No React re-renders on every tick — consumers
// pull values through a getter function (useSlomoFactor) inside
// useFrame, and the HUD hook polls the meter on a low-frequency
// timer (useFocusMeter).
//
// Integration contract with WorldPage.tsx:
//   - WorldPage creates combatRef (already does).
//   - WorldPage calls `setCombatRef(combatRef)` once after mount.
//   - WorldPage's existing `updateSlowMo(...)` call is harmless — this
//     module is tolerant of the legacy {factor, timer} shape. Game loop
//     may additionally call `updateSlomo(combat.slowMo, dt)` and
//     `updateFocusMeter(dt)` each frame for the new ramp-curve behavior.
//
// SlowMo shape is extended at runtime with extra fields. These are
// optional/attached ad-hoc so legacy `createSlowMo` callers (combat.ts,
// sword.ts) keep working with sensible defaults.

import { useEffect, useRef, useState } from 'react';
import type { SlowMo } from './types';
import type { CombatState } from './combat';

// ── Reason table ────────────────────────────────────────────────────

export type FocusReason =
  | 'manual'
  | 'dash'
  | 'doubleJump'
  | 'wallRunLaunch'
  | 'hardLanding'
  | 'aimBurst';

interface ReasonProfile {
  /** Slowest playback speed during hold (target factor, 1 = normal). */
  factor: number;
  /** Hold duration ms (excluding entry + exit). 999999 for manual = held while key pressed. */
  holdMs: number;
  /** Entry ramp duration ms (easeOutCubic by default). Small = snappy like hitstop. */
  entryMs: number;
  /** Exit ramp duration ms (easeInOutQuad). */
  exitMs: number;
}

const REASON_TABLE: Record<FocusReason, ReasonProfile> = {
  dash: { factor: 0.45, holdMs: 250, entryMs: 150, exitMs: 220 },
  doubleJump: { factor: 0.6, holdMs: 180, entryMs: 150, exitMs: 220 },
  wallRunLaunch: { factor: 0.5, holdMs: 300, entryMs: 150, exitMs: 220 },
  // Hitstop flavour — near-freeze with a sharp, almost-instant entry.
  hardLanding: { factor: 0.25, holdMs: 120, entryMs: 40, exitMs: 180 },
  aimBurst: { factor: 0.35, holdMs: 400, entryMs: 150, exitMs: 220 },
  // Manual hold — huge holdMs acts as "infinite" until released.
  manual: { factor: 0.25, holdMs: 999999, entryMs: 150, exitMs: 220 },
};

// ── Extended SlowMo runtime shape ───────────────────────────────────

type Phase = 'entry' | 'hold' | 'exit';

interface SlomoRuntimeExtras {
  targetFactor: number;
  entryMs: number;
  holdMs: number;
  exitMs: number;
  phase: Phase;
  /** ms elapsed in current phase. */
  phaseMs: number;
  /** factor at start of current phase (for interpolation). */
  phaseStartFactor: number;
  /** true while a manual hold is being requested (Q / focus btn down). */
  held: boolean;
  reason: FocusReason;
}

type SlomoState = (SlowMo & Partial<SlomoRuntimeExtras>) | null;

// ── Module singletons ───────────────────────────────────────────────

let combatRef: { current: CombatState } | null = null;

interface FocusMeterState {
  value: number; // 0–1
  /** Cooldown remaining (seconds) before an auto-trigger can re-fire. */
  autoCooldown: number;
}

const focusMeter: FocusMeterState = { value: 1, autoCooldown: 0 };

const METER_FILL_PER_SEC = 0.15;
const METER_DRAIN_PER_SEC = 1.0;
const AUTO_TRIGGER_COOLDOWN_SEC = 2.0;

/** Called once by WorldPage after combatRef is created. */
export function setCombatRef(ref: { current: CombatState }): void {
  combatRef = ref;
}

function getSlomo(): SlomoState {
  if (!combatRef) return null;
  return combatRef.current.slowMo as SlomoState;
}

function setSlomo(next: SlomoState): void {
  if (!combatRef) return;
  combatRef.current.slowMo = next as SlowMo | null;
}

// ── Ramp helpers ────────────────────────────────────────────────────

function easeOutCubic(t: number): number {
  const c = 1 - t;
  return 1 - c * c * c;
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Trigger a focus/slomo pulse for a given reason. Respects auto-trigger
 * cooldown + meter. `manual` enters a held state (exits only on release).
 * Returns true if the trigger fired.
 */
export function triggerFocus(reason: FocusReason): boolean {
  const profile = REASON_TABLE[reason];
  if (!profile) return false;

  if (focusMeter.value <= 0.01) return false;
  if (reason !== 'manual' && focusMeter.autoCooldown > 0) return false;

  const current = getSlomo();
  // If we're already in a stronger (smaller factor) slomo that hasn't
  // started exiting yet, don't weaken it — but allow `manual` to extend.
  if (current && current.targetFactor !== undefined && current.phase !== 'exit') {
    const alreadyStronger = current.targetFactor <= profile.factor;
    if (alreadyStronger && reason !== 'manual') return false;
  }

  const prevFactor = current?.factor ?? 1;

  const next: SlowMo & SlomoRuntimeExtras = {
    factor: prevFactor,
    timer: 999, // stays truthy; real lifetime managed by updateSlomo.
    targetFactor: profile.factor,
    entryMs: profile.entryMs,
    holdMs: profile.holdMs,
    exitMs: profile.exitMs,
    phase: 'entry',
    phaseMs: 0,
    phaseStartFactor: prevFactor,
    held: reason === 'manual',
    reason,
  };

  setSlomo(next);

  if (reason !== 'manual') {
    focusMeter.autoCooldown = AUTO_TRIGGER_COOLDOWN_SEC;
  }
  return true;
}

/** Release any held manual focus. Begins exit ramp immediately. */
export function releaseManualFocus(): void {
  const s = getSlomo() as (SlowMo & SlomoRuntimeExtras) | null;
  if (!s || !s.held) return;
  s.held = false;
  if (s.phase !== 'exit') {
    s.phase = 'exit';
    s.phaseMs = 0;
    s.phaseStartFactor = s.factor;
  }
}

/**
 * Advance the slomo state machine. Call once per frame from the main
 * game loop with dt in seconds. Tolerates legacy `createSlowMo` objects
 * (no runtime fields) by retrofitting a synthetic hold-then-exit.
 *
 * Returns the next slomo state (possibly null if fully resolved).
 * Callers should assign: `combat.slowMo = updateSlomo(combat.slowMo, dt)`.
 */
export function updateSlomo(slomo: SlomoState, dt: number): SlomoState {
  if (!slomo) return null;
  const s = slomo as SlowMo & SlomoRuntimeExtras;

  // Legacy back-compat: wrap {factor, timer} into a short
  // hold-then-exit so old callers still animate out smoothly.
  if (s.phase === undefined) {
    s.targetFactor = s.factor ?? 0.3;
    s.entryMs = 80;
    s.holdMs = Math.max(0, (s.timer ?? 8) * (1000 / 60));
    s.exitMs = 220;
    s.phase = 'entry';
    s.phaseMs = 0;
    s.phaseStartFactor = 1;
    s.factor = 1;
    s.held = false;
    s.reason = 'manual';
  }

  const dtMs = dt * 1000;
  s.phaseMs += dtMs;

  if (s.phase === 'entry') {
    const t = s.entryMs <= 0 ? 1 : clamp01(s.phaseMs / s.entryMs);
    const eased = easeOutCubic(t);
    s.factor = s.phaseStartFactor + (s.targetFactor - s.phaseStartFactor) * eased;
    if (t >= 1) {
      s.phase = 'hold';
      s.phaseMs = 0;
      s.phaseStartFactor = s.factor;
      s.factor = s.targetFactor;
    }
  } else if (s.phase === 'hold') {
    s.factor = s.targetFactor;
    const holdDone = !s.held && s.phaseMs >= s.holdMs;
    if (holdDone) {
      s.phase = 'exit';
      s.phaseMs = 0;
      s.phaseStartFactor = s.factor;
    }
  } else {
    // exit
    const t = s.exitMs <= 0 ? 1 : clamp01(s.phaseMs / s.exitMs);
    const eased = easeInOutQuad(t);
    s.factor = s.phaseStartFactor + (1 - s.phaseStartFactor) * eased;
    if (t >= 1) {
      s.factor = 1;
      s.timer = 0;
      return null; // fully resolved
    }
  }

  // Keep legacy `timer` counter alive-truthy while active so any other
  // code path doing `if (combat.slowMo)` continues to see the state.
  s.timer = Math.max(1, s.timer - 1);
  return s;
}

/**
 * Update the focus meter. Call every frame with dt in seconds.
 * Passive fill 0.15/s, drain 1.0/s while slomo is active (factor < 0.95).
 * Ticks down the auto-trigger cooldown in parallel.
 */
export function updateFocusMeter(dt: number): void {
  if (dt <= 0) return;

  if (focusMeter.autoCooldown > 0) {
    focusMeter.autoCooldown = Math.max(0, focusMeter.autoCooldown - dt);
  }

  const slomo = getSlomo();
  const factor = slomo?.factor ?? 1;
  const active = factor < 0.95;

  if (active) {
    focusMeter.value = clamp01(focusMeter.value - METER_DRAIN_PER_SEC * dt);
    // Out of meter while held — force release so we don't stall at near-0.
    if (focusMeter.value <= 0 && slomo && (slomo as SlomoRuntimeExtras).held) {
      releaseManualFocus();
    }
  } else {
    focusMeter.value = clamp01(focusMeter.value + METER_FILL_PER_SEC * dt);
  }
}

/**
 * Returns a getter for the current slomo factor (1 = normal speed).
 * Designed for useFrame polling — does NOT re-render on factor change.
 * Consumers that drive renders (HUD meter fill) should use
 * `useFocusMeter` instead.
 */
export function useSlomoFactor(): () => number {
  // Stable getter reference across renders; reads fresh each call.
  const getter = useRef<(() => number) | null>(null);
  if (!getter.current) {
    getter.current = () => {
      const s = getSlomo();
      return s?.factor ?? 1;
    };
  }
  return getter.current;
}

/**
 * Subscribes to the meter value at a low polling cadence (~15fps) — for
 * HUD display. Doesn't cause a render storm during slomo.
 */
export function useFocusMeter(): number {
  const [value, setValue] = useState(focusMeter.value);
  useEffect(() => {
    const id = window.setInterval(() => {
      setValue(focusMeter.value);
    }, 66); // ~15 fps
    return () => window.clearInterval(id);
  }, []);
  return value;
}

/** Read the raw meter value without subscribing. For refs / useFrame. */
export function getFocusMeter(): number {
  return focusMeter.value;
}

/** Debug / test helper. */
export function _setFocusMeter(v: number): void {
  focusMeter.value = clamp01(v);
}
