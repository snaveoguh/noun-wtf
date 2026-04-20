// ── useFocusTrigger — Q-hold binding for manual focus/slomo ─────────
//
// Watches `inputRef.current.keys` for 'q'. While Q is held AND the
// focus meter > 0, we call `triggerFocus('manual')` once and let the
// timeControl state machine keep us in slomo. When Q is released (or
// the hook unmounts), we call `releaseManualFocus()` to start the
// exit ramp.
//
// The input system already tracks Q for `forcePush` on justPressed —
// that fires-and-forgets on the first frame, so tapping Q still
// triggers a force push while holding Q also engages focus. By design.
//
// Polling pattern is lightweight — a short interval (~60 Hz) reads the
// raw key set. No event listeners are added here; `engine/input.ts` is
// the single keyboard source of truth.

import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { InputState } from './input';
import { triggerFocus, releaseManualFocus, getFocusMeter } from './timeControl';

interface UseFocusTriggerOpts {
  /** Key to watch (defaults to 'q'). Must match input.ts convention (lowercase). */
  key?: string;
  /** Poll interval ms (defaults to 16 ≈ 60Hz). */
  pollMs?: number;
}

export function useFocusTrigger(
  inputRef: RefObject<InputState | null>,
  opts: UseFocusTriggerOpts = {},
): void {
  const key = opts.key ?? 'q';
  const pollMs = opts.pollMs ?? 16;

  useEffect(() => {
    let heldLocal = false;

    const tick = () => {
      const input = inputRef.current;
      if (!input) return;
      const pressed = input.keys.has(key);

      if (pressed && !heldLocal) {
        // Edge: start of hold.
        if (getFocusMeter() > 0.01) {
          heldLocal = triggerFocus('manual');
        }
      } else if (!pressed && heldLocal) {
        // Edge: release.
        heldLocal = false;
        releaseManualFocus();
      } else if (pressed && heldLocal && getFocusMeter() <= 0) {
        // Meter exhausted while still holding — force release so we
        // don't stall at near-zero factor. timeControl also auto-
        // releases internally, but do it here for symmetry of the
        // heldLocal flag so a re-press after refill works cleanly.
        heldLocal = false;
        releaseManualFocus();
      }
    };

    const id = window.setInterval(tick, pollMs);
    return () => {
      window.clearInterval(id);
      if (heldLocal) releaseManualFocus();
    };
  }, [inputRef, key, pollMs]);
}

export default useFocusTrigger;
