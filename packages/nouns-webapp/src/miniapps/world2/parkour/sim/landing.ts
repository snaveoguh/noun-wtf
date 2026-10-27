// ── Landings: roll, stick, stumble or just land ──────────────────────────
//
//   impact < rollImpact (9 m/s, ~3 m)    land as normal (a narrow top sticks)
//   rollImpact ≤ impact < hardImpact     moving → roll and keep the speed;
//                                         standing → a crouched landing
//   impact ≥ hardImpact (15 m/s, ~9 m)   roll only with duck pressed in the
//                                         last 0.4 s (or held), else stumble
//
// A stumble from very high (≥ 1.6 × hardImpact) lasts longer.

import { PK } from '../contract';

export type Landing = 'none' | 'stick' | 'roll' | 'stumble' | 'stumbleHard';

export interface LandingIn {
  /** Downward speed at touchdown (m/s, positive). */
  impact: number;
  /** Horizontal speed at touchdown (m/s). */
  speed: number;
  /** Seconds since duck was last pressed (Infinity = never), or 0 while held. */
  sinceDuck: number;
  /** Came down on something narrow (rail, post, wall top). */
  narrow: boolean;
}

export function landing(i: LandingIn): Landing {
  const timed = i.sinceDuck <= PK.duckWindow;
  if (i.impact >= PK.hardImpact) {
    if (timed) return 'roll';
    return i.impact >= PK.hardImpact * 1.6 ? 'stumbleHard' : 'stumble';
  }
  if (i.narrow && i.impact > 2.5) return 'stick';
  if (i.impact >= PK.rollImpact) return i.speed > 2.5 || timed ? 'roll' : 'stick';
  return 'none';
}
