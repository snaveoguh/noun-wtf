// ─── Agent NounIRL — Trait Prediction & Matching ────────────────────────────
//
// Mirrors NounsSeeder.sol (V1):
//   pseudorandomness = keccak256(abi.encodePacked(blockhash(block.number - 1), nounId))
//   background = uint48(pseudorandomness) % backgroundCount
//   body = uint48(pseudorandomness >> 48) % bodyCount
//   accessory = uint48(pseudorandomness >> 96) % accessoryCount
//   head = uint48(pseudorandomness >> 144) % headCount
//   glasses = uint48(pseudorandomness >> 192) % glassesCount
//
// V2 (NounV2SlobberSeeder @ 0xd777E701506A86fE89f07f963aA6c08d6905cFF8) differs:
//   1. accessory range is [0, accessoryCount - 1) with a +1 skip past SLOBBER_INDEX,
//      so slobber is excluded from random rotation.
//   2. If accessory == GREASE_INDEX (137) and head ∈ {RETAINER (173), INDEX_CARD (237)},
//      bits 240..255 of the same pseudorandomness gate a 50/50 swap to SLOBBER_INDEX (143).

import { keccak256, encodePacked, type Hex } from 'viem';
import { ImageData } from '@noundry/nouns-assets';
import { getTraitCounts } from './traitCounts.js';
import { WATCHED_DAO } from './constants.js';
// Vendored V2 art mirror — 32 bodies / 144 accessories / 253 heads / 23 glasses,
// founder traits at white@30, black@31, multicolor@142, slobber@143,
// missingnoun@252 (verified on-chain 2026-06-05). Kept in-package rather than
// via the `@nouns/assets` workspace dep because the nouns-api Docker image only
// COPYs nouns-api/sdk/contracts (see root Dockerfile). Same schema as the V1
// `ImageData`; name resolution only reads `.images[category][i].filename`.
import ImageDataV2Json from './image-data-v2.json';

const ImageDataV2 = ImageDataV2Json as unknown as typeof ImageData;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface NounSeed {
  background: number;
  body: number;
  accessory: number;
  head: number;
  glasses: number;
}

export interface TraitNames {
  background: string;
  body: string;
  accessory: string;
  head: string;
  glasses: string;
}

export type SeederVariant = 'v1' | 'v2';

export interface PredictSeedOptions {
  /**
   * Which on-chain seeder to mirror. Defaults to 'v1' (the standard
   * NounsSeeder used by the original Nouns DAO). Use 'v2' to apply the
   * NounV2SlobberSeeder rule on top of the standard pseudorandomness:
   *   - accessory is sampled from [0, accessoryCount - 1) with a +1
   *     skip past SLOBBER_INDEX, so slobber is never picked at random;
   *   - if accessory lands on grease and head is retainer or index-card,
   *     bits 240..255 of the same pseudorandomness gate a 50/50 swap to
   *     slobber.
   */
  dao?: SeederVariant;
}

// ─── Slobber Rule Constants ────────────────────────────────────────────────
// Mirror NounV2SlobberSeeder.sol. Hardcoded indices for the V2 descriptor at
// deploy time — change here only if the on-chain seeder is redeployed with
// different indices.
export const V2_GREASE_INDEX = 137;
export const V2_RETAINER_INDEX = 173;
export const V2_INDEX_CARD_INDEX = 237;
export const V2_SLOBBER_INDEX = 143;

// ─── Seed Prediction ───────────────────────────────────────────────────────

/**
 * Predict the seed of a Noun that would be minted if settled in a given block.
 *
 * @param blockHash - The parent block's hash (blockhash(block.number - 1))
 * @param nounId - The noun ID that would be minted
 * @param options - Optional seeder variant ('v1' default, 'v2' for slobber rule)
 */
