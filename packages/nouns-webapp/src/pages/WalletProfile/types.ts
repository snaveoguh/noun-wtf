/**
 * Wallet "gamer profile" API contract — `/api/wallet/:identity/*`.
 *
 * The API is being built in parallel, so every section is nullable and every
 * field inside a section is optional. Renderers must tolerate any of them
 * being missing and fall back to a skeleton / empty state.
 */

export interface NounSeedLike {
  background: number;
  body: number;
  accessory: number;
  glasses: number;
  head: number;
}

/** Unix seconds, ms, numeric string or ISO string — the API is loose here. */
export type Timestampish = number | string | null | undefined;

export interface ProfileIdentity {
  address?: string;
  ens?: string | null;
  farcaster?: { fid?: number; username?: string; displayName?: string } | null;
  tags?: string[];
  aliases?: string[];
  firstSeen?: { block?: number; timestamp?: Timestampish } | null;
  lastActive?: { block?: number; timestamp?: Timestampish } | null;
  summary?: string | null;
}

export interface HeldNoun {
  nounId: number | string;
  seed?: NounSeedLike | null;
  since?: Timestampish;
}

export interface ProfileHoldings {
  nouns?: HeldNoun[];
  count?: number;
  delegate?: string | null;
  delegatedVotes?: number;
  representsNouns?: Array<number | string>;
  delegators?: string[];
}

export interface RecentVote {
  proposalId: number | string;
  title?: string | null;
  support?: number | null;
  votes?: number | string;
  reason?: string | null;
  timestamp?: Timestampish;
  txHash?: string | null;
  clientId?: number | null;
  proposalStatus?: string | null;
  proposalResult?: string | null;
  alignedWithOutcome?: boolean | null;
}

export interface ProfileVoting {
  total?: number;
  for?: number;
  against?: number;
  abstain?: number;
  withReason?: number;
  participationPct?: number | null;
  avgWeight?: number | null;
  firstVote?: Timestampish;
  lastVote?: Timestampish;
  streakCurrent?: number;
  byClient?: Array<{ clientId: number | null; count: number }>;
  revotes?: number;
  recent?: RecentVote[];
}

export interface AuthoredProposal {
  id: number | string;
  title?: string | null;
  status?: string | null;
  forVotes?: number | string;
  againstVotes?: number | string;
  abstainVotes?: number | string;
  createdAt?: Timestampish;
  executed?: boolean;
}

export interface ProfileProposals {
  authored?: AuthoredProposal[];
  signed?: Array<{ id: number | string; title?: string | null; status?: string | null }>;
  passRate?: number | null;
  totalRequestedEth?: number | null;
}

export interface AuthoredCandidate {
  id: string;
  slug?: string;
  title?: string | null;
  createdAt?: Timestampish;
  canceled?: boolean;
  promotedToProposalId?: number | string | null;
  sponsorCount?: number;
}

export interface SponsoredCandidate {
  candidateId: string;
  title?: string | null;
  reason?: string | null;
  createdAt?: Timestampish;
  canceled?: boolean;
  expirationTimestamp?: Timestampish;
}

export interface ProfileCandidates {
  authored?: AuthoredCandidate[];
  sponsored?: SponsoredCandidate[];
  feedbackGiven?: number;
  proposalFeedbackGiven?: number;
}

export interface WonAuction {
  nounId: number | string;
  amountEth?: number | string;
  timestamp?: Timestampish;
  clientId?: number | null;
  seed?: NounSeedLike | null;
}

export interface ProfileAuctions {
  won?: WonAuction[];
  wonCount?: number;
  totalSpentEth?: number | string;
  settled?: number;
  curated?: Array<number | string>;
  bids?: {
    count?: number;
    totalEth?: number | string;
    extendedCount?: number;
    nounsBidOn?: number;
  } | null;
  nounderRewards?: number | string | null;
}

export interface SaleRecord {
  nounId: number | string;
  priceEth?: number | string;
  marketplace?: string | null;
  side?: 'buy' | 'sell' | string;
  counterparty?: string | null;
  timestamp?: Timestampish;
}

