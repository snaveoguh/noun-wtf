import { LIL_NOUNS_SUBGRAPH } from '../activityFeed.js';

export async function fetchLilNounsFromSubgraph() {
  // Paginate in chunks of 500 (subgraph max is usually 1000; 500 is conservative).
  const PAGE = 500;
  const all: Array<Record<string, unknown>> = [];
  let skip = 0;
  while (true) {
    const query = `{
      proposals(first: ${PAGE}, skip: ${skip}, orderBy: createdBlock, orderDirection: desc) {
        id
        title
        description
        status
        forVotes
        againstVotes
        abstainVotes
        quorumVotes
        proposalThreshold
        startBlock
        endBlock
        createdBlock
        createdTimestamp
        executionETA
        executedTimestamp
        canceledTimestamp
        vetoedTimestamp
        queuedTimestamp
        proposer { id }
      }
    }`;
    const res = await fetch(LIL_NOUNS_SUBGRAPH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Goldsky ${res.status}`);
    const json = (await res.json()) as { data?: { proposals?: Array<Record<string, unknown>> } };
    const page = json.data?.proposals ?? [];
    all.push(...page);
    if (page.length < PAGE) break;
    skip += PAGE;
  }
  return all;
}
