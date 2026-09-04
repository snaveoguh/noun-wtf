/**
 * Dev-only fake profile so the gamer page can be eyeballed before the API
 * ships. Enabled by `?fixture=1` on the URL or
 * `localStorage['noun-wtf-profile-fixture'] = '1'`.
 *
 * Every section is populated so all tabs, tiles and the Autopilot panel have
 * something to render. Addresses are synthetic except the well-known DAO
 * contracts.
 */
import type {
  AutopilotState,
  WalletActivityPage,
  WalletProfile,
  WalletActivityEvent,
} from './types';

export const PROFILE_FIXTURE_KEY = 'noun-wtf-profile-fixture';

export function profileFixtureEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('fixture') === '1') return true;
    return window.localStorage.getItem(PROFILE_FIXTURE_KEY) === '1';
  } catch {
    return false;
  }
}

export const FIXTURE_ADDRESS = '0x1d6d4f5d8c4a6b1f6f3e9b8c7a6d5e4f3a2b1c0d';

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86_400;
const ago = (days: number) => NOW - Math.round(days * DAY);

const ALICE = '0x9f2e1a4b6c8d0e2f4a6b8c0d2e4f6a8b0c2d4e6f';
const BOB = '0x5a3b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b';
const CAROL = '0xe1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const TX = '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed';

