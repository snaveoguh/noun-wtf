// ── Noun Football: run whole matches headless (tests, tuning) ────────────

import type { FootballEvent, PadInput, SimState, TeamSize } from '../contract';

import { FootballSim } from './FootballSim';
import { makeMatch, type MatchSetup } from './setup';

export interface MatchReport {
  final: SimState;
  events: Record<string, number>;
  /** Longest stretch (s) the match sat in one non-live phase. */
  longestStall: number;
  ticks: number;
}

/** Play a match to the end (or `maxTicks`), CPU vs CPU unless `pads` drives humans. */
export function playMatch(
  setup: Partial<MatchSetup> & { size: TeamSize; seed: number },
  opts: {
    maxTicks?: number;
    pads?: (s: SimState, tick: number) => Record<string, PadInput>;
    onStep?: (s: SimState) => void;
  } = {},
): MatchReport {
  const cfg = makeMatch({ humans: [], halfSeconds: 90, ...setup });
  const sim = new FootballSim(cfg);
  const events: Record<string, number> = {};
  let st = sim.snapshot();
  let stallPhase = st.phase;
  let stallT = 0;
  let longest = 0;
  const max = opts.maxTicks ?? 60 * 60 * 20;
  let t = 0;
  for (; t < max && st.phase !== 'final'; t++) {
    st = sim.step(opts.pads ? opts.pads(st, t) : {});
    opts.onStep?.(st);
    for (const e of st.events as FootballEvent[]) events[e.type] = (events[e.type] ?? 0) + 1;
    if (st.phase === stallPhase && st.phase !== 'live') stallT += 1 / 60;
    else {
      stallPhase = st.phase;
      stallT = 0;
    }
    longest = Math.max(longest, stallT);
  }
  return { final: sim.snapshot(), events, longestStall: longest, ticks: t };
}
