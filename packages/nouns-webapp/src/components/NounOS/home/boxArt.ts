// Deterministic "box art" for every page on noun.wtf that has no cover.
//
// A card's key (its path, or a submitted URL) hashes to a Noun seed, a crop
// and a colourway, so the same page always gets the same Noun on the same
// background, and the shelf still looks varied. The pure parts (hashing,
// seeding, picking) live here so they can be tested without the art data;
// `nounSvgUrl` renders the actual Noun.

import { getNounData, ImageData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';

export interface NounSeed {
  background: number;
  body: number;
  accessory: number;
  head: number;
  glasses: number;
}

export interface SeedCounts {
  backgrounds: number;
  bodies: number;
  accessories: number;
  heads: number;
  glasses: number;
}

/** 32-bit FNV-1a. Stable across browsers and Node. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small seeded PRNG (mulberry32): one hash in, a stream of [0,1) out. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r: () => number, n: number) => Math.min(n - 1, Math.floor(r() * n));

/** The Noun for a key: every trait in range, the same every time. */
export function seedFromKey(key: string, counts: SeedCounts): NounSeed {
  const r = prng(hashString(`noun:${key}`));
  return {
    background: pick(r, counts.backgrounds),
    body: pick(r, counts.bodies),
    accessory: pick(r, counts.accessories),
    head: pick(r, counts.heads),
    glasses: pick(r, counts.glasses),
  };
}

/** How the Noun sits on the box: a face close-up, the full figure, or a tilted peek. */
export type Crop = 'face' | 'full' | 'peek';
const CROPS: Crop[] = ['face', 'face', 'full', 'peek'];

/** Bold two-tone grounds in the house poster style (see the game covers). */
export const GROUNDS: Record<string, [string, string][]> = {
  play: [
    ['#ff2f8e', '#ff9a1f'],
    ['#7b2cff', '#ff2f8e'],
    ['#ff5a1f', '#ffd400'],
  ],
  art: [
    ['#c6ff1a', '#119b5a'],
    ['#ff2f8e', '#7b2cff'],
    ['#ffd400', '#ff5a1f'],
  ],
  free: [
    ['#3dff8a', '#0a6b4a'],
    ['#29e0a0', '#1a6bff'],
  ],
  gov: [
    ['#ff3b5c', '#5a0c2e'],
    ['#ff6a3d', '#9b0f3c'],
  ],
  mkt: [
    ['#5ef1ff', '#2b2bd9'],
    ['#20d6ff', '#0b6f8f'],
  ],
  net: [
    ['#b9bccb', '#3a3f55'],
    ['#8c7bff', '#22203a'],
  ],
  clients: [
    ['#ff3b3b', '#2a2a8f'],
    ['#8c7bff', '#1a1440'],
    ['#20d6ff', '#1b2a8f'],
  ],
  community: [
    ['#ffd400', '#ff2f8e'],
    ['#ffe66b', '#ff8a00'],
  ],
};

export interface ArtSpec {
  seed: NounSeed;
  crop: Crop;
  ground: [string, string];
  /** Tilt of the title, degrees */
  tilt: number;
  /** Where the light comes from, % across */
  light: number;
}

export function artSpec(key: string, group: string, counts: SeedCounts): ArtSpec {
  const r = prng(hashString(`art:${group}:${key}`));
  const grounds = GROUNDS[group] ?? GROUNDS.art!;
  return {
    seed: seedFromKey(key, counts),
    crop: CROPS[pick(r, CROPS.length)]!,
    ground: grounds[pick(r, grounds.length)]!,
    tilt: -2 - Math.round(r() * 4),
    light: 20 + Math.round(r() * 60),
  };
}

export const NOUN_COUNTS: SeedCounts = {
  backgrounds: ImageData.bgcolors.length,
  bodies: ImageData.images.bodies.length,
  accessories: ImageData.images.accessories.length,
  heads: ImageData.images.heads.length,
  glasses: ImageData.images.glasses.length,
};

const svgCache = new Map<string, string>();

/** The Noun as a data URL, without its flat background (the box paints its own). */
export function nounSvgUrl(seed: NounSeed): string {
  const k = `${seed.background}.${seed.body}.${seed.accessory}.${seed.head}.${seed.glasses}`;
  const hit = svgCache.get(k);
  if (hit !== undefined) return hit;
  let url = '';
  try {
    const { parts, background } = getNounData(seed);
    const svg = buildSVG(parts, ImageData.palette, background).replace(
      /<rect width="100%" height="100%" fill="#[\dA-Fa-f]+" \/>/,
      '',
    );
    url = `data:image/svg+xml;base64,${btoa(svg)}`;
  } catch {
    url = '';
  }
  svgCache.set(k, url);
  return url;
}