export const FIXTURE_PROFILE: WalletProfile = {
  identity: {
    address: FIXTURE_ADDRESS,
    ens: 'hugo.eth',
    farcaster: { fid: 4242, username: 'hugo', displayName: 'hugo' },
    tags: ['nounder-adjacent', 'proposer', 'settler'],
    aliases: ['memevalue.eth', 'nocguild.eth'],
    firstSeen: { block: 13_100_000, timestamp: ago(1490) },
    lastActive: { block: 23_400_000, timestamp: ago(0.2) },
    summary: null,
  },
  holdings: {
    nouns: [
      {
        nounId: 67,
        seed: { background: 1, body: 12, accessory: 44, glasses: 7, head: 120 },
        since: ago(900),
      },
      {
        nounId: 431,
        seed: { background: 0, body: 3, accessory: 101, glasses: 18, head: 66 },
        since: ago(640),
      },
      {
        nounId: 802,
        seed: { background: 1, body: 22, accessory: 12, glasses: 2, head: 201 },
        since: ago(310),
      },
      {
        nounId: 1157,
        seed: { background: 0, body: 9, accessory: 87, glasses: 11, head: 33 },
        since: ago(45),
      },
      {
        nounId: 1290,
        seed: { background: 1, body: 27, accessory: 5, glasses: 20, head: 178 },
        since: ago(4),
      },
    ],
    count: 5,
    delegate: null,
    delegatedVotes: 7,
    representsNouns: [67, 431, 802, 1157, 1290, 555, 913],
    delegators: [ALICE, BOB],
  },
  voting: {
    total: 412,
    for: 251,
    against: 118,
    abstain: 43,
    withReason: 288,
    participationPct: 87.4,
    avgWeight: 5.6,
    firstVote: ago(1400),
    lastVote: ago(1.5),
    streakCurrent: 23,
    byClient: [
      { clientId: 37, count: 190 },
      { clientId: 3, count: 140 },
      { clientId: 0, count: 60 },
      { clientId: 10, count: 22 },
    ],
    revotes: 3,
    recent: [
      {
        proposalId: 987,
        title: 'Wall',
        support: 1,
        votes: 7,
        reason:
          'Shortest proposal ever executed if it lands. Cheap, funny, and a real public good. FOR.',
        timestamp: ago(1.5),
        txHash: TX,
        clientId: 37,
        proposalStatus: 'EXECUTED',
        proposalResult: 'passed',
        alignedWithOutcome: true,
      },
      {
        proposalId: 984,
        title: 'Nouns Esports season 4 — 180 ETH',
        support: 0,
        votes: 7,
        reason:
          'Ask is 3x the last season with no retro report. Come back with numbers and I will flip.',
        timestamp: ago(6),
        txHash: TX,
        clientId: 3,
        proposalStatus: 'DEFEATED',
        proposalResult: 'failed',
        alignedWithOutcome: true,
      },
      {
        proposalId: 981,
        title: 'Upgrade AuctionHouse to V4 (no-bid → treasury)',
        support: 1,
        votes: 7,
        reason: 'Stops burning nouns on quiet days. Obvious yes.',
        timestamp: ago(11),
        txHash: TX,
        clientId: 37,
        proposalStatus: 'EXECUTED',
        proposalResult: 'passed',
        alignedWithOutcome: true,
      },
      {
        proposalId: 977,
        title: 'Nouns x Formula 1 activation',
        support: 2,
        votes: 7,
        reason: null,
        timestamp: ago(19),
        txHash: TX,
        clientId: 0,
        proposalStatus: 'EXECUTED',
        proposalResult: 'passed',
        alignedWithOutcome: null,
      },
      {
        proposalId: 972,
        title: 'Small grants round 9',
        support: 1,
        votes: 6,
        reason: 'Small grants keeps working. Keep it funded.',
        timestamp: ago(31),
        txHash: TX,
        clientId: 10,
        proposalStatus: 'EXECUTED',
        proposalResult: 'passed',
        alignedWithOutcome: true,
      },
      {
        proposalId: 969,
        title: 'Nouns documentary sequel — 420 ETH',
        support: 0,
        votes: 6,
        reason: 'Media spend is already 24% of all-time outflow.',
        timestamp: ago(38),
        txHash: TX,
        clientId: 37,
        proposalStatus: 'EXECUTED',
        proposalResult: 'passed',
        alignedWithOutcome: false,
      },
    ],
  },
  proposals: {
    authored: [
      {
        id: 987,
        title: 'Wall',
        status: 'EXECUTED',
        forVotes: 128,
        againstVotes: 4,
        abstainVotes: 9,
        createdAt: ago(9),
        executed: true,
      },
      {
        id: 968,
        title: 'AuctionHouse V4: route no-bid nouns to the treasury',
        status: 'EXECUTED',
        forVotes: 211,
        againstVotes: 2,
        abstainVotes: 5,
        createdAt: ago(101),
        executed: true,
      },
      {
        id: 941,
        title: 'noun.wtf client incentives',
        status: 'EXECUTED',
        forVotes: 97,
        againstVotes: 31,
        abstainVotes: 12,
        createdAt: ago(190),
        executed: true,
      },
      {
        id: 902,
        title: 'Nouns Terminal — governance CLI',
        status: 'DEFEATED',
        forVotes: 44,
        againstVotes: 88,
        abstainVotes: 6,
        createdAt: ago(290),
        executed: false,
      },
      {
        id: 877,
        title: 'Retro funding for probe.wtf',
        status: 'EXECUTED',
        forVotes: 133,
        againstVotes: 19,
        abstainVotes: 2,
        createdAt: ago(360),
        executed: true,
      },
    ],
    signed: [
      { id: 985, title: 'Nouns Comic issue 7', status: 'EXECUTED' },
      { id: 960, title: 'Lil Nouns DAO bridge', status: 'CANCELED' },
    ],
    passRate: 80,
    totalRequestedEth: 612.5,
  },
  candidates: {
    authored: [
      {
        id: `${FIXTURE_ADDRESS}-wall`,
        slug: 'wall',
        title: 'Wall',
        createdAt: ago(12),
        canceled: false,
        promotedToProposalId: 987,
        sponsorCount: 3,
      },
      {
        id: `${FIXTURE_ADDRESS}-joker-head-v2`,
        slug: 'joker-head-v2',
        title: 'Add joker head to NounV2',
        createdAt: ago(41),
        canceled: false,
        promotedToProposalId: null,
        sponsorCount: 1,
      },
      {
        id: `${FIXTURE_ADDRESS}-gas-rebate`,
        slug: 'gas-rebate',
        title: 'Gas rebate for settlers',
        createdAt: ago(210),
        canceled: true,
        promotedToProposalId: null,
        sponsorCount: 0,
      },
    ],
    sponsored: [
      {
        candidateId: `${ALICE}-nouns-radio`,
        title: 'Nouns Radio season 2',
        reason: 'Own tracks only. Ship it.',
        createdAt: ago(8),
        canceled: false,
        expirationTimestamp: NOW + 20 * DAY,
      },
      {
        candidateId: `${BOB}-prop-house-revival`,
        title: 'Prop House revival',
        reason: null,
        createdAt: ago(60),
        canceled: false,
        expirationTimestamp: ago(10),
      },
    ],
    feedbackGiven: 74,
    proposalFeedbackGiven: 31,
  },
  auctions: {
    won: [
      {
        nounId: 1290,
        amountEth: 8.42,
        timestamp: ago(4),
        clientId: 37,
        seed: { background: 1, body: 27, accessory: 5, glasses: 20, head: 178 },
      },
      {
        nounId: 1157,
        amountEth: 9.1,
        timestamp: ago(45),
        clientId: 3,
        seed: { background: 0, body: 9, accessory: 87, glasses: 11, head: 33 },
      },
      {
        nounId: 802,
        amountEth: 21.5,
        timestamp: ago(310),
        clientId: 0,
        seed: { background: 1, body: 22, accessory: 12, glasses: 2, head: 201 },
      },
      {
        nounId: 431,
        amountEth: 33.0,
        timestamp: ago(640),
        clientId: 0,
        seed: { background: 0, body: 3, accessory: 101, glasses: 18, head: 66 },
      },
    ],
    wonCount: 4,
    totalSpentEth: 72.02,
    settled: 58,
    curated: [1291, 1158, 803, 432, 1201, 1177],
    bids: { count: 191, totalEth: 1642.7, extendedCount: 12, nounsBidOn: 74 },
    nounderRewards: 0,
  },
  transfers: {
    received: 9,
    sent: 4,
    sales: [
      {
        nounId: 67,
        priceEth: 41.2,
        marketplace: 'opensea',
        side: 'buy',
        counterparty: CAROL,
        timestamp: ago(900),
      },
      {
        nounId: 555,
        priceEth: 12.0,
        marketplace: 'blur',
        side: 'sell',
        counterparty: ALICE,
        timestamp: ago(120),
      },
    ],
  },
  treasury: {
    streams: [
      {
        streamAddress: '0x1111111111111111111111111111111111111111',
        proposalId: 941,
        tokenAddress: USDC,
        tokenSymbol: 'USDC',
        totalAmount: 120_000,
        withdrawnAmount: 84_000,
        status: 'active',
      },
      {
        streamAddress: '0x2222222222222222222222222222222222222222',
        proposalId: 877,
        tokenAddress: USDC,
        tokenSymbol: 'USDC',
        totalAmount: 60_000,
        withdrawnAmount: 60_000,
        status: 'completed',
      },
    ],
    totalReceivedUsdc: 144_000,
    totalReceivedEth: 18.5,
    grants: { authored: 2, votes: 41 },
  },
  forks: [{ forkId: 0, kind: 'escrow-withdrawn', nounIds: [67], timestamp: ago(700) }],
  v2: {
    votes: 6,
    for: 5,
    against: 1,
    abstain: 0,
    proposalsAuthored: 1,
    auctionsWon: 3,
    bids: 22,
    settled: 140,
  },
  delegationHistory: [
    {
      kind: 'delegate-in',
      fromDelegate: ALICE,
      toDelegate: FIXTURE_ADDRESS,
      nounCount: 1,
      timestamp: ago(200),
    },
    {
      kind: 'delegate-in',
      fromDelegate: BOB,
      toDelegate: FIXTURE_ADDRESS,
      nounCount: 1,
      timestamp: ago(90),
    },
    {
      kind: 'delegate-out',
      fromDelegate: FIXTURE_ADDRESS,
      toDelegate: CAROL,
      nounCount: 5,
      timestamp: ago(400),
    },
    {
      kind: 'delegate-in',
      fromDelegate: CAROL,
      toDelegate: FIXTURE_ADDRESS,
      nounCount: 5,
      timestamp: ago(380),
    },
  ],
  overview: {
    text: 'hugo.eth is one of the most active governance participants in Nouns DAO: 412 votes at 87% participation, 288 of them with a written reason, and a current 23-vote streak. He authors as much as he votes — five proposals with an 80% pass rate, including the AuctionHouse V4 upgrade that stopped no-bid burns and the one-word "Wall" prop. His stance is consistent: strong FOR on infrastructure and small grants, skeptical of large media asks (documentary sequel, esports) and F1-style activations. He wins auctions rarely but deliberately (4 wins, 72 ETH) and settles constantly (58 settlements, 6 curated nouns). Represents 7 votes across 5 held nouns plus 2 delegators.',
    generatedAt: ago(0.08),
    model: 'claude-sonnet-4-6',
  },
  autopilot: { enabled: true, updatedAt: ago(3) },
  badges: ['Proposer', 'Settler', 'Streak 23', 'Reason writer', 'Curator', 'V2 early'],
};

