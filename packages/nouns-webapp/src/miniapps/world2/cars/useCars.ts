// React hooks onto the cars' HUD state (cars/Cars.ts).

import type { Game } from '../Game';
import type { CarUi } from './Cars';

import { useSyncExternalStore } from 'react';

export function useCarUi(game: Game): CarUi {
  return useSyncExternalStore(
    cb => game.cars.subscribe(cb),
    () => game.cars.ui,
  );
}

/** True while the player drives a car (the skate touch controls hide). */
export function useCarDriving(game: Game | null): boolean {
  return useSyncExternalStore(
    cb => (game !== null ? game.cars.subscribe(cb) : () => undefined),
    () => game?.cars.ui.driving ?? false,
  );
}
