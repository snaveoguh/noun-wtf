/**
 * NotificationsApp — draggable-window twin of the slide-out Notification
 * Center. Adds filters (All / Unread / By App / By Level) and, in dev mode,
 * a "Test notifications" button that fires one of each level.
 *
 * HIG / Liquid Sand notes:
 *   - Filter strip lives in a single <GlassToolbar>. The level filters and
 *     "All / Unread" are in <GlassTabs> for the segmented pill feel.
 *   - The "By app" select is a sand-tone control (no nested glass over
 *     the toolbar's glass surface — that would fail HIG glass-stacking).
 *   - Notification rows are SOLID sand panels with a colored leading border
 *     so the body stays readable. Glass over text is a HIG no-go.
 *   - Empty state: centered Bell + "All caught up" copy in muted-1.
 *
 * Self-registers with `berryRegistry` if it exists at import time. The
 * registry is being built by another agent; if it isn't there yet, we
 * silently skip — the app can still be opened by adding it to the
 * existing `apps/registry.tsx` list as a normal entry.
 */

import { useMemo, useState, type ComponentType } from 'react';

import { GlassButton, GlassChip, GlassTabs, GlassToolbar } from '@/liquid-sand/glass';
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

/** Encode the current filter as a single string for <GlassTabs value=...>. */
function encodeFilter(f: Filter): string {
  if (f.kind === 'all') return 'all';
  if (f.kind === 'unread') return 'unread';
  if (f.kind === 'level') return `level:${f.level}`;
  return `app:${f.appId}`;
}

