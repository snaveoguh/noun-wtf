// ── Who lives (or works) there (pure, seeded from the door id) ───────────
//
// 1–4 Nouns per interior. Public places have an owner (behind the counter,
// at the decks, at the desk) plus a few regulars; homes have a household.
// Their look is a Noun seed (any trait combination of the on-chain art),
// fixed per door, and their first mood comes from your respect tier.

import type { InteriorKind, Resident, RespectTier } from './contract';
import type { Layout } from './layout';

import { hash32, int, mulberry32, pick } from './rng';

/** Trait counts of the Nouns art (ImageData: backgrounds, bodies, accessories, heads, glasses). */
export const TRAITS = [2, 31, 145, 258, 24] as const;

export type SeedTuple = [number, number, number, number, number];

export interface ResidentDef extends Resident {
  seed: SeedTuple;
  /** The spot (layout.spots index) they start at; owners keep to theirs. */
  home: number;
  /** A little about how they are: hospitality (offers food) and how watchful they are. */
  generous: number;
  watchful: number;
  /** Set when an agent (src/miniapps/agents) is this resident (agents/rooms.ts withAgent). */
  agent?: string;
}

const FIRST = [
  'Pixel',
  'Lil',
  'Squarey',
  'Noggs',
  'Prop',
  'Blocky',
  'Vox',
  'Frame',
  'Lens',
  'Bidz',
  'Quorum',
  'Ink',
  'Patch',
  'Fork',
  'Beans',
  'Mochi',
  'Taco',
  'Sprout',
  'Disco',
  'Gizmo',
];
const LAST = ['', ' Jr.', ' the Third', ' Square', ' McNoun', ' von Pixel', ''];

/** First mood (−1…1) by tier. */
export function moodFor(tier: RespectTier): number {
  switch (tier) {
    case 'outcast':
      return -0.6;
    case 'stranger':
      return -0.05;
    case 'local':
      return 0.2;
    case 'regular':
      return 0.45;
    default:
      return 0.8;
  }
}

const OWNED: ReadonlySet<InteriorKind> = new Set([
  'cafe',
  'shop',
  'bar',
  'studio',
  'gallery',
  'arcade',
  'barber',
  'laundromat',
  'gym',
]);

/** Who's in. Deterministic per door (only their mood depends on your tier). */
export function residentsFor(doorId: string, l: Layout, tier: RespectTier): ResidentDef[] {
  const rnd = mulberry32(hash32(`folk:${doorId}`));
  const owned = OWNED.has(l.kind);
  const n = Math.min(4, l.kind === 'home' ? int(rnd, 1, 3) : 1 + int(rnd, 0, 2));
  const ownerSpot = l.spots.findIndex(s => s.owner === true);
  const free = l.spots.map((_, i) => i).filter(i => i !== ownerSpot);
  const out: ResidentDef[] = [];
  const base = moodFor(tier);
  for (let i = 0; i < n; i++) {
    const seed = TRAITS.map(c => Math.floor(rnd() * c)) as SeedTuple;
    const owner = owned && i === 0;
    const role: Resident['role'] = owner
      ? 'owner'
      : l.kind === 'home'
        ? 'resident'
        : rnd() < 0.3
          ? 'staff'
          : 'guest';
    const name = `${pick(rnd, FIRST)}${pick(rnd, LAST)}`;
    const home =
      owner && ownerSpot >= 0
        ? ownerSpot
        : free.length > 0
          ? free[(i * 3 + int(rnd, 0, 7)) % free.length]!
          : 0;
    const temper = (rnd() - 0.5) * 0.3;
    out.push({
      id: `${doorId}#${i}`,
      name,
      seed,
      role,
      mood: Math.max(-1, Math.min(1, base + temper)),
      home,
      generous: 0.3 + rnd() * 0.7,
      watchful: 0.3 + rnd() * 0.7,
    });
  }
  return out;
}
