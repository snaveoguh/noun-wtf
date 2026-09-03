import { and, eq } from 'ponder';
import { ponder } from 'ponder:registry';
import {
  candidate,
  daoConfigEvent,
  forkEvent,
  proposal,
  proposalSigner,
  proposalStatusChange,
  proposalVersion,
  stream,
  transaction,
  vote,
} from 'ponder:schema';
import { encodeAbiParameters, encodePacked, type Hex, keccak256, stringToBytes } from 'viem';

/**
 * Recomputes the same `encodedProposalHash` that NounsDAOData stores on
 * `ProposalCandidateCreated` / `ProposalCandidateUpdated`. Must stay in sync
 * with `calcProposalEncodeData` in packages/nouns-webapp/src/lib/dreamCandidate.ts
 * and the on-chain encoding in NounsDAOProposals.sol.
 */
function calcProposalEncodedData({
  proposer,
  targets,
  values,
  signatures,
  calldatas,
  description,
}: {
  proposer: Hex;
  targets: readonly Hex[];
  values: readonly bigint[];
  signatures: readonly string[];
  calldatas: readonly Hex[];
  description: string;
}): Hex {
  const signatureHashes = signatures.map(sig => keccak256(stringToBytes(sig)));
  const calldatasHashes = calldatas.map(cd => keccak256(cd));

  return encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'bytes32' },
    ],
    [
      proposer,
      keccak256(encodePacked(['address[]'], [[...targets]])),
      keccak256(encodePacked(['uint256[]'], [[...values]])),
      keccak256(encodePacked(['bytes32[]'], [signatureHashes])),
      keccak256(encodePacked(['bytes32[]'], [calldatasHashes])),
      keccak256(stringToBytes(description)),
    ],
  );
}

ponder.on('NounsDAOV4:ProposalCreated', async ({ event, context }) => {
  await context.db.insert(proposal).values({
    id: event.args.id,
    description: event.args.description,
    proposer: event.args.proposer,
    status: 'PENDING',
    startBlock: event.args.startBlock,
    endBlock: event.args.endBlock,
    forVotes: 0,
    againstVotes: 0,
    abstainVotes: 0,
    createdAt: new Date(Number(event.block.timestamp)),
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
  });

  await context.db.insert(transaction).values(
    event.args.targets.map((target, index) => ({
      index,
      proposalId: event.args.id,
      target,
      value: event.args.values[index]!,
      signature: event.args.signatures[index]!,
      calldata: event.args.calldatas[index]!,
    })),
  );

  // ── Candidate promotion detection ─────────────────────────────────────────
  // Recompute the encodedProposalHash from the new proposal's content and
  // match it against any active candidate by the same proposer. Covers both
  // proposeBySigs (candidate with sponsor sigs) and direct propose() calls
  // where the proposer has enough voting power — in either case the new
  // proposal's encoded hash matches the candidate's encodedProposalHash.
  try {
    const encoded = calcProposalEncodedData({
      proposer: event.args.proposer,
      targets: event.args.targets,
      values: event.args.values,
      signatures: event.args.signatures,
      calldatas: event.args.calldatas,
      description: event.args.description,
    });

    const matches = await context.db.sql
      .select()
      .from(candidate)
      .where(
        and(
          eq(candidate.proposer, event.args.proposer),
          eq(candidate.encodedProposalHash, encoded),
        ),
      )
      .limit(1);
    const match = matches[0];
    if (match && match.promotedToProposalId == null) {
      await context.db.update(candidate, { id: match.id }).set({
        promotedToProposalId: event.args.id,
        promotedAtBlock: event.block.number,
        promotedAtTimestamp: new Date(Number(event.block.timestamp)),
        promotedAtTx: event.transaction.hash,
      });
    }
  } catch (err) {
    console.warn('[promotion-detect] match failed for proposal', event.args.id.toString(), err);
  }
});