export const FIXTURE_AUTOPILOT: AutopilotState = {
  enabled: true,
  updatedAt: ago(3),
  prefs: {
    philosophy:
      'Fund builders and public goods, be stingy with media and big activations. Prefer small, retroactive, measurable asks. Nouns is a meme value machine, not a marketing budget.',
    stances: {
      art: 1,
      infrastructure: 2,
      events: -1,
      media: -2,
      grants: 2,
      protocolChanges: 1,
      treasuryOps: 0,
    },
    maxAskEth: 150,
    blockedProposers: [CAROL],
    trustedProposers: [ALICE],
    defaultWhenUnsure: 'abstain',
    voteReasonStyle: 'short',
  },
  recommendations: [
    {
      proposalId: 991,
      title: 'Nouns Builder grants — 90 ETH retro round',
      support: 1,
      confidence: 0.91,
      reason:
        'Retroactive, itemised, under your 150 ETH ceiling and squarely in your "fund builders" lane. Two past rounds shipped what they promised.',
      generatedAt: ago(0.1),
    },
    {
      proposalId: 990,
      title: 'Nouns at Art Basel Miami — 320 ETH activation',
      support: 0,
      confidence: 0.84,
      reason:
        'Over your max ask, events stance is -1 and the deliverable is impressions not artefacts. Matches your F1 and esports votes.',
      generatedAt: ago(0.1),
    },
    {
      proposalId: 989,
      title: 'Adjust proposal threshold to 3 nouns',
      support: 2,
      confidence: 0.55,
      reason:
        'Protocol change with unclear second-order effects on spam. Your philosophy does not resolve it; default when unsure is abstain.',
      generatedAt: ago(0.1),
    },
    {
      proposalId: 988,
      title: 'Nouns Comic issue 8',
      support: 1,
      confidence: 0.7,
      reason: 'You signed issue 7 and it shipped on time. Same team, same ask.',
      generatedAt: ago(0.2),
      alreadyVoted: true,
    },
  ],
};

