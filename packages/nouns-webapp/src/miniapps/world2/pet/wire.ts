// ── The pet on the wire (pure) ───────────────────────────────────────────
//
// An optional pose-blob key, only once a rider has adopted a pet:
//   pt: [look, mode, name]
// look = PET_LOOKS index, mode = PET_MODES index (both append only), name
// the cleaned pet name. Others place the pet themselves, next to the rider
// they already draw (no per-frame pet positions travel). Older clients
// ignore the key; the relay passes it through untouched.

import { PET, PET_LOOKS, PET_MODES, type PetLook, type PetMode } from './contract';
import { blockedName, cleanPetName } from './name';

export type PetWire = [number, number, string];

export interface RemotePet {
  look: PetLook;
  mode: PetMode;
  /** '' when theirs didn't pass our filter. */
  name: string;
}

export function encodePet(look: PetLook, mode: PetMode, name: string): PetWire {
  return [PET_LOOKS.indexOf(look), PET_MODES.indexOf(mode), cleanPetName(name)];
}

/** A blob's `pt` → the pet, or null for anything missing or malformed. */
export function decodePet(v: unknown): RemotePet | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [l, m, n] = v as unknown[];
  if (typeof l !== 'number' || !Number.isInteger(l) || l < 1 || l >= PET_LOOKS.length) return null;
  if (typeof m !== 'number' || !Number.isInteger(m) || m < 0 || m >= PET_MODES.length) return null;
  if (typeof n !== 'string' || n.length > PET.nameMax * 2) return null;
  const name = cleanPetName(n).trim();
  return {
    look: PET_LOOKS[l] as PetLook,
    mode: PET_MODES[m]!,
    name: name !== '' && !blockedName(name) ? name : '',
  };
}
