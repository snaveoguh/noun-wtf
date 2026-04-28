import { useCallback } from 'react';

import { useLocation, useNavigate } from 'react-router';

/**
 * Which DAO the current page is showing.
 *
 * - `'nouns'`  → the traditional mainnet Nouns auction (default).
 * - `'nounv2'` → the NounV2 fork (no-reserve auctions, shared webapp).
 *
 * Source of truth is the URL pathname:
 *   - `/v2`, `/v2/...`        → `'nounv2'`
 *   - everything else         → `'nouns'`
 *
 * This used to be a `?dao=` query param + `localStorage` fallback. That model
 * leaked: a stale `'nounv2'` in storage made `/noun/:id` and `/probe` think
 * they were V2 even though those pages always render mainnet content. The
 * URL is the only source of truth now.
 */
export type ActiveDao = 'nouns' | 'nounv2';

function pathnameToDao(pathname: string): ActiveDao {
  if (pathname === '/v2' || pathname.startsWith('/v2/')) return 'nounv2';
  // The legacy `/nounv2` governance routes also live in V2 context — keep
  // the toggle showing V2 when the user is reading proposals there.
  if (pathname === '/nounv2' || pathname.startsWith('/nounv2/')) return 'nounv2';
  return 'nouns';
}

// Matches `/noun/:id`, `/v2/noun/:id` (id is a positive integer). The capture
// group is the noun id when present.
const V1_NOUN_ID_RE = /^\/noun\/(\d+)\/?$/;
const V2_NOUN_ID_RE = /^\/v2\/noun\/(\d+)\/?$/;

/**
 * Whether the global V1/V2 toggle should be visible — and toggling it
 * has a meaningful destination — for this pathname.
 *
 * Only the four DAO-namespaced auction routes qualify: `/`, `/noun/:id`,
 * `/v2`, `/v2/noun/:id`. Everything else (governance, probe, crystal-ball,
 * etc.) is rendered DAO-agnostic and the global toggle is a no-op there.
 */
export function routeHasDaoToggle(pathname: string): boolean {
  if (pathname === '/' || pathname === '/v2') return true;
  if (V1_NOUN_ID_RE.test(pathname)) return true;
  if (V2_NOUN_ID_RE.test(pathname)) return true;
  return false;
}

export function useActiveDao(): { activeDao: ActiveDao; setActiveDao: (dao: ActiveDao) => void } {
  const location = useLocation();
  const navigate = useNavigate();

  const activeDao = pathnameToDao(location.pathname);

  const setActiveDao = useCallback(
    (next: ActiveDao) => {
      const pathname = location.pathname;

      // Determine the destination based on the current path. Only the four
      // namespaced auction paths participate; everything else is a no-op so
      // the user doesn't get yanked off the page they're on. (The global
      // toggle is also hidden on those pages, but we defend the navigation
      // here too in case someone calls `setActiveDao` programmatically.)
      let target: string | null = null;

      if (next === 'nounv2') {
        if (pathname === '/') {
          target = '/v2';
        } else {
          const m = V1_NOUN_ID_RE.exec(pathname);
          if (m) target = `/v2/noun/${m[1]}`;
        }
      } else {
        if (pathname === '/v2') {
          target = '/';
        } else {
          const m = V2_NOUN_ID_RE.exec(pathname);
          if (m) target = `/noun/${m[1]}`;
        }
      }

      if (target === null) return;

      // Navigating to the DAO root replaces the current entry so the
      // back-button steps page-by-page rather than toggle-by-toggle.
      navigate(target, { replace: true });
    },
    [location.pathname, navigate],
  );

  return { activeDao, setActiveDao };
}

export default useActiveDao;
