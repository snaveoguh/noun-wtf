import { useCallback, useEffect, useMemo } from 'react';

import { useSearchParams } from 'react-router';

/**
 * Which DAO the auction hero + home view is currently showing.
 *
 * - `'nouns'`  → the traditional mainnet Nouns auction (default).
 * - `'nounv2'` → the NounV2 fork (no-reserve auctions, shared webapp).
 *
 * Source of truth, in order:
 *   1. `?dao=` query param on the current URL.
 *   2. `localStorage['noun.wtf:activeDao']` from a previous visit.
 *   3. Fallback to `'nouns'`.
 */
export type ActiveDao = 'nouns' | 'nounv2';

const STORAGE_KEY = 'noun.wtf:activeDao';
const VALID_DAOS: readonly ActiveDao[] = ['nouns', 'nounv2'] as const;

function isValidDao(value: unknown): value is ActiveDao {
  return typeof value === 'string' && VALID_DAOS.includes(value as ActiveDao);
}

function readStoredDao(): ActiveDao | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isValidDao(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Returns the active DAO plus a setter that updates both the URL query
 * param and localStorage. Setter uses `replace` so the back-button still
 * navigates page-by-page rather than toggle-by-toggle.
 */
export function useActiveDao(): { activeDao: ActiveDao; setActiveDao: (dao: ActiveDao) => void } {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryDao = searchParams.get('dao');

  const activeDao: ActiveDao = useMemo(() => {
    if (isValidDao(queryDao)) return queryDao;
    const stored = readStoredDao();
    if (stored) return stored;
    return 'nouns';
  }, [queryDao]);

  // Whenever the effective DAO changes (URL or fallback), persist to localStorage
  // so a fresh visit without a `?dao=` param remembers the last choice.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, activeDao);
    } catch {
      // storage may be disabled (private mode, quota) — silent fail is fine.
    }
  }, [activeDao]);

  const setActiveDao = useCallback(
    (next: ActiveDao) => {
      // Update the URL so the state is shareable + survives reloads.
      const nextParams = new URLSearchParams(searchParams);
      if (next === 'nouns') {
        // 'nouns' is the default — keep URLs clean when flipping back to it.
        nextParams.delete('dao');
      } else {
        nextParams.set('dao', next);
      }
      setSearchParams(nextParams, { replace: true });

      // localStorage write is handled by the effect above once the URL updates,
      // but we also write eagerly so the value is available on the same tick
      // for any non-hook consumer that reads storage directly.
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // ignore
        }
      }
    },
    [searchParams, setSearchParams],
  );

  return { activeDao, setActiveDao };
}

export default useActiveDao;
