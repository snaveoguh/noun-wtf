// Everything noun.wtf does, condensed into one directory. Each entry opens in
// the navigator window (or a dedicated app window when `app` is set).

import type { AppKind } from './osStore';

export interface Entry {
  path: string;
  name: string;
  blurb: string;
  app?: AppKind;
  hot?: boolean;
}

export interface Section {
  id: string;
  title: string;
  tag: string;
  entries: Entry[];
}

export const CATALOG: Section[] = [
  {
    id: 'art',
    title: 'ART / CULTURE',
    tag: 'the actual point',
    entries: [
      {
        path: '/pip3',
        name: 'PIP3',
        blurb: '60r90 animations. low-res, high-signal.',
        app: 'pip3',
        hot: true,
      },
      {
        path: '/world',
        name: 'NOUN WORLD',
        blurb: 'skate the plaza. voice, graffiti, pirate radio.',
        hot: true,
      },
      { path: '/playground', name: 'PLAYGROUND', blurb: 'mix traits, make a noun, dream one up.' },
      { path: '/studio', name: 'STUDIO', blurb: 'make things with noun parts.' },
      { path: '/traits', name: 'TRAITS', blurb: 'every head, body, accessory, glasses.' },
      { path: '/terraforms', name: 'TERRAFORMS', blurb: 'on-chain land, rendered.' },
      { path: '/nonsense', name: 'NONSENSE', blurb: 'exactly what it says.' },
      {
        path: '/world/classic',
        name: 'WORLD (CLASSIC)',
        blurb: 'the old world, kept for the archive.',
      },
    ],
  },
  {
    id: 'free',
    title: 'FREEDOM',
    tag: 'no reserve. anyone can propose.',
    entries: [
      {
        path: '/nounv2',
        name: 'NOUN V2',
        blurb: 'the free dao. no reserve to raid, built here.',
        hot: true,
      },
      { path: '/v2', name: 'V2 AUCTION', blurb: 'one v2 noun a day. bid.' },
      { path: '/grants', name: 'GRANTS', blurb: 'anyone can propose. 24h, no quorum.' },
      { path: '/hackathons', name: 'HACKATHONS', blurb: 'build weekends.' },
    ],
  },
  {
    id: 'gov',
    title: 'THE CAPTURED DAO',
    tag: 'watch them vote',
    entries: [
      { path: '/vote', name: 'PROPOSALS', blurb: 'what the whales are passing this week.' },
      { path: '/candidates', name: 'CANDIDATES', blurb: 'ideas waiting for a sponsor.' },
      { path: '/create-proposal', name: 'PROPOSE', blurb: 'put something on chain anyway.' },
      { path: '/delegate', name: 'DELEGATE', blurb: 'hand your vote to someone nounish.' },
      { path: '/nounders', name: 'NOUNDERS', blurb: 'who started it.' },
    ],
  },
  {
    id: 'mkt',
    title: 'MARKET',
    tag: 'one noun a day, forever',
    entries: [
      { path: '/marketplace', name: 'MARKETPLACE', blurb: 'buy and sell nouns.' },
      { path: '/predictions', name: 'PREDICTIONS', blurb: 'bet on governance outcomes.' },
      { path: '/crystal-ball', name: 'CRYSTAL BALL', blurb: 'see the next noun before it mints.' },
      { path: '/settlers', name: 'SETTLERS', blurb: 'who settles the auctions.' },
      { path: '/gas', name: 'GAS', blurb: 'gas leaderboard.' },
    ],
  },
  {
    id: 'net',
    title: 'NETWORK',
    tag: 'look around',
    entries: [
      { path: '/probe', name: 'PROBE', blurb: 'explore every noun, every dream.' },
      { path: '/explore/wallet', name: 'WALLETS', blurb: 'who holds what, who votes how.' },
      { path: '/feed', name: 'FEED', blurb: 'everything happening, live.' },
      { path: '/stats', name: 'STATS', blurb: 'numbers.' },
      { path: '/dashboard', name: 'DASHBOARD', blurb: 'the treasury at a glance.' },
      { path: '/underground', name: 'UNDERGROUND', blurb: 'the basement.' },
    ],
  },
];

const TITLES: [RegExp, string][] = [
  [/^\/noun\/(\d+)/, 'NOUN $1'],
  [/^\/v2\/noun\/(\d+)/, 'V2 NOUN $1'],
  [/^\/vote\/(\d+)/, 'PROP $1'],
  [/^\/candidates\/.+/, 'CANDIDATE'],
  [/^\/explore\/wallet\/(.+)/, 'WALLET $1'],
];

export function titleForPath(path: string): string {
  for (const [re, t] of TITLES) {
    const m = path.match(re);
    if (m) return t.replace('$1', m[1] ?? '');
  }
  for (const s of CATALOG) for (const e of s.entries) if (e.path === path) return e.name;
  const seg = path.split('/').filter(Boolean)[0];
  return seg !== undefined ? seg.toUpperCase().replace(/-/g, ' ') : 'NOUN.WTF';
}
