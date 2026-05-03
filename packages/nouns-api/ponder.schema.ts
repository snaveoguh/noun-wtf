import { index, onchainEnum, onchainTable, primaryKey, relations } from 'ponder';

// ── Nouns ──────────────────────────────────────────────────────────────────────

export const noun = onchainTable('nouns', t => ({
  id: t.bigint().primaryKey(),
  owner: t.hex().notNull(),
  head: t.integer().notNull(),
  body: t.integer().notNull(),
  accessory: t.integer().notNull(),
  glasses: t.integer().notNull(),
  background: t.integer().notNull(),
  createdAt: t.timestamp().notNull(),
  createdAtBlock: t.bigint().notNull(),
  createdAtTransaction: t.text().notNull(),
}));

export const nounRelations = relations(noun, ({ one }) => ({
  auction: one(auction, {
    fields: [noun.id],
    references: [auction.nounId],
  }),
}));

// ── Delegates ──────────────────────────────────────────────────────────────────

export const delegate = onchainTable('delegate', t => ({
  id: t.hex().primaryKey(), // delegate address
  delegatedVotes: t.integer().notNull().default(0),
}));

export const delegateRelations = relations(delegate, ({ many }) => ({
  nounsRepresented: many(delegateNoun),
}));

export const delegateNoun = onchainTable(
  'delegate_noun',
  t => ({
    delegateId: t.hex().notNull(),
    nounId: t.bigint().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.delegateId, t.nounId] }),
  }),
);

export const delegateNounRelations = relations(delegateNoun, ({ one }) => ({
  delegate: one(delegate, {
    fields: [delegateNoun.delegateId],
    references: [delegate.id],
  }),
  noun: one(noun, {
    fields: [delegateNoun.nounId],
    references: [noun.id],
  }),
}));

// Tracks the current delegate for each address. Defaults to self when no row
// exists (matches NounsToken's ERC721Checkpointable behavior where `delegates(holder)`
// returns `holder` itself when `_delegates[holder] == address(0)`).
//
// Maintained on `DelegateChanged` and read by the `Transfer` handler to know
// which `delegateNoun` row to delete (old owner's delegate) and insert (new
// owner's delegate). Without this we'd need an RPC call to `delegates(addr)`
// per transfer, which is wasteful during historical sync.
export const accountDelegate = onchainTable('account_delegate', t => ({
  account: t.hex().primaryKey(),
  delegate: t.hex().notNull(),
}));

// ── Proposals ──────────────────────────────────────────────────────────────────

const proposalStatusValues = [
  'PENDING',
  'ACTIVE',
  'CANCELLED',
  'VETOED',
  'QUEUED',
  'EXECUTED',
] as const;
export type ProposalStatus = (typeof proposalStatusValues)[number];
export const proposalStatus = onchainEnum('proposalStatus', proposalStatusValues);

export const proposal = onchainTable(
  'proposal',
  t => ({
    id: t.bigint().primaryKey(),
    proposer: t.hex().notNull(),
    description: t.text().notNull(),
    status: proposalStatus().notNull().default('PENDING'),
    forVotes: t.integer().notNull().default(0),
    againstVotes: t.integer().notNull().default(0),
    abstainVotes: t.integer().notNull().default(0),
    startBlock: t.bigint().notNull().default(0n),
    endBlock: t.bigint().notNull().default(0n),
    proposalThreshold: t.bigint().notNull().default(0n),
    quorumVotes: t.bigint().notNull().default(0n),
    executionETA: t.bigint(),
    objectionPeriodEndBlock: t.bigint(),
    updatePeriodEndBlock: t.bigint(),
    voteSnapshotBlock: t.bigint(),
    onTimelockV1: t.boolean().notNull().default(false),
    clientId: t.integer(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
  }),
  t => ({
    statusIndex: index().on(t.status),
  }),
);

export const proposalRelations = relations(proposal, ({ many }) => ({
  transactions: many(transaction),
  streams: many(stream),
  votes: many(vote),
  signers: many(proposalSigner),
}));

// ── Proposal Signers ───────────────────────────────────────────────────────────

export const proposalSigner = onchainTable(
  'proposal_signer',
  t => ({
    proposalId: t.bigint().notNull(),
    signer: t.hex().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.proposalId, t.signer] }),
  }),
);

