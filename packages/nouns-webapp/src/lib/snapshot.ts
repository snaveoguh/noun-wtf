/**
 * Snapshot.org client — reads proposals/votes from a Snapshot space.
 * Used for Yellow Collective metagov integration.
 *
 * Writing (casting votes) requires @snapshot-labs/snapshot.js SDK —
 * that will be added when the Snapshot space is live.
 */

const SNAPSHOT_GRAPHQL = 'https://hub.snapshot.org/graphql';

export const YC_SNAPSHOT_SPACE = 'yellowcollective.eth';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SnapshotProposal {
  id: string;
  title: string;
  body: string;
  state: 'active' | 'closed' | 'pending';
  choices: string[];
  scores: number[];
  scores_total: number;
  start: number;
  end: number;
  snapshot: string;
  author: string;
  /** Extracted Nouns proposal ID from title pattern "{id}: {title}" */
  nounsProposalId: string | null;
}

export interface SnapshotVote {
  id: string;
  voter: string;
  choice: number; // 1-indexed into choices array
  vp: number; // voting power
  reason: string;
  created: number;
}

// ─── Queries ────────────────────────────────────────────────────────────────

async function snapshotQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(SNAPSHOT_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors != null) {
    throw new Error(
      (json.errors as Array<{ message?: string }>)[0]?.message ?? 'Snapshot GraphQL error',
    );
  }
  return json.data;
}

/** Parse Nouns proposal ID from metagov title format "{id}: {title}" */
function extractNounsId(title: string): string | null {
  const match = title.match(/^(\d+):/);
  return match ? match[1] : null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function fetchSpaceProposals(
  spaceId: string = YC_SNAPSHOT_SPACE,
  limit = 100,
): Promise<SnapshotProposal[]> {
  const data = await snapshotQuery<{ proposals: Array<Omit<SnapshotProposal, 'nounsProposalId'>> }>(
    `
    query GetProposals($space: String!, $limit: Int!) {
      proposals(
        first: $limit,
        where: { space: $space },
        orderBy: "created",
        orderDirection: desc
      ) {
        id
        title
        body
        state
        choices
        scores
        scores_total
        start
        end
        snapshot
        author
      }
    }
  `,
    { space: spaceId, limit },
  );

  return (data.proposals ?? []).map(p => ({
    ...p,
    nounsProposalId: extractNounsId(p.title),
  }));
}

export async function fetchProposalVotes(
  proposalId: string,
  limit = 1000,
): Promise<SnapshotVote[]> {
  const data = await snapshotQuery<{ votes: SnapshotVote[] }>(
    `
    query GetVotes($proposal: String!, $limit: Int!) {
      votes(
        first: $limit,
        where: { proposal: $proposal },
        orderBy: "vp",
        orderDirection: desc
      ) {
        id
        voter
        choice
        vp
        reason
        created
      }
    }
  `,
    { proposal: proposalId, limit },
  );

  return data.votes ?? [];
}

export async function fetchVotingPower(spaceId: string, voter: string): Promise<number> {
  // Snapshot's voting power API is a REST endpoint, not GraphQL
  try {
    const res = await fetch(`https://score.snapshot.org/api/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        params: {
          space: spaceId,
          network: '8453', // Base
          snapshot: 'latest',
          strategies: [], // Will use space strategies
          addresses: [voter],
        },
      }),
    });
    const json = await res.json();
    const scores = json?.result?.scores?.[0] ?? {};
    return scores[voter.toLowerCase()] ?? scores[voter] ?? 0;
  } catch {
    return 0;
  }
}
