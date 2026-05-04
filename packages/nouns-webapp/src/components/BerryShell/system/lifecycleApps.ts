/**
 * Side-effect mount file for BerryOS lifecycle / personalisation apps.
 *
 * Mirrors the convention used by `apps/devtoolsApps.ts` — a single import
 * here registers every "system polish" app on the registry without touching
 * the static `apps/registry.tsx`.
 *
 * Importing this from a top-level module (App.tsx → BerryShell mount path,
 * or a `lifecycleMount.tsx` under `system/`) is enough to pull the apps in.
 *
 * Currently registers:
 *   - WallpaperApp ("Desktop & Screensaver")
 *
 * Future additions (e.g. Screensaver picker, Login Items, Energy Saver) can
 * land here without further wiring changes.
 */

// Side-effect imports — each calls `berryRegistry.register(...)` on load.
import '../apps/WallpaperApp';

import { hotkeyManager } from './hotkeys';
import { berryRegistry } from './berryRegistry';
import { windowStore } from '../store/windowStore';

function launch(appId: string): void {
  const def = berryRegistry.get(appId);
  if (!def) return;
  windowStore.open({
    appId: def.id,
    title: def.name,
    icon: def.icon,
    width: def.defaultWindow?.w,
    height: def.defaultWindow?.h,
  });
}

if (typeof window !== 'undefined') {
  try {
    hotkeyManager.register({
      id: 'lifecycle-open-wallpaper',
      combo: 'cmd+shift+w',
      description: 'Open Desktop & Screensaver',
      scope: 'global',
      handler: () => launch('wallpaper'),
    });
  } catch {
    /* hotkey manager unavailable — registry import alone is enough */
  }
}
