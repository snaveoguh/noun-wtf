import { ponder } from 'ponder:registry';
import { delegate, delegateNoun, delegationEvent, noun, nounTransfer } from 'ponder:schema';

ponder.on('NounsToken:NounCreated', async ({ event, context }) => {
  // Transfer fires before NounCreated (mint), so the noun may already exist with zero traits.
  // Use upsert to overwrite the zero-trait record with the real seed data.
  await context.db
    .insert(noun)
    .values({
      id: event.args.tokenId,
      owner: '0x0000000000000000000000000000000000000000', // set by Transfer event
      head: event.args.seed.head,
      body: event.args.seed.body,
      accessory: event.args.seed.accessory,
      glasses: event.args.seed.glasses,
      background: event.args.seed.background,
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoUpdate({
      head: event.args.seed.head,
      body: event.args.seed.body,
      accessory: event.args.seed.accessory,
      glasses: event.args.seed.glasses,
      background: event.args.seed.background,
    });
});

ponder.on('NounsToken:Transfer', async ({ event, context }) => {
  const tokenId = event.args.tokenId;
  const from = event.args.from;
  const to = event.args.to;

  // Upsert noun owner — Transfer may fire before NounCreated (mint)
  await context.db
    .insert(noun)
    .values({
      id: tokenId,
      owner: to,
      head: 0,
      body: 0,
      accessory: 0,
      glasses: 0,
      background: 0,
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoUpdate({
      owner: to,
    });

  // Track non-mint transfers in the feed (skip mints from 0x0)
  const ZERO = '0x0000000000000000000000000000000000000000';
  if (from.toLowerCase() !== ZERO) {
    await context.db
      .insert(nounTransfer)
      .values({
        nounId: tokenId,
        from,
        to,
        createdAt: new Date(Number(event.block.timestamp)),
        createdAtBlock: event.block.number,
        createdAtTransaction: event.transaction.hash,
      })
      .onConflictDoNothing();
  }
});

ponder.on('NounsToken:DelegateChanged', async ({ event, context }) => {
  const { delegator, fromDelegate, toDelegate } = event.args;

  // Track delegation event in the feed
  // Skip initial self-delegation on mint (fromDelegate = 0x0)
  const ZERO = '0x0000000000000000000000000000000000000000';
  if (fromDelegate.toLowerCase() !== ZERO) {
    await context.db
      .insert(delegationEvent)
      .values({
        delegator,
        fromDelegate,
        toDelegate,
        createdAt: new Date(Number(event.block.timestamp)),
        createdAtBlock: event.block.number,
        createdAtTransaction: event.transaction.hash,
      })
      .onConflictDoNothing();
  }
});

ponder.on('NounsToken:DelegateVotesChanged', async ({ event, context }) => {
  const { delegate: delegateAddr, previousBalance, newBalance } = event.args;

  // Upsert delegate record
  await context.db
    .insert(delegate)
    .values({
      id: delegateAddr,
      delegatedVotes: Number(newBalance),
    })
    .onConflictDoUpdate({
      delegatedVotes: Number(newBalance),
    });
});
