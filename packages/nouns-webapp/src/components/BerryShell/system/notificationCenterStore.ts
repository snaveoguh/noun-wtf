/**
 * UI-only store for the slide-out Notification Center panel.
 *
 * Kept separate from `notificationStore` so the bell + center can toggle open
 * without churning the notifications array. Same `useSyncExternalStore` shim
 * the rest of BerryOS uses (see `notifications.ts` for the rationale on
 * skipping zustand here).
 */

import { useSyncExternalStore } from 'react';

interface CenterState {
  isOpen: boolean;
}

let state: CenterState = { isOpen: false };

type Listener = () => void;
const listeners = new Set<Listener>();

function setState(next: CenterState) {
  state = next;
  listeners.forEach(l => l());
}

export const notificationCenterStore = {
  getState() {
    return state;
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  open() {
    if (state.isOpen) return;
    setState({ isOpen: true });
  },
  close() {
    if (!state.isOpen) return;
    setState({ isOpen: false });
  },
  toggle() {
    setState({ isOpen: !state.isOpen });
  },
};

const subscribe = (l: Listener) => notificationCenterStore.subscribe(l);
const getSnapshot = () => state;

export function useNotificationCenterOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).isOpen;
}
