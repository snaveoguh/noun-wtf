import { DocumentNode, print } from 'graphql'

import {
    clearUnavailableSubgraphUrl,
    getSubgraphRequestUrls,
    markSubgraphUrlUnavailable,
} from '@/lib/subgraphSettings'

const createRequestInit = (query: string, variables?: Record<string, unknown>): RequestInit => ({
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        Accept: 'application/graphql-response+json'
    },
    body: JSON.stringify({
        query,
        variables
    })
})

const fetchSubgraph = async <TResult>(
    url: string,
    query: string,
    variables?: Record<string, unknown>,
): Promise<TResult> => {
    const response = await fetch(url, createRequestInit(query, variables))

    if (!response.ok) {
        throw new Error(`Subgraph request failed: HTTP ${response.status}`)
    }

    const json = await response.json()
    return json.data as TResult
}

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
    const urls = getSubgraphRequestUrls()

    if (urls.length === 0) {
        throw new Error('No subgraph URL configured')
    }

    let lastError: Error | null = null

    for (const [index, url] of urls.entries()) {
        try {
            const result = await fetchSubgraph<TResult>(url, queryString, variables)
            clearUnavailableSubgraphUrl(url)
            return result
        } catch (error) {
            markSubgraphUrlUnavailable(url)
            lastError =
                error instanceof Error ? error : new Error('Subgraph request failed')

            if (index === urls.length - 1) {
                throw lastError
            }
        }
    }

    throw lastError ?? new Error('Subgraph request failed')
}
