/**
 * BerryOS services daemon framework.
 *
 * Background services register themselves once at module-load time. The
 * `serviceManager` keeps a registry, tracks lifecycle status, and exposes
 * imperative start/stop/restart for the Services manager UI.
 *
 * Services flagged `autoStart: true` boot once at app start. Because the
 * core eventBus owner (other agent) hasn't wired `system:bootComplete` yet
 * we expose `serviceManager.boot()` as the explicit kick-off — the BerryShell
 * mounts a `<ServicesBoot />` effect that calls boot() once on mount and
 * also subscribes to `system:bootComplete` if/when that event arrives, so
 * either pathway works. (boot() is idempotent — second call is a no-op.)
 *
 * Service implementations live in ./daemons/. They are pure objects that
 * conform to BerryService — no React, no JSX. The UI reads the manager via
 * the same useSyncExternalStore pattern used everywhere else in BerryShell.
 */

import { useSyncExternalStore } from 'react';

import { berryBus } from './eventBus';
import { extendedBus } from './extendedBus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'failed';

export interface BerryService {
  /** Stable, unique service ID (kebab-case). */
  id: string;
  /** Human-readable name shown in the Services app. */
  name: string;
  /** Boot once on system start? */
  autoStart: boolean;
  /** Optional human description shown in the Services app. */
  description?: string;
  /**
   * Start the service. Returning a promise lets the manager track the
   * 'starting' state. Throw to mark the service as 'failed'.
   */
  start(): Promise<void>;
  /** Stop the service. Should clean up listeners / intervals / etc. */
  stop(): Promise<void>;
  /** Optional: cheap status snapshot. The manager also tracks this itself. */
  status?(): ServiceStatus;
}

export interface ServiceRecord {
  service: BerryService;
  status: ServiceStatus;
  /** Last error message, only populated when status === 'failed'. */
  lastError?: string;
  /** Wall-clock timestamp of the last status change. */
  changedAt: number;
}

// ---------------------------------------------------------------------------
// Internal store — same useSyncExternalStore pattern as windowStore.
// ---------------------------------------------------------------------------

type Listener = () => void;

let registry: Map<string, ServiceRecord> = new Map();
const listeners = new Set<Listener>();
let booted = false;

function notify() {
  listeners.forEach(l => l());
}

function setRecord(id: string, patch: Partial<ServiceRecord>): void {
  const current = registry.get(id);
  if (!current) return;
  const next: ServiceRecord = {
    ...current,
    ...patch,
    changedAt: Date.now(),
  };
  // Replace map ref so useSyncExternalStore notices.
  const nextMap = new Map(registry);
  nextMap.set(id, next);
  registry = nextMap;
  notify();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const serviceManager = {
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  register(service: BerryService): void {
    if (registry.has(service.id)) {
      // Re-registration during HMR is normal — keep the latest impl, preserve
      // the running status if it was running so we don't double-start.
      const existing = registry.get(service.id)!;
      const nextMap = new Map(registry);
      nextMap.set(service.id, { ...existing, service });
      registry = nextMap;
      notify();
      return;
    }
    const nextMap = new Map(registry);
    nextMap.set(service.id, {
      service,
      status: 'stopped',
      changedAt: Date.now(),
    });
    registry = nextMap;
    notify();
  },

  list(): ServiceRecord[] {
    return Array.from(registry.values());
  },

  get(id: string): ServiceRecord | undefined {
    return registry.get(id);
  },

  async start(id: string): Promise<void> {
    const rec = registry.get(id);
    if (!rec) return;
    if (rec.status === 'running' || rec.status === 'starting') return;
    setRecord(id, { status: 'starting', lastError: undefined });
    try {
      await rec.service.start();
      setRecord(id, { status: 'running' });
      extendedBus.emit('service:started', { id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRecord(id, { status: 'failed', lastError: message });
      extendedBus.emit('service:failed', { id, error: message });
    }
  },

  async stop(id: string): Promise<void> {
    const rec = registry.get(id);
    if (!rec) return;
    if (rec.status === 'stopped') return;
    try {
      await rec.service.stop();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // We still mark stopped — leaving a service in 'failed' on a stop
      // error makes it look like the service crashed mid-run, which is
      // confusing. Log the error in the record instead.
      setRecord(id, { status: 'stopped', lastError: message });
      extendedBus.emit('service:stopped', { id });
      return;
    }
    setRecord(id, { status: 'stopped', lastError: undefined });
    extendedBus.emit('service:stopped', { id });
  },

  async restart(id: string): Promise<void> {
    await serviceManager.stop(id);
    await serviceManager.start(id);
  },

  /**
   * Boot once: start every service flagged `autoStart`. Idempotent — a
   * second call is a no-op so it's safe to wire to multiple triggers
   * (BerryShell mount + system:bootComplete bus event).
   */
  async boot(): Promise<void> {
    if (booted) return;
    booted = true;
    const auto = Array.from(registry.values()).filter(r => r.service.autoStart);
    await Promise.all(auto.map(r => serviceManager.start(r.service.id)));
  },

  /** For tests + the Services UI's "shut down everything" button. */
  async shutdown(): Promise<void> {
    const running = Array.from(registry.values()).filter(r => r.status === 'running');
    await Promise.all(running.map(r => serviceManager.stop(r.service.id)));
    booted = false;
  },

  hasBooted(): boolean {
    return booted;
  },
};

// Wire boot to the eventBus' `system:bootComplete` so when the other agent
// starts emitting it, autoStart services light up automatically — and the
// no-op-after-first-call guarantee inside boot() means there's no race with
// the BerryShell mount-effect that also calls boot().
berryBus.on('system:bootComplete', () => {
  void serviceManager.boot();
});

// ---------------------------------------------------------------------------
// React helpers
// ---------------------------------------------------------------------------

const subscribe = (l: Listener) => serviceManager.subscribe(l);
const getSnapshot = () => registry;

export function useServices(): ServiceRecord[] {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return Array.from(snap.values());
}

export function useService(id: string): ServiceRecord | undefined {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return snap.get(id);
}
