/**
 * Menu-bar bell — toggles the Notification Center, shows an unread badge,
 * pulses with a subtle warm glow when a new notification arrives.
 *
 * Liquid Sand chrome: monoline `<Bell>` icon, sand-tone unread badge, glass
 * hover surface.
 */

import { useEffect, useState } from 'react';

import { Bell } from '@/liquid-sand/icons';
import { BlendIcon } from '@/liquid-sand/inversion';

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

  // Glow when there are unread notifications, intensify briefly on pulse.
  const hasUnread = unread > 0;
  const filter = pulse
    ? 'drop-shadow(0 0 8px rgba(184,147,82,0.85))'
    : hasUnread
      ? 'drop-shadow(0 0 4px rgba(184,147,82,0.6))'
      : 'none';

  return (
    <button
      type="button"
      data-berry-bell
      aria-label={
        hasUnread ? `Notifications (${unread} unread)` : 'Notifications'
      }
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      onClick={() => notificationCenterStore.toggle()}
      style={{
        position: 'relative',
        height: 22,
        minWidth: 26,
        padding: '0 5px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isOpen ? 'var(--ls-glass-light-strong)' : 'transparent',
        color: 'var(--ls-fg-primary)',
        border: 'none',
        borderRadius: 'var(--ls-r-sm)',
        cursor: 'pointer',
        fontFamily: 'var(--ls-font-sans)',
        fontSize: 13,
        lineHeight: 1,
        userSelect: 'none',
        transition:
          'background var(--ls-dur-fast) var(--ls-ease-soft), transform var(--ls-dur-base) var(--ls-ease-spring), filter var(--ls-dur-base) var(--ls-ease-soft)',
        transform: pulse ? 'scale(1.15)' : 'scale(1)',
        filter,
      }}
    >
      <BlendIcon mode="difference">
        <Bell size={16} />
      </BlendIcon>
      {hasUnread && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: -1,
            right: -1,
            minWidth: 14,
            height: 14,
            padding: '0 3px',
            borderRadius: 7,
            background: 'var(--ls-danger)',
            color: 'var(--ls-fg-on-dark)',
            fontFamily: 'var(--ls-font-mono)',
            fontSize: 9,
            fontWeight: 700,
            lineHeight: '14px',
            textAlign: 'center',
            boxShadow:
              'var(--ls-shadow-sm), 0 0 0 1px var(--ls-border-glass)',
          }}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
}
