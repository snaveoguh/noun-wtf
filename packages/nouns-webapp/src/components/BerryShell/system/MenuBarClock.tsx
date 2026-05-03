/**
 * MenuBarClock — live HH:MM clock widget for the BerryOS menu bar.
 *
 * Liquid Sand chrome: tabular-nums in the JetBrains Mono token font, glass
 * hover lift on the menu bar surface. Subscribes to `system:tick` when
 * available; falls back to a 30s setInterval. Click to open the Clock app.
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
        // Mono + tabular-nums so the time slot doesn't shimmy on each tick.
        fontFamily: 'var(--ls-font-mono)',
        fontVariantNumeric: 'tabular-nums',
        fontSize: 12,
        padding: '0 8px',
        height: '100%',
        color: 'var(--ls-fg-primary)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        borderRadius: 'var(--ls-r-sm)',
        transition: 'background var(--ls-dur-fast) var(--ls-ease-soft)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--ls-glass-light-strong)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {compact ? time : `${day} ${time}`}
    </button>
  );
}
