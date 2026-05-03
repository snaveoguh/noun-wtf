import { useEffect } from 'react';

import { windowStore } from './store/windowStore';

interface AppleMenuProps {
  onLaunch: (appId: string) => void;
  onClose: () => void;
}

const itemStyle: React.CSSProperties = {
  padding: '4px 14px',
  fontSize: 13,
  fontFamily: 'var(--theme-font-display)',
  cursor: 'default',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: 'var(--theme-text-primary)',
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  margin: '2px 0',
  background: 'var(--theme-border)',
};

/**
 * AppleMenu — leftmost dropdown opened by clicking the strawberry icon.
 * Stub-y but shaped like the original Berry Apple menu (About / Settings /
 * Restart / Shut Down). Restart closes all windows; Shut Down switches the
 * site theme back to classic.
 */
export default function AppleMenu({ onLaunch, onClose }: AppleMenuProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function MenuItem(props: { label: string; onSelect: () => void; emoji?: string }) {
    return (
      <div
        role="menuitem"
        tabIndex={0}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'var(--theme-accent)';
          e.currentTarget.style.color = '#fff';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--theme-text-primary)';
        }}
        onClick={props.onSelect}
        style={itemStyle}
      >
        {props.emoji && <span aria-hidden>{props.emoji}</span>}
        <span>{props.label}</span>
      </div>
    );
  }

  return (
    <div
      data-apple-menu
      role="menu"
      style={{
        position: 'absolute',
        top: 24,
        left: 6,
        minWidth: 200,
        background: 'var(--theme-bg-card)',
        border: '1px solid var(--theme-border-strong)',
        // Aqua menu shadow: soft, large-radius drop with a 1px inner highlight
        // for the "lit from above" look. Keeps the inner bevel for retro feel.
        boxShadow:
          'inset 1px 1px 0 var(--theme-bevel-light), inset -1px -1px 0 var(--theme-bevel-dark), 0 6px 18px rgba(0, 0, 0, 0.32), 0 2px 4px rgba(0, 0, 0, 0.18)',
        padding: '4px 0',
        zIndex: 1100,
      }}
      onClick={e => e.stopPropagation()}
    >
      <MenuItem label="About this Berry" emoji="🍓" onSelect={() => onLaunch('settings')} />
      <div style={dividerStyle} />
      <MenuItem label="Auction" emoji="🍆" onSelect={() => onLaunch('auction')} />
      <MenuItem label="Vote" emoji="🗳️" onSelect={() => onLaunch('vote')} />
      <MenuItem label="Candidates" emoji="📜" onSelect={() => onLaunch('candidates')} />
      <div style={dividerStyle} />
      <MenuItem label="Settings…" emoji="⚙️" onSelect={() => onLaunch('settings')} />
      <div style={dividerStyle} />
      <MenuItem
        label="Restart"
        emoji="↻"
        onSelect={() => {
          windowStore.closeAll();
          onClose();
        }}
      />
      <MenuItem
        label="Shut Down"
        emoji="⏻"
        onSelect={() => {
          // Switch theme away from berry — equivalent to "shutting down" the OS.
          try {
            window.localStorage.setItem('noun-wtf-theme', 'classic');
            window.location.reload();
          } catch {
            onClose();
          }
        }}
      />
    </div>
  );
}
