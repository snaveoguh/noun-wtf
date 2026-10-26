// ── The Big Drop's systems: created on the way in, one line each ────────
//
// Add yours as one import + one entry (keep the list order: terrain-side
// things first, then scenery, then riders and effects).

import type { PeakSystemFactory } from './contract';

import { makeAtmosphere } from './scenery/atmosphere';
import { makeBirds } from './scenery/birds';
import { makeForest } from './scenery/forest';

export const PEAK_SYSTEMS: PeakSystemFactory[] = [makeAtmosphere, makeForest, makeBirds];
