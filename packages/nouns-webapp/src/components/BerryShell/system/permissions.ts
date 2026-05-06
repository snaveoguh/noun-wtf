/**
 * BerryOS permission/capability system.
 *
 * Tracks which apps have been granted which capabilities. Persists to
 * localStorage under `berry.permissions` (keyed `${appId}:${capability}` →
 * `'granted' | 'denied' | 'prompt'`).
 *
 * Apps call `requestPermission(appId, cap)` and either:
 *   - resolve immediately if a stored decision exists (granted = true,
 *     denied = false), or
 *   - emit a `permission:requested` event on the extended bus and await the
 *     UI's response (`permission:granted` / `permission:denied`).
 *
 * Trusted apps (see `TRUSTED_APP_IDS`) auto-grant on first request without a
 * prompt. This is the BerryOS equivalent of Apple's "system process" trust
 * tier — the permissions panel still shows them and the user can revoke.
 *
 * No external state lib (Zustand/Redux): we mirror the windowStore pattern of
 * a singleton over `useSyncExternalStore`. Keeps the dependency footprint at
 * zero and matches the rest of the BerryShell wiring.
 */

import { useSyncExternalStore } from 'react';

import { extendedBus } from './extendedBus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BerryCapability =
  | 'wallet:read'
  | 'wallet:sign'
  | 'network'
  | 'fs:read'
  | 'fs:write'
  | 'clipboard'
  | 'notifications'
  | 'background'
  | 'spotlight'
  | 'system:lifecycle';

export type PermissionStatus = 'granted' | 'denied' | 'prompt';

export interface CapabilityMeta {
  /** Capability ID. */
  id: BerryCapability;
  /** Short human label shown in the prompt + settings grid. */
  label: string;
  /** Plain-English description for the prompt body. */
  description: string;
  /** Whether the system can auto-grant for trusted apps. */
  autoGrantTrusted: boolean;
}

export const CAPABILITIES: readonly CapabilityMeta[] = [
  {
    id: 'wallet:read',
    label: 'Wallet (read)',
    description: 'read your connected wallet address and chain',
    autoGrantTrusted: true,
  },
  {
    id: 'wallet:sign',
    label: 'Wallet (sign)',
    description: 'request signatures and transactions from your wallet',
    autoGrantTrusted: false,
  },
  {
    id: 'network',
    label: 'Network',
    description: 'make HTTP requests and read on-chain data',
    autoGrantTrusted: true,
  },
  {
    id: 'fs:read',
    label: 'Files (read)',
    description: 'read files from the BerryOS virtual filesystem',
    autoGrantTrusted: true,
  },
  {
    id: 'fs:write',
    label: 'Files (write)',
    description: 'create or modify files in the BerryOS virtual filesystem',
    autoGrantTrusted: false,
  },
  {
    id: 'clipboard',
    label: 'Clipboard',
    description: 'read from and write to the system clipboard',
    autoGrantTrusted: false,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'post desktop notifications',
    autoGrantTrusted: true,
  },
  {
    id: 'background',
    label: 'Background activity',
    description: 'run tasks while the app window is closed',
    autoGrantTrusted: true,
  },
  {
    id: 'spotlight',
    label: 'Spotlight',
    description: 'register search providers for global search',
    autoGrantTrusted: true,
  },
  {
    id: 'system:lifecycle',
    label: 'System lifecycle',
    description: 'observe boot, shutdown, and service lifecycle events',
    autoGrantTrusted: true,
  },
] as const;

const CAPABILITY_BY_ID: Record<BerryCapability, CapabilityMeta> = CAPABILITIES.reduce(
  (acc, cap) => {
    acc[cap.id] = cap;
    return acc;
  },
  {} as Record<BerryCapability, CapabilityMeta>,
);

export function describeCapability(cap: BerryCapability): CapabilityMeta {
  return CAPABILITY_BY_ID[cap];
}

/**
 * Built-in apps the system trusts implicitly. First-party services + the
 * permissions/services manager itself qualify. Third-party-feeling apps
 * (anything not in this list) always prompt.
 */
const TRUSTED_APP_IDS: ReadonlyArray<string> = [
  'permissions',
  'services',
  'settings',
  'system',
  'finder',
  'auction',
  'vote',
  'candidates',
  'wallet',
];

