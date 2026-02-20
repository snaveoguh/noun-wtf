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
