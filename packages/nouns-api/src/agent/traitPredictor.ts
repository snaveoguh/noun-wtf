// ─── Agent NounIRL — Trait Prediction & Matching ────────────────────────────
//
// Mirrors NounsSeeder.sol:
//   pseudorandomness = keccak256(abi.encodePacked(blockhash(block.number - 1), nounId))
//   background = uint48(pseudorandomness) % backgroundCount
//   body = uint48(pseudorandomness >> 48) % bodyCount
//   accessory = uint48(pseudorandomness >> 96) % accessoryCount
//   head = uint48(pseudorandomness >> 144) % headCount
//   glasses = uint48(pseudorandomness >> 192) % glassesCount

import { keccak256, encodePacked, type Hex } from 'viem';
import { ImageData } from '@noundry/nouns-assets';
import { TRAIT_COUNTS } from './constants.js';

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

// ─── Seed Prediction ───────────────────────────────────────────────────────

/**
 * Predict the seed of a Noun that would be minted if settled in a given block.
 *
 * @param blockHash - The parent block's hash (blockhash(block.number - 1))
 * @param nounId - The noun ID that would be minted
 */
export function predictSeed(blockHash: Hex, nounId: number): NounSeed {
  // Replicate Solidity: keccak256(abi.encodePacked(blockhash, nounId))
  const pseudorandomness = BigInt(
    keccak256(encodePacked(['bytes32', 'uint256'], [blockHash, BigInt(nounId)])),
  );

  // Extract 48-bit chunks via right shift + mask
  const mask48 = (1n << 48n) - 1n;

  return {
    background: Number((pseudorandomness & mask48) % BigInt(TRAIT_COUNTS.background)),
    body: Number(((pseudorandomness >> 48n) & mask48) % BigInt(TRAIT_COUNTS.body)),
    accessory: Number(((pseudorandomness >> 96n) & mask48) % BigInt(TRAIT_COUNTS.accessory)),
    head: Number(((pseudorandomness >> 144n) & mask48) % BigInt(TRAIT_COUNTS.head)),
    glasses: Number(((pseudorandomness >> 192n) & mask48) % BigInt(TRAIT_COUNTS.glasses)),
  };
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
 */
function traitName(type: keyof NounSeed, seedIndex: number): string {
  if (type === 'background') {
    return ['Cool', 'Warm'][seedIndex] ?? 'Unknown';
  }

  const category = CATEGORY_MAP[type];
  if (!category) return 'Unknown';

  const images = ImageData.images[category];
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
 */
export function seedToTraitNames(seed: NounSeed): TraitNames {
  return {
    background: traitName('background', seed.background),
    body: traitName('body', seed.body),
    accessory: traitName('accessory', seed.accessory),
    head: traitName('head', seed.head),
    glasses: traitName('glasses', seed.glasses),
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
export function getAllTraitNames(category: keyof NounSeed): string[] {
  if (category === 'background') return ['Cool', 'Warm'];

  const imageCategory = CATEGORY_MAP[category];
  if (!imageCategory) return [];

  return ImageData.images[imageCategory].map((img, idx) => traitName(category, idx));
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
