/**
 * BerryOS toast stack — top-right floating notifications.
 *
 * Subscribes to `notification:posted` and renders incoming notifications as
 * stacked cards (max 5 visible). Auto-dismisses based on level:
 *   - info     → 3s
 *   - success  → 4s
 *   - warning  → 6s
 *   - error    → sticky (manual dismiss only)
 *
 * Z-index sits above all windows but below permission prompts. Mount once in
 * BerryShell/index.tsx (see drop-in note at the bottom of this file).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';

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

const ACCENT_BY_LEVEL: Record<NotificationLevel, string> = {
  info: '#3478F6',
  success: '#34C759',
  warning: '#FF9F0A',
  error: '#FF3B30',
};

const ICON_FALLBACK_BY_LEVEL: Record<NotificationLevel, string> = {
  info: '🔔',
  success: '✅',
  warning: '⚠️',
  error: '🚫',
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
        // De-dupe in case of rapid double-emit.
        if (prev.some(t => t.notification.id === fresh.id)) return prev;
        const next = [...prev, { notification: fresh, shown: false }];
        // Cap to MAX_VISIBLE, drop the oldest.
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
        top: 32,
        right: 12,
        // Above all windows (max ~9999) but below permission prompts (10100).
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
        maxWidth: 340,
      }}
    >
      {toasts.map(toast => (
        <ToastCard
          key={toast.notification.id}
          notification={toast.notification}
          shown={toast.shown}
          onDismiss={() => handleDismiss(toast.notification.id)}
          onAutoDismiss={() => removeToast(toast.notification.id)}
        />
      ))}
    </div>
  );
}

interface ToastCardProps {
  notification: BerryNotification;
  shown: boolean;
  onDismiss: () => void;
  onAutoDismiss: () => void;
}

function ToastCard({ notification, shown, onDismiss, onAutoDismiss }: ToastCardProps) {
  const level: NotificationLevel = notification.level ?? 'info';
  const timeoutMs = TIMEOUT_BY_LEVEL[level];

  // Auto-dismiss timer — paused on hover.
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (timeoutMs == null) return;
    if (hovered) return;
    const id = window.setTimeout(() => {
      // Soft removal — keep entry in store, just remove from visible stack.
      onAutoDismiss();
    }, timeoutMs);
    return () => window.clearTimeout(id);
  }, [hovered, timeoutMs, onAutoDismiss]);

  const accent = ACCENT_BY_LEVEL[level];
  const icon: ReactNode =
    notification.icon != null ? (notification.icon as ReactNode) : ICON_FALLBACK_BY_LEVEL[level];

  function handleBodyClick() {
    if (notification.action) {
      notification.action.onClick();
      onDismiss();
    }
  }

  return (
    <div
      role="status"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        // Slide in from the top with a subtle bounce.
        transform: shown ? 'translateY(0) scale(1)' : 'translateY(-20px) scale(0.96)',
        opacity: shown ? 1 : 0,
        transition: 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 180ms ease',
        pointerEvents: 'auto',
        background: 'rgba(252, 250, 245, 0.97)',
        backdropFilter: 'blur(20px) saturate(160%)',
        WebkitBackdropFilter: 'blur(20px) saturate(160%)',
        border: '1px solid rgba(0, 0, 0, 0.08)',
        borderLeft: `3px solid ${accent}`,
        borderRadius: 8,
        boxShadow:
          '0 6px 20px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.9)',
        padding: '10px 12px',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        fontFamily: 'var(--theme-font-display, -apple-system, BlinkMacSystemFont, sans-serif)',
        color: 'var(--theme-text-primary, #1d1d1f)',
        minWidth: 280,
        cursor: notification.action ? 'pointer' : 'default',
      }}
      onClick={handleBodyClick}
      onMouseDown={e => {
        // Prevent click from firing when interacting with the X.
        if ((e.target as HTMLElement).closest('[data-toast-close]')) e.stopPropagation();
      }}
    >
      <div
        aria-hidden="true"
        style={{
          fontSize: 18,
          lineHeight: 1,
          marginTop: 1,
          flexShrink: 0,
          width: 20,
          textAlign: 'center',
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.3,
            marginBottom: notification.body ? 2 : 0,
            wordWrap: 'break-word',
          }}
        >
          {notification.title}
        </div>
        {notification.body && (
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.35,
              color: 'var(--theme-text-secondary, #5a5a5f)',
              wordWrap: 'break-word',
            }}
          >
            {notification.body}
          </div>
        )}
        {notification.action && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: accent,
              marginTop: 4,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
            }}
          >
            {notification.action.label} ›
          </div>
        )}
      </div>
      <button
        data-toast-close
        type="button"
        aria-label="Dismiss notification"
        onClick={e => {
          e.stopPropagation();
          onDismiss();
        }}
        style={{
          flexShrink: 0,
          width: 18,
          height: 18,
          borderRadius: 9,
          background: 'transparent',
          border: 'none',
          color: 'var(--theme-text-muted, #888)',
          fontSize: 14,
          lineHeight: 1,
          cursor: 'pointer',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 120ms ease, color 120ms ease',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(0, 0, 0, 0.08)';
          e.currentTarget.style.color = 'var(--theme-text-primary, #1d1d1f)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--theme-text-muted, #888)';
        }}
      >
        ×
      </button>
    </div>
  );
}

/*
 * Drop-in for BerryShell/index.tsx:
 *
 *   import ToastStack from './system/ToastStack';
 *   ...
 *   <ToastStack />   // mount inside the root <div>, anywhere after the menu bar.
 */
