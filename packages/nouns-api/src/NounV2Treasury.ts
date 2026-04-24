import { ponder } from 'ponder:registry';
import {
  nounV2Proposal,
  nounV2ProposalTransaction,
  nounV2Vote,
  nounV2ProposalStatusChange,
} from 'ponder:schema';

// Mirrors SmallGrantsTreasury handlers. Same event surface:
// ProposalCreated, VoteCast, ProposalQueued, ProposalExecuted, ProposalCanceled,
// plus AdminChanged / ETHReceived (ignored — no on-chain state of interest).

ponder.on('NounV2Treasury:ProposalCreated', async ({ event, context }) => {
  await context.db.insert(nounV2Proposal).values({
    id: event.args.id,
    proposer: event.args.proposer,
    description: event.args.description,
    status: 'ACTIVE', // voting starts immediately — no pending state
    startBlock: event.args.startBlock,
    endBlock: event.args.endBlock,
    forVotes: 0,
    againstVotes: 0,
    abstainVotes: 0,
    createdAt: new Date(Number(event.block.timestamp)),
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
  });

  // Pull proposal actions from the contract (they're not in the event args).
  try {
    const actions = await context.client.readContract({
      abi: [
        {
          type: 'function',
          name: 'getActions',
          inputs: [{ name: 'proposalId', type: 'uint256' }],
          outputs: [
            { name: 'targets', type: 'address[]' },
            { name: 'values', type: 'uint256[]' },
            { name: 'signatures', type: 'string[]' },
            { name: 'calldatas', type: 'bytes[]' },
          ],
          stateMutability: 'view',
        },
      ],
      address: event.log.address,
      functionName: 'getActions',
      args: [event.args.id],
    });

    const [targets, values, signatures, calldatas] = actions;
    if (targets.length > 0) {
      await context.db.insert(nounV2ProposalTransaction).values(
        targets.map((target, index) => ({
          index,
          proposalId: event.args.id,
          target,
          value: values[index]!,
          signature: signatures[index]!,
          calldata: calldatas[index]!,
        })),
      );
    }
  } catch {
    // Contract read failed — transactions won't be indexed for this proposal.
  }
});

ponder.on('NounV2Treasury:VoteCast', async ({ event, context }) => {
  const support = Number(event.args.support);

  await context.db.insert(nounV2Vote).values({
    voter: event.args.voter,
    proposalId: event.args.proposalId,
    support,
    votes: Number(event.args.votes),
    reason: event.args.reason || null,
    createdAt: new Date(Number(event.block.timestamp)),
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
  });

  // Update proposal vote tallies.
  const existing = await context.db.find(nounV2Proposal, { id: event.args.proposalId });
  if (existing) {
    const update: Record<string, number> = {};
    if (support === 0) update.againstVotes = existing.againstVotes + Number(event.args.votes);
    else if (support === 1) update.forVotes = existing.forVotes + Number(event.args.votes);
    else if (support === 2) update.abstainVotes = existing.abstainVotes + Number(event.args.votes);
    await context.db.update(nounV2Proposal, { id: event.args.proposalId }).set(update);
  }
});

ponder.on('NounV2Treasury:ProposalQueued', async ({ event, context }) => {
  await context.db.update(nounV2Proposal, { id: event.args.id }).set({
    status: 'QUEUED',
    executionETA: event.args.eta,
  });
  await context.db
    .insert(nounV2ProposalStatusChange)
    .values({
      proposalId: event.args.id,
      status: 'QUEUED',
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounV2Treasury:ProposalExecuted', async ({ event, context }) => {
  await context.db.update(nounV2Proposal, { id: event.args.id }).set({ status: 'EXECUTED' });
  await context.db
    .insert(nounV2ProposalStatusChange)
    .values({
      proposalId: event.args.id,
      status: 'EXECUTED',
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounV2Treasury:ProposalCanceled', async ({ event, context }) => {
  await context.db.update(nounV2Proposal, { id: event.args.id }).set({ status: 'CANCELED' });
  await context.db
    .insert(nounV2ProposalStatusChange)
    .values({
      proposalId: event.args.id,
      status: 'CANCELED',
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});
