import { and, eq } from 'ponder';
import { ponder } from 'ponder:registry';
import {
  candidate,
  proposal,
  proposalSigner,
  proposalStatusChange,
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
});
