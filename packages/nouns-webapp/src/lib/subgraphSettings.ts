/**
 * Custom Subgraph URL settings — stored in localStorage.
 * Allows users to point noun.wtf at their own Ponder/subgraph endpoint.
 * Like anouns.eth.limo's custom subgraph feature.
 */

const STORAGE_KEY = 'noun-wtf-subgraph-url';
const UNAVAILABLE_STORAGE_KEY = 'noun-wtf-subgraph-url-unavailable';
const DEFAULT_URL = import.meta.env.VITE_MAINNET_SUBGRAPH ?? '';

const normalizeUrl = (url: string | null | undefined): string => (url ?? '').trim();

const getUnavailableSubgraphUrl = (): string => {
  try {
    return normalizeUrl(sessionStorage.getItem(UNAVAILABLE_STORAGE_KEY));
  } catch {
    return '';
  }
};

const getCustomSubgraphUrl = (): string => {
  try {
    return normalizeUrl(localStorage.getItem(STORAGE_KEY));
  } catch {
    return '';
  }
};

/** Get the active subgraph URL (custom or default) */
export const getSubgraphUrl = (): string => {
  return getCustomSubgraphUrl() || DEFAULT_URL;
};

/** Get the default (built-in) subgraph URL */
export const getDefaultSubgraphUrl = (): string => DEFAULT_URL;

/** Get the ordered list of subgraph URLs to try for this session */
export const getSubgraphRequestUrls = (): string[] => {
  const customUrl = getCustomSubgraphUrl();
  const defaultUrl = normalizeUrl(DEFAULT_URL);
  const unavailableUrl = getUnavailableSubgraphUrl();
  const urls: string[] = [];

  if (customUrl && customUrl !== unavailableUrl) {
    urls.push(customUrl);
  }

  if (defaultUrl && defaultUrl !== customUrl) {
    urls.push(defaultUrl);
  }

  // If the custom URL is all we have, keep using it even when marked unavailable.
  if (urls.length === 0 && customUrl) {
    urls.push(customUrl);
  }

  return urls;
};

/** Check if a custom URL is set */
export const hasCustomSubgraphUrl = (): boolean => {
  return getCustomSubgraphUrl().length > 0;
};

/** Remember that a custom URL is failing so we can fall back for the rest of the session */
export const markSubgraphUrlUnavailable = (url: string): void => {
  const normalized = normalizeUrl(url);
  if (!normalized || normalized === normalizeUrl(DEFAULT_URL)) return;

  try {
    sessionStorage.setItem(UNAVAILABLE_STORAGE_KEY, normalized);
  } catch {
    // sessionStorage might be disabled
  }
};

/** Clear the temporary unavailable flag once a URL is healthy again */
export const clearUnavailableSubgraphUrl = (url?: string): void => {
  try {
    const current = sessionStorage.getItem(UNAVAILABLE_STORAGE_KEY);
    if (!current) return;
    if (url && normalizeUrl(current) !== normalizeUrl(url)) return;
    sessionStorage.removeItem(UNAVAILABLE_STORAGE_KEY);
  } catch {
    // sessionStorage might be disabled
  }
};

/** Set a custom subgraph URL */
export const setSubgraphUrl = (url: string): void => {
  try {
    const trimmed = normalizeUrl(url);
    localStorage.setItem(STORAGE_KEY, trimmed);
    clearUnavailableSubgraphUrl(trimmed);
    // Dispatch event so React components can react to changes
    window.dispatchEvent(new CustomEvent('subgraph-url-changed', { detail: trimmed }));
  } catch {
    // localStorage might be full or disabled
  }
};

/** Reset to the default subgraph URL */
export const resetSubgraphUrl = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    clearUnavailableSubgraphUrl();
    window.dispatchEvent(new CustomEvent('subgraph-url-changed', { detail: DEFAULT_URL }));
  } catch {
    // noop
  }
};

/** Test if a subgraph URL responds with valid data */
export const testSubgraphUrl = async (
  url: string,
): Promise<{ ok: boolean; latency: number; error?: string }> => {
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
    if (Array.isArray(json.errors) && json.errors.length > 0) {
      return {
        ok: false,
        latency: performance.now() - start,
        error: json.errors[0]?.message ?? 'GraphQL error',
      };
    }

    if (json.data == null || json.data._meta == null) {
      return {
        ok: false,
        latency: performance.now() - start,
        error: 'Invalid response (no _meta)',
      };
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