export const proposalSignerRelations = relations(proposalSigner, ({ one }) => ({
  proposal: one(proposal, {
    fields: [proposalSigner.proposalId],
    references: [proposal.id],
  }),
}));

// ── Transactions ───────────────────────────────────────────────────────────────

export const transaction = onchainTable(
  'transaction',
  t => ({
    index: t.integer(),
    proposalId: t.bigint().notNull(),
    target: t.hex().notNull(),
    value: t.bigint().notNull(),
    signature: t.text().notNull(),
    calldata: t.hex().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.index, t.proposalId] }),
  }),
);

export const transactionRelations = relations(transaction, ({ one }) => ({
  proposal: one(proposal, {
    fields: [transaction.proposalId],
    references: [proposal.id],
  }),
}));

// ── Votes ──────────────────────────────────────────────────────────────────────

export const vote = onchainTable(
  'vote',
  t => ({
    voter: t.hex().notNull(),
    proposalId: t.bigint().notNull(),
    support: t.integer().notNull(), // 0=against, 1=for, 2=abstain
    votes: t.integer().notNull(),
    reason: t.text(),
    clientId: t.integer(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.voter, t.proposalId] }),
    proposalIdIndex: index().on(t.proposalId),
  }),
);

export const voteRelations = relations(vote, ({ one }) => ({
  proposal: one(proposal, {
    fields: [vote.proposalId],
    references: [proposal.id],
  }),
}));

// ── Auctions ───────────────────────────────────────────────────────────────────

export const auction = onchainTable('nounsAuctionHouseV2', t => ({
  nounId: t.bigint().primaryKey(),
  startTime: t.timestamp().notNull(),
  endTime: t.timestamp().notNull(),
  settled: t.boolean().notNull().default(false),
  // settler: t.hex(), // TODO: add after initial sync completes to avoid full resync
  winner: t.hex(),
  amount: t.bigint(), // winning bid amount
  // Mainnet prop #XXX raised reservePrice to 2.8 ETH. Auctions that end with
  // no bid meeting the reserve settle as AuctionSettled(winner=0x0, amount=0)
  // and the noun is burned in _settleAuction. Flag those rows so the webapp
  // can branch to a burned-placeholder renderer instead of showing a "won by
  // 0x000..." row.
  burned: t.boolean().notNull().default(false),
  clientId: t.integer(),
  createdAt: t.timestamp().notNull(),
  createdAtBlock: t.bigint().notNull(),
  createdAtTransaction: t.text().notNull(),
}));

export const auctionRelations = relations(auction, ({ one, many }) => ({
  noun: one(noun, {
    fields: [auction.nounId],
    references: [noun.id],
  }),
  bids: many(bid),
}));

// ── Bids ───────────────────────────────────────────────────────────────────────

export const bid = onchainTable(
  'bid',
  t => ({
    nounId: t.bigint().notNull(),
    value: t.bigint().notNull(),
    bidder: t.hex().notNull(),
    clientId: t.integer(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.nounId, t.value] }),
  }),
);

export const bidRelations = relations(bid, ({ one }) => ({
  auction: one(auction, {
    fields: [bid.nounId],
    references: [auction.nounId],
  }),
}));

// ── Streams ────────────────────────────────────────────────────────────────────

const streamStatusValues = ['active', 'cancelled', 'concluded'] as const;
export type StreamStatus = (typeof streamStatusValues)[number];
export const streamStatus = onchainEnum('streamStatus', streamStatusValues);

export const stream = onchainTable(
  'stream',
  t => ({
    proposalId: t.bigint(),
    streamAddress: t.hex().primaryKey(),
    status: streamStatus().notNull(),
    creator: t.hex().notNull(),
    payer: t.hex().notNull(),
    recipient: t.hex().notNull(),
    tokenAmount: t.bigint().notNull(),
    withdrawnAmount: t.bigint().notNull(),
    tokenAddress: t.hex().notNull(),
    startTime: t.timestamp().notNull(),
    stopTime: t.timestamp().notNull(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
  }),
  t => ({
    createdAtBlockIndex: index().on(t.createdAtBlock),
  }),
);

export const streamRelations = relations(stream, ({ one }) => ({
  proposal: one(proposal, {
    fields: [stream.proposalId],
    references: [proposal.id],
  }),
}));

// ── Delegation Events ────────────────────────────────────────────────────────

export const delegationEvent = onchainTable(
  'delegation_event',
  t => ({
    delegator: t.hex().notNull(),
    fromDelegate: t.hex().notNull(),
    toDelegate: t.hex().notNull(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.delegator, t.createdAtBlock] }),
    createdAtBlockIndex: index().on(t.createdAtBlock),
  }),
);

