// ── What a building is: its kind and its name (pure, seeded) ─────────────
//
// A sign on the building decides when there is one (SALOON → a bar, BARBER
// → a barber); otherwise the kind is picked from the door's seed, weighted
// by the building's floor area (a gym or a gallery wants room; a barber or
// a home fits anywhere), and the name is made up to suit it.

import type { InteriorKind } from './contract';

import { hash32, mulberry32, pick, pickWeighted, type Rng } from './rng';

export const INTERIOR_KINDS: readonly InteriorKind[] = [
  'home',
  'cafe',
  'shop',
  'bar',
  'studio',
  'gallery',
  'arcade',
  'barber',
  'laundromat',
  'gym',
];

/** Kind label and a glyph for door signs and the HUD. */
export const KIND_LABEL: Record<InteriorKind, { label: string; icon: string }> = {
  home: { label: 'HOME', icon: '🏠' },
  cafe: { label: 'CAFE', icon: '☕' },
  shop: { label: 'SHOP', icon: '🛍' },
  bar: { label: 'BAR', icon: '🍸' },
  studio: { label: 'STUDIO', icon: '🎧' },
  gallery: { label: 'GALLERY', icon: '🖼' },
  arcade: { label: 'ARCADE', icon: '🕹' },
  barber: { label: 'BARBER', icon: '💈' },
  laundromat: { label: 'LAUNDROMAT', icon: '🧺' },
  gym: { label: 'GYM', icon: '🏋' },
};

const RULES: [RegExp, InteriorKind][] = [
  [/saloon|\bbar\b|cantina|pub\b|tavern|club|lounge|tiki|brew|disco/i, 'bar'],
  [/barber|salon|hair|cuts?\b/i, 'barber'],
  [/laund|wash|suds/i, 'laundromat'],
  [/gym|fitness|dojo|school|high\b|boxing|sports/i, 'gym'],
  [/arcade|games?\b|pinball|bowl/i, 'arcade'],
  [/gallery|museum|opera|\bart\b|exhibit/i, 'gallery'],
  [/studio|records?|radio|\bfm\b|music|vinyl|beats|tapes/i, 'studio'],
  [
    /cafe|café|coffee|\btea\b|diner|pizza|fries|deli|ice ?cream|donut|bakery|fish|taco|noodle|kitchen|grill|snack|burger|juice/i,
    'cafe',
  ],
  [/hotel|\binn\b|house|home|lodge|cabin|hut|villa|apart|flat/i, 'home'],
  [
    /store|shop|market|trading|post|feed|optic|frames|tint|squares|bank|smith|ice house|mart|goods|supply|surf|bodega|kiosk|lens/i,
    'shop',
  ],
];

/** Kind a sign's words suggest, if any. */
export function kindFor(name: string | undefined): InteriorKind | null {
  if (name === undefined) return null;
  for (const [re, k] of RULES) if (re.test(name)) return k;
  return null;
}

/**
 * A kind for a building with no sign: weighted by floor area (m²) and the
 * area it's in (the plaza is a high street, the towns are mostly homes).
 */
export function pickKind(rnd: Rng, floorArea: number, area: string): InteriorKind {
  const big = Math.min(1, Math.max(0, (floorArea - 60) / 160));
  const street = area === 'plaza' ? 1 : 0.6;
  const w: [InteriorKind, number][] = [
    ['home', 3.2 - street * 1.2 - big],
    ['cafe', 1.4 * street + 0.4],
    ['shop', 1.2 * street + 0.4],
    ['bar', 0.9 * street + 0.3 * big],
    ['studio', 0.7],
    ['gallery', 0.25 + 1.0 * big],
    ['arcade', 0.2 + 0.9 * big],
    ['barber', 0.6 - 0.3 * big],
    ['laundromat', 0.5 - 0.2 * big],
    ['gym', 0.15 + 1.1 * big],
  ];
  return pickWeighted(rnd, w);
}

const NOUNISH = [
  'Noggle',
  'Lil',
  'Nounish',
  'Square',
  'Pixel',
  'Prop',
  'Big Head',
  'Red Lens',
  '⌐◨-◨',
  'Auction',
  'Daily',
  'Treasury',
  'CC0',
  'Builder',
  'Fork',
  'Quorum',
];
const SURNAMES = ['Pixel', 'Square', 'Lens', 'Frame', 'Noggs', 'Bidder', 'Voxel', 'Block', 'Ink'];

const KIND_WORDS: Record<InteriorKind, string[]> = {
  home: ['House', 'Flat', 'Place', 'Pad', 'Loft', 'Den'],
  cafe: ['Cafe', 'Coffee', 'Diner', 'Bakery', 'Kitchen', 'Noodles', 'Pizza'],
  shop: ['Bodega', 'Goods', 'Supply', 'Mart', 'Store', 'Corner Shop'],
  bar: ['Bar', 'Tavern', 'Lounge', 'Pub', 'Tiki Bar'],
  studio: ['Records', 'Studio', 'Beats', 'Tapes', 'Sound'],
  gallery: ['Gallery', 'Art Space', 'Museum', 'Prints'],
  arcade: ['Arcade', 'Games', 'Pinball', 'Pixel Palace'],
  barber: ['Barber', 'Cuts', 'Fades', 'Clippers'],
  laundromat: ['Laundromat', 'Suds', 'Wash & Fold', 'Spin Cycle'],
  gym: ['Gym', 'Fitness', 'Iron Club', 'Boxing'],
};

/** A made-up name that suits the kind ("Noggle Coffee", "Pixel's Place"). */
export function nameFor(rnd: Rng, kind: InteriorKind): string {
  const word = pick(rnd, KIND_WORDS[kind]);
  if (kind === 'home') return `${pick(rnd, SURNAMES)}'s ${word}`;
  if (rnd() < 0.3) return `${pick(rnd, SURNAMES)}'s ${word}`;
  return `${pick(rnd, NOUNISH)} ${word}`;
}

/** Kind + name for a door id (and what its sign, if any, says). */
export function identify(
  id: string,
  area: string,
  floorArea: number,
  sign?: string,
  forced?: InteriorKind,
): { kind: InteriorKind; name: string } {
  const rnd = mulberry32(hash32(`kind:${id}`));
  const kind = forced ?? kindFor(sign) ?? pickKind(rnd, floorArea, area);
  const name = sign ?? nameFor(rnd, kind);
  return { kind, name };
}
