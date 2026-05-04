"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nounV2Auction = exports.nounV2ProposalStatusChange = exports.nounV2VoteRelations = exports.nounV2Vote = exports.nounV2ProposalTransactionRelations = exports.nounV2ProposalTransaction = exports.nounV2ProposalRelations = exports.nounV2Proposal = exports.nounV2ProposalStatus = exports.grantStatusChange = exports.grantVoteRelations = exports.grantVote = exports.grantTransactionRelations = exports.grantTransaction = exports.grantRelations = exports.grant = exports.grantStatus = exports.candidateFeedback = exports.proposalFeedback = exports.candidateSignatureRelations = exports.candidateSignature = exports.candidateVersionRelations = exports.candidateVersion = exports.candidateRelations = exports.candidate = exports.proposalStatusChange = exports.nounTransfer = exports.delegationEvent = exports.streamRelations = exports.stream = exports.streamStatus = exports.bidRelations = exports.bid = exports.auctionRelations = exports.auction = exports.voteRelations = exports.vote = exports.transactionRelations = exports.transaction = exports.proposalSignerRelations = exports.proposalSigner = exports.proposalRelations = exports.proposal = exports.proposalStatus = exports.delegateNounRelations = exports.delegateNoun = exports.delegateRelations = exports.delegate = exports.nounRelations = exports.noun = void 0;
exports.nounV2BidRelations = exports.nounV2Bid = exports.nounV2AuctionRelations = void 0;
var ponder_1 = require("ponder");
// ── Nouns ──────────────────────────────────────────────────────────────────────
exports.noun = (0, ponder_1.onchainTable)('nouns', function (t) { return ({
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
}); });
exports.nounRelations = (0, ponder_1.relations)(exports.noun, function (_a) {
    var one = _a.one;
    return ({
        auction: one(exports.auction, {
            fields: [exports.noun.id],
            references: [exports.auction.nounId],
        }),
    });
});
// ── Delegates ──────────────────────────────────────────────────────────────────
exports.delegate = (0, ponder_1.onchainTable)('delegate', function (t) { return ({
    id: t.hex().primaryKey(), // delegate address
    delegatedVotes: t.integer().notNull().default(0),
}); });
exports.delegateRelations = (0, ponder_1.relations)(exports.delegate, function (_a) {
    var many = _a.many;
    return ({
        nounsRepresented: many(exports.delegateNoun),
    });
});
exports.delegateNoun = (0, ponder_1.onchainTable)('delegate_noun', function (t) { return ({
    delegateId: t.hex().notNull(),
    nounId: t.bigint().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.delegateId, t.nounId] }),
}); });
exports.delegateNounRelations = (0, ponder_1.relations)(exports.delegateNoun, function (_a) {
    var one = _a.one;
    return ({
        delegate: one(exports.delegate, {
            fields: [exports.delegateNoun.delegateId],
            references: [exports.delegate.id],
        }),
        noun: one(exports.noun, {
            fields: [exports.delegateNoun.nounId],
            references: [exports.noun.id],
        }),
    });
});
// ── Proposals ──────────────────────────────────────────────────────────────────
var proposalStatusValues = [
    'PENDING',
    'ACTIVE',
    'CANCELLED',
    'VETOED',
    'QUEUED',
    'EXECUTED',
];
exports.proposalStatus = (0, ponder_1.onchainEnum)('proposalStatus', proposalStatusValues);
exports.proposal = (0, ponder_1.onchainTable)('proposal', function (t) { return ({
    id: t.bigint().primaryKey(),
    proposer: t.hex().notNull(),
    description: t.text().notNull(),
    status: (0, exports.proposalStatus)().notNull().default('PENDING'),
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
}); }, function (t) { return ({
    statusIndex: (0, ponder_1.index)().on(t.status),
}); });
exports.proposalRelations = (0, ponder_1.relations)(exports.proposal, function (_a) {
    var many = _a.many;
    return ({
        transactions: many(exports.transaction),
        streams: many(exports.stream),
        votes: many(exports.vote),
        signers: many(exports.proposalSigner),
    });
});
// ── Proposal Signers ───────────────────────────────────────────────────────────
exports.proposalSigner = (0, ponder_1.onchainTable)('proposal_signer', function (t) { return ({
    proposalId: t.bigint().notNull(),
    signer: t.hex().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.proposalId, t.signer] }),
}); });
exports.proposalSignerRelations = (0, ponder_1.relations)(exports.proposalSigner, function (_a) {
    var one = _a.one;
    return ({
        proposal: one(exports.proposal, {
            fields: [exports.proposalSigner.proposalId],
            references: [exports.proposal.id],
        }),
    });
});
// ── Transactions ───────────────────────────────────────────────────────────────
exports.transaction = (0, ponder_1.onchainTable)('transaction', function (t) { return ({
    index: t.integer(),
    proposalId: t.bigint().notNull(),
    target: t.hex().notNull(),
    value: t.bigint().notNull(),
    signature: t.text().notNull(),
    calldata: t.hex().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.index, t.proposalId] }),
}); });
exports.transactionRelations = (0, ponder_1.relations)(exports.transaction, function (_a) {
    var one = _a.one;
    return ({
        proposal: one(exports.proposal, {
            fields: [exports.transaction.proposalId],
            references: [exports.proposal.id],
        }),
    });
});
// ── Votes ──────────────────────────────────────────────────────────────────────
exports.vote = (0, ponder_1.onchainTable)('vote', function (t) { return ({
    voter: t.hex().notNull(),
    proposalId: t.bigint().notNull(),
    support: t.integer().notNull(), // 0=against, 1=for, 2=abstain
    votes: t.integer().notNull(),
    reason: t.text(),
    clientId: t.integer(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.voter, t.proposalId] }),
    proposalIdIndex: (0, ponder_1.index)().on(t.proposalId),
}); });
exports.voteRelations = (0, ponder_1.relations)(exports.vote, function (_a) {
    var one = _a.one;
    return ({
        proposal: one(exports.proposal, {
            fields: [exports.vote.proposalId],
            references: [exports.proposal.id],
        }),
    });
});
// ── Auctions ───────────────────────────────────────────────────────────────────
exports.auction = (0, ponder_1.onchainTable)('nounsAuctionHouseV2', function (t) { return ({
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
}); });
exports.auctionRelations = (0, ponder_1.relations)(exports.auction, function (_a) {
    var one = _a.one, many = _a.many;
    return ({
        noun: one(exports.noun, {
            fields: [exports.auction.nounId],
            references: [exports.noun.id],
        }),
        bids: many(exports.bid),
    });
});
// ── Bids ───────────────────────────────────────────────────────────────────────
exports.bid = (0, ponder_1.onchainTable)('bid', function (t) { return ({
    nounId: t.bigint().notNull(),
    value: t.bigint().notNull(),
    bidder: t.hex().notNull(),
    clientId: t.integer(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.nounId, t.value] }),
}); });
exports.bidRelations = (0, ponder_1.relations)(exports.bid, function (_a) {
    var one = _a.one;
    return ({
        auction: one(exports.auction, {
            fields: [exports.bid.nounId],
            references: [exports.auction.nounId],
        }),
    });
});
// ── Streams ────────────────────────────────────────────────────────────────────
var streamStatusValues = ['active', 'cancelled', 'concluded'];
exports.streamStatus = (0, ponder_1.onchainEnum)('streamStatus', streamStatusValues);
exports.stream = (0, ponder_1.onchainTable)('stream', function (t) { return ({
    proposalId: t.bigint(),
    streamAddress: t.hex().primaryKey(),
    status: (0, exports.streamStatus)().notNull(),
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
}); }, function (t) { return ({
    createdAtBlockIndex: (0, ponder_1.index)().on(t.createdAtBlock),
}); });
exports.streamRelations = (0, ponder_1.relations)(exports.stream, function (_a) {
    var one = _a.one;
    return ({
        proposal: one(exports.proposal, {
            fields: [exports.stream.proposalId],
            references: [exports.proposal.id],
        }),
    });
});
// ── Delegation Events ────────────────────────────────────────────────────────
exports.delegationEvent = (0, ponder_1.onchainTable)('delegation_event', function (t) { return ({
    delegator: t.hex().notNull(),
    fromDelegate: t.hex().notNull(),
    toDelegate: t.hex().notNull(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.delegator, t.createdAtBlock] }),
    createdAtBlockIndex: (0, ponder_1.index)().on(t.createdAtBlock),
}); });
// ── Noun Transfers ───────────────────────────────────────────────────────────
exports.nounTransfer = (0, ponder_1.onchainTable)('noun_transfer', function (t) { return ({
    nounId: t.bigint().notNull(),
    from: t.hex().notNull(),
    to: t.hex().notNull(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.nounId, t.createdAtBlock, t.createdAtTransaction] }),
    createdAtBlockIndex: (0, ponder_1.index)().on(t.createdAtBlock),
}); });
// ── Proposal Status Changes ─────────────────────────────────────────────────
exports.proposalStatusChange = (0, ponder_1.onchainTable)('proposal_status_change', function (t) { return ({
    proposalId: t.bigint().notNull(),
    status: (0, exports.proposalStatus)().notNull(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.proposalId, t.status] }),
    createdAtBlockIndex: (0, ponder_1.index)().on(t.createdAtBlock),
}); });
// ── Proposal Candidates ──────────────────────────────────────────────────────
exports.candidate = (0, ponder_1.onchainTable)('candidate', function (t) { return ({
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
}); }, function (t) { return ({
    proposerIndex: (0, ponder_1.index)().on(t.proposer),
    canceledIndex: (0, ponder_1.index)().on(t.canceled),
    canceledAtBlockIndex: (0, ponder_1.index)().on(t.canceledAtBlock),
    promotedAtBlockIndex: (0, ponder_1.index)().on(t.promotedAtBlock),
}); });
exports.candidateRelations = (0, ponder_1.relations)(exports.candidate, function (_a) {
    var many = _a.many;
    return ({
        candidateSignatures: many(exports.candidateSignature),
        candidateVersions: many(exports.candidateVersion),
    });
});
// ── Candidate Versions ───────────────────────────────────────────────────────
// One row per ProposalCandidateUpdated event (i.e. NOT the initial create).
// Lets us emit CANDIDATE_UPDATED activity events per update.
exports.candidateVersion = (0, ponder_1.onchainTable)('candidate_version', function (t) { return ({
    candidateId: t.text().notNull(),
    blockNumber: t.bigint().notNull(),
    logIndex: t.integer().notNull(),
    txHash: t.hex().notNull(),
    blockTimestamp: t.timestamp().notNull(),
    description: t.text().notNull(),
    reason: t.text().notNull().default(''),
    encodedProposalHash: t.hex(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.candidateId, t.blockNumber, t.logIndex] }),
    candidateIdIndex: (0, ponder_1.index)().on(t.candidateId),
    blockNumberIndex: (0, ponder_1.index)().on(t.blockNumber),
}); });
exports.candidateVersionRelations = (0, ponder_1.relations)(exports.candidateVersion, function (_a) {
    var one = _a.one;
    return ({
        candidate: one(exports.candidate, {
            fields: [exports.candidateVersion.candidateId],
            references: [exports.candidate.id],
        }),
    });
});
// ── Candidate Signatures ─────────────────────────────────────────────────────
exports.candidateSignature = (0, ponder_1.onchainTable)('candidate_signature', function (t) { return ({
    candidateId: t.text().notNull(),
    signer: t.hex().notNull(),
    sig: t.hex().notNull(),
    expirationTimestamp: t.bigint().notNull(),
    encodedPropHash: t.hex().notNull(),
    reason: t.text().notNull().default(''),
    canceled: t.boolean().notNull().default(false),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.candidateId, t.signer, t.sig] }),
    candidateIdIndex: (0, ponder_1.index)().on(t.candidateId),
}); });
exports.candidateSignatureRelations = (0, ponder_1.relations)(exports.candidateSignature, function (_a) {
    var one = _a.one;
    return ({
        candidate: one(exports.candidate, {
            fields: [exports.candidateSignature.candidateId],
            references: [exports.candidate.id],
        }),
    });
});
// ── Proposal Feedback ────────────────────────────────────────────────────────
exports.proposalFeedback = (0, ponder_1.onchainTable)('proposal_feedback', function (t) { return ({
    voter: t.hex().notNull(),
    proposalId: t.bigint().notNull(),
    support: t.integer().notNull(), // 0=against, 1=for, 2=abstain
    reason: t.text().notNull().default(''),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.voter, t.proposalId] }),
    proposalIdIndex: (0, ponder_1.index)().on(t.proposalId),
}); });
// ── Candidate Feedback ───────────────────────────────────────────────────────
exports.candidateFeedback = (0, ponder_1.onchainTable)('candidate_feedback', function (t) { return ({
    voter: t.hex().notNull(),
    candidateId: t.text().notNull(), // `${proposer}-${slug}`
    support: t.integer().notNull(), // 0=against, 1=for, 2=abstain
    reason: t.text().notNull().default(''),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.voter, t.candidateId] }),
    candidateIdIndex: (0, ponder_1.index)().on(t.candidateId),
}); });
// ── Small Grants ─────────────────────────────────────────────────────────────
var grantStatusValues = ['ACTIVE', 'DEFEATED', 'SUCCEEDED', 'QUEUED', 'EXECUTED', 'CANCELED', 'EXPIRED'];
exports.grantStatus = (0, ponder_1.onchainEnum)('grantStatus', grantStatusValues);
exports.grant = (0, ponder_1.onchainTable)('grant', function (t) { return ({
    id: t.bigint().primaryKey(),
    proposer: t.hex().notNull(),
    description: t.text().notNull(),
    status: (0, exports.grantStatus)().notNull().default('ACTIVE'),
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
}); }, function (t) { return ({
    statusIndex: (0, ponder_1.index)().on(t.status),
}); });
exports.grantRelations = (0, ponder_1.relations)(exports.grant, function (_a) {
    var many = _a.many;
    return ({
        transactions: many(exports.grantTransaction),
        votes: many(exports.grantVote),
    });
});
exports.grantTransaction = (0, ponder_1.onchainTable)('grant_transaction', function (t) { return ({
    index: t.integer(),
    grantId: t.bigint().notNull(),
    target: t.hex().notNull(),
    value: t.bigint().notNull(),
    signature: t.text().notNull(),
    calldata: t.hex().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.index, t.grantId] }),
}); });
exports.grantTransactionRelations = (0, ponder_1.relations)(exports.grantTransaction, function (_a) {
    var one = _a.one;
    return ({
        grant: one(exports.grant, {
            fields: [exports.grantTransaction.grantId],
            references: [exports.grant.id],
        }),
    });
});
exports.grantVote = (0, ponder_1.onchainTable)('grant_vote', function (t) { return ({
    voter: t.hex().notNull(),
    grantId: t.bigint().notNull(),
    support: t.integer().notNull(),
    votes: t.integer().notNull(),
    reason: t.text(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.voter, t.grantId] }),
    grantIdIndex: (0, ponder_1.index)().on(t.grantId),
}); });
exports.grantVoteRelations = (0, ponder_1.relations)(exports.grantVote, function (_a) {
    var one = _a.one;
    return ({
        grant: one(exports.grant, {
            fields: [exports.grantVote.grantId],
            references: [exports.grant.id],
        }),
    });
});
exports.grantStatusChange = (0, ponder_1.onchainTable)('grant_status_change', function (t) { return ({
    grantId: t.bigint().notNull(),
    status: (0, exports.grantStatus)().notNull(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.grantId, t.status] }),
    createdAtBlockIndex: (0, ponder_1.index)().on(t.createdAtBlock),
}); });
// ── NounV2 ───────────────────────────────────────────────────────────────────
// Standalone fork tables. Kept separate from main Nouns schema so neither
// depends on the other and existing UI/queries are unaffected.
var nounV2ProposalStatusValues = [
    'ACTIVE',
    'DEFEATED',
    'SUCCEEDED',
    'QUEUED',
    'EXECUTED',
    'CANCELED',
    'EXPIRED',
];
exports.nounV2ProposalStatus = (0, ponder_1.onchainEnum)('nounV2ProposalStatus', nounV2ProposalStatusValues);
exports.nounV2Proposal = (0, ponder_1.onchainTable)('nounv2_proposal', function (t) { return ({
    id: t.bigint().primaryKey(),
    proposer: t.hex().notNull(),
    description: t.text().notNull(),
    status: (0, exports.nounV2ProposalStatus)().notNull().default('ACTIVE'),
    forVotes: t.integer().notNull().default(0),
    againstVotes: t.integer().notNull().default(0),
    abstainVotes: t.integer().notNull().default(0),
    startBlock: t.bigint().notNull(),
    endBlock: t.bigint().notNull(),
    executionETA: t.bigint(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
}); }, function (t) { return ({
    statusIndex: (0, ponder_1.index)().on(t.status),
}); });
exports.nounV2ProposalRelations = (0, ponder_1.relations)(exports.nounV2Proposal, function (_a) {
    var many = _a.many;
    return ({
        transactions: many(exports.nounV2ProposalTransaction),
        votes: many(exports.nounV2Vote),
    });
});
exports.nounV2ProposalTransaction = (0, ponder_1.onchainTable)('nounv2_proposal_transaction', function (t) { return ({
    index: t.integer(),
    proposalId: t.bigint().notNull(),
    target: t.hex().notNull(),
    value: t.bigint().notNull(),
    signature: t.text().notNull(),
    calldata: t.hex().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.index, t.proposalId] }),
}); });
exports.nounV2ProposalTransactionRelations = (0, ponder_1.relations)(exports.nounV2ProposalTransaction, function (_a) {
    var one = _a.one;
    return ({
        proposal: one(exports.nounV2Proposal, {
            fields: [exports.nounV2ProposalTransaction.proposalId],
            references: [exports.nounV2Proposal.id],
        }),
    });
});
exports.nounV2Vote = (0, ponder_1.onchainTable)('nounv2_vote', function (t) { return ({
    voter: t.hex().notNull(),
    proposalId: t.bigint().notNull(),
    support: t.integer().notNull(), // 0=against, 1=for, 2=abstain
    votes: t.integer().notNull(),
    reason: t.text(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.voter, t.proposalId] }),
    proposalIdIndex: (0, ponder_1.index)().on(t.proposalId),
}); });
exports.nounV2VoteRelations = (0, ponder_1.relations)(exports.nounV2Vote, function (_a) {
    var one = _a.one;
    return ({
        proposal: one(exports.nounV2Proposal, {
            fields: [exports.nounV2Vote.proposalId],
            references: [exports.nounV2Proposal.id],
        }),
    });
});
exports.nounV2ProposalStatusChange = (0, ponder_1.onchainTable)('nounv2_proposal_status_change', function (t) { return ({
    proposalId: t.bigint().notNull(),
    status: (0, exports.nounV2ProposalStatus)().notNull(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.proposalId, t.status] }),
    createdAtBlockIndex: (0, ponder_1.index)().on(t.createdAtBlock),
}); });
// ── NounV2 Auctions ─────────────────────────────────────────────────────────
exports.nounV2Auction = (0, ponder_1.onchainTable)('nounv2_auction', function (t) { return ({
    nounId: t.bigint().primaryKey(),
    startTime: t.timestamp().notNull(),
    endTime: t.timestamp().notNull(),
    settled: t.boolean().notNull().default(false),
    winner: t.hex(),
    amount: t.bigint(),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
}); });
exports.nounV2AuctionRelations = (0, ponder_1.relations)(exports.nounV2Auction, function (_a) {
    var many = _a.many;
    return ({
        bids: many(exports.nounV2Bid),
    });
});
exports.nounV2Bid = (0, ponder_1.onchainTable)('nounv2_bid', function (t) { return ({
    nounId: t.bigint().notNull(),
    value: t.bigint().notNull(),
    bidder: t.hex().notNull(),
    extended: t.boolean().notNull().default(false),
    createdAt: t.timestamp().notNull(),
    createdAtBlock: t.bigint().notNull(),
    createdAtTransaction: t.text().notNull(),
}); }, function (t) { return ({
    primaryKey: (0, ponder_1.primaryKey)({ columns: [t.nounId, t.value] }),
    nounIdIndex: (0, ponder_1.index)().on(t.nounId),
}); });
exports.nounV2BidRelations = (0, ponder_1.relations)(exports.nounV2Bid, function (_a) {
    var one = _a.one;
    return ({
        auction: one(exports.nounV2Auction, {
            fields: [exports.nounV2Bid.nounId],
            references: [exports.nounV2Auction.nounId],
        }),
    });
});
