/**
 * BerryOS notifications store + bridge.
 *
 * Owns the canonical list of `BerryNotification`s, the `notify()` /
 * `dismiss()` API, and the persistence layer (`localStorage` under
 * `berry.notifications`, last 100 entries).
 *
 * Also bridges existing bus events (`app:launched`, `system:walletConnected`,
 * `auction:newBid`, `service:failed`, `permission:denied`) into auto-generated
 * notifications. The bridge runs once on first import so the toast/center are
 * "live" the moment they mount.
 *
 * Note: this codebase doesn't ship `zustand`. The brief asks for a Zustand
 * store, but the established pattern in `store/windowStore.ts` is a
 * `useSyncExternalStore` shim with the same `getState` / `subscribe` /
 * `useXxx()` shape — keeping that pattern avoids introducing a new dep and
 * matches the rest of BerryOS.
 */

import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';

import { berryBus } from './eventBus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

export interface BerryNotification {
  id: string;
  appId: string;
  title: string;
  body?: string;
  /** ReactNode for inline icons; string fallback for emoji / persisted entries. */
  icon?: ReactNode | string;
  timestamp: number;
  action?: { label: string; onClick: () => void };
  level?: NotificationLevel;
  dismissed?: boolean;
}

interface NotificationsState {
  notifications: BerryNotification[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'berry.notifications';
const MAX_NOTIFICATIONS = 100;

// ---------------------------------------------------------------------------
// Persistence — only stable fields. Action callbacks + ReactNode icons get
// stripped on save / restore (the click handler is gone after a refresh).
// ---------------------------------------------------------------------------

interface PersistedNotification {
  id: string;
  appId: string;
  title: string;
  body?: string;
  icon?: string;
  timestamp: number;
  level?: NotificationLevel;
  dismissed?: boolean;
}

function isStringIcon(icon: ReactNode | string | undefined): icon is string {
  return typeof icon === 'string';
}

function toPersisted(n: BerryNotification): PersistedNotification {
  return {
    id: n.id,
    appId: n.appId,
    title: n.title,
    body: n.body,
    icon: isStringIcon(n.icon) ? n.icon : undefined,
    timestamp: n.timestamp,
    level: n.level,
    dismissed: n.dismissed,
  };
}

function loadPersisted(): BerryNotification[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedNotification[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-MAX_NOTIFICATIONS);
  } catch {
    return [];
  }
}

function savePersisted(notifications: BerryNotification[]): void {
  if (typeof window === 'undefined') return;
  try {
    const persisted = notifications.slice(-MAX_NOTIFICATIONS).map(toPersisted);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Quota exceeded — silent. The in-memory store is still authoritative.
  }
}

// ---------------------------------------------------------------------------
// Store — useSyncExternalStore shim with a Zustand-shaped surface.
// ---------------------------------------------------------------------------

let state: NotificationsState = {
  notifications: loadPersisted(),
};

type Listener = () => void;
const listeners = new Set<Listener>();

function setState(next: NotificationsState) {
  state = next;
  savePersisted(state.notifications);
  listeners.forEach(l => l());
}

function genId(): string {
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const notificationStore = {
  getState() {
    return state;
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Reset to empty — used by tests. */
  reset() {
    setState({ notifications: [] });
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a notification. Returns the generated id.
 * Emits `notification:posted` with the canonical payload after store update.
 */
export function notify(input: Omit<BerryNotification, 'id' | 'timestamp'>): string {
  const id = genId();
  const timestamp = Date.now();
  const level: NotificationLevel = input.level ?? 'info';
  const notification: BerryNotification = {
    ...input,
    id,
    timestamp,
    level,
    dismissed: false,
  };

  // Cap to MAX_NOTIFICATIONS (drop oldest).
  const next = [...state.notifications, notification].slice(-MAX_NOTIFICATIONS);
  setState({ notifications: next });

  berryBus.emit('notification:posted', {
    id,
    appId: notification.appId,
    title: notification.title,
    body: notification.body,
    level,
    timestamp,
  });

  return id;
}

/** Mark one notification as dismissed (does not remove from history). */
export function dismiss(id: string): void {
  let changed = false;
  const next = state.notifications.map(n => {
    if (n.id !== id || n.dismissed) return n;
    changed = true;
    return { ...n, dismissed: true };
  });
  if (!changed) return;
  setState({ notifications: next });
  berryBus.emit('notification:dismissed', { id });
}

/**
 * Mark all notifications as dismissed. Pass an `appId` to scope the dismissal
 * to a single app (used by per-app "clear" controls).
 */
export function dismissAll(appId?: string): void {
  let changed = false;
  const next = state.notifications.map(n => {
    if (n.dismissed) return n;
    if (appId && n.appId !== appId) return n;
    changed = true;
    return { ...n, dismissed: true };
  });
  if (!changed) return;
  setState({ notifications: next });
  berryBus.emit('notification:dismissed', { appId, all: true });
}

/** Hard delete (used by "Clear all" in the center / app). */
export function clearAll(appId?: string): void {
  const next = appId ? state.notifications.filter(n => n.appId !== appId) : [];
  setState({ notifications: next });
  berryBus.emit('notification:dismissed', { appId, all: true });
}

// ---------------------------------------------------------------------------
// React selectors
// ---------------------------------------------------------------------------

const subscribe = (l: Listener) => notificationStore.subscribe(l);
const getSnapshot = () => state;

export function useNotifications(): BerryNotification[] {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // Newest first — most consumers want this order.
  return [...s.notifications].reverse();
}

export function useUnreadCount(): number {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return s.notifications.reduce((acc, n) => acc + (n.dismissed ? 0 : 1), 0);
}

// ---------------------------------------------------------------------------
// Bus → notification bridge
//
// Subscribed once on first import. Idempotent via module-level guard so HMR
// doesn't double-subscribe.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __berryNotificationsBridged?: boolean;
  }
}

function shortAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function appNameFromId(appId: string): string {
  // Best-effort title-case fallback. The other agent's registry will provide
  // canonical names once it lands; until then this keeps copy human-readable.
  if (!appId) return 'App';
  return appId.charAt(0).toUpperCase() + appId.slice(1);
}

export function bridgeBusToNotifications(): void {
  if (typeof window !== 'undefined') {
    if (window.__berryNotificationsBridged) return;
    window.__berryNotificationsBridged = true;
  }

  // app:launched → low-priority "AppName launched", auto-dismiss in 3s.
  // The toast layer auto-dismisses by level; we tag this as 'info' so it
  // disappears on the standard 3s timer without needing extra plumbing.
  berryBus.on('app:launched', ({ appId }) => {
    const name = appNameFromId(appId);
    const id = notify({
      appId,
      title: `${name} launched`,
      level: 'info',
      icon: '🚀',
    });
    // Belt-and-braces auto-dismiss in case the toast layer is unmounted.
    if (typeof window !== 'undefined') {
      window.setTimeout(() => dismiss(id), 3000);
    }
  });

  berryBus.on('system:walletConnected', ({ address }) => {
    notify({
      appId: 'system',
      title: 'Wallet connected',
      body: shortAddress(address),
      level: 'success',
      icon: '🔌',
    });
  });

  berryBus.on('auction:newBid', ({ nounId, amount, bidder }) => {
    notify({
      appId: 'auction',
      title: `New bid on Noun ${nounId}`,
      body: `Ξ${amount}${bidder ? ` from ${shortAddress(bidder)}` : ''}`,
      level: 'info',
      icon: '🪙',
      action: {
        label: 'View',
        onClick: () => {
          if (typeof window === 'undefined') return;
          window.location.assign(`/noun/${nounId}`);
        },
      },
    });
  });

  berryBus.on('service:failed', ({ name, reason }) => {
    notify({
      appId: 'system',
      title: `Service ${name} failed to start`,
      body: reason,
      level: 'error',
      icon: '⚠️',
    });
  });

  berryBus.on('permission:denied', ({ appId, appName, capability }) => {
    const name = appName ?? appNameFromId(appId);
    notify({
      appId,
      title: `${name} denied permission`,
      body: `Capability: ${capability}`,
      level: 'warning',
      icon: '🔒',
    });
  });
}

// Auto-bridge on first import. Safe to call again (idempotent).
bridgeBusToNotifications();
