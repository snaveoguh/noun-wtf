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

// All pathname comparisons here are case-insensitive — react-router's route
// matching is case-insensitive by default (so `<Route path="v2">` matches
// both `/v2` and `/V2`), and we have to mirror that or a capital-V link
// would render the V1 fallback while the URL bar still says `/V2`.
function pathnameToDao(pathname: string): ActiveDao {
  const p = pathname.toLowerCase();
  if (p === '/v2' || p.startsWith('/v2/')) return 'nounv2';
  // The legacy `/nounv2` governance routes also live in V2 context — keep
  // the toggle showing V2 when the user is reading proposals there.
  if (p === '/nounv2' || p.startsWith('/nounv2/')) return 'nounv2';
  return 'nouns';
}

// Matches `/noun/:id`, `/v2/noun/:id` (id is a positive integer). The capture
// group is the noun id when present. Pathname is lowercased before matching.
const V1_NOUN_ID_RE = /^\/noun\/(\d+)\/?$/;
const V2_NOUN_ID_RE = /^\/v2\/noun\/(\d+)\/?$/;

/**
 * Whether the global V1/V2 toggle should be visible — and toggling it
 * has a meaningful destination — for this pathname.
 *
 * The DAO-namespaced routes are: `/`, `/noun/:id`, `/v2`, `/v2/noun/:id`,
 * `/crystal-ball`, `/v2/crystal-ball`. Everything else (governance, probe,
 * etc.) is rendered DAO-agnostic and the global toggle is a no-op there.
 */
export function routeHasDaoToggle(pathname: string): boolean {
  const p = pathname.toLowerCase();
  if (p === '/' || p === '/v2') return true;
  if (V1_NOUN_ID_RE.test(p)) return true;
  if (V2_NOUN_ID_RE.test(p)) return true;
  if (p === '/crystal-ball' || p === '/v2/crystal-ball') return true;
  return false;
}

export function useActiveDao(): { activeDao: ActiveDao; setActiveDao: (dao: ActiveDao) => void } {
  const location = useLocation();
  const navigate = useNavigate();

  const activeDao = pathnameToDao(location.pathname);

  const setActiveDao = useCallback(
    (next: ActiveDao) => {
      // Match the source pathname case-insensitively so a capital-V link
      // (`/V2`, `/V2/Noun/123`) still toggles cleanly. Targets we generate
      // below are always canonical lowercase.
      const pathname = location.pathname.toLowerCase();

      // Toggle to the target DAO's auction root (or its crystal-ball twin).
      // The noun id is deliberately NOT carried across: V1 and V2 are separate
      // DAOs with unrelated id ranges, so `/noun/1640` → `/v2/noun/1640` points
      // at a noun that doesn't exist and crashes the auction page.
      const onCrystalBall = pathname === '/crystal-ball' || pathname === '/v2/crystal-ball';
      let target: string;
      if (next === 'nounv2') {
        target = onCrystalBall ? '/v2/crystal-ball' : '/v2';
      } else {
        target = onCrystalBall ? '/crystal-ball' : '/';
      }

      // Navigating to the DAO root replaces the current entry so the
      // back-button steps page-by-page rather than toggle-by-toggle.
      navigate(target, { replace: true });
    },
    [location.pathname, navigate],
  );

  return { activeDao, setActiveDao };
}

export default useActiveDao;