// ProposalCreatedWithRequirements provides extra governance fields
// There are two overloads — the newer one includes signers, updatePeriodEndBlock, clientId
ponder.on(
  'NounsDAOV4:ProposalCreatedWithRequirements(uint256 id, address[] signers, uint256 updatePeriodEndBlock, uint256 proposalThreshold, uint256 quorumVotes, uint32 indexed clientId)',
  async ({ event, context }) => {
    await context.db.update(proposal, { id: event.args.id }).set({
      proposalThreshold: event.args.proposalThreshold,
      quorumVotes: event.args.quorumVotes,
      updatePeriodEndBlock: event.args.updatePeriodEndBlock,
      clientId: event.args.clientId,
    });

    // Store signers
    if (event.args.signers.length > 0) {
      await context.db.insert(proposalSigner).values(
        event.args.signers.map(signer => ({
          proposalId: event.args.id,
          signer,
        })),
      );
    }
  },
);

ponder.on('NounsDAOV4:ProposalCreatedOnTimelockV1', async ({ event, context }) => {
  await context.db.update(proposal, { id: event.args.id }).set({
    onTimelockV1: true,
  });
});

ponder.on('NounsDAOV4:VoteCast', async ({ event, context }) => {
  const support = Number(event.args.support);

  await context.db.insert(vote).values({
    voter: event.args.voter,
    proposalId: event.args.proposalId,
    support,
    votes: Number(event.args.votes),
    reason: event.args.reason || null,
    createdAt: new Date(Number(event.block.timestamp)),
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
  });

  // Update proposal vote tallies
  if (support === 0) {
    // against
    const existing = await context.db.find(proposal, { id: event.args.proposalId });
    if (existing) {
      await context.db.update(proposal, { id: event.args.proposalId }).set({
        againstVotes: existing.againstVotes + Number(event.args.votes),
      });
    }
  } else if (support === 1) {
    // for
    const existing = await context.db.find(proposal, { id: event.args.proposalId });
    if (existing) {
      await context.db.update(proposal, { id: event.args.proposalId }).set({
        forVotes: existing.forVotes + Number(event.args.votes),
      });
    }
  } else if (support === 2) {
    // abstain
    const existing = await context.db.find(proposal, { id: event.args.proposalId });
    if (existing) {
      await context.db.update(proposal, { id: event.args.proposalId }).set({
        abstainVotes: existing.abstainVotes + Number(event.args.votes),
      });
    }
  }
});

ponder.on('NounsDAOV4:VoteCastWithClientId', async ({ event, context }) => {
  // VoteCast may not have been processed yet (event ordering) — guard with find
  const existing = await context.db.find(vote, {
    voter: event.args.voter,
    proposalId: event.args.proposalId,
  });
  if (existing) {
    await context.db
      .update(vote, { voter: event.args.voter, proposalId: event.args.proposalId })
      .set({
        clientId: event.args.clientId,
      });
  }
});

