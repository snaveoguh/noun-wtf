import type { DocumentNode, OperationDefinitionNode } from 'graphql';

import { useQuery } from '@tanstack/react-query';

import { execute, executeStrict } from '@/subgraphs/execute';

export interface UseSubgraphQueryOptions {
  variables?: Record<string, unknown>;
  /** Don't run the query (Apollo's `skip`). */
  skip?: boolean;
  /** Re-run every N ms; 0/undefined disables (Apollo's `pollInterval`). */
  pollInterval?: number;
  /**
   * 'none' (default) — GraphQL `errors` make the query fail and surface as
   * `error`. 'ignore' — errors are dropped and whatever `data` came back is
   * returned. Same semantics as Apollo's `errorPolicy`.
   */
  errorPolicy?: 'none' | 'ignore';
}

export const getOperationName = (document: DocumentNode): string | undefined =>
  document.definitions.find((d): d is OperationDefinitionNode => d.kind === 'OperationDefinition')
    ?.name?.value;

export const subgraphQueryKey = (document: DocumentNode, variables?: Record<string, unknown>) =>
  ['subgraph', getOperationName(document) ?? document.loc?.source.body, variables ?? {}] as const;

/**
 * TanStack Query wrapper for the app's GraphQL documents (`wrappers/subgraph.ts`)
 * run through the typed `execute()` helper. It is the drop-in replacement for
 * Apollo's `useQuery` and returns the same `{ data, loading, error, refetch }`
 * shape so callers keep their loading/error checks unchanged.
 *
 * Apollo did not retry failed requests (and `execute` already fails over
 * across subgraph URLs), so retries are off here — callers such as the
 * candidate/feedback hooks switch to an eth_getLogs fallback as soon as
 * `error` is set. Everything else uses the root QueryClient defaults.
 */
export function useSubgraphQuery<TData>(
  document: DocumentNode,
  { variables, skip = false, pollInterval, errorPolicy = 'none' }: UseSubgraphQueryOptions = {},
) {
  const run = errorPolicy === 'ignore' ? execute : executeStrict;
  const query = useQuery({
    queryKey: subgraphQueryKey(document, variables),
    // TanStack rejects `undefined` query data; a body without `data` (possible
    // under errorPolicy 'ignore') is stored as null and handed back as undefined.
    queryFn: async () => (await run<TData>(document, variables)) ?? null,
    enabled: !skip,
    refetchInterval: pollInterval != null && pollInterval > 0 ? pollInterval : false,
    retry: false,
  });

  return {
    data: query.data ?? undefined,
    loading: query.isLoading,
    error: query.error ?? undefined,
    refetch: query.refetch,
  };
}
