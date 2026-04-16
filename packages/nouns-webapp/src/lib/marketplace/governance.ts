/**
 * Prediction market governance bridge.
 *
 * Fetches active Nouns/Lil Nouns proposals for prediction market display.
 * Uses our own Ponder API (spirited-flexibility) for Nouns proposals,
 * and the Lil Nouns subgraph for Lil Nouns.
 */

const API_BASE = (
  (import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app'
).replace(/\/graphql\/?$/, '');

const LIL_NOUNS_SUBGRAPH =
  (import.meta.env.VITE_LIL_NOUNS_SUBGRAPH_URL as string | undefined) ??
  'https://api.goldsky.com/api/public/project_cldf2o9pqagp43svvbk5u3kmo/subgraphs/lil-nouns/prod/gn';

export interface PredictionProposal {
  dao: string;
  proposalId: string;
  title: string;
  status: string;
  url?: string;
  votesFor?: number;
  votesAgainst?: number;
  quorum?: number;
  votingClosed?: boolean;
}

interface SubgraphProposal {
  id: string;
  title?: string;
  description: string;
  status: string;
  forVotes: string;
  againstVotes: string;
  quorumVotes: string;
}

const ACTIVE_STATUSES = ['ACTIVE', 'PENDING', 'OBJECTION_PERIOD', 'UPDATABLE'];
const RESOLVED_STATUSES = [
  'CANCELLED',
  'DEFEATED',
  'SUCCEEDED',
  'QUEUED',
  'EXPIRED',
  'EXECUTED',
  'VETOED',
];

/** Fetch Nouns proposals from our Ponder REST API */
async function fetchNounsProposals(): Promise<PredictionProposal[]> {
  try {
    const res = await fetch(`${API_BASE}/api/proposals`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const proposals = await res.json();
    if (!Array.isArray(proposals)) return [];
    return proposals.map((p: Record<string, unknown>) => {
      const desc = (p.description as string) ?? '';
      const firstLine = desc.split('\n')[0] ?? '';
      const title =
        (p.title as string) ??
        (firstLine
          .replace(/^#+\s*/, '')
          .trim()
          .slice(0, 120) ||
          'Untitled Proposal');
      const status = ((p.status as string) ?? '').toLowerCase().replace(/_/g, '-');
      return {
        dao: 'nouns',
        proposalId: String(p.id),
        title,
        status,
        url: `https://nouns.wtf/vote/${p.id}`,
        votesFor: Number(p.forVotes ?? 0),
        votesAgainst: Number(p.againstVotes ?? 0),
        quorum: Number(p.quorumVotes ?? 0),
        votingClosed: RESOLVED_STATUSES.includes(((p.status as string) ?? '').toUpperCase()),
      };
    });
  } catch {
    return [];
  }
}

/** Fetch Lil Nouns proposals from subgraph */
async function fetchLilNounsProposals(): Promise<PredictionProposal[]> {
  try {
    const res = await fetch(LIL_NOUNS_SUBGRAPH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{
          proposals(first: 25, orderBy: createdBlock, orderDirection: desc) {
            id
            description
            status
            forVotes
            againstVotes
            quorumVotes
          }
        }`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const proposals: SubgraphProposal[] = data?.data?.proposals ?? [];
    return proposals.map(raw => {
      const status = raw.status.toLowerCase().replace(/_/g, '-');
      return {
        dao: 'lil-nouns',
        proposalId: raw.id,
        title:
          raw.title ??
          raw.description
            .split('\n')[0]
            ?.replace(/^#+\s*/, '')
            .trim()
            .slice(0, 120) ??
          'Untitled Proposal',
        status,
        url: `https://lilnouns.wtf/vote/${raw.id}`,
        votesFor: Number(raw.forVotes),
        votesAgainst: Number(raw.againstVotes),
        quorum: Number(raw.quorumVotes),
        votingClosed: RESOLVED_STATUSES.includes(raw.status),
      };
    });
  } catch {
    return [];
  }
}

export async function fetchActivePredictionProposals(): Promise<PredictionProposal[]> {
  const [nouns, lilNouns] = await Promise.all([fetchNounsProposals(), fetchLilNounsProposals()]);

  const activeNouns = nouns.filter(p =>
    ACTIVE_STATUSES.some(s => p.status === s.toLowerCase().replace(/_/g, '-')),
  );
  const activeLilNouns = lilNouns.filter(p =>
    ACTIVE_STATUSES.some(s => p.status === s.toLowerCase().replace(/_/g, '-')),
  );

  return [...activeNouns, ...activeLilNouns];
}

export async function fetchResolvedPredictionProposals(): Promise<PredictionProposal[]> {
  const [nouns, lilNouns] = await Promise.all([fetchNounsProposals(), fetchLilNounsProposals()]);

  const resolvedNouns = nouns.filter(p =>
    RESOLVED_STATUSES.some(s => p.status === s.toLowerCase().replace(/_/g, '-')),
  );
  const resolvedLilNouns = lilNouns.filter(p =>
    RESOLVED_STATUSES.some(s => p.status === s.toLowerCase().replace(/_/g, '-')),
  );

  return [...resolvedNouns, ...resolvedLilNouns];
}
