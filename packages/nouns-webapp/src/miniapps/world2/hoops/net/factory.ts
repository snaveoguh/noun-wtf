// ── Integration points: the sim and the view hoops mode runs ────────────
//
// Swap the stubs for the real parts here (and nowhere else):
//   createSim  → `return new HoopsSim(config);`           (hoops/sim)
//   createView → `return new HoopsView(opts);`            (hoops/view)
// The real HoopsView takes HoopsViewOptions (or adapt them here) and needs
// `update(dt, state, events)` + `dispose()` (HoopsViewLike).

import type { GameConfig, HoopsSimApi } from '../contract';

import { HoopsSim } from '../sim';
import { StubView, type HoopsViewLike, type HoopsViewOptions } from './stubView';

export function createSim(config: GameConfig): HoopsSimApi {
  return new HoopsSim(config);
}

export function createView(opts: HoopsViewOptions): HoopsViewLike {
  return new StubView(opts);
}
