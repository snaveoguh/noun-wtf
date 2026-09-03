import { eq } from 'ponder';
import { ponder } from 'ponder:registry';
import {
  candidate,
  candidateFeedback,
  candidateSignature,
  candidateVersion,
  proposalFeedback,
} from 'ponder:schema';

// ── Candidate Created ────────────────────────────────────────────────────────

ponder.on('NounsDAOData:ProposalCandidateCreated', async ({ event, context }) => {
  const id = `${event.args.msgSender.toLowerCase()}-${event.args.slug}`;
  const ts = new Date(Number(event.block.timestamp));

  await context.db.insert(candidate).values({
    id,
    slug: event.args.slug,
    proposer: event.args.msgSender,
    canceled: false,
    versionsCount: 1,
    proposalIdToUpdate:
      event.args.proposalIdToUpdate > 0n ? event.args.proposalIdToUpdate : undefined,
    encodedProposalHash: event.args.encodedProposalHash,
    description: event.args.description,
    targets: JSON.stringify(event.args.targets),
    values: JSON.stringify(event.args.values.map(String)),
    signatures: JSON.stringify(event.args.signatures),
    calldatas: JSON.stringify(event.args.calldatas),
    createdAt: ts,
    createdAtBlock: event.block.number,
    createdAtTransaction: event.transaction.hash,
    lastUpdatedAt: ts,
    lastUpdatedAtBlock: event.block.number,
  });
});

// ── Candidate Updated ────────────────────────────────────────────────────────

ponder.on('NounsDAOData:ProposalCandidateUpdated', async ({ event, context }) => {
  const id = `${event.args.msgSender.toLowerCase()}-${event.args.slug}`;
  const ts = new Date(Number(event.block.timestamp));

  const existing = await context.db.find(candidate, { id });
  if (!existing) return;

  await context.db.update(candidate, { id }).set({
    description: event.args.description,
    encodedProposalHash: event.args.encodedProposalHash,
    targets: JSON.stringify(event.args.targets),
    values: JSON.stringify(event.args.values.map(String)),
    signatures: JSON.stringify(event.args.signatures),
    calldatas: JSON.stringify(event.args.calldatas),
    proposalIdToUpdate:
      event.args.proposalIdToUpdate > 0n ? event.args.proposalIdToUpdate : undefined,
    versionsCount: existing.versionsCount + 1,
    lastUpdatedAt: ts,
    lastUpdatedAtBlock: event.block.number,
  });

  // Record the update as its own row so /api/activity can emit CANDIDATE_UPDATED per event.
  await context.db
    .insert(candidateVersion)
    .values({
      candidateId: id,
      blockNumber: event.block.number,
      logIndex: event.log.logIndex,
      txHash: event.transaction.hash,
      blockTimestamp: ts,
      description: event.args.description,
      reason: event.args.reason || '',
      encodedProposalHash: event.args.encodedProposalHash,
    })
    .onConflictDoNothing();

  // Invalidate all existing signatures (content hash changed)
  await context.db.sql.delete(candidateSignature).where(eq(candidateSignature.candidateId, id));
});

// ── Candidate Canceled ───────────────────────────────────────────────────────

ponder.on('NounsDAOData:ProposalCandidateCanceled', async ({ event, context }) => {
  const id = `${event.args.msgSender.toLowerCase()}-${event.args.slug}`;

  const existing = await context.db.find(candidate, { id });
  if (!existing) return;

  await context.db.update(candidate, { id }).set({
    canceled: true,
    canceledAtBlock: event.block.number,
    canceledAtTimestamp: new Date(Number(event.block.timestamp)),
    canceledAtTx: event.transaction.hash,
  });
});

// ── Signature Added ──────────────────────────────────────────────────────────

ponder.on('NounsDAOData:SignatureAdded', async ({ event, context }) => {
  const candidateId = `${event.args.proposer.toLowerCase()}-${event.args.slug}`;

  // Only index if the candidate exists
  const existing = await context.db.find(candidate, { id: candidateId });
  if (!existing) return;

  await context.db
    .insert(candidateSignature)
    .values({
      candidateId,
      signer: event.args.signer,
      sig: event.args.sig,
      expirationTimestamp: event.args.expirationTimestamp,
      encodedPropHash: event.args.encodedPropHash,
      reason: event.args.reason || '',
      canceled: false,
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoNothing();
});

// ── Proposal Feedback (FeedbackSent) ─────────────────────────────────────────

ponder.on('NounsDAOData:FeedbackSent', async ({ event, context }) => {
  await context.db
    .insert(proposalFeedback)
    .values({
      voter: event.args.msgSender,
      proposalId: event.args.proposalId,
      support: Number(event.args.support),
      reason: event.args.reason || '',
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoUpdate({
      support: Number(event.args.support),
      reason: event.args.reason || '',
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    });
});

// ── Candidate Feedback (CandidateFeedbackSent) ──────────────────────────────

ponder.on('NounsDAOData:CandidateFeedbackSent', async ({ event, context }) => {
  const candidateId = `${event.args.proposer.toLowerCase()}-${event.args.slug}`;

  await context.db
    .insert(candidateFeedback)
    .values({
      voter: event.args.msgSender,
      candidateId,
      support: Number(event.args.support),
      reason: event.args.reason || '',
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    })
    .onConflictDoUpdate({
      support: Number(event.args.support),
      reason: event.args.reason || '',
      createdAt: new Date(Number(event.block.timestamp)),
      createdAtBlock: event.block.number,
      createdAtTransaction: event.transaction.hash,
    });
});
