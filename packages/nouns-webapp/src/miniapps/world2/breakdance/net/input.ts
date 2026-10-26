// ── Break inputs from the keyboard and touch ────────────────────────────
//
//   keyboard  arrows / WASD = up down left right, J or Space = A, K or L = B,
//             Esc = leave. Each press is stamped with the key event's own
//             timeStamp (same clock as performance.now()), not the frame it's
//             noticed in, so a 10 fps frame doesn't smear the timing.
//   touch     BreakUi's pad calls press() from pointerdown, with that
//             event's timeStamp.
//
// While attached it listens on window in the capture phase and stops the
// keys it uses, so the skate controls never see them.

import type { BreakKey } from '../contract';

const MAP: Record<string, BreakKey> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  KeyJ: 'a',
  Space: 'a',
  KeyK: 'b',
  KeyL: 'b',
};

export function keyFor(code: string): BreakKey | null {
  return MAP[code] ?? null;
}

/** A DOM event time → performance.now() time (they share an origin; guard odd ones). */
export function eventMs(ts: number | undefined, now = performance.now()): number {
  return typeof ts === 'number' && ts > 0 && Math.abs(ts - now) < 1000 ? ts : now;
}

export class BreakInputReader {
  /** Set by BreakMode: a press at local time `ms`. */
  onPress: ((key: BreakKey, ms: number) => void) | null = null;
  onEscape: (() => void) | null = null;
  /** Last key (for the touch pad's flash). */
  last: { key: BreakKey; ms: number } | null = null;
  private off: (() => void) | null = null;

  attach() {
    if (this.off !== null || typeof window === 'undefined') return;
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA') return;
      if (e.code === 'Escape') {
        e.stopPropagation();
        this.onEscape?.();
        return;
      }
      const k = keyFor(e.code);
      if (k === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      this.press(k, e.timeStamp);
    };
    const up = (e: KeyboardEvent) => {
      if (keyFor(e.code) !== null) e.stopPropagation();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    this.off = () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }

  detach() {
    this.off?.();
    this.off = null;
    this.last = null;
  }

  press(key: BreakKey, ts?: number) {
    const ms = eventMs(ts);
    this.last = { key, ms };
    this.onPress?.(key, ms);
  }
}
