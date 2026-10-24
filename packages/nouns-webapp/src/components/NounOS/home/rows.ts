// The homescreen shelves: what goes in each row, in what order. Pure, so
// the layout is testable; HomeScreen turns items into cards.

import type { Entry, Section } from '../catalog';

import { hostOf, KIND_LABEL, type CommunityEntry } from './community';

export type GameId = 'world' | 'hoops' | 'warfare';

/** A pre-rendered clip: webm first, mp4 fallback, poster still. */
export interface Clip {
  webm: string;
  mp4: string;
  poster: string;
  /** The file has a soundtrack (played only if the visitor turned sound on) */
  audio?: boolean;
}

export const CLIPS = {
  sizzle: {
    webm: '/home/hero-sizzle.webm',
    mp4: '/home/hero-sizzle.mp4',
    poster: '/home/hero-sizzle-poster.jpg',
  },
  worldVhs: {
    webm: '/home/world-vhs.webm',
    mp4: '/home/world-vhs.mp4',
    poster: '/home/world-vhs-poster.jpg',
    audio: true,
  },
  hoops: {
    webm: '/home/hero-hoops.webm',
    mp4: '/home/hero-hoops.mp4',
    poster: '/home/hero-hoops-poster.jpg',
  },
} satisfies Record<string, Clip>;

export interface Game {
  id: GameId;
  /** Hover preview on its card (Netflix-style) */
  preview?: Clip;
  name: string;
  /** Wide poster: the hero slide and the MORE INFO sheet */
  cover: string;
  /** 2:3 portrait box art for its shelf card */
  card: string;
  /** Where the interesting part of the cover is when it's cropped wide */
  focus: string;
  teaser: string;
  tagline: string;
  facts: string[];
  cta: string;
  loading: string;
}

export const GAMES: Game[] = [
  {
    id: 'world',
    name: 'Noun World',
    cover: '/world2/cover-1200.webp',
    card: '/home/covers/world.webp',
    preview: CLIPS.worldVhs,
    focus: '50% 62%',
    teaser:
      'Skate a pixel plaza with everyone online. Spray graffiti, talk on voice, chase records and tune into NOUN FM.',
    tagline: 'SKATE · SPRAY · TALK',
    facts: [
      'Multiplayer, in the browser',
      'Voice chat + graffiti walls',
      'Records, missions, NOUN FM',
    ],
    cta: 'PLAY',
    loading: 'loading noun world. grab a board',
  },
  {
    id: 'hoops',
    name: 'Noun Hoops',
    cover: '/world2/hoops-cover.webp',
    card: '/home/covers/hoops.webp',
    focus: '72% 58%',
    teaser:
      'Three on three at the Noun Jersey court. Cross them up, break ankles, dunk on a Noun with a toaster for a head.',
    tagline: 'DUNK · CROSS · SWISH',
    facts: ['1v1 up to 5v5', 'Play friends or the Jersey crew', 'Runs inside Noun World'],
    cta: 'PLAY 3V3',
    loading: 'lacing up. off to the noun jersey court',
  },
  {
    id: 'warfare',
    name: 'Noun Warfare',
    cover: '/warfare/cover.webp',
    card: '/home/covers/warfare.webp',
    focus: '72% 58%',
    teaser:
      'Red noggles versus blue noggles. A paintball arena shooter: splat the other team, paint the turf, be the last one dry.',
    tagline: 'SPLAT · CAPTURE · REPEAT',
    facts: [
      'Team Splat, Turf War, Elimination, FFA',
      'Bots or real players',
      'Pick your Noun, pick your gun',
    ],
    cta: 'LOCK & LOAD',
    loading: 'loading noun warfare. paint up',
  },
];

/**
 * The hero's rotation. Adding footage later is just another entry here: a
 * `clip` plays (muted unless sound is on, poster only for reduced motion /
 * save-data), otherwise `still` gets the slow Ken Burns.
 */
export interface Slide {
  key: string;
  /** Title (first word white, the rest in the accent colour) */
  title: string;
  eyebrow: string;
  tagline: string;
  teaser: string;
  accent: string;
  clip?: Clip;
  still?: string;
  /** object-position for the cropped media */
  focus: string;
  /** The game PLAY launches (and MORE INFO describes) */
  game: GameId;
  /** Label for the primary button (defaults to the game's CTA) */
  cta?: string;
  /** Brand slide: the second button browses the shelves instead of MORE INFO */
  browse?: boolean;
  /** A voice-over read over it, once per page view, sound on only (voiceOver.ts) */
  vo?: string;
  /**
   * A sound bed under it while it shows, sound on only (bed.ts): a looping
   * music file plus synthesised ambience, faded in and out with the slide.
   */
  bed?: Bed;
  /** How long it stays up, ms */
  ms: number;
}

/** A slide's sound bed: a seamless music loop + the ambience to put under it. */
export interface Bed {
  track: string;
  ambience: 'court';
}

