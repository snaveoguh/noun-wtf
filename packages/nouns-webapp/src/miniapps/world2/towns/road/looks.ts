// ── The side towns' looks, by id (road/decorator.ts, interiors/townDoors.ts) ─

import type { RoadLook } from './look';
import type { SideTownId } from './places';

import { DIESEL_LOOK } from './diesel';
import { PEAK_LOOK } from './peak';
import { PINES_LOOK } from './pines';

export const SIDE_LOOKS: Record<SideTownId, RoadLook> = {
  peak: PEAK_LOOK,
  pines: PINES_LOOK,
  diesel: DIESEL_LOOK,
};
