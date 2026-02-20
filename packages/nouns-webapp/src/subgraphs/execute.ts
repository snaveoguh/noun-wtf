import { DocumentNode, print } from 'graphql'

import { getSubgraphUrl } from '@/lib/subgraphSettings'

/**
 * Execute a GraphQL query against the Ponder API (or any GraphQL endpoint).
 * Uses the dynamic subgraph URL from settings (supports custom user endpoints).
 * Accepts either:
 *   - A DocumentNode (from gql`...`) with a separate variables object
 *   - A plain string query with variables
 */
export async function execute<TResult = unknown>(
    query: DocumentNode | string,
    variables?: Record<string, unknown>,
): Promise<TResult> {
    const queryString = typeof query === 'string' ? query : print(query)

    const response = await fetch(getSubgraphUrl(), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/graphql-response+json'
        },
        body: JSON.stringify({
            query: queryString,
            variables
        })
    })

    if (!response.ok) {
        throw new Error('Network response was not ok')
    }

    return (await response.json()).data as TResult
}
