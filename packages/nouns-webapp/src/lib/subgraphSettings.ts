/**
 * Custom Subgraph URL settings — stored in localStorage.
 * Allows users to point noun.wtf at their own Ponder/subgraph endpoint.
 * Like anouns.eth.limo's custom subgraph feature.
 */

const STORAGE_KEY = 'noun-wtf-subgraph-url';
const DEFAULT_URL = import.meta.env.VITE_MAINNET_SUBGRAPH ?? '';

/** Get the active subgraph URL (custom or default) */
export const getSubgraphUrl = (): string => {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_URL;
  } catch {
    return DEFAULT_URL;
  }
};

/** Get the default (built-in) subgraph URL */
export const getDefaultSubgraphUrl = (): string => DEFAULT_URL;

/** Check if a custom URL is set */
export const hasCustomSubgraphUrl = (): boolean => {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
};

/** Set a custom subgraph URL */
export const setSubgraphUrl = (url: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, url.trim());
    // Dispatch event so React components can react to changes
    window.dispatchEvent(new CustomEvent('subgraph-url-changed', { detail: url.trim() }));
  } catch {
    // localStorage might be full or disabled
  }
};

/** Reset to the default subgraph URL */
export const resetSubgraphUrl = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('subgraph-url-changed', { detail: DEFAULT_URL }));
  } catch {
    // noop
  }
};

/** Test if a subgraph URL responds with valid data */
export const testSubgraphUrl = async (url: string): Promise<{ ok: boolean; latency: number; error?: string }> => {
  const start = performance.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/graphql-response+json',
      },
      body: JSON.stringify({
        query: `{ _meta { status } }`,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { ok: false, latency: performance.now() - start, error: `HTTP ${response.status}` };
    }

    const json = await response.json();
    if (json.errors) {
      return { ok: false, latency: performance.now() - start, error: json.errors[0]?.message ?? 'GraphQL error' };
    }

    if (!json.data?._meta) {
      return { ok: false, latency: performance.now() - start, error: 'Invalid response (no _meta)' };
    }

    return { ok: true, latency: performance.now() - start };
  } catch (err) {
    return {
      ok: false,
      latency: performance.now() - start,
      error: err instanceof Error ? err.message : 'Connection failed',
    };
  }
};
