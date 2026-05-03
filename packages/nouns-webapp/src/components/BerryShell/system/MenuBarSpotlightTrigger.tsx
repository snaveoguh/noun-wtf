/**
 * MenuBarSpotlightTrigger — magnifying-glass icon that fires the global
 * `spotlight:toggle` event. The Spotlight system already listens for this
 * (see system/SpotlightSystem.tsx), so the click is enough.
 *
 * Drop-in: render between MenuBarWifi and MenuBarClock in
 * BerryShell/index.tsx.
 */
import type { ReactElement } from 'react';

import { berryBus } from './eventBus';

export default function MenuBarSpotlightTrigger(): ReactElement {
  return (
    <button
      type="button"
      aria-label="Spotlight Search"
      title="Spotlight (⌘ Space)"
      onClick={() => berryBus.emit('spotlight:toggle', {})}
      style={{
        height: '100%',
        padding: '0 8px',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--theme-text-primary)',
        display: 'inline-flex',
        alignItems: 'center',
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
      <SearchIcon color="currentColor" />
    </button>
  );
}

function SearchIcon({ color }: { color: string }): ReactElement {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
      <circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke={color} strokeWidth="1.5" />
      <line x1="10" y1="10" x2="14" y2="14" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