ponder.on('NounsDAOV4:ProposalQueued', async ({ event, context }) => {
  await context.db.update(proposal, { id: event.args.id }).set({
    status: 'QUEUED',
    executionETA: event.args.eta,
  });
  await context.db
    .insert(proposalStatusChange)
    .values({
      proposalId: event.args.id,
      status: 'QUEUED',
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:ProposalExecuted', async ({ event, context }) => {
  await context.db.update(proposal, { id: event.args.id }).set({
    status: 'EXECUTED',
  });

  // Link streams created in this transaction to the proposal
  await context.db.sql
    .update(stream)
    .set({ proposalId: event.args.id })
    .where(eq(stream.createdAtTransaction, event.transaction.hash));

  await context.db
    .insert(proposalStatusChange)
    .values({
      proposalId: event.args.id,
      status: 'EXECUTED',
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:ProposalCanceled', async ({ event, context }) => {
  await context.db.update(proposal, { id: event.args.id }).set({
    status: 'CANCELLED',
  });
  await context.db
    .insert(proposalStatusChange)
    .values({
      proposalId: event.args.id,
      status: 'CANCELLED',
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:ProposalVetoed', async ({ event, context }) => {
  await context.db.update(proposal, { id: event.args.id }).set({
    status: 'VETOED',
  });
  await context.db
    .insert(proposalStatusChange)
    .values({
      proposalId: event.args.id,
      status: 'VETOED',
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:ProposalObjectionPeriodSet', async ({ event, context }) => {
  await context.db.update(proposal, { id: event.args.id }).set({
    objectionPeriodEndBlock: event.args.objectionPeriodEndBlock,
  });
  // Status-change row only — `proposal.status` itself stays as-is (the
  // objection period is a phase of ACTIVE, not a terminal state).
  await context.db
    .insert(proposalStatusChange)
    .values({
      proposalId: event.args.id,
      status: 'OBJECTION',
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

// ─── Proposal updates (DAO V3+ updatable period) ──────────────────────────
// Without these, the indexed description is frozen at ProposalCreated forever
// and every client shows a proposer's FIRST DRAFT — even after they edit it
// during the ~60h updatable window. Hit on prop 987 (Wall), which was edited
// three times; noun.wtf kept rendering draft 1.
//
// `transaction` is keyed by (index, proposalId), so re-inserting each index
// upserts in place. An update that SHRINKS the action list would leave stale
// tail rows; in practice the updatable flow replaces the full set and the
// governor re-emits every action, so tail rows are overwritten not orphaned.

ponder.on('NounsDAOV4:ProposalUpdated', async ({ event, context }) => {
  await context.db
    .update(proposal, { id: event.args.id })
    .set({ description: event.args.description });

  await context.db
    .insert(proposalVersion)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      proposalId: event.args.id,
      kind: 'full',
      description: event.args.description,
      updateMessage: event.args.updateMessage || '',
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();

  for (let index = 0; index < event.args.targets.length; index++) {
    await context.db
      .insert(transaction)
      .values({
        index,
        proposalId: event.args.id,
        target: event.args.targets[index]!,
        value: event.args.values[index]!,
        signature: event.args.signatures[index]!,
        calldata: event.args.calldatas[index]!,
      })
      .onConflictDoUpdate({
        target: event.args.targets[index]!,
        value: event.args.values[index]!,
        signature: event.args.signatures[index]!,
        calldata: event.args.calldatas[index]!,
      });
  }
});

ponder.on('NounsDAOV4:ProposalDescriptionUpdated', async ({ event, context }) => {
  await context.db
    .update(proposal, { id: event.args.id })
    .set({ description: event.args.description });

  await context.db
    .insert(proposalVersion)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      proposalId: event.args.id,
      kind: 'description',
      description: event.args.description,
      updateMessage: event.args.updateMessage || '',
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:ProposalTransactionsUpdated', async ({ event, context }) => {
  await context.db
    .insert(proposalVersion)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      proposalId: event.args.id,
      kind: 'transactions',
      description: null,
      updateMessage: event.args.updateMessage || '',
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();

  for (let index = 0; index < event.args.targets.length; index++) {
    await context.db
      .insert(transaction)
      .values({
        index,
        proposalId: event.args.id,
        target: event.args.targets[index]!,
        value: event.args.values[index]!,
        signature: event.args.signatures[index]!,
        calldata: event.args.calldatas[index]!,
      })
      .onConflictDoUpdate({
        target: event.args.targets[index]!,
        value: event.args.values[index]!,
        signature: event.args.signatures[index]!,
        calldata: event.args.calldatas[index]!,
      });
  }
});

// ─── Fork events ───────────────────────────────────────────────────────────

ponder.on('NounsDAOV4:EscrowedToFork', async ({ event, context }) => {
  await context.db
    .insert(forkEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      kind: 'escrow',
      forkId: Number(event.args.forkId),
      owner: event.args.owner,
      nounIds: JSON.stringify(event.args.tokenIds.map(Number)),
      proposalIds: JSON.stringify(event.args.proposalIds.map(Number)),
      reason: event.args.reason || '',
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:JoinFork', async ({ event, context }) => {
  await context.db
    .insert(forkEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      kind: 'join',
      forkId: Number(event.args.forkId),
      owner: event.args.owner,
      nounIds: JSON.stringify(event.args.tokenIds.map(Number)),
      proposalIds: JSON.stringify(event.args.proposalIds.map(Number)),
      reason: event.args.reason || '',
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:WithdrawFromForkEscrow', async ({ event, context }) => {
  await context.db
    .insert(forkEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      kind: 'withdraw',
      forkId: Number(event.args.forkId),
      owner: event.args.owner,
      nounIds: JSON.stringify(event.args.tokenIds.map(Number)),
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:ExecuteFork', async ({ event, context }) => {
  await context.db
    .insert(forkEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      kind: 'executed',
      forkId: Number(event.args.forkId),
      forkTreasury: event.args.forkTreasury,
      forkToken: event.args.forkToken,
      forkEndTimestamp: event.args.forkEndTimestamp,
      tokensInEscrow: event.args.tokensInEscrow,
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

// ─── DAO config changes ────────────────────────────────────────────────────
// Every governor parameter event is (old, new); values are stored as strings
// so one table (and one DAO_CONFIG_CHANGED feed type) covers all of them.

ponder.on('NounsDAOV4:VotingPeriodSet', async ({ event, context }) => {
  await context.db
    .insert(daoConfigEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      param: 'votingPeriod',
      oldValue: event.args.oldVotingPeriod.toString(),
      newValue: event.args.newVotingPeriod.toString(),
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:VotingDelaySet', async ({ event, context }) => {
  await context.db
    .insert(daoConfigEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      param: 'votingDelay',
      oldValue: event.args.oldVotingDelay.toString(),
      newValue: event.args.newVotingDelay.toString(),
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:ProposalThresholdBPSSet', async ({ event, context }) => {
  await context.db
    .insert(daoConfigEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      param: 'proposalThresholdBPS',
      oldValue: event.args.oldProposalThresholdBPS.toString(),
      newValue: event.args.newProposalThresholdBPS.toString(),
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:MinQuorumVotesBPSSet', async ({ event, context }) => {
  await context.db
    .insert(daoConfigEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      param: 'minQuorumVotesBPS',
      oldValue: String(event.args.oldMinQuorumVotesBPS),
      newValue: String(event.args.newMinQuorumVotesBPS),
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:MaxQuorumVotesBPSSet', async ({ event, context }) => {
  await context.db
    .insert(daoConfigEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      param: 'maxQuorumVotesBPS',
      oldValue: String(event.args.oldMaxQuorumVotesBPS),
      newValue: String(event.args.newMaxQuorumVotesBPS),
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:QuorumCoefficientSet', async ({ event, context }) => {
  await context.db
    .insert(daoConfigEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      param: 'quorumCoefficient',
      oldValue: String(event.args.oldQuorumCoefficient),
      newValue: String(event.args.newQuorumCoefficient),
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:ForkPeriodSet', async ({ event, context }) => {
  await context.db
    .insert(daoConfigEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      param: 'forkPeriod',
      oldValue: event.args.oldForkPeriod.toString(),
      newValue: event.args.newForkPeriod.toString(),
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:ForkThresholdSet', async ({ event, context }) => {
  await context.db
    .insert(daoConfigEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      param: 'forkThreshold',
      oldValue: event.args.oldForkThreshold.toString(),
      newValue: event.args.newForkThreshold.toString(),
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:NewVetoer', async ({ event, context }) => {
  await context.db
    .insert(daoConfigEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      param: 'vetoer',
      oldValue: event.args.oldVetoer,
      newValue: event.args.newVetoer,
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:ObjectionPeriodDurationSet', async ({ event, context }) => {
  await context.db
    .insert(daoConfigEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      param: 'objectionPeriodDuration',
      oldValue: String(event.args.oldObjectionPeriodDurationInBlocks),
      newValue: String(event.args.newObjectionPeriodDurationInBlocks),
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:ProposalUpdatablePeriodSet', async ({ event, context }) => {
  await context.db
    .insert(daoConfigEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      param: 'proposalUpdatablePeriod',
      oldValue: String(event.args.oldProposalUpdatablePeriodInBlocks),
      newValue: String(event.args.newProposalUpdatablePeriodInBlocks),
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsDAOV4:LastMinuteWindowSet', async ({ event, context }) => {
  await context.db
    .insert(daoConfigEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      param: 'lastMinuteWindow',
      oldValue: String(event.args.oldLastMinuteWindowInBlocks),
      newValue: String(event.args.newLastMinuteWindowInBlocks),
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});