export default function NotificationsApp() {
  const all = useNotifications();
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });

  const filtered = useMemo(() => all.filter(n => matches(n, filter)), [all, filter]);
  const apps = useMemo(() => uniqueAppIds(all), [all]);

  const onTabsChange = (value: string) => {
    if (value === 'all') return setFilter({ kind: 'all' });
    if (value === 'unread') return setFilter({ kind: 'unread' });
    if (value.startsWith('level:')) {
      return setFilter({ kind: 'level', level: value.slice(6) as NotificationLevel });
    }
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{
        fontFamily: 'var(--ls-font-sans)',
        color: 'var(--ls-fg-primary)',
      }}
    >
      {/* Filter bar — 16pt content padding per HIG 8pt grid. The toolbar is
          the ONE glass surface here; chips/tabs ride on top without nesting. */}
      <div style={{ padding: 16, paddingBottom: 8 }}>
        <GlassToolbar size="md" align="start" className="w-full flex-wrap">
          <GlassTabs
            size="sm"
            value={encodeFilter(filter)}
            onValueChange={onTabsChange}
            aria-label="Notification filter"
          >
            <GlassTabs.Item value="all">All</GlassTabs.Item>
            <GlassTabs.Item value="unread">Unread</GlassTabs.Item>
            {LEVELS.map(level => (
              <GlassTabs.Item key={level} value={`level:${level}`}>
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: 'var(--ls-r-full)',
                    background: LEVEL_COLOR[level],
                    marginRight: 6,
                  }}
                />
                <span style={{ textTransform: 'capitalize' }}>{level}</span>
              </GlassTabs.Item>
            ))}
          </GlassTabs>
          {apps.length > 0 && (
            <>
              <span
                aria-hidden
                style={{ width: 1, height: 16, background: 'var(--ls-border-glass)', margin: '0 4px' }}
              />
              {/* Solid sand control — no nested glass over the toolbar surface. */}
              <select
                value={filter.kind === 'app' ? filter.appId : ''}
                onChange={e => {
                  if (!e.target.value) setFilter({ kind: 'all' });
                  else setFilter({ kind: 'app', appId: e.target.value });
                }}
                aria-label="Filter by app"
                style={{
                  fontSize: 'var(--ls-text-xs)',
                  lineHeight: 1.4,
                  fontFamily: 'inherit',
                  padding: '6px 10px',
                  borderRadius: 'var(--ls-r-md)',
                  border: '1px solid var(--ls-border-glass)',
                  background: 'var(--ls-sand-100)',
                  color: 'var(--ls-fg-primary)',
                  minHeight: 32,
                  cursor: 'pointer',
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

      {/* List — 16pt edge padding, 8pt item gap */}
      <div className="flex-1 overflow-y-auto flex flex-col" style={{ padding: '0 16px 16px', gap: 8 }}>
        {filtered.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          filtered.map(n => <Row key={n.id} notification={n} />)
        )}
      </div>

      {/* Dev tools — solid sand band so the dev panel doesn't nest more glass */}
      {isDev() && (
        <div
          style={{
            padding: 16,
            borderTop: '1px solid var(--ls-border-glass)',
            background: 'var(--ls-sand-100)',
          }}
        >
          <div className="flex items-center" style={{ gap: 8 }}>
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

function EmptyState({ filter }: { filter: Filter }) {
  // Tailor copy slightly to the filter so an empty unread bucket reads as
  // "all caught up" rather than implying nothing ever arrived.
  const copy =
    filter.kind === 'unread' || filter.kind === 'all'
      ? 'All caught up'
      : 'No notifications match this filter';
  return (
    <div
      role="status"
      className="flex-1 flex flex-col items-center justify-center text-center"
      style={{
        padding: 32,
        gap: 12,
        color: 'var(--ls-fg-muted)',
      }}
    >
      <div
        aria-hidden
        className="inline-flex items-center justify-center"
        style={{
          width: 56,
          height: 56,
          borderRadius: 'var(--ls-r-full)',
          background: 'var(--ls-sand-100)',
          color: 'var(--ls-fg-muted)',
          boxShadow: 'inset 0 1px 0 rgba(255,250,240,0.8), 0 0 0 1px var(--ls-border-glass)',
        }}
      >
        <Bell size={26} />
      </div>
      <div
        style={{
          fontFamily: 'var(--ls-font-sans)',
          fontSize: 'var(--ls-text-lg)',
          lineHeight: 1.3,
          fontWeight: 600,
          color: 'var(--ls-fg-secondary)',
        }}
      >
        {copy}
      </div>
      <div
        style={{
          fontSize: 'var(--ls-text-sm)',
          lineHeight: 1.4,
        }}
      >
        New activity will land here as it happens.
      </div>
    </div>
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
    // Solid sand surface — no nested glass over text. A colored leading
    // border carries the level signal without competing with the body type.
    <div
      className="flex"
      style={{
        opacity: notification.dismissed ? 0.6 : 1,
        background: 'var(--ls-sand-50)',
        borderRadius: 'var(--ls-r-md)',
        border: '1px solid var(--ls-border-glass)',
        borderLeftWidth: 3,
        borderLeftColor: notification.dismissed ? 'var(--ls-border-glass)' : accent,
        padding: 16,
        gap: 12,
      }}
    >
      <div
        aria-hidden
        className="flex-shrink-0 flex items-center justify-center"
        style={{
          width: 24,
          height: 24,
          color: accent,
        }}
      >
        {fallbackIcon(notification.appId, notification.level)}
      </div>
      <div className="flex-1 min-w-0">
        <div style={{ fontSize: 'var(--ls-text-md)', fontWeight: 600, lineHeight: 1.3 }}>
          {notification.title}
        </div>
        {notification.body && (
          <div
            style={{
              fontSize: 'var(--ls-text-sm)',
              color: 'var(--ls-fg-secondary)',
              lineHeight: 1.4,
              wordBreak: 'break-word',
              marginTop: 4,
            }}
          >
            {notification.body}
          </div>
        )}
        <div
          className="flex items-center"
          style={{
            fontSize: 'var(--ls-text-xs)',
            lineHeight: 1.4,
            color: 'var(--ls-fg-muted)',
            marginTop: 8,
            gap: 8,
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
          <span className="ml-auto inline-flex" style={{ gap: 4 }}>
            {notification.action && (
              <GlassButton
                variant="ghost"
                size="sm"
                onClick={() => notification.action?.onClick()}
                style={{ color: accent }}
              >
                {notification.action.label}
              </GlassButton>
            )}
            {!notification.dismissed && (
              <GlassButton
                variant="ghost"
                size="sm"
                onClick={() => dismiss(notification.id)}
                aria-label={`Dismiss ${notification.title}`}
              >
                Dismiss
              </GlassButton>
            )}
          </span>
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
