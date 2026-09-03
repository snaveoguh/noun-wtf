/**
 * Dev-only sample events — one per registry branch — so every label /
 * description / link path can be eyeballed before the API emits the real
 * thing. Enabled by `localStorage['noun-wtf-feed-fixtures'] = '1'`.
 *
 * Block numbers are deliberately far above mainnet so fixtures always sort
 * to the top; the feed hook records the real newest block *before*
 * prepending these so polling isn't fooled.
 */
import type { ActivityEvent } from './useActivityFeed';

export const FEED_FIXTURES_KEY = 'noun-wtf-feed-fixtures';

export function feedFixturesEnabled(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(FEED_FIXTURES_KEY) === '1';
  } catch {
    return false;
  }
}

const A = {
  nounders: '0x2573C60a6D127755aA2DC85e342F7da2378a0Cc5',
  treasury: '0xb1a32FC9F9D8b2cf86C068Cae13108809547ef71',
  alice: '0x1D6D4F5d8C4A6b1F6f3E9B8C7a6D5E4F3A2B1C0D',
  bob: '0x9F2E1A4B6C8D0E2F4A6B8C0D2E4F6A8B0C2D4E6F',
  carol: '0x5A3b7C9d1E3f5A7b9C1d3E5f7A9b1C3d5E7f9A1B',
  dave: '0xE1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9F0',
  settler: '0x7B1C4D2E9F3A5B6C8D0E1F2A3B4C5D6E7F8A9B0C',
  usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
} as const;

const TX = '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed';
const BASE_BLOCK = 900_000_000;

interface Sample {
  type: string;
  data: Record<string, unknown>;
  /** Derived events carry no tx hash. */
  derived?: boolean;
  /** Minutes ago. */
  ago?: number;
}

const nowSec = () => Math.floor(Date.now() / 1000);

