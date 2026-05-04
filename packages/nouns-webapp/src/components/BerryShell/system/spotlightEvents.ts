/**
 * BerryOS event bus augmentation — adds `hotkey:*` and `spotlight:*`
 * categories owned by the Spotlight + global-hotkey subsystem.
 *
 * Declaration merging into the host `BerryEventMap` interface lets these
 * events flow through `berryBus.emit` / `berryBus.on` with full type safety
 * without modifying `eventBus.ts`. Importing this module anywhere in the
 * Spotlight chain is enough — TypeScript merges the interfaces at compile
 * time and the runtime is unchanged.
 *
 * Note: `berryBus.onAll` only iterates over event names listed in the static
 * `EVENT_NAMES` table inside eventBus.ts. Hotkey/spotlight events are emitted
 * normally and observed by anyone subscribing by name; they just won't appear
 * in the dev-only `onAll` firehose. That's fine — debug subscribers can use
 * the explicit names.
 */

import type { BerryHotkeyScope } from './hotkeys';

declare module './eventBus' {
  interface BerryEventMap {
    'hotkey:fired': { id: string; combo: string; scope: BerryHotkeyScope };
    'spotlight:toggle': Record<string, never>;
    'spotlight:opened': Record<string, never>;
    'spotlight:closed': Record<string, never>;
    /** Emitted when Spotlight launches an app. */
    'spotlight:launched': { appId: string };
  }
}

export {}; // module marker so TS treats this as a module