// ── Noun Transfers ───────────────────────────────────────────────────────────

export const nounTransfer = onchainTable(
  'noun_transfer',
  t => ({
    nounId: t.bigint().notNull(),
    from: t.hex().notNull(),
    to: t.hex().notNull(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.nounId, t.createdAtBlock, t.createdAtTransaction] }),
    createdAtBlockIndex: index().on(t.createdAtBlock),
  }),
);

// ── Proposal Status Changes ─────────────────────────────────────────────────

export const proposalStatusChange = onchainTable(
  'proposal_status_change',
  t => ({
    proposalId: t.bigint().notNull(),
    status: proposalStatus().notNull(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.proposalId, t.status] }),
    createdAtBlockIndex: index().on(t.createdAtBlock),
  }),
);

// ── Proposal Candidates ──────────────────────────────────────────────────────

export const candidate = onchainTable(
  'candidate',
  t => ({
    id: t.text().primaryKey(), // `${proposer}-${slug}`
    slug: t.text().notNull(),
    proposer: t.hex().notNull(),
    canceled: t.boolean().notNull().default(false),
    versionsCount: t.integer().notNull().default(1),
    proposalIdToUpdate: t.bigint(),
    encodedProposalHash: t.hex(),
    description: t.text().notNull(),
    // Transaction details stored as JSON text for simplicity
    targets: t.text().notNull().default('[]'),
    values: t.text().notNull().default('[]'),
    signatures: t.text().notNull().default('[]'),
    calldatas: t.text().notNull().default('[]'),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
    lastUpdatedAt: t.timestamp().notNull(),
    lastUpdatedAtBlock: t.bigint().notNull(),
    // Cancel details (null until canceled)
    canceledAtBlock: t.bigint(),
    canceledAtTimestamp: t.timestamp(),
    canceledAtTx: t.hex(),
    // Promotion details (null until promoted to a live proposal)
    promotedToProposalId: t.bigint(),
    promotedAtBlock: t.bigint(),
    promotedAtTimestamp: t.timestamp(),
    promotedAtTx: t.hex(),
  }),
  t => ({
    proposerIndex: index().on(t.proposer),
    canceledIndex: index().on(t.canceled),
    canceledAtBlockIndex: index().on(t.canceledAtBlock),
    promotedAtBlockIndex: index().on(t.promotedAtBlock),
  }),
);

export const candidateRelations = relations(candidate, ({ many }) => ({
  candidateSignatures: many(candidateSignature),
  candidateVersions: many(candidateVersion),
}));

// ── Candidate Versions ───────────────────────────────────────────────────────
// One row per ProposalCandidateUpdated event (i.e. NOT the initial create).
// Lets us emit CANDIDATE_UPDATED activity events per update.

export const candidateVersion = onchainTable(
  'candidate_version',
  t => ({
    candidateId: t.text().notNull(),
    blockNumber: t.bigint().notNull(),
    logIndex: t.integer().notNull(),
    txHash: t.hex().notNull(),
    blockTimestamp: t.timestamp().notNull(),
    description: t.text().notNull(),
    reason: t.text().notNull().default(''),
    encodedProposalHash: t.hex(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.candidateId, t.blockNumber, t.logIndex] }),
    candidateIdIndex: index().on(t.candidateId),
    blockNumberIndex: index().on(t.blockNumber),
  }),
);

export const candidateVersionRelations = relations(candidateVersion, ({ one }) => ({
  candidate: one(candidate, {
    fields: [candidateVersion.candidateId],
    references: [candidate.id],
  }),
}));

// ── Candidate Signatures ─────────────────────────────────────────────────────

