// ── The Big Drop's systems: created on the way in, one line each ────────
//
// Add yours as one import + one entry (keep the list order: terrain-side
// things first, then scenery, then riders and effects).

import type { PeakSystemFactory } from './contract';

import { createCourse } from './course';
import { createLoops } from './loops';
import { createRiders } from './riders';
import { makeAtmosphere } from './scenery/atmosphere';
import { makeBasinLife } from './scenery/basinLife';
import { makeBirds } from './scenery/birds';
import { makeForest } from './scenery/forest';
import { createSpray } from './spray';
import { createTrackDressing } from './trackDressing';

export const PEAK_SYSTEMS: PeakSystemFactory[] = [
  createTrackDressing,
  createCourse,
  makeAtmosphere,
  makeForest,
  makeBasinLife,
  createLoops,
  makeBirds,
  createRiders,
  createSpray,
];
