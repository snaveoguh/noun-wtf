// ─── Agent NounIRL — What's on noun.wtf ─────────────────────────────────────
//
// Everything the chat bar and NounIRL know about the site itself: every game
// on the NounOS homescreen deck, every section of the catalog, and the few
// facts we have about the owner. The model has no other way to know what ships
// here, so keep this in step with the webapp:
//
//   games     → packages/nouns-webapp/src/components/NounOS/home/rows.ts (GAMES)
//   sections  → packages/nouns-webapp/src/components/NounOS/catalog.ts
//   details   → the repo's CLAUDE.md (one section per game / feature)
//
// siteKnowledge.test.ts fails when a game id or catalog path is added to the
// webapp without an entry here. One line each: what it is and how to get in.

export interface SiteGame {
  /** GameId in rows.ts */
  id: string;
  name: string;
  /** Where it opens */
  open: string;
  about: string;
}

export const SITE_GAMES: SiteGame[] = [
  {
    id: 'world',
    name: 'Noun World',
    open: '/world',
    about:
      'multiplayer 3D skate city in the browser, played as your Noun (3D heads, real noggles). Board tricks (ollies, flips, grinds, manuals, powerslides), walking, climbing and parkour moves on foot, graffiti walls, voice chat, records and missions, bars and rooms you can walk into (players see each other inside), a respect score for how you act (gifts, helping, buying local up; stealing, bailing into people down), and in-game radio (COMMUNITY RADIO, NOUN BEATS). Most of the other games run inside it. Top speed: the city caps you at about 61 km/h (17 m/s); the downhill has no limit, so the real answer is the fastest-of-all-time leaderboard (the 🏁 chip; use the world_fastest tool, never make up a number)',
  },
  {
    id: 'hoops',
    name: 'Noun Hoops',
    open: '/world?play=hoops&mode=3',
    about:
      'street basketball at the Noun Jersey court, 1v1 up to 5v5, against friends or the Jersey crew. Runs inside Noun World',
  },
  {
    id: 'breaks',
    name: 'Noun Breaks',
    open: '/world?play=breaks',
    about:
      'breakdance battles at the plaza cypher: VS CPU, 1v1 online, 2v2 / 3v3 crews, or WATCH. Hit 24 moves on the beat (toprock, power, freezes); three judges score technique, musicality, originality and power. You can also freestyle anywhere outside in Noun World with the comma key or the 🕺 button',
  },
  {
    id: 'hideseek',
    name: 'Hide & Seek',
    open: '/world?play=hideseek',
    about:
      "hide and seek across the whole plaza city, VS CPU or 2–12 players online. Hiders' names are hidden; found hiders join the seekers. Runs inside Noun World",
  },
  {
    id: 'warfare',
    name: 'Noun Warfare',
    open: '/warfare',
    about:
      'paintball arena shooter, red noggles vs blue noggles. Modes: Team Splat, Turf War, Elimination, FFA; bots or real players; pick your Noun and your gun',
  },
  {
    id: 'drop',
    name: 'The Big Drop',
    open: '/world?drop=1 once unlocked (locked until you find the Keymaker in Noun World)',
    about:
      "a 1,000 km snow peak behind the Noggle Bowl's deepest door. 40% gravity, huge airs, no top speed, NPC hoverboarders, and an SSX-style course over the first ~5 km (START to FINISH, about 3 minutes: checkpoints, boost, rails, an ice cave, a shortcut at THE SPLIT). Nothing done there counts toward stats",
  },
  {
    id: 'parkour',
    name: 'Noun Parkour',
    open: '/world?play=parkour (or K on foot in Noun World)',
    about:
      'rooftop time trials: THE GAUNTLET, NORTH ROOFS and LAMP LINE. Wall runs, tic-tacs, ledge hangs and leaps, pole swings, slides and rolls, checkpoint to checkpoint, with gold / silver / bronze times and a ghost of your best run. Bests are kept locally in your browser',
  },
  {
    id: 'drive',
    name: 'Noun Drive',
    open: '/world?play=drive',
    about:
      'take any of eight cars off the plaza kerb, each with its own handling: a roadster that flies (the ROADSTAR: X at speed), a 1947 racer, a lowrider, a monster truck and more. Drift, boost, park on a roof. Runs inside Noun World',
  },
  {
    id: 'pool',
    name: 'Noun Pool',
    open: '/world?play=pool',
    about:
      'eight-ball in a pool hall, or on any bar pool table in Noun World. Real ball physics and spin; VS CPU (easy, normal, hard, pro), 1v1 with someone in the same room, or WATCH. Wins add respect',
  },
];