export function predictSeed(
  blockHash: Hex,
  nounId: number,
  options: PredictSeedOptions = {},
): NounSeed {
  const variant: SeederVariant = options.dao ?? 'v1';

  // Replicate Solidity: keccak256(abi.encodePacked(blockhash, nounId))
  const pseudorandomness = BigInt(
    keccak256(encodePacked(['bytes32', 'uint256'], [blockHash, BigInt(nounId)])),
  );

  // Extract 48-bit chunks via right shift + mask
  const mask48 = (1n << 48n) - 1n;

  // Use the live trait counts for THIS variant, cached from the on-chain
  // descriptor — falls back to the hardcoded constants in `constants.ts` if the
  // descriptor read failed at startup (see `traitCounts.ts`).
  const counts = getTraitCounts(variant);

  const background = Number((pseudorandomness & mask48) % BigInt(counts.background));
  const body = Number(((pseudorandomness >> 48n) & mask48) % BigInt(counts.body));
  const head = Number(((pseudorandomness >> 144n) & mask48) % BigInt(counts.head));
  const glasses = Number(((pseudorandomness >> 192n) & mask48) % BigInt(counts.glasses));

  let accessory: number;
  if (variant === 'v2') {
    // V2: skip-mapping excludes SLOBBER_INDEX from random rotation.
    // Sample from [0, accessoryCount - 1), then shift any pick at-or-above
    // SLOBBER_INDEX up by one. Effective range:
    //   [0, SLOBBER_INDEX) ∪ (SLOBBER_INDEX, accessoryCount)
    //
    // `counts` here is the V2 descriptor's live counts (getTraitCounts('v2')),
    // so accessoryCount is V2's 144 — matching the on-chain seeder.
    const accessoryRange = BigInt(counts.accessory - 1);
    let acc = Number(((pseudorandomness >> 96n) & mask48) % accessoryRange);
    if (acc >= V2_SLOBBER_INDEX) acc += 1;

    // Slobber rule: head ∈ {retainer, index-card} && accessory == grease
    // → bits 240..255 of pseudorandomness gate a 50/50 swap to slobber.
    // Solidity uses `(pseudorandomness >> 240) & 1`, which keeps the LSB of
    // the top 16 bits — replicated here for parity.
    if (
      acc === V2_GREASE_INDEX &&
      (head === V2_RETAINER_INDEX || head === V2_INDEX_CARD_INDEX)
    ) {
      const coin = (pseudorandomness >> 240n) & 1n;
      if (coin === 1n) acc = V2_SLOBBER_INDEX;
    }

    accessory = acc;
  } else {
    accessory = Number(((pseudorandomness >> 96n) & mask48) % BigInt(counts.accessory));
  }

  return { background, body, accessory, head, glasses };
}

// ─── Trait Name Resolution ─────────────────────────────────────────────────

const capitalizeFirstLetter = (s: string): string =>
  s.charAt(0).toUpperCase() + s.slice(1);

// Maps seed category to ImageData array key
const CATEGORY_MAP: Record<string, 'bodies' | 'accessories' | 'heads' | 'glasses'> = {
  body: 'bodies',
  accessory: 'accessories',
  head: 'heads',
  glasses: 'glasses',
};

/**
 * Convert a seed index to a human-readable trait name.
 * Mirrors packages/nouns-webapp/src/lib/traitName.ts
 *
 * `dao` picks the art set: V1 reads the canonical `@noundry/nouns-assets`
 * frozen trait set; V2 reads the vendored `image-data-v2.json` (V1 snapshot +
 * founder traits at their on-chain indices). The inherited range is identical
 * across both — only the V2 founder slots (e.g. slobber@143) differ — so this
 * matters mainly for reservations that target those founder traits.
 */
function traitName(
  type: keyof NounSeed,
  seedIndex: number,
  dao: SeederVariant = WATCHED_DAO,
): string {
  if (type === 'background') {
    return ['Cool', 'Warm'][seedIndex] ?? 'Unknown';
  }

  const category = CATEGORY_MAP[type];
  if (!category) return 'Unknown';

  const source = dao === 'v2' ? ImageDataV2 : ImageData;
  const images = source.images[category];
  if (!images || seedIndex >= images.length) return `Unknown(${seedIndex})`;

  const entry = images[seedIndex];
  if (!entry) return `Unknown(${seedIndex})`;
  let filename = entry.filename;

  // Strip prefixes (matches webapp logic)
  if (type === 'glasses') {
    filename = filename.replace('square-', '');
  }
  if (type === 'accessory') {
    filename = filename.replace('body-', '');
  }

  // "head-shark" → "Shark", "glasses-hip-rose" → "Hip rose"
  const raw = filename.substring(filename.indexOf('-') + 1).replace(/-/g, ' ');
  return capitalizeFirstLetter(raw);
}

