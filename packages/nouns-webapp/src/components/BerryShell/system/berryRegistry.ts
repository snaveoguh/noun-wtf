/**
 * berryRegistry — self-registration shim for BerryOS apps.
 *
 * The other-agent brief assumed an `app:` capability registry where apps
 * call `berryRegistry.register(descriptor)` at module load. The current
 * shell (see `apps/registry.tsx`) uses a static `APP_REGISTRY` map keyed by
 * appId. This shim bridges the two: descriptors registered here are merged
 * back into `APP_REGISTRY` so the existing dock + window manager pick them
 * up without any changes to BerryShell internals.
 *
 * Side-effecting imports are the registration trigger — see
 * `apps/ActivityMonitorApp.tsx` and `apps/ConsoleApp.tsx` for examples.
 *
 * If a future iteration of the shell switches to true dynamic registration,
 * `list()` / `get()` here become the source of truth and APP_REGISTRY can be
 * removed.
 */

import type { ComponentType } from 'react';

import type { BerryAppDef } from '../apps/registry';

import { berryBus } from './eventBus';

/* ------------------------------------------------------------------------- *
 * Circular-import dance:                                                    *
 *                                                                           *
 *   apps/registry.tsx → side-effect-imports app modules (which call         *
 *     berryRegistry.register at top level) → those need APP_REGISTRY.       *
 *                                                                           *
 * If we import APP_REGISTRY directly at the top of this file, ES module     *
 * evaluation hits the bindings *before* the `export const APP_REGISTRY`     *
 * line has run, so accessing it throws "Cannot access 'APP_REGISTRY' before *
 * initialization". We use a lazy dynamic-import inside register() — by the  *
 * time any consumer reads APP_REGISTRY (Spotlight, BerryShell launcher),    *
 * the microtask resolving this import has fired and the mirror is live.    *
 * ------------------------------------------------------------------------- */
async function getAppRegistry(): Promise<Record<string, BerryAppDef>> {
  const mod = (await import('../apps/registry')) as {
    APP_REGISTRY: Record<string, BerryAppDef>;
  };
  return mod.APP_REGISTRY;
}

export interface BerryAppDescriptor {
  /** Stable id used for window dedup and menu lookups. */
  id: string;
  /** Display name shown in window title bar + Activity Monitor. */
  name: string;
  /** Single emoji or short string used in the dock. */
  icon: string;
  component: ComponentType;
  defaultWindow?: { w?: number; h?: number };
  /**
   * Optional declared capabilities. Used by Activity Monitor + future
   * permission UI; the existing shell ignores unknowns so this is forward-
   * compatible.
   */
  capabilities?: readonly string[];
}

const descriptors = new Map<string, BerryAppDescriptor>();

function toAppDef(d: BerryAppDescriptor): BerryAppDef {
  return {
    appId: d.id,
    title: d.name,
    emoji: d.icon,
    Component: d.component,
    width: d.defaultWindow?.w ?? 640,
    height: d.defaultWindow?.h ?? 480,
  };
}

export const berryRegistry = {
  register(descriptor: BerryAppDescriptor): void {
    descriptors.set(descriptor.id, descriptor);
    // Mirror into the legacy registry so the existing launcher works without
    // edits. The launcher reads `APP_REGISTRY[appId]` directly. Done via a
    // lazy dynamic import to dodge the TDZ at registry-module load time —
    // see comment at top of this file.
    void getAppRegistry().then(reg => {
      reg[descriptor.id] = toAppDef(descriptor);
    });
    // Boot-time signal — useful for the bus history wrapper to capture which
    // apps came online during the session (visible in Console / Inspector).
    try {
      berryBus.emit('app:launching', { appId: descriptor.id, source: 'event' });
    } catch {
      /* eventBus map may not include the name in older builds */
    }
  },
  list(): BerryAppDescriptor[] {
    return Array.from(descriptors.values());
  },
  get(id: string): BerryAppDescriptor | undefined {
    return descriptors.get(id);
  },
  capabilities(id: string): readonly string[] {
    return descriptors.get(id)?.capabilities ?? [];
  },
};
