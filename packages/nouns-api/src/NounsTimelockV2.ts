import { ponder } from 'ponder:registry';
import { treasurySend } from 'ponder:schema';

// Fork payouts from nouns.eth (see src/abi/NounsTimelockV2.ts). Read by
// /api/treasury/flows as `fork` outflows.

ponder.on('NounsTimelockV2:ETHSent', async ({ event, context }) => {
  await context.db
    .insert(treasurySend)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      to: event.args.to,
      token: null,
      amount: event.args.amount,
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('NounsTimelockV2:ERC20Sent', async ({ event, context }) => {
  await context.db
    .insert(treasurySend)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      to: event.args.to,
      token: event.args.erc20Token,
      amount: event.args.amount,
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});
