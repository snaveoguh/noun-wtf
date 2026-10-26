// ── Freestyle: when you can dance, and when it earns a little respect ────
//
// Pure. `blockedBy` says why freestyle can't start (or must stop) right now;
// null = go. `CrowdRespect` decides the tiny `custom` respect bump for a long
// clean freestyle with people around (respect/rules.ts rate-limits `custom`
// on top: 4 a minute, and the ± caps).

export interface FreestyleContext {
  inside: boolean;
  bigDrop: boolean;
  /** Hoops game, break battle, cutscene, replay, showroom, van, dragon, paused. */
  busy: boolean;
  mode: 'foot' | 'board';
  /** Player.state ('ground', 'air', 'grind', 'bail', 'manual', …). */
  state: string;
  speed: number;
  climbing: boolean;
  grounded: boolean;
}

/** Fastest you can be rolling and still step off the board to dance (m/s). */
export const STEP_OFF_SPEED = 4;

export type Blocked = 'inside' | 'bigdrop' | 'busy' | 'air' | 'fast';

export function blockedBy(c: FreestyleContext): Blocked | null {
  if (c.inside) return 'inside';
  if (c.bigDrop) return 'bigdrop';
  if (c.busy) return 'busy';
  if (c.climbing) return 'air';
  if (c.mode === 'board') {
    if (c.state !== 'ground' && c.state !== 'manual') return 'air';
    if (c.speed > STEP_OFF_SPEED) return 'fast';
    return null;
  }
  if (!c.grounded) return 'air';
  return null;
}

export const BLOCKED_TEXT: Record<Blocked, string> = {
  inside: 'take it outside to dance',
  bigdrop: 'no dancing on the Big Drop',
  busy: 'not right now',
  air: 'land first',
  fast: 'slow down to dance',
};

/** Seconds of dancing with people near before it counts. */
export const RESPECT_AFTER_S = 40;
/** Clean keyed moves (on the beat) it needs in that time. */
export const RESPECT_CLEAN = 3;
/** Our own cooldown between bumps (s), under the server's limits. */
export const RESPECT_COOLDOWN_S = 300;
/** How far "near people" is (m). */
export const AUDIENCE_R = 15;

export class CrowdRespect {
  private watched = 0;
  private clean = 0;
  private since = Infinity;

  /** A clean keyed move landed. */
  hit() {
    this.clean++;
  }

  /** Stopped dancing: the count starts over. */
  reset() {
    this.watched = 0;
    this.clean = 0;
  }

  /** Per frame while dancing; true when the bump is due (then it starts over). */
  tick(dt: number, audience: boolean): boolean {
    this.since += dt;
    if (audience) this.watched += dt;
    if (
      this.watched >= RESPECT_AFTER_S &&
      this.clean >= RESPECT_CLEAN &&
      this.since >= RESPECT_COOLDOWN_S
    ) {
      this.since = 0;
      this.reset();
      return true;
    }
    return false;
  }
}
