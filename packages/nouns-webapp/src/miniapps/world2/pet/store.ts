// ── Your pet, saved in this browser (localStorage, versioned) ─────────────

import { DEFAULT_LOOK, FOLLOW_PREFS, PET_LOOKS, type FollowPref, type PetLook } from './contract';
import { checkPetName, DEFAULT_PET_NAME } from './name';

export const PET_STORAGE_KEY = 'noun-world-pet-v1';

export interface SavedPet {
  v: 1;
  look: PetLook;
  name: string;
  follow: FollowPref;
  /** When it was adopted (ms). */
  at: number;
}

/** Parse what's stored; null = not adopted (or unreadable). */
export function parseSavedPet(raw: string | null): SavedPet | null {
  if (raw === null) return null;
  try {
    const o = JSON.parse(raw) as Partial<SavedPet>;
    if (o === null || typeof o !== 'object' || o.v !== 1) return null;
    const look =
      PET_LOOKS.includes(o.look as PetLook) && (o.look as string) !== ''
        ? (o.look as PetLook)
        : DEFAULT_LOOK;
    const nm = checkPetName(typeof o.name === 'string' ? o.name : '');
    const follow = FOLLOW_PREFS.includes(o.follow as FollowPref)
      ? (o.follow as FollowPref)
      : 'auto';
    return {
      v: 1,
      look,
      name: nm.ok ? nm.name : DEFAULT_PET_NAME,
      follow,
      at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0,
    };
  } catch {
    return null;
  }
}

export function loadPet(): SavedPet | null {
  try {
    return parseSavedPet(localStorage.getItem(PET_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function savePet(p: SavedPet): void {
  try {
    localStorage.setItem(PET_STORAGE_KEY, JSON.stringify(p));
  } catch {
    // storage blocked: it follows you this visit
  }
}
