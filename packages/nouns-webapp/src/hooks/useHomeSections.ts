import { useCallback, useSyncExternalStore } from 'react';

import {
  applyHomeUrlParams,
  getHomeState,
  HOME_SECTIONS,
  setHomeHeroStyle,
  setHomeSections,
  subscribeHomeState,
  toggleHomeSection,
  type HeroStyle,
  type HomeSectionId,
} from '@/lib/homeSections';

/**
 * React binding for the Dice home-page preferences (optional sections + hero
 * layout). Backed by a module store so the page, the hero and the app chrome
 * all see the same state. See `@/lib/homeSections` for the URL/localStorage
 * contract.
 */
export function useHomeSections() {
  const state = useSyncExternalStore(subscribeHomeState, getHomeState, getHomeState);

  const isEnabled = useCallback(
    (id: HomeSectionId) => state.sections.includes(id),
    [state.sections],
  );

  const enableAll = useCallback(() => {
    setHomeSections(HOME_SECTIONS.map(section => section.id));
  }, []);

  const reset = useCallback(() => {
    setHomeSections([]);
    setHomeHeroStyle('classic');
  }, []);

  return {
    sections: state.sections,
    anyEnabled: state.sections.length > 0,
    isEnabled,
    toggle: toggleHomeSection,
    setSections: setHomeSections,
    enableAll,
    reset,
    heroStyle: state.heroStyle as HeroStyle,
    setHeroStyle: setHomeHeroStyle,
    applyUrlParams: applyHomeUrlParams,
  };
}

export default useHomeSections;