/**
 * Convert a full NounSeed to human-readable trait names.
 * `dao` selects the art set (defaults to the DAO this process watches).
 */
export function seedToTraitNames(
  seed: NounSeed,
  dao: SeederVariant = WATCHED_DAO,
): TraitNames {
  return {
    background: traitName('background', seed.background, dao),
    body: traitName('body', seed.body, dao),
    accessory: traitName('accessory', seed.accessory, dao),
    head: traitName('head', seed.head, dao),
    glasses: traitName('glasses', seed.glasses, dao),
  };
}

// ─── Trait Matching ────────────────────────────────────────────────────────

/**
 * Check if a set of trait names matches a reservation's desired traits.
 *
 * Reservation traits use format "category:value" e.g. "head:shark"
 * Matching is case-insensitive and supports partial matching:
 *   "head:shark" matches "Shark" head
 *   "glasses:blue" matches any glasses containing "blue"
 *   "body:hot" matches "Hot dog" body
 *
 * ALL requested traits must match (AND logic).
 */
export function matchesTraits(
  traitNames: TraitNames,
  requestedTraits: string[],
): boolean {
  if (requestedTraits.length === 0) return false;

  for (const trait of requestedTraits) {
    const colonIdx = trait.indexOf(':');
    if (colonIdx === -1) {
      // No category prefix — match against ALL categories
      const query = trait.toLowerCase().trim();
      const anyMatch = Object.values(traitNames).some(
        name => name.toLowerCase().includes(query),
      );
      if (!anyMatch) return false;
      continue;
    }

    const category = trait.slice(0, colonIdx).toLowerCase().trim() as keyof TraitNames;
    const query = trait.slice(colonIdx + 1).toLowerCase().trim();

    const actualValue = traitNames[category];
    if (!actualValue) return false;

    if (!actualValue.toLowerCase().includes(query)) {
      return false;
    }
  }

  return true;
}

/**
 * Get all valid trait names for a given category.
 * Useful for fuzzy matching and autocomplete.
 */
export function getAllTraitNames(
  category: keyof NounSeed,
  dao: SeederVariant = WATCHED_DAO,
): string[] {
  if (category === 'background') return ['Cool', 'Warm'];

  const imageCategory = CATEGORY_MAP[category];
  if (!imageCategory) return [];

  const source = dao === 'v2' ? ImageDataV2 : ImageData;
  return source.images[imageCategory].map((_img, idx) => traitName(category, idx, dao));
}

/**
 * Parse a natural language trait description into structured trait queries.
 * e.g. "shark head and blue noggles" → ["head:shark", "glasses:blue"]
 */
export function parseTraitDescription(description: string): string[] {
  const traits: string[] = [];
  const lower = description.toLowerCase();

  // Category keywords
  const categoryKeywords: Record<string, keyof NounSeed> = {
    head: 'head',
    body: 'body',
    accessory: 'accessory',
    glasses: 'glasses',
    noggles: 'glasses',
    background: 'background',
    bg: 'background',
  };

  // Try to find "X head", "X glasses", etc.
  for (const [keyword, category] of Object.entries(categoryKeywords)) {
    // Pattern: "value keyword" (e.g. "shark head")
    const beforePattern = new RegExp(`(\\w[\\w\\s-]*)\\s+${keyword}\\b`, 'i');
    const beforeMatch = lower.match(beforePattern);
    if (beforeMatch?.[1]) {
      traits.push(`${category}:${beforeMatch[1].trim()}`);
      continue;
    }

    // Pattern: "keyword value" (e.g. "head shark")
    const afterPattern = new RegExp(`${keyword}\\s*[:=]?\\s*(\\w[\\w\\s-]*)`, 'i');
    const afterMatch = lower.match(afterPattern);
    if (afterMatch?.[1]) {
      traits.push(`${category}:${afterMatch[1].trim()}`);
    }
  }

  // If no structured matches found, treat the whole thing as a general query
  if (traits.length === 0 && description.trim()) {
    traits.push(description.trim());
  }

  return traits;
}
