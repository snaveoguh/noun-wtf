// React hooks onto the drivable van's HUD state (van/VanDrive.ts).

import type { Game } from '../Game';
import type { VanUi } from './VanDrive';

import { useSyncExternalStore } from 'react';

export function useVanUi(game: Game): VanUi {
  return useSyncExternalStore(
    cb => game.van2.subscribe(cb),
    () => game.van2.ui,
  );
}

/** True while the player drives the van (the skate touch controls hide). */
export function useVanDriving(game: Game | null): boolean {
  return useSyncExternalStore(
    cb => (game !== null ? game.van2.subscribe(cb) : () => undefined),
    () => game?.van2.ui.driving ?? false,
  );
}