export const candidateSignature = onchainTable(
  'candidate_signature',
  t => ({
    candidateId: t.text().notNull(),
    signer: t.hex().notNull(),
    sig: t.hex().notNull(),
    expirationTimestamp: t.bigint().notNull(),
    encodedPropHash: t.hex().notNull(),
    reason: t.text().notNull().default(''),
    canceled: t.boolean().notNull().default(false),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.candidateId, t.signer, t.sig] }),
    candidateIdIndex: index().on(t.candidateId),
  }),
);

export const candidateSignatureRelations = relations(candidateSignature, ({ one }) => ({
  candidate: one(candidate, {
    fields: [candidateSignature.candidateId],
    references: [candidate.id],
  }),
}));

// ── Proposal Feedback ────────────────────────────────────────────────────────

export const proposalFeedback = onchainTable(
  'proposal_feedback',
  t => ({
    voter: t.hex().notNull(),
    proposalId: t.bigint().notNull(),
    support: t.integer().notNull(), // 0=against, 1=for, 2=abstain
    reason: t.text().notNull().default(''),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.voter, t.proposalId] }),
    proposalIdIndex: index().on(t.proposalId),
  }),
);

// ── Candidate Feedback ───────────────────────────────────────────────────────

export const candidateFeedback = onchainTable(
  'candidate_feedback',
  t => ({
    voter: t.hex().notNull(),
    candidateId: t.text().notNull(), // `${proposer}-${slug}`
    support: t.integer().notNull(), // 0=against, 1=for, 2=abstain
    reason: t.text().notNull().default(''),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.voter, t.candidateId] }),
    candidateIdIndex: index().on(t.candidateId),
  }),
);

// ── Small Grants ─────────────────────────────────────────────────────────────

const grantStatusValues = [
  'ACTIVE',
  'DEFEATED',
  'SUCCEEDED',
  'QUEUED',
  'EXECUTED',
  'CANCELED',
  'EXPIRED',
] as const;
export type GrantStatus = (typeof grantStatusValues)[number];
export const grantStatus = onchainEnum('grantStatus', grantStatusValues);

export const grant = onchainTable(
  'grant',
  t => ({
    id: t.bigint().primaryKey(),
    proposer: t.hex().notNull(),
    description: t.text().notNull(),
    status: grantStatus().notNull().default('ACTIVE'),
    forVotes: t.integer().notNull().default(0),
    againstVotes: t.integer().notNull().default(0),
    abstainVotes: t.integer().notNull().default(0),
    snapshotBlock: t.bigint().notNull(),
    startBlock: t.bigint().notNull(),
    endBlock: t.bigint().notNull(),
    executionETA: t.bigint(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
  }),
  t => ({
    statusIndex: index().on(t.status),
  }),
);

export const grantRelations = relations(grant, ({ many }) => ({
  transactions: many(grantTransaction),
  votes: many(grantVote),
}));

export const grantTransaction = onchainTable(
  'grant_transaction',
  t => ({
    index: t.integer(),
    grantId: t.bigint().notNull(),
    target: t.hex().notNull(),
    value: t.bigint().notNull(),
    signature: t.text().notNull(),
    calldata: t.hex().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.index, t.grantId] }),
  }),
);

export const grantTransactionRelations = relations(grantTransaction, ({ one }) => ({
  grant: one(grant, {
    fields: [grantTransaction.grantId],
    references: [grant.id],
  }),
}));

export const grantVote = onchainTable(
  'grant_vote',
  t => ({
    voter: t.hex().notNull(),
    grantId: t.bigint().notNull(),
    support: t.integer().notNull(),
    votes: t.integer().notNull(),
    reason: t.text(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.voter, t.grantId] }),
    grantIdIndex: index().on(t.grantId),
  }),
);

export const grantVoteRelations = relations(grantVote, ({ one }) => ({
  grant: one(grant, {
    fields: [grantVote.grantId],
    references: [grant.id],
  }),
}));

export const grantStatusChange = onchainTable(
  'grant_status_change',
  t => ({
    grantId: t.bigint().notNull(),
    status: grantStatus().notNull(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.grantId, t.status] }),
    createdAtBlockIndex: index().on(t.createdAtBlock),
  }),
);

// ── NounV2 ───────────────────────────────────────────────────────────────────
// Standalone fork tables. Kept separate from main Nouns schema so neither
// depends on the other and existing UI/queries are unaffected.

