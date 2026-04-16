import { ImageData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';

export interface NounSeed {
  background: number;
  body: number;
  accessory: number;
  head: number;
  glasses: number;
}

type CategoryKey = 'body' | 'accessory' | 'head' | 'glasses';

/**
 * Build a full Noun SVG from a seed (all layers composited).
 * Returns an SVG string.
 */
export function buildNounSvg(seed: NounSeed): string {
  const { images, palette, bgcolors } = ImageData;
  const parts = [
    images.bodies[seed.body],
    images.accessories[seed.accessory],
    images.heads[seed.head],
    images.glasses[seed.glasses],
  ].filter(Boolean);
  return buildSVG(parts, palette, bgcolors[seed.background] ?? '');
}

/**
 * Build a single trait layer SVG (no background).
 * Category: "body" | "accessory" | "head" | "glasses"
 */
export function buildTraitSvg(category: CategoryKey, index: number): string {
  const { images, palette } = ImageData;
  const key = category === 'body' ? 'bodies' : `${category}s`;
  const image = (images as Record<string, { filename: string; data: string }[]>)[key]?.[index] as
    | { filename: string; data: string }
    | undefined;
  if (image == null) return '';
  return buildSVG([image], palette, '');
}

/**
 * Build a data URI for a full Noun SVG.
 */
export function nounSvgDataUri(seed: NounSeed): string {
  return svgToDataUri(buildNounSvg(seed));
}

/**
 * Build a data URI for a single trait layer SVG.
 */
export function traitSvgDataUri(
  category: 'body' | 'accessory' | 'head' | 'glasses',
  index: number,
): string {
  return svgToDataUri(buildTraitSvg(category, index));
}

/**
 * Get the background hex color for a seed.
 */
export function backgroundHex(seed: NounSeed): string {
  return `#${ImageData.bgcolors[seed.background] ?? 'e1d7d5'}`;
}

/**
 * Get the trait filename (human-readable name) for a given category and index.
 */
export function traitFilename(
  category: 'body' | 'accessory' | 'head' | 'glasses',
  index: number,
): string | null {
  const key = category === 'body' ? 'bodies' : `${category}s`;
  const image = (ImageData.images as Record<string, { filename: string }[]>)[key]?.[index] as
    | { filename: string }
    | undefined;
  if (image == null) return null;
  // Strip the category prefix: "head-aardvark" → "aardvark"
  const raw = image.filename;
  const dashIndex = raw.indexOf('-');
  return dashIndex === -1 ? raw : raw.substring(dashIndex + 1);
}

function svgToDataUri(svg: string): string {
  if (!svg) return '';
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
