import { ponder } from 'ponder:registry';
import { federationMirror, federationMirrorVote } from 'ponder:schema';

// NounsFederation — V2→V1 meta-governance relay.
// Event surface: MirrorCreated, MirrorVoteCast, VoteRelayed.
// (Owner/config events — MaxLeadBlocksChanged etc. — carry no indexed state.)

ponder.on('NounsFederation:MirrorCreated', async ({ event, context }) => {
  await context.db.insert(federationMirror).values({
    id: event.args.mirrorId,
    v1ProposalId: event.args.v1ProposalId,
    creator: event.args.creator,
    snapshotBlock: event.args.snapshotBlock,
    endBlock: event.args.endBlock,
    forVotes: 0,
    againstVotes: 0,
    abstainVotes: 0,
    relayed: false,
    relayedSupport: null,
    relayedAtBlock: null,
    relayedAtTransaction: null,
    createdAt: new Date(Number(event.block.timestamp)),
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
  });
});

ponder.on('NounsFederation:MirrorVoteCast', async ({ event, context }) => {
  const support = Number(event.args.support);
  const votes = Number(event.args.votes);

  await context.db.insert(federationMirrorVote).values({
    voter: event.args.voter,
    mirrorId: event.args.mirrorId,
    support,
    votes,
    reason: event.args.reason || null,
    createdAt: new Date(Number(event.block.timestamp)),
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
  });

  const existing = await context.db.find(federationMirror, { id: event.args.mirrorId });
  if (existing) {
    const update: Record<string, number> = {};
    if (support === 0) update.againstVotes = existing.againstVotes + votes;
    else if (support === 1) update.forVotes = existing.forVotes + votes;
    else if (support === 2) update.abstainVotes = existing.abstainVotes + votes;
    await context.db.update(federationMirror, { id: event.args.mirrorId }).set(update);
  }
});

ponder.on('NounsFederation:VoteRelayed', async ({ event, context }) => {
  await context.db.update(federationMirror, { id: event.args.mirrorId }).set({
    relayed: true,
    relayedSupport: Number(event.args.support),
    relayedAtBlock: event.block.number,
    relayedAtTransaction: event.transaction.hash,
  });
});
