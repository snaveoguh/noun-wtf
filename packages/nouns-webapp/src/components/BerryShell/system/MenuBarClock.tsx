/**
 * MenuBarClock — live HH:MM clock widget for the BerryOS menu bar.
 *
 * Subscribes to `system:tick` when available; falls back to a 30s setInterval
 * (close enough to the minute boundary, cheap). Click to open the Clock app.
 *
 * Drop-in: import and render between the existing menu-bar widgets in
 * `BerryShell/index.tsx` (replacement for the local MenuBarClock there).
 */
import { useEffect, useState, type ReactElement } from 'react';

import { ALL_BERRY_EVENT_NAMES, berryBus } from './eventBus';
import { APP_REGISTRY } from '../apps/registry';
import { windowStore } from '../store/windowStore';

export default function MenuBarClock(): ReactElement {
  const [now, setNow] = useState(() => new Date());
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false,
  );

  useEffect(() => {
    const hasTick = ALL_BERRY_EVENT_NAMES.includes('system:tick' as never);
    if (hasTick) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const off = (berryBus as any).on('system:tick', () => setNow(new Date()));
      return () => off();
    }
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = now.toLocaleDateString([], { weekday: 'short' });

  function openClockApp(): void {
    const def = APP_REGISTRY.clock;
    if (!def) return;
    windowStore.open({
      appId: def.appId,
      title: def.title,
      icon: def.emoji,
      width: def.width,
      height: def.height,
    });
  }

  return (
    <button
      type="button"
      onClick={openClockApp}
      aria-label={`Clock — ${time}`}
      title="Open Clock"
      style={{
        fontFamily: 'var(--theme-font-display)',
        fontSize: 12,
        padding: '0 8px',
        height: '100%',
        color: 'var(--theme-text-primary)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--theme-accent)';
        e.currentTarget.style.color = '#fff';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--theme-text-primary)';
      }}
    >
      {compact ? time : `${day} ${time}`}
    </button>
  );
}
