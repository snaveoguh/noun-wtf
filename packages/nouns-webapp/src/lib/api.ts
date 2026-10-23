/**
 * Shared base URL + fetch helper for the noun.wtf Ponder indexer/API
 * (`packages/nouns-api`, deployed on Railway).
 *
 * This is the ONLY place the Railway URL should be written down — import
 * `API_BASE` (or `DEFAULT_API_BASE` where the literal production URL is shown
 * to users as copy) instead of re-declaring it.
 */

/** The production Railway deployment of `packages/nouns-api`. */
export const DEFAULT_API_BASE = 'https://spirited-flexibility-production-3c30.up.railway.app';

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * Ponder API root: `VITE_MAINNET_SUBGRAPH` when set (and non-empty), otherwise
 * the production Railway URL. A trailing `/graphql` is stripped so REST paths
 * (`${API_BASE}/api/...`) and GraphQL POSTs to the root both work — Ponder
 * serves GraphQL on `/` as well as `/graphql`.
 */
export const API_BASE: string = (
  nonEmpty(import.meta.env.VITE_MAINNET_SUBGRAPH) ?? DEFAULT_API_BASE
).replace(/\/graphql\/?$/, '');

/**
 * Same API, but overridable via `VITE_API_URL` instead of
 * `VITE_MAINNET_SUBGRAPH` — used by the agent / feed / pageview endpoints,
 * which historically read that variable.
 */
export const REST_API_BASE: string = nonEmpty(import.meta.env.VITE_API_URL) ?? DEFAULT_API_BASE;

/**
 * `fetch(`${API_BASE}${path}`)` → parsed JSON. Throws on a non-2xx response
 * with the status in the message. `path` should start with `/`.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}
