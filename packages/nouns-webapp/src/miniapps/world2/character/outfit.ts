// ── Outfit contract: trousers + shoes + their colours (pure, no three.js) ──
//
// The rider's lower half. Part of the appearance like the seed / board /
// deck: saved with the character (ui/CharacterSelect), sent in the
// multiplayer blob as `of` (net/Net.ts, `encodeOutfit`), drawn by
// character/outfitMesh.ts on any NounCharacter (`setOutfit`).
//
// Every NounCharacter starts in `outfitFromSeed(seed)`, so NPCs, crowds and
// players without a saved outfit look varied and the same Noun always wears
// the same thing on every client. Other scenes (the 3D Grand Exchange crowd)
// can call `ch.setOutfit(outfitFromSeed(seed))` or use the default.
//
// Wire format (`of`): four base-36 chars, pants style, pants colour, shoe
// style, shoe colour, e.g. "0315". Unknown future styles / colours fall back
// to the seed default for that field, so older clients never break.

import type { NounSeed } from './NounAppearance';

export const PANTS_STYLES = ['baggy', 'cargo', 'track', 'shorts', 'skinny'] as const;
export type PantsStyle = (typeof PANTS_STYLES)[number];

export const SHOE_STYLES = ['skate', 'hightop', 'runner', 'boot', 'slide'] as const;
export type ShoeStyle = (typeof SHOE_STYLES)[number];

export interface Outfit {
  pants: PantsStyle;
  /** Index into PANTS_COLORS. */
  pantsColor: number;
  shoes: ShoeStyle;
  /** Index into SHOE_COLORS. */
  shoeColor: number;
}

export interface Swatch {
  name: string;
  /** 0xRRGGBB */
  hex: number;
}

export const PANTS_LABELS: Record<PantsStyle, string> = {
  baggy: 'BAGGY JEANS',
  cargo: 'CARGOS',
  track: 'TRACK PANTS',
  shorts: 'SHORTS',
  skinny: 'SKINNY',
};

export const SHOE_LABELS: Record<ShoeStyle, string> = {
  skate: 'CHUNKY SKATE',
  hightop: 'HIGH-TOPS',
  runner: 'RUNNERS',
  boot: 'BOOTS',
  slide: 'SLIDES + SOCKS',
};

/** Trouser colours (indices are on the wire: only ever append). */
export const PANTS_COLORS: readonly Swatch[] = [
  { name: 'INDIGO', hex: 0x2f4a7d },
  { name: 'LIGHT WASH', hex: 0x7f9dc4 },
  { name: 'BLACK', hex: 0x24242a },
  { name: 'CHARCOAL', hex: 0x4c4e57 },
  { name: 'KHAKI', hex: 0xc2a878 },
  { name: 'OLIVE', hex: 0x5d6b3c },
  { name: 'NAVY', hex: 0x1f2a52 },
  { name: 'RED', hex: 0xc8322c },
  { name: 'CREAM', hex: 0xece3cc },
  { name: 'PURPLE', hex: 0x6a3fa0 },
  { name: 'PINK', hex: 0xf08cb4 },
  { name: 'ORANGE', hex: 0xf07a2a },
];

/** Shoe colours (indices are on the wire: only ever append). */
export const SHOE_COLORS: readonly Swatch[] = [
  { name: 'WHITE', hex: 0xf4f1ea },
  { name: 'BLACK', hex: 0x232328 },
  { name: 'NOUNS RED', hex: 0xe8473a },
  { name: 'ROYAL', hex: 0x2d5fd8 },
  { name: 'YELLOW', hex: 0xffcf2e },
  { name: 'GREEN', hex: 0x3fb950 },
  { name: 'PINK', hex: 0xff7eb6 },
  { name: 'ORANGE', hex: 0xff8a1f },
  { name: 'TAN', hex: 0xb7864f },
  { name: 'GREY', hex: 0x8d9099 },
  { name: 'PURPLE', hex: 0x8a4fe0 },
  { name: 'TEAL', hex: 0x22b5b0 },
];

/** Colours a style usually comes in (the seed default picks from these). */
const PANTS_TONES: Record<PantsStyle, readonly number[]> = {
  baggy: [0, 0, 1, 1, 2, 6],
  cargo: [5, 4, 3, 2, 8],
  track: [2, 6, 7, 9, 5, 11],
  shorts: [4, 0, 1, 2, 7, 10],
  skinny: [2, 0, 3, 7, 8],
};
const SHOE_TONES: Record<ShoeStyle, readonly number[]> = {
  skate: [0, 1, 2, 3, 9, 4],
  hightop: [0, 1, 2, 4, 5, 10],
  runner: [0, 3, 6, 7, 11, 2],
  boot: [8, 1, 8, 9],
  slide: [1, 0, 2, 3, 5],
};

/** The default when nothing is saved (the GLB's old look was cargos + red skate shoes). */
export const DEFAULT_OUTFIT: Outfit = {
  pants: 'cargo',
  pantsColor: 5,
  shoes: 'skate',
  shoeColor: 2,
};

