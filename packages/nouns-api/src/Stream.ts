import { ponder } from 'ponder:registry';
import { stream, streamEvent, StreamStatus } from 'ponder:schema';

ponder.on('Stream:StreamCancelled', async ({ event, context }) => {
  const streamAddress = event.log.address;
  await context.db.update(stream, { streamAddress }).set({
    status: 'cancelled',
  });

  const row = await context.db.find(stream, { streamAddress });
  await context.db
    .insert(streamEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      kind: 'cancelled',
      streamAddress,
      recipient: event.args.recipient,
      tokenAddress: row?.tokenAddress ?? '0x0000000000000000000000000000000000000000',
      proposalId: row?.proposalId ?? null,
      amount: event.args.recipientBalance,
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

ponder.on('Stream:TokensWithdrawn', async ({ event, context }) => {
  const streamAddress = event.log.address;
  await context.db.update(stream, { streamAddress }).set(stream => {
    return {
      status: updatedStreamStatus(stream),
      withdrawnAmount: stream.withdrawnAmount + event.args.amount,
    };
  });

  const row = await context.db.find(stream, { streamAddress });
  await context.db
    .insert(streamEvent)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      kind: 'withdrawn',
      streamAddress,
      recipient: event.args.recipient,
      tokenAddress: row?.tokenAddress ?? '0x0000000000000000000000000000000000000000',
      proposalId: row?.proposalId ?? null,
      amount: event.args.amount,
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

const updatedStreamStatus = ({
  status,
  tokenAmount,
  withdrawnAmount,
}: {
  status: StreamStatus;
  tokenAmount: bigint;
  withdrawnAmount: bigint;
}) => {
  if (status === 'cancelled') return 'cancelled';
  return tokenAmount - withdrawnAmount > 0n ? 'active' : 'concluded';
};
