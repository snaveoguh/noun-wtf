import type { INounSeed } from '@/wrappers/nounToken';

/**
 * `head-missingnoun` — index 252 of the V2 head art set (verified on-chain
 * 2026-06-05). V1's art set is unrelated at that index (252 = shrimp tempura),
 * so the DAO check is load-bearing, not belt-and-braces.
 */
export const MISSINGNOUN_HEAD_INDEX = 252;

export function isMissingNoun(seed: INounSeed | null | undefined, isV2: boolean): boolean {
  return isV2 && seed?.head === MISSINGNOUN_HEAD_INDEX;
}
