import { useCallback } from 'react';

import { useLocation, useNavigate } from 'react-router';

import { THEME_NAMES } from '@/contexts/SiteThemeContext';

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

// Theme prefixes (`/pro`, `/game`, ...) are an orthogonal axis to DAO routing
// — they only swap the chrome that wraps SiteRoutes — so we strip them before
// any DAO-pathname matching. Without this, ThemeSwitcher's `navigate('/pro')`
// would hide the toggle (no `/pro` in the whitelist), and the toggle would
// stay gone until the user navigated to a different page.
function splitThemePrefix(pathname: string): { prefix: string; logical: string } {
  const lower = pathname.toLowerCase();
  for (const t of THEME_NAMES) {
    const p = `/${t}`;
    if (lower === p) return { prefix: p, logical: '/' };
    if (lower.startsWith(`${p}/`)) return { prefix: p, logical: lower.slice(p.length) };
  }
  return { prefix: '', logical: lower };
}

// All pathname comparisons here are case-insensitive — react-router's route
// matching is case-insensitive by default (so `<Route path="v2">` matches
// both `/v2` and `/V2`), and we have to mirror that or a capital-V link
// would render the V1 fallback while the URL bar still says `/V2`.
function pathnameToDao(pathname: string): ActiveDao {
  const { logical } = splitThemePrefix(pathname);
  if (logical === '/v2' || logical.startsWith('/v2/')) return 'nounv2';
  // The legacy `/nounv2` governance routes also live in V2 context — keep
  // the toggle showing V2 when the user is reading proposals there.
  if (logical === '/nounv2' || logical.startsWith('/nounv2/')) return 'nounv2';
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
 *
 * A `/<theme>` prefix (e.g. `/pro`, `/pro/v2`) is treated as equivalent to
 * the underlying logical route, since themes only swap chrome.
 */
export function routeHasDaoToggle(pathname: string): boolean {
  const { logical } = splitThemePrefix(pathname);
  if (logical === '/' || logical === '/v2') return true;
  if (V1_NOUN_ID_RE.test(logical)) return true;
  if (V2_NOUN_ID_RE.test(logical)) return true;
  if (logical === '/crystal-ball' || logical === '/v2/crystal-ball') return true;
  return false;
}

export function useActiveDao(): { activeDao: ActiveDao; setActiveDao: (dao: ActiveDao) => void } {
  const location = useLocation();
  const navigate = useNavigate();

  const activeDao = pathnameToDao(location.pathname);

  const setActiveDao = useCallback(
    (next: ActiveDao) => {
      // Strip any theme prefix so logical-path matching works regardless of
      // whether the user is on `/v2` or `/pro/v2`. We re-prepend the prefix
      // when building the target so the user stays on their current theme.
      const { prefix, logical } = splitThemePrefix(location.pathname);

      let logicalTarget: string | null = null;

      if (next === 'nounv2') {
        if (logical === '/') {
          logicalTarget = '/v2';
        } else if (logical === '/crystal-ball') {
          logicalTarget = '/v2/crystal-ball';
        } else {
          const m = V1_NOUN_ID_RE.exec(logical);
          if (m) logicalTarget = `/v2/noun/${m[1]}`;
        }
      } else {
        if (logical === '/v2') {
          logicalTarget = '/';
        } else if (logical === '/v2/crystal-ball') {
          logicalTarget = '/crystal-ball';
        } else {
          const m = V2_NOUN_ID_RE.exec(logical);
          if (m) logicalTarget = `/noun/${m[1]}`;
        }
      }

      if (logicalTarget === null) return;

      const target = prefix
        ? logicalTarget === '/'
          ? prefix
          : `${prefix}${logicalTarget}`
        : logicalTarget;

      // Navigating to the DAO root replaces the current entry so the
      // back-button steps page-by-page rather than toggle-by-toggle.
      navigate(target, { replace: true });
    },
    [location.pathname, navigate],
  );

  return { activeDao, setActiveDao };
}

export default useActiveDao;
