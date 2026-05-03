/**
 * Top-voters aggregation — Camp's voter-screen ranks delegates by recent
 * vote-with-reason / vote count over a 30-day window. We can't pull `delegates`
 * with their nested votes from Ponder in one query, so we fetch the raw
 * `votes` rows (joined with proposals so we can filter by recency) and bucket
 * client-side.
 *
 * For the digest tab on `/`, "recent" is approximated by sorting all votes by
 * `createdAtBlock` and keeping the most recent ~5000 — sufficient for ranking.
 */
import { useMemo } from 'react';

import { gql, useQuery } from '@apollo/client';

interface VoterAggregate {
  address: string;
  voteCount: number;
  withReasonCount: number;
  totalVotingPower: number;
  /** Block of their most recent vote, used to break ties. */
  lastBlock: bigint;
}

interface RawVote {
  voter: string;
  support: number;
  votes: number;
  reason: string | null;
  createdAtBlock: bigint;
}

const TOP_VOTES_QUERY = gql`
  query TopVotes($first: Int!) {
    votes(limit: $first, orderBy: "createdAtBlock", orderDirection: "desc") {
      items {
        voter
        support
        votes
        reason
        createdAtBlock
      }
    }
  }
`;

export interface TopVotersResult {
  loading: boolean;
  voters: VoterAggregate[];
  error?: Error;
}

export function useTopVoters(limit = 1000): TopVotersResult {
  const { data, loading, error } = useQuery<{ votes: { items: RawVote[] } }>(TOP_VOTES_QUERY, {
    variables: { first: limit },
  });

  const voters = useMemo<VoterAggregate[]>(() => {
    const items = data?.votes?.items ?? [];
    if (items.length === 0) return [];
    const byVoter = new Map<string, VoterAggregate>();
    for (const v of items) {
      const addr = v.voter.toLowerCase();
      let agg = byVoter.get(addr);
      if (!agg) {
        agg = {
          address: addr,
          voteCount: 0,
          withReasonCount: 0,
          totalVotingPower: 0,
          lastBlock: 0n,
        };
        byVoter.set(addr, agg);
      }
      agg.voteCount += 1;
      agg.totalVotingPower += Number(v.votes ?? 0);
      const reason = (v.reason ?? '').trim();
      if (reason !== '') agg.withReasonCount += 1;
      const block = BigInt(v.createdAtBlock ?? 0n);
      if (block > agg.lastBlock) agg.lastBlock = block;
    }
    return Array.from(byVoter.values()).sort((a, b) => {
      if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
      if (b.withReasonCount !== a.withReasonCount) return b.withReasonCount - a.withReasonCount;
      return Number(b.lastBlock - a.lastBlock);
    });
  }, [data]);

  return { loading, voters, error: (error as Error) ?? undefined };
}