const nounV2ProposalStatusValues = [
  'ACTIVE',
  'DEFEATED',
  'SUCCEEDED',
  'QUEUED',
  'EXECUTED',
  'CANCELED',
  'EXPIRED',
] as const;
export type NounV2ProposalStatus = (typeof nounV2ProposalStatusValues)[number];
export const nounV2ProposalStatus = onchainEnum('nounV2ProposalStatus', nounV2ProposalStatusValues);

export const nounV2Proposal = onchainTable(
  'nounv2_proposal',
  t => ({
    id: t.bigint().primaryKey(),
    proposer: t.hex().notNull(),
    description: t.text().notNull(),
    status: nounV2ProposalStatus().notNull().default('ACTIVE'),
    forVotes: t.integer().notNull().default(0),
    againstVotes: t.integer().notNull().default(0),
    abstainVotes: t.integer().notNull().default(0),
    startBlock: t.bigint().notNull(),
    endBlock: t.bigint().notNull(),
    executionETA: t.bigint(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
  }),
  t => ({
    statusIndex: index().on(t.status),
  }),
);

export const nounV2ProposalRelations = relations(nounV2Proposal, ({ many }) => ({
  transactions: many(nounV2ProposalTransaction),
  votes: many(nounV2Vote),
}));

export const nounV2ProposalTransaction = onchainTable(
  'nounv2_proposal_transaction',
  t => ({
    index: t.integer(),
    proposalId: t.bigint().notNull(),
    target: t.hex().notNull(),
    value: t.bigint().notNull(),
    signature: t.text().notNull(),
    calldata: t.hex().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.index, t.proposalId] }),
  }),
);

export const nounV2ProposalTransactionRelations = relations(
  nounV2ProposalTransaction,
  ({ one }) => ({
    proposal: one(nounV2Proposal, {
      fields: [nounV2ProposalTransaction.proposalId],
      references: [nounV2Proposal.id],
    }),
  }),
);

export const nounV2Vote = onchainTable(
  'nounv2_vote',
  t => ({
    voter: t.hex().notNull(),
    proposalId: t.bigint().notNull(),
    support: t.integer().notNull(), // 0=against, 1=for, 2=abstain
    votes: t.integer().notNull(),
    reason: t.text(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.voter, t.proposalId] }),
    proposalIdIndex: index().on(t.proposalId),
  }),
);

export const nounV2VoteRelations = relations(nounV2Vote, ({ one }) => ({
  proposal: one(nounV2Proposal, {
    fields: [nounV2Vote.proposalId],
    references: [nounV2Proposal.id],
  }),
}));

export const nounV2ProposalStatusChange = onchainTable(
  'nounv2_proposal_status_change',
  t => ({
    proposalId: t.bigint().notNull(),
    status: nounV2ProposalStatus().notNull(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.proposalId, t.status] }),
    createdAtBlockIndex: index().on(t.createdAtBlock),
  }),
);

// ── NounV2 Auctions ─────────────────────────────────────────────────────────

export const nounV2Auction = onchainTable('nounv2_auction', t => ({
  nounId: t.bigint().primaryKey(),
  startTime: t.timestamp().notNull(),
  endTime: t.timestamp().notNull(),
  settled: t.boolean().notNull().default(false),
  winner: t.hex(),
  amount: t.bigint(),
  createdAt: t.timestamp().notNull(),
  createdAtBlock: t.bigint().notNull(),
  createdAtTransaction: t.text().notNull(),
}));

export const nounV2AuctionRelations = relations(nounV2Auction, ({ many }) => ({
  bids: many(nounV2Bid),
}));

export const nounV2Bid = onchainTable(
  'nounv2_bid',
  t => ({
    nounId: t.bigint().notNull(),
    value: t.bigint().notNull(),
    bidder: t.hex().notNull(),
    extended: t.boolean().notNull().default(false),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
  }),
  t => ({
    primaryKey: primaryKey({ columns: [t.nounId, t.value] }),
    nounIdIndex: index().on(t.nounId),
  }),
);

export const nounV2BidRelations = relations(nounV2Bid, ({ one }) => ({
  auction: one(nounV2Auction, {
    fields: [nounV2Bid.nounId],
    references: [nounV2Auction.nounId],
  }),
}));
