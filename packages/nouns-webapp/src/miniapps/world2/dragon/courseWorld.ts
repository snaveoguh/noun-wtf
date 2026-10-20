// ── The Dragon Run's anchors in the world (towns + landmarks) ────────────
//
// Resolved once (growing the lines as far as needed, like the map does), so
// the course is the same for every client.

import type { CourseAnchor, Ring } from './course';

import { ROOST } from '../towns/noggle';
import { townFrameNow, townToWorld } from '../towns/site';
import { LANDMARKS, landmarkPlace } from '../world/landmarks/sites';

import { buildCourse } from './course';

/** Checkpoint heights (m above their ground): over the arch, the lighthouse, the tower. */
const ALT = { roost: 16, arch: 26, crabby: 58, boom: 72 } as const;

let cached: Ring[] | null = null;

export function dragonCourseAnchors(
  floorAt: (x: number, z: number) => number,
): CourseAnchor[] | null {
  const f = townFrameNow('noggle');
  if (f === null) return null;
  const w = { x: 0, z: 0 };
  townToWorld(f, ROOST.vp + 14, ROOST.u, w);
  const roost: CourseAnchor = {
    label: 'DRAGON ROOST',
    x: w.x,
    z: w.z,
    ground: f.P,
    alt: ALT.roost,
  };
  const lm = (id: string, label: string, alt: number): CourseAnchor | null => {
    const def = LANDMARKS.find(d => d.id === id);
    const p = def === undefined ? null : landmarkPlace(def, true);
    if (p === null) return null;
    return { label, x: p.x, z: p.z, ground: p.y ?? floorAt(p.x, p.z), alt };
  };
  const arch = lm('noggle-arch', 'NOGGLE ARCH', ALT.arch);
  const crabby = lm('crabby-light', 'CRABBY LIGHT', ALT.crabby);
  const boom = lm('boom-tower', 'BOOM TOWER', ALT.boom);
  if (arch === null || crabby === null || boom === null) return null;
  return [roost, arch, crabby, boom];
}

/** The Dragon Run's rings (null while the towns can't be resolved). */
export function dragonCourse(floorAt: (x: number, z: number) => number): Ring[] | null {
  if (cached !== null) return cached;
  const a = dragonCourseAnchors(floorAt);
  if (a === null) return null;
  cached = buildCourse(a, floorAt);
  return cached;
}
