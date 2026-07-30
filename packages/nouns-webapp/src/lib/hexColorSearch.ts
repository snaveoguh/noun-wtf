import { ImageData } from '@noundry/nouns-assets';

import { traitCategory } from '@/lib/traitCategory';
import { INounSeed } from '@/wrappers/nounToken';

/**
 * Hex-colour search support for the probe grid.
 *
 * A search token like `#c54e38` (or `#c53`, or bare `c54e38`) filters to
 * nouns whose art actually contains that colour. Matching is done against
 * the palette indices in each trait's RLE data — exact palette hits plus a
 * small RGB-distance tolerance so picker-chosen colours that fall between
 * palette entries still find their neighbours.
 */

/** Max Euclidean RGB distance for a palette colour to count as a match. */
const HEX_COLOR_TOLERANCE = 32;

/**
 * Parse a search token as a hex colour. Accepts `#rgb`, `#rrggbb`, and bare
 * `rrggbb` — but a bare token must be 6 chars with at least one a-f letter,
 * so numeric ID searches ("1000") and trait words ("dad") aren't hijacked.
 * Returns a normalized lowercase `#rrggbb`, or null if not a colour.
 */
export const parseHexColor = (token: string): string | null => {
  const hasHash = token.startsWith('#');
  const raw = hasHash ? token.slice(1) : token;
  if (!/^([\da-f]{3}|[\da-f]{6})$/i.test(raw)) return null;
  if (!hasHash && !(raw.length === 6 && /[a-f]/i.test(raw))) return null;
  const six =
    raw.length === 3
      ? raw
          .split('')
          .map(c => c + c)
          .join('')
      : raw;
  return `#${six.toLowerCase()}`;
};

/** `rrggbb` (no hash) → [r, g, b] */
const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(0, 2), 16),
  parseInt(hex.slice(2, 4), 16),
  parseInt(hex.slice(4, 6), 16),
];

type Category = keyof (typeof ImageData)['images'];

/**
 * Lazily-built cache: for each trait category and index, the unique palette
 * hex colours (lowercase, no hash) used by that trait's RLE data. Built once
 * (~440 traits) on the first colour query.
 */
let traitColorCache: Record<Category, string[][]> | null = null;

const decodeTraitColors = (rleData: string): string[] => {
  const hex = rleData.startsWith('0x') ? rleData.slice(2) : rleData;
  const indices = new Set<number>();
  // Skip palette index (2) + bounds (8); each 4-char chunk is [run, colorIndex]
  for (let i = 10; i + 4 <= hex.length; i += 4) {
    indices.add(parseInt(hex.slice(i + 2, i + 4), 16));
  }
  indices.delete(0); // 0 = transparent
  const colors: string[] = [];
  for (const idx of indices) {
    const c = ImageData.palette[idx];
    if (typeof c === 'string' && c.length === 6) colors.push(c.toLowerCase());
  }
  return colors;
};

const getTraitColors = (): Record<Category, string[][]> => {
  traitColorCache ??= {
    bodies: ImageData.images.bodies.map(t => decodeTraitColors(t.data)),
    accessories: ImageData.images.accessories.map(t => decodeTraitColors(t.data)),
    heads: ImageData.images.heads.map(t => decodeTraitColors(t.data)),
    glasses: ImageData.images.glasses.map(t => decodeTraitColors(t.data)),
  };
  return traitColorCache;
};

const matchingHexCache = new Map<string, Set<string>>();

/**
 * All palette + background colours within tolerance of the target `#rrggbb`,
 * as a lowercase no-hash Set. Memoized per target so keystroke re-filters are
 * a Set lookup, not a distance scan.
 */
export const getMatchingPaletteHexes = (targetHex: string): Set<string> => {
  const cached = matchingHexCache.get(targetHex);
  if (cached != null) return cached;
  const [tr, tg, tb] = hexToRgb(targetHex.slice(1));
  const matching = new Set<string>();
  const candidates = new Set([...ImageData.palette, ...ImageData.bgcolors]);
  for (const c of candidates) {
    if (typeof c !== 'string' || c.length !== 6) continue; // palette[0] = transparent ''
    const [r, g, b] = hexToRgb(c);
    const distance = Math.sqrt((r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2);
    if (distance <= HEX_COLOR_TOLERANCE) matching.add(c.toLowerCase());
  }
  matchingHexCache.set(targetHex, matching);
  return matching;
};

/**
 * True when any of the noun's trait colours (or its background) is in the
 * matching set. Out-of-range trait indices (e.g. stale V2 seeds pointing past
 * the bundled V1 art set) are skipped rather than thrown on.
 */
export const nounContainsColor = (seed: INounSeed, matching: Set<string>): boolean => {
  const bg = ImageData.bgcolors[seed.background];
  if (typeof bg === 'string' && matching.has(bg.toLowerCase())) return true;
  const traitColors = getTraitColors();
  for (const [type, category] of Object.entries(traitCategory) as [
    Exclude<keyof INounSeed, 'background'>,
    Category,
  ][]) {
    const colors = traitColors[category][seed[type]];
    if (colors != null && colors.some(c => matching.has(c))) return true;
  }
  return false;
};
