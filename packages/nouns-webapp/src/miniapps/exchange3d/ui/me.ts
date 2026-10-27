// ── You, as your Noun World rider (for walking the Exchange) ────────────
//
// Under the fountain the game hands us its rider (Game.seed / name /
// weight). At /exchange on its own we read the pick Noun World's character
// select saves (world2/ui/CharacterSelect.tsx, SavedCharacter; read here
// directly so this chunk doesn't pull in the select screen). First-timers
// get a stable Noun from their rider id.

import type { MeLook } from '../render/walkMode';

import { riderId } from '../../exchange/client';
import { BUILDS } from '../../world2/character/NounCharacter';
import { ART } from '../render/crowdMesh';
import { seedFromId } from '../sim/looks';

/** CharacterSelect's STORAGE_KEY. */
const CHARACTER_KEY = 'noun-world-v2-character';

const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/** The saved rider, if any (null for missing / junk). */
export function parseSaved(raw: string | null): MeLook | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as {
      seed?: Record<string, unknown>;
      name?: unknown;
      build?: unknown;
    };
    const s = v.seed ?? {};
    const seed = {
      background: int(s.background),
      body: int(s.body),
      accessory: int(s.accessory),
      head: int(s.head),
      glasses: int(s.glasses),
    };
    if (Object.values(seed).some(x => x === null)) return null;
    const build = int(v.build) ?? 2;
    return {
      seed: seed as MeLook['seed'],
      name: typeof v.name === 'string' && v.name.trim() !== '' ? v.name.slice(0, 24) : 'YOU',
      weight: BUILDS[build]?.w ?? 0,
    };
  } catch {
    return null;
  }
}

export function myLook(): MeLook {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CHARACTER_KEY);
  } catch {
    // storage blocked
  }
  return parseSaved(raw) ?? { seed: seedFromId(riderId(), ART), name: 'YOU', weight: 0 };
}