export interface SiteSection {
  path: string;
  name: string;
  about: string;
}

/** The catalog shelves, in catalog.ts order, plus a few routes it doesn't list. */
export const SITE_SECTIONS: SiteSection[] = [
  // ART / CULTURE
  {
    path: '/books/meme-value',
    name: 'MEME VALUE',
    about:
      'the book "MEME VALUE" by LIL 67 (the site owner\'s own book) as a flipbook: 252 pages with search and a text panel; /memevalue works too and ?p=N opens a page',
  },
  { path: '/pip3', name: 'PIP3', about: '60r90 animations' },
  { path: '/icecreamvan', name: 'ICE CREAM VAN', about: 'icecreamvan.eth; walk round the van' },
  {
    path: '/world/voice',
    name: 'VOICE BOOTH',
    about:
      "record your Noun World rider's callout lines with your mic (also in game: Settings → 🎙 VOICE BOOTH). Clips stay in your browser unless you tick the consent box to share them. You can export a dataset to train your own voice model and load it back; it is never uploaded",
  },
  {
    path: '/cc0',
    name: 'CC0 LIBRARY',
    about:
      'free Nouns art, voxels, sounds and 3D: a curated archive plus community uploads (CC0 consent required, an admin approves each upload before it shows)',
  },
  { path: '/playground', name: 'PLAYGROUND', about: 'mix traits, make a noun, dream one up' },
  { path: '/studio', name: 'STUDIO', about: 'make things with noun parts' },
  {
    path: '/terraforms',
    name: 'TERRAFORMS',
    about: 'Mathcastles Terraforms, on-chain land, rendered',
  },
  { path: '/world', name: 'NOUN WORLD', about: 'see the games above' },
  { path: '/warfare', name: 'NOUN WARFARE', about: 'see the games above' },
  { path: '/traits', name: 'TRAITS', about: 'every head, body, accessory and glasses' },
  {
    path: '/nonsense',
    name: 'NONSENSE',
    about:
      "Nouns DAO treasury flows: what it holds now (live, per holder), where the money came from (auction proceeds), where it went (executed proposals' payments decoded, fork payouts, ETH sold for USDC) and a reconciliation between them. Quote figures only from the page, never from memory",
  },
  {
    path: '/world/classic',
    name: 'WORLD (CLASSIC)',
    about: 'the old Noun World, kept for the archive',
  },
  // FREEDOM
  { path: '/nounv2', name: 'NOUN V2', about: 'the NounV2 DAO: no reserve, anyone can propose' },
  { path: '/v2', name: 'V2 AUCTION', about: 'one NounV2 a day; bid' },
  { path: '/grants', name: 'GRANTS', about: 'small grants: anyone can propose, 24h, no quorum' },
  { path: '/hackathons', name: 'HACKATHONS', about: 'build weekends' },
  // THE CAPTURED DAO
  { path: '/vote', name: 'PROPOSALS', about: 'mainnet Nouns proposals (/v2/vote for NounV2)' },
  { path: '/candidates', name: 'CANDIDATES', about: 'proposal candidates waiting for sponsors' },
  { path: '/create-proposal', name: 'PROPOSE', about: 'put a proposal on chain' },
  { path: '/delegate', name: 'DELEGATE', about: 'delegate your votes' },
  { path: '/nounders', name: 'NOUNDERS', about: 'who started Nouns' },
  // MARKET
  { path: '/marketplace', name: 'MARKETPLACE', about: 'buy and sell Nouns' },
  {
    path: '/exchange',
    name: 'GRAND EXCHANGE',
    about:
      'a 3D trading floor you walk around as your Noun World rider (also under the Noggles Fountain in Noun World). An order book in in-game COIN only, plus direct deals: click a player or bot to offer a trade',
  },
  { path: '/predictions', name: 'PREDICTIONS', about: 'bet on governance outcomes' },
  { path: '/crystal-ball', name: 'CRYSTAL BALL', about: 'see the next noun before it mints' },
  { path: '/settlers', name: 'SETTLERS', about: 'who settles the auctions (leaderboard)' },
  { path: '/gas', name: 'GAS', about: 'gas leaderboard' },
  // NETWORK
  { path: '/probe', name: 'PROBE', about: 'explore every noun and every dream' },
  {
    path: '/explore/wallet',
    name: 'WALLETS',
    about: 'any address or ENS: Nouns held and delegated, governance activity, transfer history',
  },
  { path: '/feed', name: 'FEED', about: 'everything happening, live' },
  { path: '/dashboard', name: 'DASHBOARD', about: "analytics: who's bidding, voting, building" },
  { path: '/underground', name: 'UNDERGROUND', about: 'the basement' },
  // Not on a shelf
  {
    path: '/terminal',
    name: 'TERMINAL',
    about:
      'full-screen chat with you (NounIRL). Pasting a proposal JSON opens a draft window with the actions attached; "/draft lil" drafts a Lil Nouns proposal',
  },
  { path: '/highway', name: 'HIGHWAY', about: 'candidate proposals' },
  { path: '/dreams', name: 'DREAMS', about: 'saved custom nouns' },
  { path: '/stats', name: 'STATS', about: '3D treasury corridor (links to /nonsense)' },
];

