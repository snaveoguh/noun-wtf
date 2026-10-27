// ── HUD slots: other UIs render their chips into the ring HUD's places ──
//
// The ring HUD owns the layout; mode UIs (hide & seek, freestyle, missions,
// replays, trade, cars…) own their buttons and state. A UI wraps a piece in
// <HudSlot name="…"> and it is portalled into the matching place in the HUD:
//
//   toasts   the top-centre stack (prompts, trick names, records, status)
//   util     the utility row under the map (one icon each)
//   modes    the mode chips row (HIDE & SEEK, FREESTYLE…)
//   rim      a badge on the map's rim (the van cargo)
//   panels   popovers under the ring (the missions tracker)
//
// When the HUD isn't mounted (a replay, hoops) the `fallback` renders in
// place instead, or nothing.

import type { ReactNode } from 'react';
import { useCallback, useSyncExternalStore } from 'react';

import { createPortal } from 'react-dom';

export type SlotName = 'toasts' | 'util' | 'modes' | 'rim' | 'panels';

const nodes = new Map<SlotName, HTMLElement>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version += 1;
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The HUD side: a callback ref that registers a place. */
export function useSlotRef(name: SlotName) {
  return useCallback(
    (el: HTMLElement | null) => {
      if (el !== null) nodes.set(name, el);
      else if (nodes.get(name) !== undefined) nodes.delete(name);
      notify();
    },
    [name],
  );
}

/** The DOM node of a place, or null while the HUD is away. */
export function useSlot(name: SlotName): HTMLElement | null {
  useSyncExternalStore(subscribe, () => version);
  const el = nodes.get(name) ?? null;
  return el !== null && el.isConnected ? el : null;
}

export function HudSlot({
  name,
  fallback = null,
  children,
}: {
  name: SlotName;
  /** What to render in place when the HUD isn't mounted. */
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const el = useSlot(name);
  return el !== null ? createPortal(children, el) : <>{fallback}</>;
}
