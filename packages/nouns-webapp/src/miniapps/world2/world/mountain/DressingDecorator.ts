// ── Mountain dressing ↔ endless-mountain adapter ────────────────────────
//
// Wraps the analytic terrain (terrain.ts) as the dressing's TerrainQuery and
// hands MountainStream a ChunkDecorator: the dressing is built with each
// near chunk's props (MountainStream.buildProps) and disposed with them
// (disposeProps / disposeChunk); its colliders ride the chunk's dynamic BVH.

import type { TerrainQuery } from './dressingUtil';
import type { ChunkDecorator } from './MountainStream';
import type { Quality } from '../../render/Graphics';

import * as THREE from 'three';

import { MountainDressing } from './Dressing';
import {
  MOUNTAIN,
  edgeDistance,
  megaBlocked,
  sampleTerrain,
  terrainHeight,
  terrainNormal,
  type TerrainSample,
} from './terrain';

const _s: TerrainSample = { y: 0, track: 0, alley: 0, side: 0, dist: 0 };
const _n = { x: 0, y: 0, z: 0 };

/** The endless mountain as seen by the dressing. */
export const mountainTerrainQuery: TerrainQuery = {
  height: terrainHeight,
  normal(x: number, z: number, out: THREE.Vector3) {
    terrainNormal(x, z, _n);
    return out.set(_n.x, _n.y, _n.z);
  },
  /** Effective distance to the nearest track (capped at INFLUENCE = 96 m). */
  trackDist: (x: number, z: number) => sampleTerrain(x, z, _s).dist,
  /**
   * Nothing in / right at the foot of the city, nothing on the alley ramps,
   * nothing on a mega ramp terrace or under its bridge.
   */
  blocked: (x: number, z: number) =>
    edgeDistance(x, z) < 14 || sampleTerrain(x, z, _s).alley > 0 || megaBlocked(x, z),
};

let dressing: MountainDressing | null = null;

/** The shared dressing (stream network cache lives here). */
export function mountainDressing(quality: Quality): MountainDressing {
  if (dressing === null) {
    dressing = new MountainDressing(mountainTerrainQuery, {
      seed: MOUNTAIN.seed,
      trackHalf: MOUNTAIN.trackHalf,
      quality,
    });
  }
  return dressing;
}

/** Streams, ponds, bridges, grass, flowers, bushes, trees + rocks per chunk. */
export function dressingDecorator(quality: Quality): ChunkDecorator {
  return mountainDressing(quality).decorator('dressing');
}