export interface ProfileTransfers {
  received?: number;
  sent?: number;
  sales?: SaleRecord[];
}

export interface StreamRecord {
  streamAddress?: string;
  proposalId?: number | string;
  tokenAddress?: string;
  tokenSymbol?: string;
  totalAmount?: number | string;
  withdrawnAmount?: number | string;
  status?: string | null;
}

export interface ProfileTreasury {
  streams?: StreamRecord[];
  totalReceivedUsdc?: number | string | null;
  totalReceivedEth?: number | string | null;
  grants?: { authored?: number; votes?: number } | null;
}

export interface ForkRecord {
  forkId: number | string;
  kind?: string;
  nounIds?: Array<number | string>;
  timestamp?: Timestampish;
}

export interface ProfileV2 {
  votes?: number;
  for?: number;
  against?: number;
  abstain?: number;
  proposalsAuthored?: number;
  auctionsWon?: number;
  bids?: number;
  settled?: number;
}

export interface DelegationRecord {
  kind?: string;
  fromDelegate?: string | null;
  toDelegate?: string | null;
  nounCount?: number;
  timestamp?: Timestampish;
}

export interface OverviewText {
  text?: string;
  generatedAt?: Timestampish;
  model?: string | null;
  cached?: boolean;
}

export interface WalletProfile {
  identity?: ProfileIdentity | null;
  holdings?: ProfileHoldings | null;
  voting?: ProfileVoting | null;
  proposals?: ProfileProposals | null;
  candidates?: ProfileCandidates | null;
  auctions?: ProfileAuctions | null;
  transfers?: ProfileTransfers | null;
  treasury?: ProfileTreasury | null;
  forks?: ForkRecord[] | null;
  v2?: ProfileV2 | null;
  delegationHistory?: DelegationRecord[] | null;
  overview?: OverviewText | null;
  autopilot?: {
    enabled?: boolean;
    updatedAt?: Timestampish;
    mode?: AutopilotMode;
    /** Last few relayer-cast votes, public so visitors see "Autopilot cast FOR on Prop N". */
    recentAutoVotes?: AutopilotAutoVote[] | null;
  } | null;
  badges?: string[] | null;
}

// ─── Activity ──────────────────────────────────────────────────────────────

export interface WalletActivityEvent {
  type: string;
  blockNumber: number;
  timestamp: string;
  txHash: string;
  data: Record<string, unknown>;
}

export interface WalletActivityPage {
  events: WalletActivityEvent[];
  hasMore: boolean;
  oldestBlock: number;
}

// ─── Autopilot ─────────────────────────────────────────────────────────────

export type StanceKey =
  | 'art'
  | 'infrastructure'
  | 'events'
  | 'media'
  | 'grants'
  | 'protocolChanges'
  | 'treasuryOps';

export type Stances = Record<StanceKey, number>;

/** DAO namespace used by the autopilot API. */
export type AutopilotDao = 'nouns' | 'lil-nouns';

export const AUTOPILOT_DAOS: AutopilotDao[] = ['nouns', 'lil-nouns'];

export const AUTOPILOT_DAO_LABEL: Record<AutopilotDao, string> = {
  nouns: 'Nouns',
  'lil-nouns': 'Lil Nouns',
};

/** `draft`: noun.wtf recommends, you confirm. `auto`: the relayer casts via your 7702 permission. */
export type AutopilotMode = 'draft' | 'auto';

export interface AutopilotPrefs {
  philosophy: string;
  stances: Stances;
  maxAskEth: number | null;
  blockedProposers: string[];
  trustedProposers: string[];
  defaultWhenUnsure: 'abstain' | 'skip' | 'against';
  voteReasonStyle: 'none' | 'short' | 'full';
  mode: AutopilotMode;
  /** DAOs the relayer may auto-vote on (auto mode only). */
  daos: AutopilotDao[];
  /** 0..1 — recommendations below this are drafted, never auto-cast. */
  minConfidence: number;
  /** Hours to wait after a recommendation before casting, so you can veto. */
  autoVoteDelayHours: number;
  /** Only auto-cast when a written reason was drafted. */
  autoVoteOnlyWithReason: boolean;
}

