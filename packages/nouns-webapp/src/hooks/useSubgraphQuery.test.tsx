import React from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installBigIntJsonSerialization } from '@/lib/bigintJson';
import { gql } from '@/lib/gql';
import { execute, executeStrict, SubgraphGraphQLError } from '@/subgraphs/execute';

import { getOperationName, subgraphQueryKey, useSubgraphQuery } from './useSubgraphQuery';

vi.mock('@/lib/subgraphSettings', () => ({
  getSubgraphRequestUrls: () => ['https://primary.test/graphql', 'https://backup.test/graphql'],
  clearUnavailableSubgraphUrl: vi.fn(),
  markSubgraphUrlUnavailable: vi.fn(),
}));

const DOC = gql`
  query GetThing($id: String!) {
    thing(id: $id) {
      id
    }
  }
`;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const makeWrapper = () => {
  // Same shape as the app's root client (retries come from the hook itself).
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

describe('gql', () => {
  it('parses to a DocumentNode and memoises by source', () => {
    const a = gql`
      query A {
        a
      }
    `;
    const b = gql`
      query A {
        a
      }
    `;
    expect(a.kind).toBe('Document');
    expect(a).toBe(b);
    expect(getOperationName(DOC)).toBe('GetThing');
  });
});

describe('installBigIntJsonSerialization', () => {
  it('lets JSON.stringify (and so query-key hashing) handle bigint', () => {
    installBigIntJsonSerialization();
    expect(JSON.stringify({ block: 12n })).toBe('{"block":"12"}');
  });
});

describe('execute / executeStrict', () => {
  it('execute ignores GraphQL errors and returns data', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { thing: null }, errors: [{ message: 'boom' }] }),
    );
    await expect(execute(DOC, { id: '1' })).resolves.toEqual({ thing: null });
  });

  it('executeStrict throws SubgraphGraphQLError on GraphQL errors without failing over', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: null, errors: [{ message: 'boom' }] }));
    const p = executeStrict(DOC, { id: '1' });
    await expect(p).rejects.toBeInstanceOf(SubgraphGraphQLError);
    await expect(p).rejects.toThrow('boom');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails over to the next URL on HTTP errors', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ data: { thing: { id: '1' } } }));
    await expect(executeStrict(DOC, { id: '1' })).resolves.toEqual({ thing: { id: '1' } });
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      'https://primary.test/graphql',
      'https://backup.test/graphql',
    ]);
  });
});

describe('useSubgraphQuery', () => {
  it('returns data with the Apollo-style { data, loading, error } shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { thing: { id: '7' } } }));
    const { result } = renderHook(
      () => useSubgraphQuery<{ thing: { id: string } }>(DOC, { variables: { id: '7' } }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ thing: { id: '7' } });
    expect(result.current.error).toBeUndefined();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.variables).toEqual({ id: '7' });
    expect(body.query).toContain('query GetThing');
  });

  it('skip → no request, not loading, no error', () => {
    const { result } = renderHook(
      () => useSubgraphQuery(DOC, { variables: { id: '1' }, skip: true }),
      { wrapper: makeWrapper() },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it('surfaces GraphQL errors as error immediately (no retry), like Apollo errorPolicy none', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: null, errors: [{ message: 'nope' }] }));
    const { result } = renderHook(() => useSubgraphQuery(DOC, { variables: { id: '1' } }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("errorPolicy 'ignore' returns partial data and no error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { thing: { id: '2' } }, errors: [{ message: 'meh' }] }),
    );
    const { result } = renderHook(
      () => useSubgraphQuery(DOC, { variables: { id: '2' }, errorPolicy: 'ignore' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ thing: { id: '2' } });
    expect(result.current.error).toBeUndefined();
  });

  it('keys queries by operation name + variables', () => {
    expect(subgraphQueryKey(DOC, { id: '1' })).toEqual(['subgraph', 'GetThing', { id: '1' }]);
  });
});
