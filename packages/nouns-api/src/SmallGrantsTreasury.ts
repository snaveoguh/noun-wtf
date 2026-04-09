import { ponder } from 'ponder:registry';
import { grant, grantTransaction, grantVote, grantStatusChange } from 'ponder:schema';

ponder.on('SmallGrantsTreasury:ProposalCreated', async ({ event, context }) => {
  await context.db.insert(grant).values({
    id: event.args.id,
    description: event.args.description,
    proposer: event.args.proposer,
    status: 'ACTIVE', // No pending state — voting starts immediately
    snapshotBlock: event.args.startBlock - 1n, // snapshot is startBlock - 1
    startBlock: event.args.startBlock,
    endBlock: event.args.endBlock,
    forVotes: 0,
    againstVotes: 0,
    abstainVotes: 0,
    createdAt: new Date(Number(event.block.timestamp)),
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
  });

  // Read transaction data from the contract (not in the event args)
  try {
    const actions = await context.client.readContract({
      abi: [{
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
      }],
      address: event.log.address,
      functionName: 'getActions',
      args: [event.args.id],
    });

    const [targets, values, signatures, calldatas] = actions;
    if (targets.length > 0) {
      await context.db.insert(grantTransaction).values(
        targets.map((target, index) => ({
          index,
          grantId: event.args.id,
          target,
          value: values[index]!,
          signature: signatures[index]!,
          calldata: calldatas[index]!,
        })),
      );
    }
  } catch {
    // Contract read failed — transactions won't be indexed for this grant
  }
});

ponder.on('SmallGrantsTreasury:VoteCast', async ({ event, context }) => {
  const support = Number(event.args.support);

  await context.db.insert(grantVote).values({
    voter: event.args.voter,
    grantId: event.args.proposalId,
    support,
    votes: Number(event.args.votes),
    reason: event.args.reason || null,
    createdAt: new Date(Number(event.block.timestamp)),
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
  });

  // Update grant vote tallies
  const existing = await context.db.find(grant, { id: event.args.proposalId });
  if (existing) {
    const update: Record<string, number> = {};
    if (support === 0) update.againstVotes = existing.againstVotes + Number(event.args.votes);
    else if (support === 1) update.forVotes = existing.forVotes + Number(event.args.votes);
    else if (support === 2) update.abstainVotes = existing.abstainVotes + Number(event.args.votes);
    await context.db.update(grant, { id: event.args.proposalId }).set(update);
  }
});

ponder.on('SmallGrantsTreasury:ProposalQueued', async ({ event, context }) => {
  await context.db.update(grant, { id: event.args.id }).set({
    status: 'QUEUED',
    executionETA: event.args.eta,
  });
  await context.db.insert(grantStatusChange).values({
    grantId: event.args.id,
    status: 'QUEUED',
    createdAt: new Date(Number(event.block.timestamp)),
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
  }).onConflictDoNothing();
});

ponder.on('SmallGrantsTreasury:ProposalExecuted', async ({ event, context }) => {
  await context.db.update(grant, { id: event.args.id }).set({
    status: 'EXECUTED',
  });
  await context.db.insert(grantStatusChange).values({
    grantId: event.args.id,
    status: 'EXECUTED',
    createdAt: new Date(Number(event.block.timestamp)),
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
  }).onConflictDoNothing();
});

ponder.on('SmallGrantsTreasury:ProposalCanceled', async ({ event, context }) => {
  await context.db.update(grant, { id: event.args.id }).set({
    status: 'CANCELED',
  });
  await context.db.insert(grantStatusChange).values({
    grantId: event.args.id,
    status: 'CANCELED',
    createdAt: new Date(Number(event.block.timestamp)),
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
  }).onConflictDoNothing();
});