/** 32-bit mix (deterministic across clients). */
function mix(h: number, v: number): number {
  h = Math.imul(h ^ (v | 0), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

/** Seed fields only (so the 3D exchange can pass its own seed-shaped type). */
type SeedLike = Pick<NounSeed, 'background' | 'body' | 'accessory' | 'head' | 'glasses'>;

/** A Noun's default outfit: deterministic, so every client dresses it the same. */
export function outfitFromSeed(seed: SeedLike): Outfit {
  let h = 0x51ed270b;
  for (const v of [seed.head, seed.glasses, seed.body, seed.accessory, seed.background])
    h = mix(h, Number.isFinite(v) ? v : 0);
  const pick = (n: number) => {
    h = mix(h, n);
    return h % n;
  };
  const pants = PANTS_STYLES[pick(PANTS_STYLES.length)];
  const pt = PANTS_TONES[pants];
  const shoes = SHOE_STYLES[pick(SHOE_STYLES.length)];
  const st = SHOE_TONES[shoes];
  return { pants, pantsColor: pt[pick(pt.length)], shoes, shoeColor: st[pick(st.length)] };
}

/**
 * The outfit to keep when a Noun's traits change: an explicit pick stays,
 * and a rider still in its seed's default is pinned to the default it wears
 * now (`prevSeed`'s), so a new head doesn't redress the whole rider.
 */
export function keepOutfit(picked: Outfit | null, prevSeed: SeedLike): Outfit {
  return picked ?? outfitFromSeed(prevSeed);
}

/** A random outfit (the select screen's dice). Colours from anywhere in the palettes. */
export function randomOutfit(rand: () => number = Math.random): Outfit {
  const i = (n: number) => Math.min(n - 1, Math.floor(rand() * n));
  return {
    pants: PANTS_STYLES[i(PANTS_STYLES.length)],
    pantsColor: i(PANTS_COLORS.length),
    shoes: SHOE_STYLES[i(SHOE_STYLES.length)],
    shoeColor: i(SHOE_COLORS.length),
  };
}

const isIndex = (v: unknown, n: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n;

/** Is `v` a well-formed Outfit? */
export function isOutfit(v: unknown): v is Outfit {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    (PANTS_STYLES as readonly unknown[]).includes(o.pants) &&
    (SHOE_STYLES as readonly unknown[]).includes(o.shoes) &&
    isIndex(o.pantsColor, PANTS_COLORS.length) &&
    isIndex(o.shoeColor, SHOE_COLORS.length)
  );
}

/**
 * Untrusted input (storage, URL) → an Outfit. Bad fields fall back to
 * `fallback`'s (the seed default); not an object at all → null.
 */
export function parseOutfit(v: unknown, fallback: Outfit = DEFAULT_OUTFIT): Outfit | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return {
    pants: (PANTS_STYLES as readonly unknown[]).includes(o.pants)
      ? (o.pants as PantsStyle)
      : fallback.pants,
    pantsColor: isIndex(o.pantsColor, PANTS_COLORS.length) ? o.pantsColor : fallback.pantsColor,
    shoes: (SHOE_STYLES as readonly unknown[]).includes(o.shoes)
      ? (o.shoes as ShoeStyle)
      : fallback.shoes,
    shoeColor: isIndex(o.shoeColor, SHOE_COLORS.length) ? o.shoeColor : fallback.shoeColor,
  };
}

export function sameOutfit(a: Outfit, b: Outfit): boolean {
  return (
    a.pants === b.pants &&
    a.pantsColor === b.pantsColor &&
    a.shoes === b.shoes &&
    a.shoeColor === b.shoeColor
  );
}

/** Wire key: exactly four base-36 chars. */
export const OUTFIT_KEY_RE = /^[\da-z]{4}$/;

/** Outfit → its 4-char wire key (the blob's `of`). */
export function encodeOutfit(o: Outfit): string {
  return [PANTS_STYLES.indexOf(o.pants), o.pantsColor, SHOE_STYLES.indexOf(o.shoes), o.shoeColor]
    .map(n => Math.max(0, Math.min(35, n)).toString(36))
    .join('');
}

/**
 * A wire key → an Outfit, or null when it isn't one. Fields this client
 * doesn't know (a newer client's style / colour) take `fallback`'s.
 */
export function decodeOutfit(v: unknown, fallback: Outfit = DEFAULT_OUTFIT): Outfit | null {
  if (typeof v !== 'string' || !OUTFIT_KEY_RE.test(v)) return null;
  const [ps, pc, ss, sc] = [...v].map(c => parseInt(c, 36));
  return {
    pants: PANTS_STYLES[ps] ?? fallback.pants,
    pantsColor: pc < PANTS_COLORS.length ? pc : fallback.pantsColor,
    shoes: SHOE_STYLES[ss] ?? fallback.shoes,
    shoeColor: sc < SHOE_COLORS.length ? sc : fallback.shoeColor,
  };
}

/** '#rrggbb' for a swatch (UI). */
export const swatchCss = (s: Swatch) => `#${s.hex.toString(16).padStart(6, '0')}`;
