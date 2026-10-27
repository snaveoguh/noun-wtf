// ── What other riders learn about your car (pure) ──────────────────────────
//
// While you drive, the pose blob carries `vh: 'car'` (pos / quat are the
// car's model origin and orientation, like the van's) plus `cr`, a short
// string: the car's id and a few flag bits, e.g. "toro.2" (doors up) or
// "roadstar.1" (flying). Older clients don't know 'car': they read it as no
// vehicle and ignore `cr` (they just see the rider). Anything malformed
// decodes to null and the rider shows as on foot.

import { isCarId, type CarId } from './specs';

export interface NetCar {
  id: CarId;
  /** Paint index (the car's `paints`). */
  paint: number;
  flying: boolean;
  doorsOpen: boolean;
  boosting: boolean;
}

const FLY = 1;
const DOORS = 2;
const BOOST = 4;
const RE = /^([a-z]{2,12})\.(\d{1,2})(?:\.(\d))?$/;

export function encodeCar(c: NetCar): string {
  const f = (c.flying ? FLY : 0) | (c.doorsOpen ? DOORS : 0) | (c.boosting ? BOOST : 0);
  return `${c.id}.${f}.${Math.max(0, Math.min(9, Math.round(c.paint)))}`;
}

export function decodeCar(v: unknown): NetCar | null {
  if (typeof v !== 'string' || v.length > 20) return null;
  const m = RE.exec(v);
  if (m === null || !isCarId(m[1])) return null;
  const f = Number(m[2]);
  if (f > 7) return null;
  return {
    id: m[1],
    paint: m[3] !== undefined ? Number(m[3]) : 0,
    flying: (f & FLY) !== 0,
    doorsOpen: (f & DOORS) !== 0,
    boosting: (f & BOOST) !== 0,
  };
}
