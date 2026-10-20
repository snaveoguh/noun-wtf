// React hook onto the dragon's HUD state (dragon/DragonRide.ts).

import type { Game } from '../Game';
import type { DragonUi } from './DragonRide';

import { useSyncExternalStore } from 'react';

export function useDragonUi(game: Game | null): DragonUi | null {
  return useSyncExternalStore(
    cb => (game !== null ? game.dragon.subscribe(cb) : () => undefined),
    () => game?.dragon.ui ?? null,
  );
}
