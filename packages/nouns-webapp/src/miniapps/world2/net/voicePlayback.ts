// ── Remote voice playback gate ─────────────────────────────────────────
//
// A late joiner gets every remote voice track at once, often while the
// world is still loading and before any tap. iOS Safari refuses play() on
// a MediaStream <audio> outside a user gesture (unless the page is already
// capturing the mic), so those elements sit paused: the joiner hears no one
// while everyone hears them.
//
// Only some events count as the gesture: on a touch screen pointerdown and
// touchstart don't (WebKit, and Chrome on Android, unlock on touchend /
// pointerup / click). The gate remembers which elements were refused and
// retries them on the events that do.

/** Events that carry media user activation on desktop and touch screens. */
export const UNLOCK_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'] as const;

export interface Playable {
  readonly paused: boolean;
  play(): Promise<void>;
}

export class PlaybackGate<E extends Playable = Playable> {
  private blocked = new Set<E>();

  /** Elements whose play() was refused and haven't started since. */
  get blockedCount() {
    return this.blocked.size;
  }

  isBlocked(el: E) {
    return this.blocked.has(el);
  }

  /** Start `el`; a refusal marks it blocked until a retry gets it going. */
  async play(el: E): Promise<boolean> {
    try {
      await el.play();
      this.blocked.delete(el);
      return true;
    } catch (err) {
      // AbortError: a newer srcObject / play() superseded this one, which
      // reports for itself
      if ((err as { name?: unknown } | null)?.name !== 'AbortError') this.blocked.add(el);
      return false;
    }
  }

  /** Retry every paused element (call from a gesture). */
  retry(els: Iterable<E>): Promise<boolean[]> {
    const tries: Promise<boolean>[] = [];
    for (const el of els) if (el.paused) tries.push(this.play(el));
    return Promise.all(tries);
  }

  forget(el: E) {
    this.blocked.delete(el);
  }
}
