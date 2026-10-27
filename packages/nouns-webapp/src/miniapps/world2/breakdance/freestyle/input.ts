// ── Freestyle keys from the keyboard (the touch pad calls press()) ───────
//
// The battle's keys (net/input.ts keyFor: arrows / WASD, A = J or Space,
// B = K or L), stamped with the key event's own timeStamp. While attached it
// listens on window in the capture phase. It only swallows Esc (that ends the
// freestyle rather than opening anything); the move keys go on to the game's
// Input too, which is harmless (the skater isn't stepped while dancing) and
// means a direction still held when the freestyle ends just keeps walking.
//
// A tap is a move key. Holding a direction (HOLD_MS) is "walk off".

import type { BreakKey } from '../contract';

import { eventMs, keyFor } from '../net/input';

/** Hold a direction this long to walk out of the freestyle. */
export const HOLD_MS = 380;

const DIRS: ReadonlySet<BreakKey> = new Set<BreakKey>(['up', 'down', 'left', 'right']);

/** Pure: is any direction key held long enough to mean "walk away"? */
export function heldLong(down: ReadonlyMap<string, number>, now: number, ms = HOLD_MS): boolean {
  for (const [code, t] of down) {
    const k = keyFor(code);
    if (k !== null && DIRS.has(k) && now - t >= ms) return true;
  }
  return false;
}

export class FreestyleKeys {
  onPress: ((key: BreakKey, ms: number) => void) | null = null;
  onEscape: (() => void) | null = null;
  /** Direction keys down now → when they went down (ms). */
  readonly down = new Map<string, number>();
  private off: (() => void) | null = null;

  get attached() {
    return this.off !== null;
  }

  attach() {
    if (this.off !== null || typeof window === 'undefined') return;
    const kd = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable === true)
        return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.onEscape?.();
        return;
      }
      const k = keyFor(e.code);
      if (k === null) return;
      e.preventDefault();
      if (e.repeat) return;
      if (DIRS.has(k)) this.down.set(e.code, eventMs(e.timeStamp));
      this.press(k, e.timeStamp);
    };
    const ku = (e: KeyboardEvent) => {
      this.down.delete(e.code);
    };
    const blur = () => this.down.clear();
    window.addEventListener('keydown', kd, true);
    window.addEventListener('keyup', ku, true);
    window.addEventListener('blur', blur);
    this.off = () => {
      window.removeEventListener('keydown', kd, true);
      window.removeEventListener('keyup', ku, true);
      window.removeEventListener('blur', blur);
    };
  }

  detach() {
    this.off?.();
    this.off = null;
    this.down.clear();
  }

  press(key: BreakKey, ts?: number) {
    this.onPress?.(key, eventMs(ts));
  }
}
