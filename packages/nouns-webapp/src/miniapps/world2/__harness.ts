// TEMP test harness (not committed)
import * as THREE from 'three';

import { randomSeed } from './character/NounAppearance';
import { loadCharacterAssets, NounCharacter } from './character/NounCharacter';
import { toonify } from './render/Toon';

(window as unknown as Record<string, unknown>).__h = {
  THREE,
  loadCharacterAssets,
  NounCharacter,
  toonify,
  randomSeed,
};