function samples(): Sample[] {
  const t = nowSec();
  return [
    // ── Auctions ────────────────────────────────────────────────────────
    {
      type: 'AUCTION_CREATED',
      data: {
        nounId: '2010',
        startTime: t - 60,
        endTime: t + 86_340,
        curator: A.settler,
        settledNounId: '2009',
      },
      ago: 1,
    },
    {
      type: 'AUCTION_SETTLED',
      data: {
        nounId: '2009',
        winner: A.alice,
        amount: '12500000000000000000',
        clientId: 3,
        settler: A.settler,
        burned: false,
        treasury: false,
      },
      ago: 2,
    },
    {
      type: 'AUCTION_SETTLED',
      data: {
        nounId: '2008',
        winner: A.treasury,
        amount: '0',
        settler: A.settler,
        burned: false,
        treasury: true,
      },
      ago: 3,
    },
    {
      type: 'AUCTION_SETTLED',
      data: {
        nounId: '1999',
        winner: '0x0000000000000000000000000000000000000000',
        amount: '0',
        settler: A.settler,
        burned: true,
        treasury: false,
      },
      ago: 4,
    },
    {
      type: 'BID',
      data: {
        nounId: '2010',
        bidder: A.bob,
        value: '1200000000000000000',
        clientId: 37,
        extended: true,
      },
      ago: 5,
    },
    {
      type: 'BID',
      data: { nounId: '2010', bidder: A.carol, value: '1050000000000000000', clientId: 0 },
      ago: 6,
    },
    { type: 'NOUNDER_NOUN', data: { nounId: '2010', owner: A.nounders }, ago: 7 },
    {
      type: 'AUCTION_CONFIG_CHANGED',
      data: {
        param: 'reservePrice',
        oldValue: '10000000000000000',
        newValue: '3000000000000000000',
      },
      ago: 8,
    },
    {
      type: 'AUCTION_CONFIG_CHANGED',
      data: { param: 'timeBuffer', oldValue: '300', newValue: '600' },
      ago: 9,
    },
    {
      type: 'AUCTION_CONFIG_CHANGED',
      data: { param: 'minBidIncrementPercentage', oldValue: '2', newValue: '5' },
      ago: 10,
    },

    // ── Token ───────────────────────────────────────────────────────────
    {
      type: 'TRANSFER',
      data: { nounIds: ['12', '34'], nounId: '12', from: A.alice, to: A.bob },
      ago: 11,
    },
    {
      type: 'TRANSFER',
      data: { nounIds: ['77'], nounId: '77', from: A.carol, to: A.dave },
      ago: 12,
    },
    {
      type: 'SALE',
      data: {
        nounIds: ['1670'],
        priceEth: 0.7425,
        marketplace: 'opensea.io',
        from: A.dave,
        to: A.alice,
        currency: 'ETH',
      },
      ago: 13,
    },
    {
      type: 'SALE',
      data: {
        nounIds: ['1', '2'],
        priceEth: 41,
        marketplace: 'blur.io',
        from: A.bob,
        to: A.carol,
        currency: 'ETH',
      },
      ago: 14,
    },
    {
      type: 'DELEGATION',
      data: {
        delegator: A.alice,
        fromDelegate: A.alice,
        toDelegate: A.bob,
        nounCount: 3,
        kind: 'delegate',
      },
      ago: 15,
    },
    {
      type: 'DELEGATION',
      data: {
        delegator: A.carol,
        fromDelegate: A.bob,
        toDelegate: A.carol,
        nounCount: 3,
        kind: 'undelegate',
      },
      ago: 16,
    },
    {
      type: 'DELEGATION',
      data: {
        delegator: A.dave,
        fromDelegate: A.alice,
        toDelegate: A.bob,
        nounCount: 1,
        kind: 'redelegate',
      },
      ago: 17,
    },

    // ── Proposals ───────────────────────────────────────────────────────
    {
      type: 'PROPOSAL_CREATED',
      data: {
        proposalId: '993',
        proposer: A.alice,
        title: 'Fund the noun.wtf feed beef-up',
        description: '# Fund the feed\n\nMore events, **better labels**.',
        signers: [A.bob, A.carol, A.dave],
        quorumVotes: 204,
        clientId: 37,
      },
      ago: 18,
    },
    {
      type: 'PROPOSAL_UPDATED',
      data: {
        proposalId: '993',
        title: 'Fund the noun.wtf feed beef-up',
        updateMessage: 'Fixed the USDC decimals in txn 2 and clarified the milestones.',
        kind: 'description',
      },
      ago: 19,
    },
    {
      type: 'PROPOSAL_VOTING_STARTED',
      data: { proposalId: '993', title: 'Fund the noun.wtf feed beef-up' },
      derived: true,
      ago: 20,
    },
    {
      type: 'PROPOSAL_OBJECTION_PERIOD',
      data: { proposalId: '992', title: 'Something contentious' },
      derived: true,
      ago: 21,
    },
    {
      type: 'PROPOSAL_ENDED',
      data: {
        proposalId: '991',
        title: 'Nouns Esports season 4',
        result: 'defeated',
        forVotes: 154,
        againstVotes: 278,
        abstainVotes: 4,
        quorumVotes: 204,
      },
      derived: true,
      ago: 22,
    },
    {
      type: 'PROPOSAL_ENDED',
      data: {
        proposalId: '990',
        title: 'Retro funding for noun.wtf',
        result: 'succeeded',
        forVotes: 301,
        againstVotes: 12,
        abstainVotes: 9,
        quorumVotes: 204,
      },
      derived: true,
      ago: 23,
    },
    {
      type: 'PROPOSAL_QUEUED',
      data: {
        proposalId: '990',
        title: 'Retro funding for noun.wtf',
        executionETA: t + 2 * 86_400,
      },
      ago: 24,
    },
    { type: 'PROPOSAL_EXECUTED', data: { proposalId: '989', title: 'Nouns Comic #3' }, ago: 25 },
    {
      type: 'PROPOSAL_CANCELLED',
      data: { proposalId: '988', title: 'Withdrawn: buy a boat' },
      ago: 26,
    },
    { type: 'PROPOSAL_VETOED', data: { proposalId: '987', title: 'Wall' }, ago: 27 },
    {
      type: 'VOTE',
      data: {
        voter: A.bob,
        proposalId: '993',
        support: 1,
        votes: 12,
        reason: 'Looks great, more feed please.',
        isRevote: true,
        clientId: 3,
      },
      ago: 28,
    },
    {
      type: 'VOTE',
      data: {
        voter: A.carol,
        proposalId: '993',
        support: 0,
        votes: 3,
        reason: 'Disagree with the milestones.',
        replyTo: A.bob,
        clientId: 37,
      },
      ago: 29,
    },
    {
      type: 'VOTE',
      data: { voter: A.dave, proposalId: '993', support: 2, votes: 1, clientId: 10 },
      ago: 30,
    },
    {
      type: 'PROPOSAL_FEEDBACK',
      data: { voter: A.alice, proposalId: '993', support: 1, reason: 'Pre-vote signal: FOR' },
      ago: 31,
    },

    // ── Candidates ──────────────────────────────────────────────────────
    {
      type: 'CANDIDATE_CREATED',
      data: {
        candidateId: `${A.alice.toLowerCase()}-feed-beef-up`,
        proposer: A.alice,
        title: 'Feed beef-up',
        slug: 'feed-beef-up',
        description: 'Candidate body.',
      },
      ago: 32,
    },
    {
      type: 'CANDIDATE_CREATED',
      data: {
        candidateId: `${A.bob.toLowerCase()}-should-we-fork`,
        proposer: A.bob,
        title: 'Should we fork?',
        slug: 'should-we-fork',
        isTopic: true,
      },
      ago: 33,
    },
    {
      type: 'CANDIDATE_CREATED',
      data: {
        candidateId: `${A.carol.toLowerCase()}-update-993`,
        proposer: A.carol,
        title: 'Fix milestone 2',
        slug: 'update-993',
        updatesProposalId: '993',
      },
      ago: 34,
    },
    {
      type: 'CANDIDATE_SPONSORED',
      data: {
        candidateId: `${A.alice.toLowerCase()}-feed-beef-up`,
        signer: A.dave,
        votes: 6,
        expirationTimestamp: t + 5 * 86_400,
        reason: 'Sponsoring — ship it.',
      },
      ago: 35,
    },
    {
      type: 'CANDIDATE_UPDATED',
      data: {
        candidateId: `${A.alice.toLowerCase()}-feed-beef-up`,
        proposer: A.alice,
        title: 'Feed beef-up',
        reason: 'typo fix',
      },
      ago: 36,
    },
    {
      type: 'CANDIDATE_CANCELED',
      data: {
        candidateId: `${A.bob.toLowerCase()}-should-we-fork`,
        proposer: A.bob,
        title: 'Should we fork?',
      },
      ago: 37,
    },
    {
      type: 'CANDIDATE_PROMOTED',
      data: {
        candidateId: `${A.alice.toLowerCase()}-feed-beef-up`,
        proposer: A.alice,
        title: 'Feed beef-up',
        proposalId: '994',
      },
      ago: 38,
    },
    {
      type: 'CANDIDATE_FEEDBACK',
      data: {
        candidateId: `${A.alice.toLowerCase()}-feed-beef-up`,
        voter: A.bob,
        support: 1,
        reason: 'yes',
      },
      ago: 39,
    },

    // ── Streams ─────────────────────────────────────────────────────────
    {
      type: 'STREAM_CREATED',
      data: {
        recipient: A.alice,
        tokenAmount: '120000000000',
        tokenAddress: A.usdc,
        proposalId: '990',
      },
      ago: 40,
    },
    { type: 'STREAM_CANCELLED', data: { recipient: A.alice, proposalId: '990' }, ago: 41 },
    {
      type: 'STREAM_WITHDRAWN',
      data: { recipient: A.alice, amount: '12000000000', tokenAddress: A.usdc, proposalId: '990' },
      ago: 42,
    },

    // ── Forks ───────────────────────────────────────────────────────────
    {
      type: 'FORK_ESCROW',
      data: {
        forkId: '1',
        owner: A.bob,
        nounIds: ['1', '2'],
        proposalIds: ['987'],
        reason: 'The wall was too far.',
      },
      ago: 43,
    },
    {
      type: 'FORK_JOIN',
      data: { forkId: '1', owner: A.carol, nounIds: ['3'], proposalIds: [] },
      ago: 44,
    },
    { type: 'FORK_WITHDRAW', data: { forkId: '1', owner: A.bob, nounIds: ['1', '2'] }, ago: 45 },
    {
      type: 'FORK_EXECUTED',
      data: { forkId: '1', forkTreasury: A.dave, tokensInEscrow: 123 },
      ago: 46,
    },

    // ── DAO config ──────────────────────────────────────────────────────
    {
      type: 'DAO_CONFIG_CHANGED',
      data: { param: 'votingPeriod', oldValue: '28800', newValue: '36000' },
      ago: 47,
    },
    {
      type: 'DAO_CONFIG_CHANGED',
      data: { param: 'proposalThresholdBPS', oldValue: '25', newValue: '50' },
      ago: 48,
    },
    {
      type: 'DAO_CONFIG_CHANGED',
      data: { param: 'vetoer', oldValue: A.alice, newValue: A.bob },
      ago: 49,
    },

    // ── Grants ──────────────────────────────────────────────────────────
    {
      type: 'GRANT_CREATED',
      data: { grantId: '12', proposer: A.alice, description: '# Tiny grant\n\nfor a tiny thing' },
      ago: 50,
    },
    {
      type: 'GRANT_VOTE',
      data: { grantId: '12', voter: A.bob, support: 1, votes: 2, reason: 'sure' },
      ago: 51,
    },
    { type: 'GRANT_QUEUED', data: { grantId: '12' }, ago: 52 },
    { type: 'GRANT_EXECUTED', data: { grantId: '11' }, ago: 53 },
    { type: 'GRANT_CANCELED', data: { grantId: '10' }, ago: 54 },

    // ── V2 ──────────────────────────────────────────────────────────────
    {
      type: 'V2_SETTLED',
      data: { nounId: '140', winner: A.alice, amount: '50', settler: A.settler },
      ago: 55,
    },
    {
      type: 'V2_SETTLED',
      data: { nounId: '139', winner: A.treasury, amount: '0', settler: A.settler, treasury: true },
      ago: 56,
    },
    {
      type: 'V2_PROP_QUEUED',
      data: { proposalId: '3', title: 'Add joker head', executionETA: t + 86_400 },
      ago: 57,
    },
    { type: 'V2_PROP_EXECUTED', data: { proposalId: '2', title: 'Add joker head' }, ago: 58 },
    { type: 'V2_PROP_CANCELED', data: { proposalId: '1', title: 'Oops' }, ago: 59 },
  ];
}

/** Build the fixture events (fresh timestamps each call). */
export function buildFeedFixtures(): ActivityEvent[] {
  const now = Date.now();
  return samples().map((s, i) => ({
    type: s.type,
    blockNumber: BASE_BLOCK - i,
    timestamp: new Date(now - (s.ago ?? i) * 60_000).toISOString(),
    txHash: s.derived === true ? '' : TX,
    data: s.data,
  }));
}

const V2_PREFIX = 'V2_';

/** Fixtures narrowed to the active filter (same semantics as the feed hook). */
export function fixturesForFilter(activeFilter: string): ActivityEvent[] {
  if (!feedFixturesEnabled()) return [];
  const all = buildFeedFixtures();
  if (!activeFilter) return all;
  if (activeFilter === '_V2') return all.filter(e => e.type.startsWith(V2_PREFIX));
  const wanted = new Set(activeFilter.split(',').map(p => p.trim()));
  return all.filter(e => wanted.has(e.type));
}
