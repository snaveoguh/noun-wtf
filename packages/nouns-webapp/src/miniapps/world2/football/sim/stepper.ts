// ── Noun Football: fixed-step accumulator (pure) ─────────────────────────
//
// The mode hands it frame time; it steps the sim at SIM_DT, so the match
// is the same at 20, 60 or 144 fps (at most MAX_STEPS a frame: a long
// stall slows the match down rather than fast-forwarding it).

import type { FootballSimApi, PadInput, SimState } from '../contract';

import { SIM_DT } from '../contract';

export const MAX_STEPS = 8;

export class FixedStepper {
  acc = 0;
  /** The last two states (for the view's interpolation). */
  prev: SimState | null = null;
  next: SimState | null = null;

  constructor(readonly sim: FootballSimApi) {}

  /** Advance by frame time; `pads(tick)` gives the humans' pads for each step. Returns the events of every step. */
  frame(dt: number, pads: (tick: number) => Record<string, PadInput>) {
    this.acc = Math.min(this.acc + Math.max(0, dt), SIM_DT * MAX_STEPS);
    const events: SimState['events'] = [];
    while (this.acc >= SIM_DT - 1e-9) {
      this.acc -= SIM_DT;
      const tick = this.next?.tick ?? 0;
      const st = this.sim.step(pads(tick));
      for (const e of st.events) events.push(e);
      this.prev = this.next ?? st;
      this.next = st;
    }
    return events;
  }

  /** Blend factor between prev and next for drawing. */
  get alpha() {
    return Math.min(1, this.acc / SIM_DT);
  }
}
