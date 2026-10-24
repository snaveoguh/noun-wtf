// Every public REST route on the noun.wtf API (packages/nouns-api), as shown
// on /underground. apiRoutes.test.ts reads the API source and fails when a
// route is added or removed there without being listed here (or in UNLISTED),
// so this page can't drift from the API again.

export type Method = 'GET' | 'POST';

export interface ApiRoute {
  method: Method;
  path: string;
  desc: string;
  /** A cheap GET the page can run live ("run" button). */
  try?: string;
  /** Who can call it, when it isn't open to anyone. */
  auth?: 'dashboard key' | 'signed' | 'wallet' | 'signer uuid';
}

export interface ApiGroup {
  id: string;
  title: string;
  routes: ApiRoute[];
}

export const API_GROUPS: ApiGroup[] = [
  {
    id: 'governance',
    title: 'GOVERNANCE',
    routes: [
      {
        method: 'GET',
        path: '/api/proposals',
        desc: 'Every V1 proposal with signers, one JSON response',
      },
      {
        method: 'GET',
        path: '/api/proposals/:id',
        desc: 'One proposal: votes, signers, transactions',
        try: '/api/proposals/1000',
      },
      {
        method: 'GET',
        path: '/api/candidates/:id',
        desc: 'One candidate by `${proposer}-${slug}` (slug-only works for old links)',
      },
      {
        method: 'GET',
        path: '/api/propdates',
        desc: 'Propdates (builder updates), ?propId= for one proposal',
        try: '/api/propdates?limit=5',
      },
      {
        method: 'GET',
        path: '/api/nounv2-proposals',
        desc: 'Every NounV2 proposal with derived status',
        try: '/api/nounv2-proposals',
      },
      {
        method: 'GET',
        path: '/api/nounv2-proposals/:id',
        desc: 'One NounV2 proposal: votes, actions, status changes',
      },
      {
        method: 'GET',
        path: '/api/lil-proposals',
        desc: 'Lil Nouns proposals',
        try: '/api/lil-proposals',
      },
      { method: 'GET', path: '/api/lil-proposals/:id', desc: 'One Lil Nouns proposal' },
    ],
  },
  {
    id: 'auctions',
    title: 'AUCTIONS',
    routes: [
      {
        method: 'GET',
        path: '/api/auction-stats',
        desc: 'Live V1 auction state, read straight from the contract',
        try: '/api/auction-stats',
      },
      {
        method: 'GET',
        path: '/api/nounv2-auction/current',
        desc: 'Live NounV2 auction state',
        try: '/api/nounv2-auction/current',
      },
      { method: 'GET', path: '/api/nounv2-auctions', desc: 'All NounV2 auctions, newest first' },
      {
        method: 'GET',
        path: '/api/nounv2-auctions/:nounId',
        desc: 'One NounV2 auction with its bids',
      },
      {
        method: 'GET',
        path: '/api/settlers',
        desc: 'Who settled (and so curated) each auction, ?dao=v1|v2',
        try: '/api/settlers?dao=v1',
      },
      {
        method: 'GET',
        path: '/api/gas-leaderboard',
        desc: 'Who spent the most gas settling',
        try: '/api/gas-leaderboard',
      },
    ],
  },
  {
    id: 'nouns',
    title: 'NOUNS + ART',
    routes: [
      { method: 'GET', path: '/api/nouns/seeds', desc: 'Every noun seed, compact (twin matching)' },
      {
        method: 'GET',
        path: '/api/noun-holders',
        desc: 'Holder leaderboard with ENS, ?addresses= to filter',
      },
      {
        method: 'GET',
        path: '/api/ascii-image',
        desc: 'A noun as ASCII art, ?nounId=',
        try: '/api/ascii-image?nounId=1',
      },
      {
        method: 'GET',
        path: '/api/trait-preview',
        desc: 'Rendered trait grid, ?category=&dao=nouns|nounv2&n=',
      },
      { method: 'GET', path: '/api/og/proposal/:id', desc: 'Share image for a proposal (PNG)' },
      {
        method: 'GET',
        path: '/api/sketch/latest',
        desc: 'Latest community noun sketches',
        try: '/api/sketch/latest',
      },
      {
        method: 'GET',
        path: '/api/pip3-gifs',
        desc: 'PIP3 animations, ?offset=&limit=',
        try: '/api/pip3-gifs?limit=3',
      },
      {
        method: 'GET',
        path: '/api/dream-nouns',
        desc: 'Dream Nouns, paginated (?page=&per_page=)',
        try: '/api/dream-nouns?per_page=3',
      },
      {
        method: 'GET',
        path: '/api/dream-nouns/:id/image',
        desc: 'A Dream Noun custom-trait image',
      },
      { method: 'POST', path: '/api/dream-nouns', desc: 'Save a Dream Noun (multipart form)' },
    ],
  },
  {
    id: 'treasury',
    title: 'TREASURY',
    routes: [
      {
        method: 'GET',
        path: '/api/treasury/flows',
        desc: 'Holdings now, reconciliation, every ETH/USDC in and out (v2, ~1 MB, gzipped)',
        try: '/api/treasury/flows',
      },
    ],
  },
  {
    id: 'wallets',
    title: 'WALLETS',
    routes: [
      {
        method: 'GET',
        path: '/api/wallet-map/:identity',
        desc: 'Identity graph: nouns held + delegated, links',
        try: '/api/wallet-map/nouns.eth',
      },
      {
        method: 'GET',
        path: '/api/wallet/:identity/profile',
        desc: 'Gamer profile: a wallet’s Nouns record',
        try: '/api/wallet/nouns.eth/profile',
      },
      {
        method: 'GET',
        path: '/api/wallet/:identity/activity',
        desc: 'A wallet’s governance + auction activity',
      },
      {
        method: 'GET',
        path: '/api/wallet/:identity/overview',
        desc: 'AI-written overview of a wallet',
      },
      {
        method: 'POST',
        path: '/api/wallet/:identity/overview/refresh',
        desc: 'Regenerate the overview',
      },
      {
        method: 'GET',
        path: '/api/ens',
        desc: 'ENS forward + reverse, ?address=',
        try: '/api/ens?address=0xb1a32FC9F9D8b2cf86C068Cae13108809547ef71',
      },
    ],
  },
  {
    id: 'autopilot',
    title: 'AUTOPILOT',
    routes: [
      {
        method: 'GET',
        path: '/api/wallet/:address/autopilot',
        desc: 'A wallet’s signed Autopilot voting prefs',
      },
      {
        method: 'POST',
        path: '/api/wallet/:address/delegations',
        desc: 'Hand the relayer a scoped ERC-7710 delegation',
        auth: 'signed',
      },
      {
        method: 'GET',
        path: '/api/agent/autopilot/status',
        desc: 'Relayer state',
        try: '/api/agent/autopilot/status',
      },
    ],
  },
  {
    id: 'feeds',
    title: 'FEEDS + SOCIAL',
    routes: [
      {
        method: 'GET',
        path: '/api/activity',
        desc: 'Everything onchain, newest first. ?type=VOTE|AUCTION_BID|…&limit=&before=&address=',
        try: '/api/activity?limit=5',
      },
      {
        method: 'GET',
        path: '/api/nounv2-feed',
        desc: 'The same for NounV2',
        try: '/api/nounv2-feed?limit=5',
      },
      {
        method: 'GET',
        path: '/api/onchain-feed',
        desc: 'Punks, Toadz, ENS: the homepage’s wider chain feed',
        try: '/api/onchain-feed?limit=5',
      },
      {
        method: 'GET',
        path: '/api/feed/:channel',
        desc: 'Farcaster channel (/nouns, /noc) via Neynar',
        try: '/api/feed/nouns',
      },
      {
        method: 'POST',
        path: '/api/farcaster/cast',
        desc: 'Cast from the site',
        auth: 'signer uuid',
      },
      {
        method: 'POST',
        path: '/api/farcaster/reaction',
        desc: 'Like / recast',
        auth: 'signer uuid',
      },
      {
        method: 'GET',
        path: '/api/predictions/markets',
        desc: 'Governance prediction markets',
        try: '/api/predictions/markets',
      },
    ],
  },
  {
    id: 'agent',
    title: 'AGENT NOUNIRL',
    routes: [
      {
        method: 'GET',
        path: '/api/agent/status',
        desc: 'Both DAOs: prediction, auction state, targets',
        try: '/api/agent/status',
      },
      {
        method: 'GET',
        path: '/api/agent/predict',
        desc: 'The next noun’s traits, ?dao=v1|v2',
        try: '/api/agent/predict',
      },
      {
        method: 'GET',
        path: '/api/agent/traits/:category',
        desc: 'Trait names: head, body, accessory, glasses, background',
        try: '/api/agent/traits/glasses',
      },
      {
        method: 'POST',
        path: '/api/agent/parse-traits',
        desc: 'Plain English → trait ids ("shark head, blue noggles")',
      },
      {
        method: 'POST',
        path: '/api/agent/reserve',
        desc: 'Reserve a trait combo (tip tx hash required)',
      },
      {
        method: 'GET',
        path: '/api/agent/reservations',
        desc: 'Reservations, ?wallet=0x…',
        try: '/api/agent/reservations',
      },
      { method: 'POST', path: '/api/agent/cancel/:id', desc: 'Cancel a reservation' },
      {
        method: 'POST',
        path: '/api/agent/settle',
        desc: 'Settle now (crystal ball twin-snipe), ?dao=v1|v2',
      },
      {
        method: 'GET',
        path: '/api/agent/settlements',
        desc: 'Settlement history',
        try: '/api/agent/settlements',
      },
      {
        method: 'GET',
        path: '/api/agent/deploys',
        desc: 'The agent’s deploy history',
        try: '/api/agent/deploys',
      },
      { method: 'GET', path: '/api/agent/knowledge', desc: 'What the agent has read' },
      { method: 'GET', path: '/api/agent/people', desc: 'People database' },
      { method: 'GET', path: '/api/agent/people/search', desc: 'Search people, ?q=' },
      {
        method: 'GET',
        path: '/api/agent/people/stats',
        desc: 'People database counts',
        try: '/api/agent/people/stats',
      },
      { method: 'GET', path: '/api/agent/people/:address', desc: 'One person' },
    ],
  },
  {
    id: 'grants',
    title: 'SMALL GRANTS',
    routes: [
      {
        method: 'GET',
        path: '/api/grants',
        desc: 'Every grant with derived status',
        try: '/api/grants',
      },
      { method: 'GET', path: '/api/grants/:id', desc: 'One grant with votes and status changes' },
      { method: 'POST', path: '/api/grants/propose', desc: 'Build a grant proposal' },
    ],
  },
  {
    id: 'chat',
    title: 'TERMINAL CHAT',
    routes: [
      {
        method: 'POST',
        path: '/api/chat',
        desc: 'Claude with governance tools (see TERMINAL below)',
        auth: 'wallet',
      },
    ],
  },
  {
    id: 'ops',
    title: 'OPS',
    routes: [
      {
        method: 'GET',
        path: '/api/health',
        desc: 'Indexing flag + proposal count',
        try: '/api/health',
      },
      {
        method: 'GET',
        path: '/api/stats/health',
        desc: 'Latest block, DB, memory',
        try: '/api/stats/health',
      },
      { method: 'GET', path: '/api/stats', desc: 'Request metrics', auth: 'dashboard key' },
      { method: 'GET', path: '/api/stats/errors', desc: 'Recent errors', auth: 'dashboard key' },
      { method: 'GET', path: '/api/stats/traffic', desc: 'Pageviews', auth: 'dashboard key' },
      { method: 'POST', path: '/api/pv', desc: 'Pageview beacon (always 204)' },
    ],
  },
];

/**
 * Routes that exist but are kept off the public page: operator / one-shot
 * jobs. Listed so the drift test knows they're accounted for.
 */
export const UNLISTED: string[] = [
  'POST /api/agent/backfill-tip-amounts',
  'POST /api/agent/check',
  'POST /api/agent/deploy',
  'POST /api/agent/learn',
  'POST /api/agent/self-learn',
  'POST /api/agent/people/build',
  'POST /api/agent/autopilot/sweep',
  'POST /api/dream-nouns/import',
];

export const ALL_ROUTES: ApiRoute[] = API_GROUPS.flatMap(g => g.routes);
