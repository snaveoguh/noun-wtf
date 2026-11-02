// ── A frame that throws must not freeze the game (pure) ─────────────────
//
// Game.frame schedules the next frame before it steps, so an exception in a
// system used to repeat every frame: nothing drew again, the canvas kept
// its last picture, and the React HUD went on working around it (the owner's
// "freezes on the book" in desktop Brave, B&W intro grade still on). The
// guard decides what to do with each error: say it once per distinct
// message (with the stack), end the CAMP intro on the first one, and draw
// the frame anyway so the world keeps moving.

export interface FrameErrorAction {
  /** Log it (first time this message is seen). */
  report: boolean;
  /** End the opening shot / trip grade (first error of the page). */
  abortIntro: boolean;
}

export class FrameGuard {
  /** Errors caught (total). */
  errors = 0;
  /** Frames in a row that threw. */
  streak = 0;
  private seen = new Set<string>();

  /** A frame threw `err`. */
  failed(err: unknown): FrameErrorAction {
    this.errors++;
    this.streak++;
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const report = !this.seen.has(msg) && this.seen.size < 20;
    if (report) this.seen.add(msg);
    return { report, abortIntro: this.errors === 1 };
  }

  /** A frame ran clean. */
  ok() {
    this.streak = 0;
  }
}
