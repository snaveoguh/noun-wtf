/**
 * MenuBarSpotlightTrigger — monoline magnifying-glass icon that fires the
 * global `spotlight:toggle` event. The Spotlight system already listens for
 * this (see system/SpotlightSystem.tsx), so the click is enough.
 */
import type { ReactElement } from 'react';

import { MagnifyingGlass } from '@/liquid-sand/icons';
import { BlendIcon } from '@/liquid-sand/inversion';

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
        color: 'var(--ls-fg-primary)',
        display: 'inline-flex',
        alignItems: 'center',
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
      <BlendIcon mode="difference">
        <MagnifyingGlass size={16} />
      </BlendIcon>
    </button>
  );
}
