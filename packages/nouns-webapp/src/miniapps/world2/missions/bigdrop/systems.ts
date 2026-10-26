// ── The Big Drop's systems: created on the way in, one line each ────────
//
// Add yours as one import + one entry (keep the list order: terrain-side
// things first, then scenery, then riders and effects).

import type { PeakSystemFactory } from './contract';

import { createLoops } from './loops';
import { createRiders } from './riders';
import { createSpray } from './spray';

export const PEAK_SYSTEMS: PeakSystemFactory[] = [createLoops, createRiders, createSpray];
