/**
 * NotificationsApp — draggable-window twin of the slide-out Notification
 * Center. Adds filters (All / Unread / By App / By Level) and, in dev mode,
 * a "Test notifications" button that fires one of each level.
 *
 * Self-registers with `berryRegistry` if it exists at import time. The
 * registry is being built by another agent; if it isn't there yet, we
 * silently skip — the app can still be opened by adding it to the
 * existing `apps/registry.tsx` list as a normal entry.
 */

import { useMemo, useState, type ComponentType } from 'react';

import {
  clearAll,
  dismiss,
  notify,
  useNotifications,
  type BerryNotification,
  type NotificationLevel,
} from '../system/notifications';

// ---------------------------------------------------------------------------
// Filter machinery
// ---------------------------------------------------------------------------

type Filter =
  | { kind: 'all' }
  | { kind: 'unread' }
  | { kind: 'app'; appId: string }
  | { kind: 'level'; level: NotificationLevel };

const LEVEL_COLORS: Record<NotificationLevel, string> = {
  info: '#3478F6',
  success: '#34C759',
  warning: '#FF9F0A',
  error: '#FF3B30',
};

const LEVELS: NotificationLevel[] = ['info', 'success', 'warning', 'error'];

function matches(n: BerryNotification, f: Filter): boolean {
  switch (f.kind) {
    case 'all':
      return true;
    case 'unread':
      return !n.dismissed;
    case 'app':
      return n.appId === f.appId;
    case 'level':
      return (n.level ?? 'info') === f.level;
  }
}

function uniqueAppIds(items: readonly BerryNotification[]): string[] {
  return Array.from(new Set(items.map(n => n.appId))).sort();
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Dev helpers
// ---------------------------------------------------------------------------

function isDev(): boolean {
  // Vite injects import.meta.env.DEV at build time. Defensive guard so this
  // file is safe to import in non-Vite environments (e.g. unit tests).
  try {
    return Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

function fireSamples() {
  notify({
    appId: 'notifications',
    title: 'Heads up',
    body: 'Just checking in — info-level notification.',
    level: 'info',
    icon: '💬',
  });
  notify({
    appId: 'auction',
    title: 'New bid on Noun 1234',
    body: 'Ξ12.34 from 0xabcd…1234',
    level: 'info',
    icon: '🪙',
    action: { label: 'View', onClick: () => console.log('[notif] view bid clicked') },
  });
  notify({
    appId: 'system',
    title: 'Wallet connected',
    body: '0x38501DEB…f764d',
    level: 'success',
    icon: '🔌',
  });
  notify({
    appId: 'system',
    title: 'Settings storage almost full',
    body: 'Consider clearing app caches.',
    level: 'warning',
    icon: '⚠️',
  });
  notify({
    appId: 'system',
    title: 'Service indexer failed to start',
    body: 'Connection refused after 3 retries.',
    level: 'error',
    icon: '🚫',
  });
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

export default function NotificationsApp() {
  const all = useNotifications();
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });

  const filtered = useMemo(() => all.filter(n => matches(n, filter)), [all, filter]);
  const apps = useMemo(() => uniqueAppIds(all), [all]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: 'var(--theme-font-display, -apple-system, sans-serif)',
        color: 'var(--theme-text-primary, #1d1d1f)',
      }}
    >
      {/* Filter bar */}
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--theme-border, rgba(0,0,0,0.08))',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          alignItems: 'center',
        }}
      >
        <FilterChip
          label="All"
          active={filter.kind === 'all'}
          onClick={() => setFilter({ kind: 'all' })}
        />
        <FilterChip
          label="Unread"
          active={filter.kind === 'unread'}
          onClick={() => setFilter({ kind: 'unread' })}
        />
        <span style={{ width: 1, height: 14, background: 'rgba(0,0,0,0.1)', margin: '0 4px' }} />
        {LEVELS.map(level => (
          <FilterChip
            key={level}
            label={level}
            color={LEVEL_COLORS[level]}
            active={filter.kind === 'level' && filter.level === level}
            onClick={() => setFilter({ kind: 'level', level })}
          />
        ))}
        {apps.length > 0 && (
          <>
            <span
              style={{ width: 1, height: 14, background: 'rgba(0,0,0,0.1)', margin: '0 4px' }}
            />
            <select
              value={filter.kind === 'app' ? filter.appId : ''}
              onChange={e => {
                if (!e.target.value) setFilter({ kind: 'all' });
                else setFilter({ kind: 'app', appId: e.target.value });
              }}
              style={{
                fontSize: 11,
                fontFamily: 'inherit',
                padding: '2px 6px',
                borderRadius: 4,
                border: '1px solid rgba(0,0,0,0.15)',
                background: '#fff',
              }}
            >
              <option value="">By app…</option>
              {apps.map(a => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          disabled={all.length === 0}
          onClick={() => clearAll()}
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 5,
            border: '1px solid rgba(0,0,0,0.12)',
            background: all.length === 0 ? 'transparent' : 'rgba(0,0,0,0.04)',
            cursor: all.length === 0 ? 'default' : 'pointer',
            color: all.length === 0 ? 'var(--theme-text-muted, #999)' : 'inherit',
            fontFamily: 'inherit',
          }}
        >
          Clear all
        </button>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {filtered.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: 32,
              color: 'var(--theme-text-muted, #888)',
              fontSize: 12,
            }}
          >
            No notifications
          </div>
        ) : (
          filtered.map(n => <Row key={n.id} notification={n} />)
        )}
      </div>

      {/* Dev tools */}
      {isDev() && (
        <div
          style={{
            padding: '8px 10px',
            borderTop: '1px solid var(--theme-border, rgba(0,0,0,0.08))',
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            background: 'rgba(0,0,0,0.02)',
            fontSize: 11,
          }}
        >
          <span style={{ color: 'var(--theme-text-muted, #888)' }}>dev</span>
          <button
            type="button"
            onClick={fireSamples}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '3px 10px',
              borderRadius: 5,
              border: '1px solid rgba(0,0,0,0.15)',
              background: '#fff',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Fire test notifications
          </button>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '3px 8px',
        borderRadius: 5,
        border: '1px solid rgba(0,0,0,0.12)',
        background: active ? color ?? 'var(--theme-accent, #3478F6)' : 'transparent',
        color: active ? '#fff' : 'inherit',
        cursor: 'pointer',
        textTransform: 'capitalize',
        fontFamily: 'inherit',
        lineHeight: 1.2,
      }}
    >
      {label}
    </button>
  );
}

