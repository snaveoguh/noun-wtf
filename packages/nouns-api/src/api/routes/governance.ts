import type { Hono } from 'hono';

import { desc, eq } from 'drizzle-orm';
import { db } from 'ponder:api';
import schema from 'ponder:schema';

import { getLatestBlockCached } from '../lib/latestBlock.js';
import { computeDerivedStatus } from '../lib/proposalStatus.js';

export function registerGovernanceRoutes(app: Hono) {
  // ============================================================
  // REST endpoints — bypass GraphQL/Yoga chunked encoding (Fastly truncates it)
  // ============================================================

  /** All proposals with signers — single JSON response, no chunked encoding */
  app.get('/api/proposals', async c => {
    const proposals = await db
      .select()
      .from(schema.proposal)
      .orderBy(desc(schema.proposal.createdAtBlock));
    const signers = await db.select().from(schema.proposalSigner);
    const signerMap = new Map<string, string[]>();
    for (const s of signers) {
      const key = String(s.proposalId);
      if (!signerMap.has(key)) signerMap.set(key, []);
      signerMap.get(key)!.push(s.signer);
    }
    const latestBlock = await getLatestBlockCached();
    const items = proposals.map(p => {
      const item: Record<string, unknown> = {
        ...p,
        id: String(p.id),
        startBlock: String(p.startBlock),
        endBlock: String(p.endBlock),
        proposalThreshold: String(p.proposalThreshold),
        quorumVotes: String(p.quorumVotes),
        executionETA: p.executionETA != null ? String(p.executionETA) : null,
        objectionPeriodEndBlock:
          p.objectionPeriodEndBlock != null ? String(p.objectionPeriodEndBlock) : null,
        updatePeriodEndBlock:
          p.updatePeriodEndBlock != null ? String(p.updatePeriodEndBlock) : null,
        voteSnapshotBlock: p.voteSnapshotBlock != null ? String(p.voteSnapshotBlock) : null,
        createdAtBlock: String(p.createdAtBlock),
        createdAt: String(new Date(p.createdAt).getTime()),
        signers: signerMap.get(String(p.id)) ?? [],
      };
      if (latestBlock > 0n) {
        item.status = computeDerivedStatus(
          {
            status: p.status,
            forVotes: p.forVotes,
            againstVotes: p.againstVotes,
            quorumVotes: BigInt(p.quorumVotes),
            endBlock: BigInt(p.endBlock),
            objectionPeriodEndBlock:
              p.objectionPeriodEndBlock != null ? BigInt(p.objectionPeriodEndBlock) : null,
            executionETA: p.executionETA != null ? BigInt(p.executionETA) : null,
            onTimelockV1: p.onTimelockV1,
            startBlock: BigInt(p.startBlock),
          },
          latestBlock,
        );
      }
      return item;
    });
    return c.json(items);
  });

  /** Single proposal with votes, signers, transactions — bypasses GraphQL/Fastly truncation */
  app.get('/api/proposals/:id', async c => {
    const idParam = c.req.param('id');
    const allProposals = await db.select().from(schema.proposal);
    const p = allProposals.find(pr => String(pr.id) === idParam);
    if (!p) return c.json({ error: 'not found' }, 404);

    const signers = await db.select().from(schema.proposalSigner);
    const proposalSigners = signers.filter(s => String(s.proposalId) === idParam);

    const allVotes = await db.select().from(schema.vote).orderBy(desc(schema.vote.createdAtBlock));
    const votes = allVotes.filter(v => String(v.proposalId) === idParam);

    const allTxs = await db.select().from(schema.transaction);
    const proposalTxs = allTxs.filter(t => String(t.proposalId) === idParam);

    const latestBlock = await getLatestBlockCached();

    const item: Record<string, unknown> = {
      ...p,
      id: String(p.id),
      startBlock: String(p.startBlock),
      endBlock: String(p.endBlock),
      proposalThreshold: String(p.proposalThreshold),
      quorumVotes: String(p.quorumVotes),
      executionETA: p.executionETA != null ? String(p.executionETA) : null,
      objectionPeriodEndBlock:
        p.objectionPeriodEndBlock != null ? String(p.objectionPeriodEndBlock) : null,
      updatePeriodEndBlock: p.updatePeriodEndBlock != null ? String(p.updatePeriodEndBlock) : null,
      voteSnapshotBlock: p.voteSnapshotBlock != null ? String(p.voteSnapshotBlock) : null,
      createdAtBlock: String(p.createdAtBlock),
      createdAt: String(new Date(p.createdAt).getTime()),
      signers: proposalSigners.map(s => s.signer),
      // Ponder returns BigInts for proposalId / value — stringify so Hono can JSON-serialize.
      transactions: proposalTxs.map(t => ({
        index: t.index,
        proposalId: String(t.proposalId),
        target: t.target,
        value: String(t.value),
        signature: t.signature,
        calldata: t.calldata,
      })),
    };
    if (latestBlock > 0n) {
      item.status = computeDerivedStatus(
        {
          status: p.status,
          forVotes: p.forVotes,
          againstVotes: p.againstVotes,
          quorumVotes: BigInt(p.quorumVotes),
          endBlock: BigInt(p.endBlock),
          objectionPeriodEndBlock:
            p.objectionPeriodEndBlock != null ? BigInt(p.objectionPeriodEndBlock) : null,
          executionETA: p.executionETA != null ? BigInt(p.executionETA) : null,
          onTimelockV1: p.onTimelockV1,
          startBlock: BigInt(p.startBlock),
        },
        latestBlock,
      );
    }

    return c.json({
      proposal: item,
      votes: votes.map(v => ({
        voter: v.voter,
        support: v.support,
        votes: v.votes,
        reason: v.reason,
        createdAtBlock: String(v.createdAtBlock),
        createdAtTransaction: v.createdAtTransaction,
      })),
    });
  });

  /**
   * Single candidate by id — used by the OG-image edge function so /candidates/:id
   * unfurls can pull the first image from the body without hitting the subgraph.
   * Candidate `id` is `${proposer}-${slug}` (matches the schema primary key).
   * Slug-only fallback supports legacy share URLs that drop the proposer prefix.
   */
  app.get('/api/candidates/:id', async c => {
    const idParam = c.req.param('id');
    if (!idParam) return c.json({ error: 'id required' }, 400);

    // Try exact id match first.
    const byId = await db
      .select()
      .from(schema.candidate)
      .where(eq(schema.candidate.id, idParam))
      .limit(1);

    let candidate = byId[0];

    // Fallback: lookup by slug if the id-prefixed form didn't hit. Picks the
    // most recently created match — slug collisions across proposers are rare
    // but possible.
    if (!candidate) {
      const bySlug = await db
        .select()
        .from(schema.candidate)
        .where(eq(schema.candidate.slug, idParam))
        .orderBy(desc(schema.candidate.createdAtBlock))
        .limit(1);
      candidate = bySlug[0];
    }

    if (!candidate) return c.json({ error: 'not found' }, 404);

    return c.json({
      id: candidate.id,
      slug: candidate.slug,
      proposer: candidate.proposer,
      description: candidate.description,
      canceled: candidate.canceled,
      versionsCount: candidate.versionsCount,
      promotedToProposalId:
        candidate.promotedToProposalId != null ? String(candidate.promotedToProposalId) : null,
      createdAt: String(new Date(candidate.createdAt).getTime()),
    });
  });
}
