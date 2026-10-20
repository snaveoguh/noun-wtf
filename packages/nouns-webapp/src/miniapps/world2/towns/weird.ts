// ── The weird towns: Noggle City, Shroom Hollow, Neon Nouns, Crater Lil ──
//
// Their looks for build.ts (signs, the static build, the instanced plant,
// animated extras). Each town's file has its own layout notes.

import type { SignSpec, TownBuilder } from './kit';
import type { ChunkContext } from '../world/mountain/MountainStream';
import type * as THREE from 'three';

import { buildCrater, craterExtras, craterSigns, crystalGeometry } from './crater';
import { buildNeon, lampGeometry, neonSigns } from './neon';
import { buildNoggle, lollipopGeometry, noggleSigns } from './noggle';
import { buildShroom, giantMushroomGeometry, shroomSigns } from './shroom';

/** Animated / special parts a town adds to its chunk (build.ts folds them in). */
export interface TownExtras {
  animate: ((dt: number) => void) | null;
  disposables: { dispose(): void }[];
  triangles: number;
  drawCalls: number;
}

interface WeirdLook {
  signs(): SignSpec[];
  build(b: TownBuilder, ground: (vp: number, u: number) => number): void;
  plant(): THREE.BufferGeometry;
  extras?: (b: TownBuilder, ctx: ChunkContext, root: THREE.Group) => TownExtras;
}

export const WEIRD_TOWNS: Record<'noggle' | 'shroom' | 'neon' | 'crater', WeirdLook> = {
  noggle: { signs: noggleSigns, build: buildNoggle, plant: lollipopGeometry },
  shroom: { signs: shroomSigns, build: buildShroom, plant: giantMushroomGeometry },
  neon: { signs: neonSigns, build: buildNeon, plant: lampGeometry },
  crater: { signs: craterSigns, build: buildCrater, plant: crystalGeometry, extras: craterExtras },
};
