/**
 * Menu-bar bell — toggles the Notification Center, shows an unread badge,
 * pulses briefly when a new notification arrives.
 *
 * This component is intentionally self-contained so it can be slotted into
 * the existing menu bar with a one-liner. See drop-in note at the bottom.
 */

import { useEffect, useState } from 'react';

import { useBerryEvent } from './eventBus';
import { useUnreadCount } from './notifications';
import {
  notificationCenterStore,
  useNotificationCenterOpen,
} from './notificationCenterStore';

export default function MenuBarNotificationBell() {
  const unread = useUnreadCount();
  const isOpen = useNotificationCenterOpen();
  const [pulse, setPulse] = useState(false);

  // Briefly pulse for 2s whenever a new notification arrives.
  useBerryEvent(
    'notification:posted',
    () => {
      setPulse(true);
      const id = window.setTimeout(() => setPulse(false), 2000);
      return () => window.clearTimeout(id);
    },
    [],
  );

  // Cleanup any in-flight pulse timer on unmount.
  useEffect(() => {
    if (!pulse) return;
    const id = window.setTimeout(() => setPulse(false), 2000);
    return () => window.clearTimeout(id);
  }, [pulse]);

  return (
    <button
      type="button"
      data-berry-bell
      aria-label={
        unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'
      }
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      onClick={() => notificationCenterStore.toggle()}
      style={{
        position: 'relative',
        height: 18,
        minWidth: 22,
        padding: '0 5px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isOpen ? 'var(--theme-accent, #3478F6)' : 'transparent',
        color: isOpen ? '#fff' : 'var(--theme-text-primary, #1d1d1f)',
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
        fontFamily: 'var(--theme-font-display, -apple-system, sans-serif)',
        fontSize: 13,
        lineHeight: 1,
        userSelect: 'none',
        transition: 'background 120ms ease, color 120ms ease, transform 200ms ease',
        transform: pulse ? 'scale(1.18)' : 'scale(1)',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 13 }}>
        🔔
      </span>
      {unread > 0 && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            minWidth: 14,
            height: 14,
            padding: '0 3px',
            borderRadius: 7,
            background: '#FF3B30',
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
            lineHeight: '14px',
            textAlign: 'center',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.85)',
          }}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
}

/*
 * Drop-in for BerryShell/index.tsx — render anywhere inside the right-hand
 * cluster of the menu bar (next to the ConnectKit button / ThemeSwitcher /
 * MenuBarClock). Single line, no other change needed:
 *
 *   import MenuBarNotificationBell from './system/MenuBarNotificationBell';
 *   ...
 *   <MenuBarNotificationBell />
 *
 * Recommended placement (BerryShell/index.tsx, between ThemeSwitcher (line
 * 358) and MenuBarClock (line 359) inside the right-hand cluster):
 *
 *   <ThemeSwitcher variant="navbar" />
 *   <MenuBarNotificationBell />     // ← add here
 *   <MenuBarClock />
 */
