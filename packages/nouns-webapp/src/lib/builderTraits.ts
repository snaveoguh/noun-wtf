/**
 * Parse trait layers from a Nouns Builder renderer image URL.
 *
 * The nouns.build renderer returns URLs like:
 *   https://nouns.build/api/renderer/stack-images?contractAddress=0x...&tokenId=0
 *     &images=ipfs%3A%2F%2Fbaf.../0-backgrounds/cool.png
 *     &images=ipfs%3A%2F%2Fbaf.../3-heads/milk.png
 *     ...
 *
 * We pull one `{layerFolder, traitFilename}` per image param.
 * Layer folders are prefixed with an index ("0-backgrounds", "1-bodies").
 */

export interface BuilderTrait {
  /** Normalized layer key (e.g. "head", "body", "accessory", "glasses", "background"). */
  layer: string;
  /** Raw trait slug from the filename ("ship-in-a-bottle"). */
  slug: string;
  /** Human-readable label ("Ship In A Bottle"). */
  label: string;
}

// Normalize a builder folder ("3-heads") to a singular layer key ("head").
const LAYER_ALIASES: Record<string, string> = {
  heads: 'head',
  bodies: 'body',
  accessories: 'accessory',
  glasses: 'glasses',
  backgrounds: 'background',
};

function normalizeLayer(folder: string): string {
  // Strip leading "<index>-" prefix if present
  const name = folder.replace(/^\d+-/, '').toLowerCase();
  return LAYER_ALIASES[name] ?? name;
}

function slugToLabel(slug: string): string {
  return slug
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

export function parseBuilderTraitsFromImage(imageUrl: string): BuilderTrait[] {
  if (imageUrl === '') return [];
  const traits: BuilderTrait[] = [];
  // Each image= param, decoded, looks like "ipfs://baf.../3-heads/milk.png"
  const matches = [...imageUrl.matchAll(/images=([^&]+)/g)];
  for (const m of matches) {
    try {
      const decoded = decodeURIComponent(m[1]);
      const pathMatch = decoded.match(/\/([^/]+)\/([^/]+)\.(png|svg)$/i);
      if (pathMatch === null) continue;
      const folder = pathMatch[1];
      const slug = pathMatch[2];
      traits.push({
        layer: normalizeLayer(folder),
        slug,
        label: slugToLabel(slug),
      });
    } catch {
      // ignore malformed entries
    }
  }
  return traits;
}

/** Preferred ordering for display — mirrors the Nouns layer order. */
const LAYER_ORDER = ['head', 'glasses', 'body', 'accessory', 'background'];

export function orderTraitsForDisplay(traits: BuilderTrait[]): BuilderTrait[] {
  return [...traits].sort((a, b) => {
    const ai = LAYER_ORDER.indexOf(a.layer);
    const bi = LAYER_ORDER.indexOf(b.layer);
    if (ai === -1 && bi === -1) return a.layer.localeCompare(b.layer);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}
