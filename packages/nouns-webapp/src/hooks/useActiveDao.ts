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

export function useActiveDao(): { activeDao: ActiveDao; setActiveDao: (dao: ActiveDao) => void } {
  const location = useLocation();
  const navigate = useNavigate();

  const activeDao = pathnameToDao(location.pathname);

  const setActiveDao = useCallback(
    (next: ActiveDao) => {
      // Navigating to the DAO root replaces the current entry so the
      // back-button steps page-by-page rather than toggle-by-toggle.
      navigate(next === 'nounv2' ? '/v2' : '/', { replace: true });
    },
    [navigate],
  );

  return { activeDao, setActiveDao };
}

export default useActiveDao;