function Row({ notification }: { notification: BerryNotification }) {
  const accent = LEVEL_COLORS[notification.level ?? 'info'];
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '8px 10px',
        marginBottom: 4,
        background: '#fff',
        border: '1px solid rgba(0,0,0,0.06)',
        borderLeft: `3px solid ${notification.dismissed ? 'rgba(0,0,0,0.12)' : accent}`,
        borderRadius: 6,
        opacity: notification.dismissed ? 0.65 : 1,
      }}
    >
      <div
        aria-hidden
        style={{ fontSize: 16, lineHeight: 1, marginTop: 1, width: 18, textAlign: 'center' }}
      >
        {typeof notification.icon === 'string' ? notification.icon : '🔔'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{notification.title}</div>
        {notification.body && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--theme-text-secondary, #5a5a5f)',
              lineHeight: 1.35,
              wordBreak: 'break-word',
              marginTop: 1,
            }}
          >
            {notification.body}
          </div>
        )}
        <div
          style={{
            fontSize: 10,
            color: 'var(--theme-text-muted, #999)',
            marginTop: 4,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <span>{notification.appId}</span>
          <span>·</span>
          <span>{formatTime(notification.timestamp)}</span>
          {notification.action && (
            <button
              type="button"
              onClick={() => notification.action?.onClick()}
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: accent,
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: 0.3,
                fontFamily: 'inherit',
              }}
            >
              {notification.action.label}
            </button>
          )}
          {!notification.dismissed && (
            <button
              type="button"
              onClick={() => dismiss(notification.id)}
              style={{
                fontSize: 10,
                color: 'var(--theme-text-muted, #999)',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                marginLeft: 'auto',
                fontFamily: 'inherit',
              }}
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Self-registration
//
// Try to register with `berryRegistry` if the other agent has already shipped
// it. The registry isn't on disk yet, so we look it up off `globalThis` /
// `window` to avoid a hard dependency. When the registry lands and exposes
// itself there, this lights up automatically. If it doesn't, you can still
// add the app to `apps/registry.tsx` manually.
// ---------------------------------------------------------------------------

interface BerryAppDescriptor {
  id: string;
  name: string;
  icon: string;
  component: ComponentType;
  defaultWindow?: { w: number; h: number };
  capabilities?: string[];
}

interface BerryRegistryGlobal {
  register(descriptor: BerryAppDescriptor): void;
  list?(): readonly BerryAppDescriptor[];
}

declare global {
  interface Window {
    berryRegistry?: BerryRegistryGlobal;
  }
}

function tryRegister(): void {
  const reg =
    typeof window !== 'undefined' ? window.berryRegistry : undefined;
  if (!reg || typeof reg.register !== 'function') return;
  try {
    reg.register({
      id: 'notifications',
      name: 'Notifications',
      icon: '🔔',
      component: NotificationsApp,
      defaultWindow: { w: 460, h: 520 },
      capabilities: ['notifications'],
    });
  } catch {
    // If the registry rejects (e.g. duplicate id on HMR) just ignore — the app
    // is still usable via the legacy `APP_REGISTRY`.
  }
}

tryRegister();
