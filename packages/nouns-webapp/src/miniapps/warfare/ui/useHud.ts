import type { HudState, WarfareGame } from '../client/WarfareGame';

import { useSyncExternalStore } from 'react';

export function useHud(game: WarfareGame): HudState {
  return useSyncExternalStore(
    cb => game.subscribe(cb),
    () => game.hud,
  );
}