export interface AutopilotRecommendation {
  proposalId: number | string;
  dao?: AutopilotDao | null;
  title?: string | null;
  support?: 0 | 1 | 2 | null;
  confidence?: number | null;
  reason?: string | null;
  generatedAt?: Timestampish;
  alreadyVoted?: boolean;
  pending?: boolean;
}

export interface AutopilotRelayer {
  address?: string | null;
  enabled?: boolean;
  balanceEth?: number | null;
}

export type AutopilotDelegationStatus = 'active' | 'expired' | 'revoked' | 'exhausted';

export interface AutopilotDelegation {
  id: string;
  dao: AutopilotDao;
  delegator?: string;
  redeemer?: string;
  hash?: string;
  expiresAt?: Timestampish;
  maxVotes?: number | null;
  uses?: number;
  createdAt?: Timestampish;
  revokedAt?: Timestampish | null;
  onchainDisabled?: boolean;
  status?: AutopilotDelegationStatus | string;
  /**
   * Serialized Delegation JSON (as posted). Needed to build the on-chain
   * revoke call; the panel also caches it locally in case the API omits it.
   */
  delegation?: string | null;
}

export type AutopilotAutoVoteStatus = 'sent' | 'confirmed' | 'failed';

export interface AutopilotAutoVote {
  id: string;
  dao?: AutopilotDao | null;
  proposalId: number | string;
  title?: string | null;
  support?: 0 | 1 | 2 | null;
  reason?: string | null;
  txHash?: string | null;
  castAt?: Timestampish;
  status?: AutopilotAutoVoteStatus | string;
  error?: string | null;
}

export interface AutopilotState {
  enabled?: boolean;
  prefs?: AutopilotPrefs | null;
  updatedAt?: Timestampish;
  recommendations?: AutopilotRecommendation[];
  relayer?: AutopilotRelayer | null;
  delegations?: AutopilotDelegation[];
  autoVotes?: AutopilotAutoVote[];
}

export const STANCE_KEYS: StanceKey[] = [
  'art',
  'infrastructure',
  'events',
  'media',
  'grants',
  'protocolChanges',
  'treasuryOps',
];

export const STANCE_LABELS: Record<StanceKey, string> = {
  art: 'Art & culture',
  infrastructure: 'Infrastructure & tooling',
  events: 'Events & IRL',
  media: 'Media & content',
  grants: 'Grants & retro funding',
  protocolChanges: 'Protocol changes',
  treasuryOps: 'Treasury ops',
};

export const DEFAULT_PREFS: AutopilotPrefs = {
  philosophy: '',
  stances: {
    art: 0,
    infrastructure: 0,
    events: 0,
    media: 0,
    grants: 0,
    protocolChanges: 0,
    treasuryOps: 0,
  },
  maxAskEth: null,
  blockedProposers: [],
  trustedProposers: [],
  defaultWhenUnsure: 'abstain',
  voteReasonStyle: 'short',
  mode: 'draft',
  daos: ['nouns'],
  minConfidence: 0.6,
  autoVoteDelayHours: 24,
  autoVoteOnlyWithReason: false,
};

export type ProfileTab =
  | 'overview'
  | 'votes'
  | 'proposals'
  | 'candidates'
  | 'auctions'
  | 'nouns'
  | 'treasury'
  | 'activity'
  | 'graph';

export const PROFILE_TABS: { key: ProfileTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'votes', label: 'Votes' },
  { key: 'proposals', label: 'Proposals' },
  { key: 'candidates', label: 'Candidates' },
  { key: 'auctions', label: 'Auctions' },
  { key: 'nouns', label: 'Nouns' },
  { key: 'treasury', label: 'Treasury' },
  { key: 'activity', label: 'Activity' },
  { key: 'graph', label: 'Identity graph' },
];
