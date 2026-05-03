/**
 * Notification Center — Mac Mission Control style slide-out panel.
 *
 * Liquid Sand chrome: slides in from the right as a `<GlassPanel>`. Each
 * notification row is rendered with the same warm sepia tone family as the
 * <GlassToast> floating cards, grouped by app.
 *
 * Toggles via the menu bar bell. Lists notifications grouped by app
 * (collapsible sections), newest first. "Clear all" button at the top.
 */

import { useEffect, useMemo, useState, type ComponentType } from 'react';

import { GlassButton, GlassChip, GlassPanel } from '@/liquid-sand/glass';
import {
  Bell,
  Coin,
  CpuChip,
  Diamond,
  Document,
  Folder,
  Settings as SettingsIcon,
} from '@/liquid-sand/icons';

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

type IconComp = ComponentType<{ size?: number | string }>;

const APP_ICON: Record<string, IconComp> = {
  finder: Folder,
  auction: Coin,
  vote: Diamond,
  candidates: Document,
  settings: SettingsIcon,
  notifications: Bell,
  system: CpuChip,
};

interface AppGroup {
  appId: string;
  notifications: BerryNotification[];
}

function groupByApp(items: BerryNotification[]): AppGroup[] {
  const map = new Map<string, BerryNotification[]>();
  for (const n of items) {
    const list = map.get(n.appId);
    if (list) list.push(n);
    else map.set(n.appId, [n]);
  }
  return Array.from(map.entries()).map(([appId, notifications]) => ({
    appId,
    notifications,
  }));
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

  // ESC closes the panel — matches HIG slide-out dismissal behaviour.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        notificationCenterStore.close();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  return (
    <>
      {/* Click-out scrim — sand-tone veil. */}
      <div
        aria-hidden={!isOpen}
        onClick={() => notificationCenterStore.close()}
        style={{
          position: 'fixed',
          inset: 0,
          background: isOpen ? 'rgba(60, 45, 25, 0.18)' : 'transparent',
          opacity: isOpen ? 1 : 0,
          transition:
            'opacity var(--ls-dur-base) var(--ls-ease-soft), background var(--ls-dur-base) var(--ls-ease-soft)',
          pointerEvents: isOpen ? 'auto' : 'none',
          zIndex: 9990,
        }}
      />
      <GlassPanel
        as="aside"
        blur="extreme"
        radius="md"
        bordered={false}
        aria-label="Notification Center"
        aria-hidden={!isOpen}
        style={{
          position: 'fixed',
          top: 28,
          right: 0,
          bottom: 0,
          width: PANEL_WIDTH,
          borderTopLeftRadius: 'var(--ls-r-lg)',
          borderBottomLeftRadius: 'var(--ls-r-lg)',
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          borderLeft: '1px solid var(--ls-border-glass)',
          boxShadow:
            'var(--ls-shadow-inset-glass), -8px 0 32px rgba(60, 45, 25, 0.18)',
          transform: isOpen
            ? 'translateX(0)'
            : `translateX(${PANEL_WIDTH + 12}px)`,
          transition:
            'transform var(--ls-dur-slow) var(--ls-ease-glide)',
          zIndex: 9995,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'var(--ls-font-sans)',
          color: 'var(--ls-fg-primary)',
        }}
      >
        <header
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--ls-border-glass)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* HIG: panel headers sit at body size (17pt) for clear scan. */}
          <h2
            style={{
              fontSize: 'var(--ls-text-lg)' /* 17pt */,
              fontWeight: 600,
              margin: 0,
              letterSpacing: 0.1,
              color: 'var(--ls-fg-primary)',
            }}
          >
            Notifications
          </h2>
          <GlassButton
            variant="ghost"
            size="sm"
            disabled={notifications.length === 0}
            onClick={() => clearAll()}
          >
            Clear all
          </GlassButton>
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
            groups.map(group => (
              <AppGroupSection key={group.appId} group={group} />
            ))
          )}
        </div>
      </GlassPanel>
    </>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        margin: 'auto',
        padding: 32,
        textAlign: 'center',
        color: 'var(--ls-fg-muted)',
        fontSize: 'var(--ls-text-sm)' /* 13pt */,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        opacity: 0.85,
      }}
    >
      <Bell size={32} />
      <div style={{ fontSize: 'var(--ls-text-lg)', fontWeight: 500, color: 'var(--ls-fg-secondary)' }}>
        No new notifications
      </div>
      <div style={{ fontSize: 'var(--ls-text-xs)', color: 'var(--ls-fg-muted)' }}>
        You're all caught up.
      </div>
    </div>
  );
}

function AppGroupSection({ group }: { group: AppGroup }) {
  const [collapsed, setCollapsed] = useState(false);
  const Icon = APP_ICON[group.appId] ?? Document;
  const undismissed = group.notifications.filter(n => !n.dismissed).length;

  return (
    <GlassPanel
      as="section"
      blur="medium"
      radius="md"
      bordered
      style={{
        overflow: 'hidden',
        padding: 0,
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
          color: 'var(--ls-fg-primary)',
          textAlign: 'left',
        }}
      >
        <Icon size={14} />
        <span
          style={{
            flex: 1,
            fontSize: 12,
            fontWeight: 600,
            textTransform: 'capitalize',
          }}
        >
          {group.appId}
        </span>
        {undismissed > 0 && (
          <GlassChip tone="danger" size="xs">
            {undismissed}
          </GlassChip>
        )}
        <span
          aria-hidden
          style={{
            fontSize: 10,
            color: 'var(--ls-fg-muted)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform var(--ls-dur-fast) var(--ls-ease-soft)',
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
    </GlassPanel>
  );
}

function NotificationRow({ notification }: { notification: BerryNotification }) {
  const accent =
    notification.level === 'error'
      ? 'var(--ls-danger)'
      : notification.level === 'warning'
        ? 'var(--ls-sand-500)'
        : notification.level === 'success'
          ? 'var(--ls-success)'
          : 'var(--ls-accent)';
  return (
    <div
      style={{
        padding: '8px 10px',
        borderTop: '1px solid var(--ls-border-glass)',
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        opacity: notification.dismissed ? 0.55 : 1,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 3,
          alignSelf: 'stretch',
          background: notification.dismissed ? 'transparent' : accent,
          borderRadius: 2,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* HIG: notification title at 13pt label size, body at 11pt caption. */}
        <div
          style={{
            fontSize: 'var(--ls-text-sm)' /* 13pt */,
            fontWeight: 600,
            lineHeight: 1.3,
            color: 'var(--ls-fg-primary)',
          }}
        >
          {notification.title}
        </div>
        {notification.body && (
          <div
            style={{
              fontSize: 'var(--ls-text-xs)' /* 11pt caption */,
              color: 'var(--ls-fg-secondary)',
              lineHeight: 1.4,
              marginTop: 2,
              wordBreak: 'break-word',
            }}
          >
            {notification.body}
          </div>
        )}
        <div
          style={{
            fontSize: 10,
            color: 'var(--ls-fg-muted)',
            marginTop: 4,
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
    </div>
  );
}
