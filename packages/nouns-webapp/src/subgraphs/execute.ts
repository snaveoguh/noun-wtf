import { DocumentNode, print } from 'graphql';

import {
  clearUnavailableSubgraphUrl,
  getSubgraphRequestUrls,
  markSubgraphUrlUnavailable,
} from '@/lib/subgraphSettings';

const createRequestInit = (query: string, variables?: Record<string, unknown>): RequestInit => ({
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/graphql-response+json',
  },
  body: JSON.stringify({
    query,
    variables,
  }),
});

export interface GraphQLResponseError {
  message: string;
  [key: string]: unknown;
}

interface GraphQLResponse<TResult> {
  data: TResult;
  errors?: GraphQLResponseError[];
}

const fetchSubgraph = async <TResult>(
  url: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<GraphQLResponse<TResult>> => {
  const response = await fetch(url, createRequestInit(query, variables));

  if (!response.ok) {
    throw new Error(`Subgraph request failed: HTTP ${response.status}`);
  }

  const json = await response.json();
  return { data: json?.data as TResult, errors: json?.errors };
};

/**
 * Thrown by `executeStrict` when the endpoint answered (HTTP 2xx) but the
 * GraphQL response carried an `errors` array — the condition Apollo's default
 * `errorPolicy: 'none'` used to surface as `error` on `useQuery`.
 */
export class SubgraphGraphQLError extends Error {
  readonly graphQLErrors: GraphQLResponseError[];

  constructor(errors: GraphQLResponseError[]) {
    super(errors.map(e => e?.message ?? 'Unknown GraphQL error').join('\n'));
    this.name = 'SubgraphGraphQLError';
    this.graphQLErrors = errors;
  }
}

/**
 * Run a query against each configured subgraph URL in order, failing over to
 * the next one on transport/HTTP errors. GraphQL-level `errors` on a 2xx
 * response do not fail over — they are handed back to the caller.
 */
async function executeWithFallback<TResult>(
  query: DocumentNode | string,
  variables?: Record<string, unknown>,
): Promise<GraphQLResponse<TResult>> {
  const queryString = typeof query === 'string' ? query : print(query);
  const urls = getSubgraphRequestUrls();

  if (urls.length === 0) {
    throw new Error('No subgraph URL configured');
  }

  let lastError: Error | null = null;

  for (const [index, url] of urls.entries()) {
    try {
      const result = await fetchSubgraph<TResult>(url, queryString, variables);
      clearUnavailableSubgraphUrl(url);
      return result;
    } catch (error) {
      markSubgraphUrlUnavailable(url);
      lastError = error instanceof Error ? error : new Error('Subgraph request failed');

      if (index === urls.length - 1) {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error('Subgraph request failed');
}

/**
 * Execute a GraphQL query against the Ponder API (or any GraphQL endpoint).
 * Uses the dynamic subgraph URL from settings (supports custom user endpoints).
 * Accepts either:
 *   - A DocumentNode (from gql`...`) with a separate variables object
 *   - A plain string query with variables
 *
 * GraphQL `errors` in the response are ignored and whatever `data` came back
 * is returned (Apollo's `errorPolicy: 'ignore'`). Use `executeStrict` to
 * treat them as a failure.
 */
export async function execute<TResult = unknown>(
  query: DocumentNode | string,
  variables?: Record<string, unknown>,
): Promise<TResult> {
  const { data } = await executeWithFallback<TResult>(query, variables);
  return data;
}

/**
 * Like `execute`, but throws `SubgraphGraphQLError` when the response carries
 * GraphQL `errors` (Apollo's default `errorPolicy: 'none'`).
 */
export async function executeStrict<TResult = unknown>(
  query: DocumentNode | string,
  variables?: Record<string, unknown>,
): Promise<TResult> {
  const { data, errors } = await executeWithFallback<TResult>(query, variables);
  if (errors && errors.length > 0) {
    throw new SubgraphGraphQLError(errors);
  }
  return data;
}