const ev = (
  type: string,
  daysAgo: number,
  data: Record<string, unknown>,
  block = 23_400_000,
): WalletActivityEvent => ({
  type,
  blockNumber: block - Math.round(daysAgo * 7150),
  timestamp: new Date(ago(daysAgo) * 1000).toISOString(),
  txHash: TX,
  data,
});

const FIXTURE_EVENTS: WalletActivityEvent[] = [
  ev('VOTE', 1.5, {
    voter: FIXTURE_ADDRESS,
    proposalId: 987,
    support: 1,
    votes: 7,
    reason: 'Shortest proposal ever executed if it lands. FOR.',
  }),
  ev('AUCTION_SETTLED', 4, {
    nounId: 1290,
    winner: FIXTURE_ADDRESS,
    amount: '8420000000000000000',
    settler: FIXTURE_ADDRESS,
  }),
  ev('BID', 4.1, {
    nounId: 1290,
    bidder: FIXTURE_ADDRESS,
    amount: '8420000000000000000',
    extended: false,
  }),
  ev('BID', 4.2, {
    nounId: 1290,
    bidder: FIXTURE_ADDRESS,
    amount: '7000000000000000000',
    extended: true,
  }),
  ev('CANDIDATE_SPONSORED', 8, {
    signer: FIXTURE_ADDRESS,
    candidateId: `${ALICE}-nouns-radio`,
    reason: 'Own tracks only. Ship it.',
  }),
  ev('PROPOSAL_CREATED', 9, { proposalId: 987, proposer: FIXTURE_ADDRESS, title: 'Wall' }),
  ev('CANDIDATE_CREATED', 12, {
    proposer: FIXTURE_ADDRESS,
    candidateId: `${FIXTURE_ADDRESS}-wall`,
    slug: 'wall',
  }),
  ev('VOTE', 6, {
    voter: FIXTURE_ADDRESS,
    proposalId: 984,
    support: 0,
    votes: 7,
    reason: 'Ask is 3x last season with no retro report.',
  }),
  ev('CANDIDATE_FEEDBACK', 14, {
    sender: FIXTURE_ADDRESS,
    candidateId: `${BOB}-prop-house-revival`,
    support: 1,
    reason: 'Bring it back.',
  }),
  ev('AUCTION_SETTLED', 20, {
    nounId: 1273,
    winner: ALICE,
    amount: '12000000000000000000',
    settler: FIXTURE_ADDRESS,
  }),
  ev('DELEGATE_CHANGED', 90, { delegator: BOB, fromDelegate: BOB, toDelegate: FIXTURE_ADDRESS }),
  ev('TRANSFER', 120, { nounId: 555, from: FIXTURE_ADDRESS, to: ALICE }),
  ev('SALE', 120, {
    nounId: 555,
    from: FIXTURE_ADDRESS,
    to: ALICE,
    priceEth: 12,
    marketplace: 'blur',
  }),
  ev('STREAM_CREATED', 190, {
    recipient: FIXTURE_ADDRESS,
    proposalId: 941,
    tokenAddress: USDC,
    tokenAmount: '120000000000',
  }),
  ev('PROPOSAL_CREATED', 190, {
    proposalId: 941,
    proposer: FIXTURE_ADDRESS,
    title: 'noun.wtf client incentives',
  }),
];

export const FIXTURE_ACTIVITY: WalletActivityPage = {
  events: FIXTURE_EVENTS,
  hasMore: false,
  oldestBlock: FIXTURE_EVENTS[FIXTURE_EVENTS.length - 1]?.blockNumber ?? 0,
};
