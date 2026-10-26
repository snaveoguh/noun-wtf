// ── The Big Drop's snow colours (the terrain grid asks per vertex) ──────
//
// peak.ts builds the terrain mesh and calls snowColor for every vertex it
// rebuilds (~20k a frame at speed: keep it cheap, no allocation). x, z are
// peak coordinates; ny is the surface normal's y (1 = flat).

import * as THREE from 'three';

import { nearestTrack, widthAt } from './track';

const SNOW_LIT = new THREE.Color(0xf7fbff);
const SNOW_SHADE = new THREE.Color(0xd6e2f0);
const ROCK = new THREE.Color(0x8d97a6);

export function snowColor(_x: number, _z: number, ny: number, out: THREE.Color): THREE.Color {
  // Fresh snow on the gentler bits, bluer on the steep, rock where it's
  // steepest (the faces of the kickers)
  out.copy(SNOW_SHADE).lerp(SNOW_LIT, Math.min(1, Math.max(0, (ny - 0.6) / 0.25)));
  if (ny < 0.62) out.lerp(ROCK, Math.min(1, (0.62 - ny) / 0.05) * 0.6);
  return out;
}

/** What the board is on (snow spray, sound and NPCs read it). */
export type SnowSurface = 'groomed' | 'powder' | 'ice' | 'off';

const _near = { s: 0, lateral: 0, dist: 0 };

/** Surface at (x, z), peak coordinates. Cheap: called per frame per rider. */
export function surfaceAt(x: number, z: number): SnowSurface {
  const n = nearestTrack(x, z, _near);
  return n.dist < widthAt(n.s) / 2 ? 'groomed' : 'powder';
}
