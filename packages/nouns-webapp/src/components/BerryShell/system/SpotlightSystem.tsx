/**
 * SpotlightSystem — single-component bootstrap for Spotlight + global
 * hotkeys + the cmd-hold cheat sheet overlay.
 *
 * Drop in once near the root of BerryShell:
 *
 *     import SpotlightSystem from './system/SpotlightSystem';
 *     // ...
 *     <SpotlightSystem />
 *
 * Responsibilities:
 *   1. On `system:bootComplete` (or immediately if missed), register the
 *      default global hotkeys defined in the spec:
 *        cmd+space      → emit `spotlight:toggle`
 *        cmd+w          → close the focused window
 *        cmd+q          → quit (terminate) the focused app
 *        cmd+shift+a    → focus first window of most-recently-launched app
 *        cmd+,          → open Settings
 *        esc            → close any spotlight / modal
 *   2. Render <Spotlight /> globally — invisible until toggled.
 *   3. Render <HotkeyHints /> — overlay shown on cmd-hold.
 *
 * Idempotent: registering the same hotkey id multiple times replaces, so
 * React strict-mode double-invokes and HMR re-renders don't double-bind.
 *
 * The "most recently launched app" tracking listens to `app:launched` via the
 * bus — falls back to scanning windowStore if that event hasn't fired yet.
 */

import { useEffect, useRef } from 'react';

import { APP_REGISTRY } from '../apps/registry';
import { windowStore } from '../store/windowStore';

import HotkeyHints from './HotkeyHints';
import Spotlight from './Spotlight';
import { berryBus } from './eventBus';
import { hotkeyManager } from './hotkeys';
import './spotlightEvents';

function focusedWindow() {
  const s = windowStore.getState();
  if (!s.focusedId) return null;
  return s.windows.find(w => w.id === s.focusedId) ?? null;
}

export default function SpotlightSystem() {
  // Track most-recently-launched app for cmd+shift+a.
  const recentAppRef = useRef<string | null>(null);

  useEffect(() => {
    const offLaunched = berryBus.on('app:launched', payload => {
      recentAppRef.current = payload.appId;
    });
    // Fallback: also track window:created since some launch paths skip the
    // app:launched event.
    const offCreated = berryBus.on('window:created', payload => {
      recentAppRef.current = payload.appId;
    });
    return () => {
      offLaunched();
      offCreated();
    };
  }, []);

  useEffect(() => {
    function registerDefaults() {
      hotkeyManager.register({
        id: 'berry-default-spotlight',
        combo: 'cmd+space',
        description: 'Open Spotlight',
        scope: 'global',
        handler: () => berryBus.emit('spotlight:toggle', {}),
      });

      hotkeyManager.register({
        id: 'berry-default-close-window',
        combo: 'cmd+w',
        description: 'Close window',
        scope: 'global',
        handler: () => {
          const win = focusedWindow();
          if (win) windowStore.close(win.id);
        },
      });

      hotkeyManager.register({
        id: 'berry-default-quit-app',
        combo: 'cmd+q',
        description: 'Quit app',
        scope: 'global',
        handler: () => {
          const win = focusedWindow();
          if (!win) return;
          // Close every window for this app so the app fully terminates.
          const s = windowStore.getState();
          const peers = s.windows.filter(w => w.appId === win.appId);
          berryBus.emit('app:terminating', { appId: win.appId });
          peers.forEach(w => windowStore.close(w.id));
        },
      });

      hotkeyManager.register({
        id: 'berry-default-focus-recent',
        combo: 'cmd+shift+a',
        description: 'Focus most recent app',
        scope: 'global',
        handler: () => {
          const target = recentAppRef.current;
          if (!target) return;
          const s = windowStore.getState();
          const win = s.windows.find(w => w.appId === target && !w.isMinimized)
            ?? s.windows.find(w => w.appId === target);
          if (win) {
            if (win.isMinimized) windowStore.restore(win.id);
            else windowStore.focus(win.id);
          }
        },
      });

      hotkeyManager.register({
        id: 'berry-default-open-settings',
        combo: 'cmd+,',
        description: 'Open Settings',
        scope: 'global',
        handler: () => {
          const def = APP_REGISTRY['settings'];
          if (!def) return;
          windowStore.open({
            appId: def.appId,
            title: def.title,
            icon: def.emoji,
            width: def.width,
            height: def.height,
          });
        },
      });

      hotkeyManager.register({
        id: 'berry-default-escape',
        combo: 'esc',
        description: 'Close modal / Spotlight',
        scope: 'global',
        // Spotlight handles its own escape internally; this acts as a fallback
        // emit for any other modal that listens.
        preventDefault: false,
        handler: () => {
          // Close Spotlight if it's open. The component listens to
          // spotlight:toggle, but for a clean "always close" we emit a
          // dedicated close event the component recognises by toggling only
          // when its own state is open. A direct toggle would re-open if
          // closed — so we narrow to a no-op in that case by checking the
          // event log: if `spotlight:opened` is the most recent of the
          // open/close pair, send a toggle.
          const log = berryBus.history();
          for (let i = log.length - 1; i >= 0; i--) {
            const r = log[i];
            if (r.event === 'spotlight:opened') {
              berryBus.emit('spotlight:toggle', {});
              return;
            }
            if (r.event === 'spotlight:closed') return;
          }
        },
      });
    }

    // Register immediately — boot may have already completed by the time we
    // mount, especially in HMR. Re-registers are idempotent (same ids).
    registerDefaults();

    // Also re-register on bootComplete in case the boot agent does anything
    // that resets registries; keeps us defensive.
    const off = berryBus.on('system:bootComplete', () => registerDefaults());
    return () => {
      off();
      // Keep registrations on unmount — Spotlight is a process-singleton.
    };
  }, []);

  return (
    <>
      <Spotlight />
      <HotkeyHints />
    </>
  );
}
