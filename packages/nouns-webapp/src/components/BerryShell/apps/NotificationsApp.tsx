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

import { GlassButton, GlassChip, GlassPanel, GlassToolbar } from '@/liquid-sand/glass';
import { Bell, ChatBubble, Coin, Info, Megaphone, Sparkle } from '@/liquid-sand/icons';

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

const LEVEL_TONE: Record<NotificationLevel, 'accent' | 'success' | 'danger' | 'neutral'> = {
  info: 'accent',
  success: 'success',
  warning: 'neutral',
  error: 'danger',
};

const LEVEL_COLOR: Record<NotificationLevel, string> = {
  info: 'var(--ls-accent)',
  success: 'var(--ls-success)',
  warning: 'var(--ls-sand-500)',
  error: 'var(--ls-danger)',
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
      className="flex flex-col h-full"
      style={{
        fontFamily: 'var(--ls-font-sans)',
        color: 'var(--ls-fg-primary)',
      }}
    >
      {/* Filter bar */}
      <div className="p-2.5">
        <GlassToolbar size="md" align="start" className="w-full flex-wrap">
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
          <span className="mx-1" style={{ width: 1, height: 16, background: 'var(--ls-border-glass)' }} />
          {LEVELS.map(level => (
            <FilterChip
              key={level}
              label={level}
              dot={LEVEL_COLOR[level]}
              active={filter.kind === 'level' && filter.level === level}
              onClick={() => setFilter({ kind: 'level', level })}
            />
          ))}
          {apps.length > 0 && (
            <>
              <span className="mx-1" style={{ width: 1, height: 16, background: 'var(--ls-border-glass)' }} />
              <select
                value={filter.kind === 'app' ? filter.appId : ''}
                onChange={e => {
                  if (!e.target.value) setFilter({ kind: 'all' });
                  else setFilter({ kind: 'app', appId: e.target.value });
                }}
                style={{
                  fontSize: 11,
                  fontFamily: 'inherit',
                  padding: '2px 8px',
                  borderRadius: 'var(--ls-r-md)',
                  border: '1px solid var(--ls-border-glass)',
                  background: 'var(--ls-glass-light-strong)',
                  color: 'var(--ls-fg-primary)',
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
          <span className="flex-1 min-w-0" />
          <GlassButton
            variant="ghost"
            size="sm"
            disabled={all.length === 0}
            onClick={() => clearAll()}
          >
            Clear all
          </GlassButton>
        </GlassToolbar>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2.5 pb-2.5 flex flex-col gap-2">
        {filtered.length === 0 ? (
          <div
            className="text-center"
            style={{
              padding: 32,
              color: 'var(--ls-fg-muted)',
              fontSize: 'var(--ls-text-sm)',
            }}
          >
            <Bell size={28} style={{ marginBottom: 8, opacity: 0.5 }} />
            <div>No notifications</div>
          </div>
        ) : (
          filtered.map(n => <Row key={n.id} notification={n} />)
        )}
      </div>

      {/* Dev tools */}
      {isDev() && (
        <div
          className="p-2.5"
          style={{
            borderTop: '1px solid var(--ls-border-glass)',
            background: 'var(--ls-glass-tint)',
          }}
        >
          <div className="flex gap-2 items-center">
            <GlassChip tone="accent" size="xs">
              dev
            </GlassChip>
            <GlassButton variant="default" size="sm" onClick={fireSamples}>
              <Sparkle size={12} />
              Fire test notifications
            </GlassButton>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  dot,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  dot?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 select-none"
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '4px 10px',
        borderRadius: 'var(--ls-r-full)',
        border: '1px solid var(--ls-border-glass)',
        background: active ? 'var(--ls-accent)' : 'transparent',
        color: active ? 'var(--ls-fg-on-dark)' : 'var(--ls-fg-secondary)',
        cursor: 'pointer',
        textTransform: 'capitalize',
        fontFamily: 'inherit',
        boxShadow: active
          ? 'var(--ls-shadow-inset-glass), var(--ls-shadow-glow)'
          : 'none',
        transition:
          'background-color var(--ls-dur-base) var(--ls-ease-soft), color var(--ls-dur-base) var(--ls-ease-soft)',
      }}
    >
      {dot && (
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: 'var(--ls-r-full)',
            background: dot,
          }}
        />
      )}
      {label}
    </button>
  );
}

function levelIcon(level: NotificationLevel | undefined) {
  switch (level) {
    case 'success':
      return <Sparkle size={16} />;
    case 'warning':
    case 'error':
      return <Megaphone size={16} />;
    case 'info':
    default:
      return <Info size={16} />;
  }
}

function fallbackIcon(appId: string, level: NotificationLevel | undefined) {
  if (appId === 'auction') return <Coin size={16} />;
  if (appId === 'notifications') return <ChatBubble size={16} />;
  return levelIcon(level);
}

function Row({ notification }: { notification: BerryNotification }) {
  const accent = LEVEL_COLOR[notification.level ?? 'info'];
  return (
    <GlassPanel
      padded={false}
      radius="md"
      tone="auto"
      className="flex gap-2.5 px-3 py-2.5"
      style={{
        opacity: notification.dismissed ? 0.6 : 1,
        borderLeft: `3px solid ${notification.dismissed ? 'var(--ls-border-glass)' : accent}`,
      }}
    >
      <div
        aria-hidden
        className="flex-shrink-0 flex items-center justify-center"
        style={{
          width: 22,
          height: 22,
          marginTop: 1,
          color: accent,
        }}
      >
        {fallbackIcon(notification.appId, notification.level)}
      </div>
      <div className="flex-1 min-w-0">
        <div style={{ fontSize: 'var(--ls-text-sm)', fontWeight: 600, lineHeight: 1.3 }}>
          {notification.title}
        </div>
        {notification.body && (
          <div
            style={{
              fontSize: 'var(--ls-text-xs)',
              color: 'var(--ls-fg-secondary)',
              lineHeight: 1.35,
              wordBreak: 'break-word',
              marginTop: 1,
            }}
          >
            {notification.body}
          </div>
        )}
        <div
          className="flex gap-2 items-center mt-1.5"
          style={{
            fontSize: 10,
            color: 'var(--ls-fg-muted)',
          }}
        >
          <GlassChip
            tone={LEVEL_TONE[notification.level ?? 'info']}
            size="xs"
          >
            {notification.appId}
          </GlassChip>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(notification.timestamp)}
          </span>
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
                letterSpacing: 0.5,
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
                color: 'var(--ls-fg-muted)',
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
    </GlassPanel>
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
