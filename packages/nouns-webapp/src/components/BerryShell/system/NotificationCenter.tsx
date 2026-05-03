/**
 * Notification Center — Mac Mission Control style slide-out panel.
 *
 * Toggles via the menu bar bell. Lists notifications grouped by app
 * (collapsible sections), newest first. "Clear all" button at the top.
 *
 * Mount once in BerryShell/index.tsx (see drop-in note at the bottom of this
 * file). The panel renders in-flow (not portal'd) so it inherits the shell's
 * theme variables.
 */

import { useMemo, useState } from 'react';

import {
  clearAll,
  dismiss,
  useNotifications,
  type BerryNotification,
} from './notifications';
import {
  notificationCenterStore,
  useNotificationCenterOpen,
} from './notificationCenterStore';

const PANEL_WIDTH = 340;

const APP_EMOJI: Record<string, string> = {
  finder: '🍓',
  auction: '🪙',
  vote: '🗳️',
  candidates: '📜',
  settings: '⚙️',
  notifications: '🔔',
  system: '🖥️',
};

interface AppGroup {
  appId: string;
  notifications: BerryNotification[];
}

function groupByApp(items: BerryNotification[]): AppGroup[] {
  const map = new Map<string, BerryNotification[]>();
  // `useNotifications` returns newest-first; preserve that order.
  for (const n of items) {
    const list = map.get(n.appId);
    if (list) list.push(n);
    else map.set(n.appId, [n]);
  }
  return Array.from(map.entries()).map(([appId, notifications]) => ({ appId, notifications }));
}

function formatTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export default function NotificationCenter() {
  const isOpen = useNotificationCenterOpen();
  const notifications = useNotifications();
  const groups = useMemo(() => groupByApp(notifications), [notifications]);

  return (
    <>
      {/* Click-out scrim */}
      <div
        aria-hidden={!isOpen}
        onClick={() => notificationCenterStore.close()}
        style={{
          position: 'fixed',
          inset: 0,
          background: isOpen ? 'rgba(0, 0, 0, 0.18)' : 'transparent',
          opacity: isOpen ? 1 : 0,
          transition: 'opacity 200ms ease, background 200ms ease',
          pointerEvents: isOpen ? 'auto' : 'none',
          zIndex: 9990,
        }}
      />
      <aside
        aria-label="Notification Center"
        aria-hidden={!isOpen}
        style={{
          position: 'fixed',
          top: 24,
          right: 0,
          bottom: 0,
          width: PANEL_WIDTH,
          background: 'rgba(248, 246, 240, 0.96)',
          backdropFilter: 'blur(28px) saturate(180%)',
          WebkitBackdropFilter: 'blur(28px) saturate(180%)',
          borderLeft: '1px solid rgba(0, 0, 0, 0.10)',
          boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.18)',
          transform: isOpen ? 'translateX(0)' : `translateX(${PANEL_WIDTH + 12}px)`,
          transition: 'transform 260ms cubic-bezier(0.32, 0.72, 0, 1)',
          zIndex: 9995,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'var(--theme-font-display, -apple-system, BlinkMacSystemFont, sans-serif)',
          color: 'var(--theme-text-primary, #1d1d1f)',
        }}
      >
        <header
          style={{
            padding: '12px 14px',
            borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              margin: 0,
              letterSpacing: 0.2,
            }}
          >
            Notifications
          </h2>
          <button
            type="button"
            disabled={notifications.length === 0}
            onClick={() => clearAll()}
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: 6,
              border: '1px solid rgba(0, 0, 0, 0.12)',
              background: notifications.length === 0 ? 'transparent' : 'rgba(0, 0, 0, 0.04)',
              color:
                notifications.length === 0
                  ? 'var(--theme-text-muted, #999)'
                  : 'var(--theme-text-primary, #1d1d1f)',
              cursor: notifications.length === 0 ? 'default' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Clear all
          </button>
        </header>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {groups.length === 0 ? (
            <EmptyState />
          ) : (
            groups.map(group => <AppGroupSection key={group.appId} group={group} />)
          )}
        </div>
      </aside>
    </>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        margin: 'auto',
        padding: 24,
        textAlign: 'center',
        color: 'var(--theme-text-muted, #888)',
        fontSize: 13,
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.6 }} aria-hidden="true">
        🔔
      </div>
      No new notifications
    </div>
  );
}

function AppGroupSection({ group }: { group: AppGroup }) {
  const [collapsed, setCollapsed] = useState(false);
  const emoji = APP_EMOJI[group.appId] ?? '•';
  const undismissed = group.notifications.filter(n => !n.dismissed).length;

  return (
    <section
      style={{
        background: 'rgba(255, 255, 255, 0.7)',
        border: '1px solid rgba(0, 0, 0, 0.06)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          color: 'inherit',
          textAlign: 'left',
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 14 }}>
          {emoji}
        </span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, textTransform: 'capitalize' }}>
          {group.appId}
        </span>
        {undismissed > 0 && (
          <span
            style={{
              background: '#FF3B30',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: 8,
              minWidth: 16,
              textAlign: 'center',
            }}
          >
            {undismissed}
          </span>
        )}
        <span
          aria-hidden
          style={{
            fontSize: 10,
            color: 'var(--theme-text-muted, #888)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 160ms ease',
          }}
        >
          ▾
        </span>
      </button>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {group.notifications.map(n => (
            <NotificationRow key={n.id} notification={n} />
          ))}
        </div>
      )}
    </section>
  );
}

function NotificationRow({ notification }: { notification: BerryNotification }) {
  const accent =
    notification.level === 'error'
      ? '#FF3B30'
      : notification.level === 'warning'
        ? '#FF9F0A'
        : notification.level === 'success'
          ? '#34C759'
          : '#3478F6';
  return (
    <div
      style={{
        padding: '8px 10px',
        borderTop: '1px solid rgba(0, 0, 0, 0.05)',
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        opacity: notification.dismissed ? 0.55 : 1,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 4,
          alignSelf: 'stretch',
          background: notification.dismissed ? 'transparent' : accent,
          borderRadius: 2,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{notification.title}</div>
        {notification.body && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--theme-text-secondary, #5a5a5f)',
              lineHeight: 1.35,
              marginTop: 1,
              wordBreak: 'break-word',
            }}
          >
            {notification.body}
          </div>
        )}
        <div
          style={{
            fontSize: 10,
            color: 'var(--theme-text-muted, #999)',
            marginTop: 3,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
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

/*
 * Drop-in for BerryShell/index.tsx:
 *
 *   import NotificationCenter from './system/NotificationCenter';
 *   ...
 *   <NotificationCenter />   // mount once inside the root <div>.
 */