function isTrusted(appId: string): boolean {
  return TRUSTED_APP_IDS.includes(appId);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'berry.permissions';

type PermissionRecord = Record<string, PermissionStatus>;

function loadFromStorage(): PermissionRecord {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: PermissionRecord = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === 'granted' || value === 'denied' || value === 'prompt') {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function persist(record: PermissionRecord): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // localStorage full / blocked — silently ignore. Permissions stay
    // session-scoped in that case.
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type Listener = () => void;

let state: PermissionRecord = loadFromStorage();
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach(l => l());
}

function permKey(appId: string, capability: BerryCapability): string {
  return `${appId}:${capability}`;
}

function setStatus(
  appId: string,
  capability: BerryCapability,
  status: PermissionStatus,
): void {
  const key = permKey(appId, capability);
  const next: PermissionRecord = { ...state, [key]: status };
  state = next;
  persist(next);
  notify();
}

export const permissionsStore = {
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getState(): PermissionRecord {
    return state;
  },
  /** Read-only lookup. Returns 'prompt' for unknown keys. */
  status(appId: string, capability: BerryCapability): PermissionStatus {
    return state[permKey(appId, capability)] ?? 'prompt';
  },
  /** Imperative setter — used by the permission prompt + settings panel. */
  set(appId: string, capability: BerryCapability, status: PermissionStatus): void {
    setStatus(appId, capability, status);
    if (status === 'granted') {
      extendedBus.emit('permission:granted', { appId, capability });
    } else if (status === 'denied') {
      extendedBus.emit('permission:denied', { appId, capability });
    } else {
      extendedBus.emit('permission:reset', { appId, capability });
    }
  },
  /** Wipe all decisions for an app — used when the user "forgets" an app. */
  resetApp(appId: string): void {
    const next: PermissionRecord = { ...state };
    let changed = false;
    for (const key of Object.keys(next)) {
      if (key.startsWith(`${appId}:`)) {
        delete next[key];
        changed = true;
      }
    }
    if (!changed) return;
    state = next;
    persist(next);
    notify();
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function hasPermission(appId: string, capability: BerryCapability): boolean {
  return permissionsStore.status(appId, capability) === 'granted';
}

/**
 * Pending requests — keyed by `${appId}:${capability}`. Multiple call sites
 * for the same capability share a single in-flight prompt; everyone gets
 * the eventual yes/no.
 */
const pending = new Map<string, Promise<boolean>>();

export function requestPermission(
  appId: string,
  capability: BerryCapability,
): Promise<boolean> {
  const status = permissionsStore.status(appId, capability);
  if (status === 'granted') return Promise.resolve(true);
  if (status === 'denied') return Promise.resolve(false);

  const meta = CAPABILITY_BY_ID[capability];

  // Trusted apps + auto-grantable capability → no UI prompt.
  if (isTrusted(appId) && meta.autoGrantTrusted) {
    permissionsStore.set(appId, capability, 'granted');
    return Promise.resolve(true);
  }

  const key = permKey(appId, capability);
  const existing = pending.get(key);
  if (existing) return existing;

  const promise = new Promise<boolean>(resolve => {
    const offGrant = extendedBus.on('permission:granted', payload => {
      if (payload.appId !== appId || payload.capability !== capability) return;
      cleanup();
      resolve(true);
    });
    const offDeny = extendedBus.on('permission:denied', payload => {
      if (payload.appId !== appId || payload.capability !== capability) return;
      cleanup();
      resolve(false);
    });

    function cleanup() {
      offGrant();
      offDeny();
      pending.delete(key);
    }

    extendedBus.emit('permission:requested', { appId, capability });
  });

  pending.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// React helpers
// ---------------------------------------------------------------------------

const subscribe = (l: Listener) => permissionsStore.subscribe(l);
const getSnapshot = () => state;

export function usePermissionsState(): PermissionRecord {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function usePermissionStatus(
  appId: string,
  capability: BerryCapability,
): PermissionStatus {
  const all = usePermissionsState();
  return all[permKey(appId, capability)] ?? 'prompt';
}

export const PERMISSION_STORAGE_KEY = STORAGE_KEY;
