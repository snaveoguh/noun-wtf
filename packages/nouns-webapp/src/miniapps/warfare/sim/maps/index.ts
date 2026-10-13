import type { MapId } from '../types';
import type { MapDef } from '../world';

import { NOUN_CITY } from './nounCity';
import { WAREHOUSE } from './warehouse';

export const MAPS: Record<MapId, MapDef> = {
  nouncity: NOUN_CITY,
  warehouse: WAREHOUSE,
};

export const MAP_ORDER: MapId[] = ['nouncity', 'warehouse'];
