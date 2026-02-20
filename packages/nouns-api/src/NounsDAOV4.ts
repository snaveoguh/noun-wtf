import { eq } from 'ponder';
import { ponder } from 'ponder:registry';
import { proposal, proposalSigner, stream, transaction, vote } from 'ponder:schema';

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
});

// ProposalCreatedWithRequirements provides extra governance fields
// There are two overloads — the newer one includes signers, updatePeriodEndBlock, clientId
ponder.on('NounsDAOV4:ProposalCreatedWithRequirements(uint256 id, address[] signers, uint256 updatePeriodEndBlock, uint256 proposalThreshold, uint256 quorumVotes, uint32 indexed clientId)', async ({ event, context }) => {
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
});

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
  const updateData: Record<string, number> = {};
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
});

ponder.on('NounsDAOV4:ProposalCanceled', async ({ event, context }) => {
  await context.db.update(proposal, { id: event.args.id }).set({
    status: 'CANCELLED',
  });
});

ponder.on('NounsDAOV4:ProposalVetoed', async ({ event, context }) => {
  await context.db.update(proposal, { id: event.args.id }).set({
    status: 'VETOED',
  });
});

ponder.on('NounsDAOV4:ProposalObjectionPeriodSet', async ({ event, context }) => {
  await context.db.update(proposal, { id: event.args.id }).set({
    objectionPeriodEndBlock: event.args.objectionPeriodEndBlock,
  });
});
