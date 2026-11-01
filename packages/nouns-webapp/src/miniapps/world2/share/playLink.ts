// ── Play-as links: one URL that drops someone into Noun World as your rider ─
//
// noun.wtf/world?seed=<key> starts the game as that Noun (World2Page reads
// `seed` and `name`). The key is the rider's seed key, the same string the
// game sends on the wire (`bg-body-acc-head-glasses`, plus `-m` for a
// missingnoun rider: character/NounAppearance.ts `seedKey`). The share card
// for a key is /og/world/<key>.png (1200 × 630, X / Discord / iMessage) and
// /og/world/fc/<key>.png (1200 × 800, the 3:2 Farcaster embed), drawn by
// netlify/functions/og-rider-image.ts.
//
// Pure (no three.js): netlify functions import it too.

export const SITE = 'https://noun.wtf';

export interface RiderSeed {
  background: number;
  body: number;
  accessory: number;
  head: number;
  glasses: number;
  missingnoun?: boolean;
}

/** Trait indexes are small whole numbers; anything else is a bad link. */
const MAX_TRAIT = 999;

/** `bg-body-acc-head-glasses`, plus `-m` for a missingnoun rider (= NounAppearance.seedKey). */
export function riderKey(s: RiderSeed): string {
  const k = `${s.background}-${s.body}-${s.accessory}-${s.head}-${s.glasses}`;
  return s.missingnoun === true ? `${k}-m` : k;
}

/**
 * A key from a URL, strictly: five whole numbers 0…999 and an optional `m`.
 * Stricter than the game's parseSeedKey (which accepts any finite number),
 * because a server draws it and a cache keeps it.
 */
export function parseRiderKey(k: string | null | undefined): RiderSeed | null {
  if (typeof k !== 'string' || k.length > 40) return null;
  const m = /^(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})(-m)?$/.exec(k);
  if (m === null) return null;
  const n = m.slice(1, 6).map(Number);
  if (n.some(x => x > MAX_TRAIT)) return null;
  const seed: RiderSeed = {
    background: n[0]!,
    body: n[1]!,
    accessory: n[2]!,
    head: n[3]!,
    glasses: n[4]!,
  };
  if (m[6] !== undefined) seed.missingnoun = true;
  return seed;
}

/** A rider name fit for a URL and a card: printable, trimmed, at most 20 characters. */
export function cleanRiderName(name: string | null | undefined): string {
  if (typeof name !== 'string') return '';
  return name
    .replace(/[^\p{L}\p{N} _.'!?-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
}

/** noun.wtf/world?seed=<key>[&name=<name>]: play as this rider. */
export function playAsUrl(seed: RiderSeed, opts: { name?: string; origin?: string } = {}): string {
  const u = new URL('/world', opts.origin ?? SITE);
  u.searchParams.set('seed', riderKey(seed));
  const name = cleanRiderName(opts.name);
  if (name.length > 0) u.searchParams.set('name', name);
  return u.toString();
}

export type CardKind = 'og' | 'fc';

/** The share card for a rider key: `og` 1200 × 630, `fc` 1200 × 800 (Farcaster's 3:2). */
export function riderCardUrl(key: string, kind: CardKind, origin = SITE): string {
  return `${origin}/og/world/${kind === 'fc' ? 'fc/' : ''}${key}.png`;
}

/** The plain /world card (no rider): the Farcaster embed and the og:image for noun.wtf/world. */
export const WORLD_CARD = `${SITE}/fc/world-card.png`;
/** The same, 1200 × 630 (og:image). */
export const WORLD_OG = `${SITE}/fc/world-og.png`;
export const WORLD_SPLASH = `${SITE}/fc/splash.png`;
export const SPLASH_BG = '#0b0b12';

/**
 * The Farcaster mini app embed (`fc:miniapp`, and `fc:frame` for older
 * clients with type `launch_frame`): an image, one button, and the app to
 * open. https://miniapps.farcaster.xyz/docs/guides/sharing
 */
export function miniAppEmbed(
  opts: { imageUrl: string; url: string; button?: string },
  legacy = false,
): Record<string, unknown> {
  return {
    version: legacy ? 'next' : '1',
    imageUrl: opts.imageUrl,
    button: {
      // Farcaster caps the button title at 32 characters
      title: (opts.button ?? 'PLAY AS ME').slice(0, 32),
      action: {
        type: legacy ? 'launch_frame' : 'launch_miniapp',
        name: 'Noun World',
        url: opts.url,
        splashImageUrl: WORLD_SPLASH,
        splashBackgroundColor: SPLASH_BG,
      },
    },
  };
}

export interface WorldShareMeta {
  title: string;
  description: string;
  /** og:image / twitter:image (1200 × 630). */
  image: string;
  /** The Farcaster embed's 3:2 image. */
  fcImage: string;
  /** Canonical URL (og:url) and the mini app's launch URL. */
  url: string;
  button: string;
}

/** What /world?seed=…&name=… unfurls as; plain /world gets the game's own card. */
export function worldShareMeta(query: {
  seed?: string | null;
  name?: string | null;
}): WorldShareMeta {
  const seed = parseRiderKey(query.seed);
  if (seed === null) {
    return {
      title: 'Noun World',
      description:
        'One link drops you into a city. Skate, parkour, play pool, battle. No download.',
      image: WORLD_OG,
      fcImage: WORLD_CARD,
      url: `${SITE}/world`,
      button: 'PLAY NOUN WORLD',
    };
  }
  const key = riderKey(seed);
  const name = cleanRiderName(query.name);
  const who = name.length > 0 ? name : seed.missingnoun === true ? 'a missingnoun' : 'this Noun';
  return {
    title: name.length > 0 ? `Play as ${name} in Noun World` : 'Play as me in Noun World',
    description: `Drop into the city as ${who}. Runs in your browser, no download.`,
    image: riderCardUrl(key, 'og'),
    fcImage: riderCardUrl(key, 'fc'),
    url: playAsUrl(seed, { name }),
    button: 'PLAY AS ME',
  };
}
