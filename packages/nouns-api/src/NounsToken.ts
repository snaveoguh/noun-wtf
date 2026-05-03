import { eq } from 'ponder';
import { ponder } from 'ponder:registry';
import {
  accountDelegate,
  delegate,
  delegateNoun,
  delegationEvent,
  noun,
  nounTransfer,
} from 'ponder:schema';

const ZERO = '0x0000000000000000000000000000000000000000';

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

  // Maintain the per-noun delegate mapping (`delegateNoun`).
  //
  // The composite PK is `[delegateId, nounId]` so deleting by nounId via raw
  // SQL removes the old binding without us needing to know which delegate
  // the noun was previously bound to. Safe to call on mints (no-op when
  // there's no existing row).
  await context.db.sql.delete(delegateNoun).where(eq(delegateNoun.nounId, tokenId));

  if (to.toLowerCase() !== ZERO) {
    // NounsToken inherits ERC721Checkpointable: `delegates(holder)` returns
    // `holder` itself when `_delegates[holder] == address(0)`. Mirror that
    // by defaulting to `to` when no `accountDelegate` row exists.
    const toRow = await context.db.find(accountDelegate, { account: to });
    const toDelegate = toRow?.delegate ?? to;
    await context.db
      .insert(delegateNoun)
      .values({ delegateId: toDelegate, nounId: tokenId })
      .onConflictDoNothing();
  }
});

ponder.on('NounsToken:DelegateChanged', async ({ event, context }) => {
  const { delegator, fromDelegate, toDelegate } = event.args;

  // Track delegation event in the feed
  // Skip initial self-delegation on mint (fromDelegate = 0x0)
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

  // Persist the delegator's new delegate so subsequent Transfer events for
  // this address know where to bind the noun. Upsert because the holder may
  // have delegated before.
  await context.db
    .insert(accountDelegate)
    .values({ account: delegator, delegate: toDelegate })
    .onConflictDoUpdate({ delegate: toDelegate });

  // Re-bind every noun this delegator currently owns from `fromDelegate` →
  // `toDelegate` in `delegateNoun`.
  //
  // We use the `noun.owner` index (every Transfer keeps it current) as the
  // source of truth for "which nouns does this address own right now". This
  // matches the subgraph's behavior where `Account.nouns` is rebuilt on
  // every transfer and consulted by `handleDelegateChanged` to move the
  // delegated set in lockstep.
  const ownedNouns = await context.db.sql
    .select({ id: noun.id })
    .from(noun)
    .where(eq(noun.owner, delegator));

  for (const { id: tokenId } of ownedNouns) {
    // Always delete by nounId — the row may sit at `(delegator, nounId)`
    // when the holder previously had implicit self-delegation (no prior
    // explicit delegate), in which case `fromDelegate` in the event is
    // 0x0 but the existing row keys on `delegator`. Deleting by nounId
    // covers both cases.
    await context.db.sql.delete(delegateNoun).where(eq(delegateNoun.nounId, tokenId));
    await context.db
      .insert(delegateNoun)
      .values({ delegateId: toDelegate, nounId: tokenId })
      .onConflictDoNothing();
  }
});

ponder.on('NounsToken:DelegateVotesChanged', async ({ event, context }) => {
  const { delegate: delegateAddr, newBalance } = event.args;

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