export const HERO_SLIDES: Slide[] = [
  {
    key: 'sizzle',
    title: 'Noun WTF',
    eyebrow: 'NOW SHOWING',
    tagline: 'PLAY · MAKE · VOTE · REPEAT',
    teaser:
      'The underground side of Nouns. Games you can jump into in seconds, art, a free DAO and every tool for watching the old one. Pick something off the shelf.',
    accent: '#ff3b3b',
    clip: CLIPS.sizzle,
    focus: '50% 40%',
    game: 'world',
    cta: 'PLAY NOUN WORLD',
    browse: true,
    vo: '/home/vo-intro.mp3',
    ms: 16900,
  },
  {
    key: 'world-vhs',
    title: 'Noun World',
    eyebrow: 'FEATURED GAME · FOUND TAPE, OCT 1996',
    tagline: 'SKATE · SPRAY · TALK',
    teaser: GAMES[0]!.teaser,
    accent: '#ffd400',
    clip: CLIPS.worldVhs,
    focus: '50% 50%',
    game: 'world',
    ms: 14000,
  },
  {
    key: 'hoops',
    title: 'Noun Hoops',
    eyebrow: 'FEATURED GAME',
    tagline: GAMES[1]!.tagline,
    teaser: GAMES[1]!.teaser,
    accent: '#ff9a1f',
    clip: CLIPS.hoops,
    focus: '50% 50%',
    game: 'hoops',
    bed: { track: '/home/hoops-track.mp3', ambience: 'court' },
    ms: 12000,
  },
  {
    key: 'warfare',
    title: 'Noun Warfare',
    eyebrow: 'FEATURED GAME',
    tagline: GAMES[2]!.tagline,
    teaser: GAMES[2]!.teaser,
    accent: '#3dff8a',
    still: GAMES[2]!.cover,
    focus: GAMES[2]!.focus,
    game: 'warfare',
    ms: 9000,
  },
];

export interface Client {
  url: string;
  name: string;
  blurb: string;
  /** 2:3 portrait poster (a tilted screenshot of the site + a Noun) */
  card: string;
}

/** Other Nouns clients (each checked live before it was listed). Open in a new tab. */
export const CLIENTS: Client[] = [
  {
    url: 'https://nouns.wtf',
    name: 'NOUNS.WTF',
    blurb: 'the original. daily auction and the dao.',
    card: '/home/covers/client-nouns-wtf.webp',
  },
  {
    url: 'https://www.nouns.camp',
    name: 'NOUNS CAMP',
    blurb: 'governance client. read props, vote, propose.',
    card: '/home/covers/client-nouns-camp.webp',
  },
  {
    url: 'https://nouns.game',
    name: 'NOUNS GAME',
    blurb: 'another nounish corner of the internet. go play.',
    card: '/home/covers/client-nouns-game.webp',
  },
  {
    url: 'https://lilnouns.wtf',
    name: 'LIL NOUNS',
    blurb: 'the lil sibling dao. lil nouns, lil auctions, own treasury.',
    card: '/home/covers/client-lilnouns.webp',
  },
  {
    url: 'https://nouns.build',
    name: 'NOUNS BUILDER',
    blurb: 'spin up your own nouns-style dao.',
    card: '/home/covers/client-nouns-build.webp',
  },
];

/**
 * Catalog pages that have their own 2:3 poster in /home/covers (named after
 * the path, slashes as dashes). Anything else, community submissions
 * included, falls back to the generated box art.
 */
const COVERED_PATHS = new Set([
  '/icecreamvan',
  '/playground',
  '/crystal-ball',
  '/pip3',
  '/studio',
  '/traits',
  '/terraforms',
  '/nonsense',
  '/world/classic',
  '/nounv2',
  '/v2',
  '/grants',
  '/hackathons',
  '/vote',
  '/candidates',
  '/create-proposal',
  '/delegate',
  '/nounders',
  '/marketplace',
  '/exchange',
  '/predictions',
  '/settlers',
  '/gas',
  '/probe',
  '/explore/wallet',
  '/feed',
  '/dashboard',
  '/underground',
]);

/** Posters whose file isn't named after the path. */
const COVER_FILES: Partial<Record<string, string>> = {
  '/world/voice': 'voice-booth',
  '/books/meme-value': 'meme-value',
};

/** The poster for a catalog path, if it has one. */
export function coverForPath(path: string): string | undefined {
  const file = COVER_FILES[path];
  if (file !== undefined) return `/home/covers/${file}.webp`;
  if (!COVERED_PATHS.has(path)) return undefined;
  return `/home/covers/${path.replace(/^\//, '').replace(/\//g, '-')}.webp`;
}

/** Extra things to play, from the catalog, after the three games. */
const PLAY_PATHS = ['/world/voice', '/icecreamvan', '/playground', '/crystal-ball', '/pip3'];

export type Action =
  | { t: 'game'; id: GameId }
  | { t: 'entry'; entry: Entry }
  | { t: 'external'; url: string }
  | { t: 'submit' };

