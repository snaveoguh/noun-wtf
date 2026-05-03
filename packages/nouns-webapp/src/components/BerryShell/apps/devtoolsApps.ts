/**
 * devtoolsApps — single mount point for BerryOS dev/inspection tools.
 *
 * Side-effect import chain:
 *   - `ActivityMonitorApp` self-registers via `berryRegistry.register(...)`.
 *   - `ConsoleApp` does the same.
 *   - The bus history wrapper boots so events that fire BEFORE either app is
 *     opened still land in the ring buffer.
 *   - The Event Inspector hotkey (Cmd+Shift+I) is installed at module load
 *     by `EventInspector.tsx` itself.
 *
 * Wire-up (one line in `apps/registry.tsx`): `import './devtoolsApps';`
 *
 * Why a single mount file: keeps the touch surface on shared registry code
 * to one line and lets the dev-tools bundle be removed in one keystroke
 * later if we ever want to ship a no-devtools build.
 */

import { berryRegistry } from '../system/berryRegistry';
import { startBusHistory } from '../system/busHistory';
import { hotkeyManager } from '../system/hotkeys';
import { windowStore } from '../store/windowStore';

// Side-effect imports — each calls `berryRegistry.register(...)` at top level.
import './ActivityMonitorApp';
import './ConsoleApp';

// Boot the high-capacity history wrapper as early as possible so notifications
// etc. fired during BerryShell mount land in the buffer, not just after a
// monitor app opens.
startBusHistory();

// EventInspector is mounted as JSX from `system/EventInspector.tsx` itself
// (it appends a portal host to <body> on import); the hotkey listener
// installs itself when the EventInspector module loads.
import '../system/EventInspector';

/* ----------------------------------------------------------------------- */
/* Launcher hotkeys                                                         */
/*                                                                          */
/* AppleMenu / dock are static, so without editing them the only built-in  */
/* way to surface dev tools is keyboard. Cmd+Shift+A opens Activity Monitor */
/* and Cmd+Shift+C opens Console. Cmd+Shift+I (Event Inspector) is wired   */
/* in EventInspector.tsx itself.                                            */
/* ----------------------------------------------------------------------- */

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
      id: 'devtools-open-activity-monitor',
      combo: 'cmd+shift+a',
      description: 'Open Activity Monitor',
      scope: 'global',
      handler: () => launch('activity-monitor'),
    });
    hotkeyManager.register({
      id: 'devtools-open-console',
      combo: 'cmd+shift+c',
      description: 'Open Console',
      scope: 'global',
      handler: () => launch('console'),
    });
  } catch {
    /* hotkey manager unavailable — apps are still launchable via window.__berryDev */
  }

  // Tiny dev/QA hook: lets the test harness or curious users open monitors
  // from the devtools console.
  (window as unknown as { __berryDev?: { open: (id: string) => void } }).__berryDev = {
    open: launch,
  };
}
