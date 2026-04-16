/**
 * Prediction market governance bridge.
 *
 * Fetches active Nouns/Lil Nouns proposals for prediction market display.
 * In the Vite SPA, this runs client-side — we fetch proposals from the
 * Nouns subgraph directly.
 */

const NOUNS_SUBGRAPH =
  (import.meta.env.VITE_NOUNS_SUBGRAPH_URL as string | undefined) ??
  'https://api.goldsky.com/api/public/project_cldf2o9pqagp43svvbk5u3kmo/subgraphs/nouns/prod/gn';

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

async function fetchSubgraphProposals(
  url: string,
  first: number = 25,
): Promise<SubgraphProposal[]> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{
          proposals(first: ${first}, orderBy: createdBlock, orderDirection: desc) {
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
    return data?.data?.proposals ?? [];
  } catch {
    return [];
  }
}

function extractTitle(description: string): string {
  const firstLine = description.split('\n')[0] || '';
  return (
    firstLine
      .replace(/^#+\s*/, '')
      .trim()
      .slice(0, 120) || 'Untitled Proposal'
  );
}

function convertProposal(raw: SubgraphProposal, dao: string, baseUrl: string): PredictionProposal {
  const status = raw.status.toLowerCase().replace(/_/g, '-');
  return {
    dao,
    proposalId: raw.id,
    title: raw.title || extractTitle(raw.description),
    status,
    url: `${baseUrl}${raw.id}`,
    votesFor: Number(raw.forVotes),
    votesAgainst: Number(raw.againstVotes),
    quorum: Number(raw.quorumVotes),
    votingClosed: RESOLVED_STATUSES.includes(raw.status),
  };
}

export async function fetchActivePredictionProposals(): Promise<PredictionProposal[]> {
  const [nouns, lilNouns] = await Promise.all([
    fetchSubgraphProposals(NOUNS_SUBGRAPH),
    fetchSubgraphProposals(LIL_NOUNS_SUBGRAPH),
  ]);

  const nounsProposals = nouns
    .map(p => convertProposal(p, 'nouns', 'https://nouns.wtf/vote/'))
    .filter(p => ACTIVE_STATUSES.some(s => p.status === s.toLowerCase().replace(/_/g, '-')));

  const lilNounsProposals = lilNouns
    .map(p => convertProposal(p, 'lil-nouns', 'https://lilnouns.wtf/vote/'))
    .filter(p => ACTIVE_STATUSES.some(s => p.status === s.toLowerCase().replace(/_/g, '-')));

  return [...nounsProposals, ...lilNounsProposals];
}

export async function fetchResolvedPredictionProposals(): Promise<PredictionProposal[]> {
  const [nouns, lilNouns] = await Promise.all([
    fetchSubgraphProposals(NOUNS_SUBGRAPH),
    fetchSubgraphProposals(LIL_NOUNS_SUBGRAPH),
  ]);

  const nounsProposals = nouns
    .map(p => convertProposal(p, 'nouns', 'https://nouns.wtf/vote/'))
    .filter(p => RESOLVED_STATUSES.some(s => p.status === s.toLowerCase().replace(/_/g, '-')));

  const lilNounsProposals = lilNouns
    .map(p => convertProposal(p, 'lil-nouns', 'https://lilnouns.wtf/vote/'))
    .filter(p => RESOLVED_STATUSES.some(s => p.status === s.toLowerCase().replace(/_/g, '-')));

  return [...nounsProposals, ...lilNounsProposals];
}
