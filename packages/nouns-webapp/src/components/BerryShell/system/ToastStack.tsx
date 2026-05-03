/**
 * BerryOS toast stack — top-right floating notifications.
 *
 * Liquid Sand chrome: each toast is a `<GlassToast>` with monoline icon
 * fallbacks and the warm sepia tone palette. Subscribes to
 * `notification:posted` and renders incoming notifications as stacked cards
 * (max 5 visible). Auto-dismisses based on level:
 *   - info     → 3s
 *   - success  → 4s
 *   - warning  → 6s
 *   - error    → sticky (manual dismiss only)
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { GlassToast, type GlassToastTone } from '@/liquid-sand/glass';
import {
  Bell,
  Close as CloseIcon,
  Info as InfoIcon,
} from '@/liquid-sand/icons';

import { useBerryEvent } from './eventBus';
import {
  dismiss as dismissNotification,
  notificationStore,
  type BerryNotification,
  type NotificationLevel,
} from './notifications';

const MAX_VISIBLE = 5;

const TIMEOUT_BY_LEVEL: Record<NotificationLevel, number | null> = {
  info: 3000,
  success: 4000,
  warning: 6000,
  error: null, // sticky
};

const TONE_BY_LEVEL: Record<NotificationLevel, GlassToastTone> = {
  info: 'accent',
  success: 'success',
  warning: 'accent',
  error: 'danger',
};

const ICON_FALLBACK_BY_LEVEL: Record<NotificationLevel, ReactNode> = {
  info: <InfoIcon size={18} />,
  success: <Bell size={18} />,
  warning: <Bell size={18} />,
  error: <CloseIcon size={18} />,
};

interface VisibleToast {
  notification: BerryNotification;
  /** Set to true once the slide-in animation has run, drives the open state. */
  shown: boolean;
}

function getNotificationById(id: string): BerryNotification | undefined {
  return notificationStore.getState().notifications.find(n => n.id === id);
}

export default function ToastStack() {
  const [toasts, setToasts] = useState<VisibleToast[]>([]);

  // Push new toasts on `notification:posted`.
  useBerryEvent(
    'notification:posted',
    payload => {
      const fresh = getNotificationById(payload.id);
      if (!fresh) return;
      setToasts(prev => {
        if (prev.some(t => t.notification.id === fresh.id)) return prev;
        const next = [...prev, { notification: fresh, shown: false }];
        return next.slice(-MAX_VISIBLE);
      });
    },
    [],
  );

  // Drop toasts that get dismissed elsewhere (notification center "clear all").
  useBerryEvent(
    'notification:dismissed',
    payload => {
      setToasts(prev => {
        if (payload.all) {
          if (payload.appId) return prev.filter(t => t.notification.appId !== payload.appId);
          return [];
        }
        if (payload.id) return prev.filter(t => t.notification.id !== payload.id);
        return prev;
      });
    },
    [],
  );

  // Trigger the open animation on the next frame after mount.
  useEffect(() => {
    if (!toasts.some(t => !t.shown)) return;
    const raf = requestAnimationFrame(() => {
      setToasts(prev => prev.map(t => (t.shown ? t : { ...t, shown: true })));
    });
    return () => cancelAnimationFrame(raf);
  }, [toasts]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.notification.id !== id));
  }, []);

  const handleDismiss = useCallback(
    (id: string) => {
      dismissNotification(id);
      removeToast(id);
    },
    [removeToast],
  );

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      style={{
        position: 'fixed',
        top: 36,
        right: 12,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
        maxWidth: 360,
      }}
    >
      {toasts.map(toast => (
        <GlassToastCard
          key={toast.notification.id}
          notification={toast.notification}
          onDismiss={() => handleDismiss(toast.notification.id)}
          onAutoDismiss={() => removeToast(toast.notification.id)}
        />
      ))}
    </div>
  );
}

interface GlassToastCardProps {
  notification: BerryNotification;
  onDismiss: () => void;
  onAutoDismiss: () => void;
}

function GlassToastCard({ notification, onDismiss, onAutoDismiss }: GlassToastCardProps) {
  const level: NotificationLevel = notification.level ?? 'info';
  const timeoutMs = TIMEOUT_BY_LEVEL[level];

  // Auto-dismiss timer — paused on hover.
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (timeoutMs == null) return;
    if (hovered) return;
    const id = window.setTimeout(() => {
      onAutoDismiss();
    }, timeoutMs);
    return () => window.clearTimeout(id);
  }, [hovered, timeoutMs, onAutoDismiss]);

  const tone = TONE_BY_LEVEL[level];
  const icon: ReactNode =
    notification.icon != null
      ? (notification.icon as ReactNode)
      : ICON_FALLBACK_BY_LEVEL[level];

  function handleBodyClick() {
    if (notification.action) {
      notification.action.onClick();
      onDismiss();
    }
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        pointerEvents: 'auto',
        cursor: notification.action ? 'pointer' : 'default',
      }}
      onClick={handleBodyClick}
      onMouseDown={e => {
        if ((e.target as HTMLElement).closest('[data-toast-close]')) e.stopPropagation();
      }}
    >
      <GlassToast
        tone={tone}
        icon={icon}
        title={notification.title}
        body={notification.body}
        action={
          notification.action ? (
            <span
              style={{
                fontFamily: 'var(--ls-font-mono)',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--ls-accent)',
                textTransform: 'uppercase',
                letterSpacing: 0.4,
              }}
            >
              {notification.action.label}
            </span>
          ) : undefined
        }
        onDismiss={() => {
          onDismiss();
        }}
      />
    </div>
  );
}
