// ── Time of day moves on by itself: afternoon → golden → blue → night ────
//
// Every TOD_EVERY seconds of play the sky steps to the next preset (the
// same 2 s transition as P). Not while something else owns the light (a
// pocket room, the Big Drop): it waits and steps once you're back out. A
// manual change (P, CAMP's sunset) starts the count again.

/** Seconds of play between steps (10 minutes). */
export const TOD_EVERY = 600;

export class TodClock {
  private t = 0;

  constructor(readonly every = TOD_EVERY) {}

  /** Advance by `dt`; true when it's time to step (and `blocked` is false). */
  tick(dt: number, blocked: boolean): boolean {
    this.t += dt;
    if (blocked || this.t < this.every) return false;
    this.t = 0;
    return true;
  }

  reset() {
    this.t = 0;
  }
}