export interface Item {
  key: string;
  title: string;
  blurb: string;
  /** Section / group id, for colours and generated art */
  group: string;
  /** Little label on the box ("ART / CULTURE", "nouns.camp") */
  label: string;
  hot?: boolean;
  cover?: string;
  coverFocus?: string;
  /** The cover is 5:4: shown whole under the box's platform band */
  coverWide?: boolean;
  /** Words stacked under a wide cover (the game's tagline) */
  coverTag?: string;
  preview?: Clip;
  action: Action;
  /** Opens off-site */
  external?: boolean;
}

export interface Row {
  id: string;
  title: string;
  tagline: string;
  group: string;
  items: Item[];
}

/** Short section names for the little label on each box */
const SHORT_LABEL: Record<string, string> = { gov: 'CAPTURED DAO', art: 'ART / CULTURE' };

const GAME_BY_PATH: Partial<Record<string, GameId>> = { '/world': 'world', '/warfare': 'warfare' };

function gameItem(g: Game, group: string, label: string): Item {
  return {
    key: `game:${g.id}`,
    title: g.name.toUpperCase(),
    blurb: g.teaser,
    group,
    label,
    hot: true,
    cover: g.card,
    coverFocus: '50% 50%',
    preview: g.preview,
    action: { t: 'game', id: g.id },
  };
}

function entryItem(e: Entry, s: Section, group = s.id): Item {
  const gid = GAME_BY_PATH[e.path];
  const g = gid !== undefined ? GAMES.find(x => x.id === gid) : undefined;
  if (g) return { ...gameItem(g, group, s.title), key: `${s.id}:${e.path}`, blurb: e.blurb };
  return {
    key: `${s.id}:${e.path}`,
    title: e.name,
    blurb: e.blurb,
    group,
    label: SHORT_LABEL[s.id] ?? s.title,
    hot: e.hot,
    cover: coverForPath(e.path),
    coverFocus: '50% 50%',
    action: { t: 'entry', entry: e },
  };
}

export function buildRows(catalog: Section[], community: CommunityEntry[] = []): Row[] {
  const byPath = new Map<string, { e: Entry; s: Section }>();
  for (const s of catalog) for (const e of s.entries) byPath.set(e.path, { e, s });

  const play: Item[] = GAMES.map(g => gameItem(g, 'play', 'GAME'));
  for (const p of PLAY_PATHS) {
    const hit = byPath.get(p);
    if (hit) play.push({ ...entryItem(hit.e, hit.s, 'play'), key: `play:${p}`, label: 'PLAY' });
  }

  const rows: Row[] = [
    {
      id: 'play',
      title: 'Play now',
      tagline: 'games you can be in, in ten seconds',
      group: 'play',
      items: play,
    },
  ];
  for (const s of catalog) {
    rows.push({
      id: s.id,
      title: s.title,
      tagline: s.tag,
      group: s.id,
      items: s.entries.map(e => entryItem(e, s)),
    });
  }
  rows.push({
    id: 'clients',
    title: 'Other Nouns clients',
    tagline: 'same nouns, other doors. opens in a new tab',
    group: 'clients',
    items: CLIENTS.map(c => ({
      key: `client:${c.url}`,
      title: c.name,
      blurb: c.blurb,
      group: 'clients',
      label: hostOf(c.url),
      cover: c.card,
      coverFocus: '50% 50%',
      action: { t: 'external', url: c.url },
      external: true,
    })),
  });
  rows.push({
    id: 'community',
    title: 'Community',
    tagline: 'built by nouns, for nouns. add yours',
    group: 'community',
    items: [
      {
        key: 'community:submit',
        title: 'SUBMIT YOURS',
        blurb: 'made a game, a page, a tool? put it on the shelf.',
        group: 'community',
        label: 'OPEN CALL',
        action: { t: 'submit' },
      },
      ...community.map(c => ({
        key: `community:${c.id}`,
        title: c.name.toUpperCase(),
        blurb: c.blurb,
        group: 'community',
        label: `${KIND_LABEL[c.kind]} · ${hostOf(c.url)}`,
        action: { t: 'external' as const, url: c.url },
        external: true,
      })),
    ],
  });
  return rows;
}

/** Search across every shelf: name first, then blurb / label. Dedupes repeats. */
export function searchItems(rows: Row[], q: string, limit = 7): Item[] {
  const needle = q.trim().toLowerCase();
  if (needle === '') return [];
  const seen = new Set<string>();
  const scored: { it: Item; s: number }[] = [];
  for (const r of rows)
    for (const it of r.items) {
      if (it.action.t === 'submit') continue;
      const id =
        it.action.t === 'entry'
          ? it.action.entry.path
          : it.action.t === 'game'
            ? `game:${it.action.id}`
            : it.key;
      if (seen.has(id)) continue;
      const name = it.title.toLowerCase();
      const s = name.startsWith(needle)
        ? 3
        : name.includes(needle)
          ? 2
          : `${it.blurb} ${it.label}`.toLowerCase().includes(needle)
            ? 1
            : 0;
      if (s === 0) continue;
      seen.add(id);
      scored.push({ it, s });
    }
  return scored
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(x => x.it);
}