/** Not a page: a corner widget on every page. */
const NOUN_FM =
  'NOUN FM: the site-wide radio, a small corner widget on every page that plays a YouTube music tile when switched on. Inside Noun World the radio is separate (COMMUNITY RADIO, NOUN BEATS).';

/**
 * What NounIRL may say about the owner. Only these facts: anything else about
 * them (life, motives, plans, availability) is unknown, so say so.
 */
export const OWNER_KNOWLEDGE = `ABOUT THE OWNER:
- noun.wtf is built and run by its owner, pip (@pip on Warpcast). pip wired up NounIRL and reviews anything that goes to production.
- pip is LIL 67, the author of MEME VALUE (/books/meme-value). The default voice of Noun World riders is pip's own trained voice model.
- That is all you know about pip. Don't invent anything else (their life, motives, whereabouts, whether they "walked away"). If asked, say you don't know.
- Refer to pip by name or as they/them. Never assume anyone's pronouns, pip's or a user's: use their name or they/them unless they've told you theirs.`;

export function renderSiteKnowledge(): string {
  const games = SITE_GAMES.map(g => `- ${g.name} (${g.open}): ${g.about}.`);
  const sections = SITE_SECTIONS.filter(s => s.about !== 'see the games above').map(
    s => `- ${s.name} (${s.path}): ${s.about}.`,
  );
  return [
    'WHAT YOU KNOW ABOUT NOUN.WTF (this site):',
    '- Homepage (/): NounOS, a homescreen with a hero carousel and shelves of games and sections. / is also where the mainnet Nouns auction lives; /v2 is the NounV2 auction. Governance: /vote and /v2/vote; candidates: /candidates/:id and /v2/candidates/:id; nouns: /noun/:id and /v2/noun/:id.',
    `GAMES (the homescreen game deck; all free, in the browser; there are ${SITE_GAMES.length} of them plus the Grand Exchange and the Voice Booth, so never say Noun World is the only game):`,
    ...games,
    'SECTIONS:',
    ...sections,
    `- ${NOUN_FM}`,
    "If someone asks about a part of the site that isn't listed here, say you don't know it rather than guessing.",
    '',
    OWNER_KNOWLEDGE,
  ].join('\n');
}

export const NOUN_WTF_SITE_KNOWLEDGE = renderSiteKnowledge();
