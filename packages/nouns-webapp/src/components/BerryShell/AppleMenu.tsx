import { useEffect, type ReactElement } from 'react';

import { GlassPanel } from '@/liquid-sand/glass';
import {
  Coin,
  Diamond,
  Document,
  Info,
  Power,
  Restart,
  Settings as SettingsIcon,
  Sparkle,
} from '@/liquid-sand/icons';

import { windowStore } from './store/windowStore';

interface AppleMenuProps {
  onLaunch: (appId: string) => void;
  onClose: () => void;
}

interface MenuItemProps {
  label: string;
  Icon: typeof Sparkle;
  onSelect: () => void;
}

function MenuItem({ label, Icon, onSelect }: MenuItemProps): ReactElement {
  return (
    <div
      role="menuitem"
      tabIndex={0}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--ls-glass-tint)';
        e.currentTarget.style.color = 'var(--ls-fg-primary)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--ls-fg-primary)';
      }}
      onClick={onSelect}
      style={{
        padding: '6px 14px',
        fontFamily: 'var(--ls-font-sans)',
        fontSize: 13,
        cursor: 'default',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        color: 'var(--ls-fg-primary)',
        borderRadius: 'var(--ls-r-sm)',
        margin: '0 4px',
        transition: 'background var(--ls-dur-fast) var(--ls-ease-soft)',
      }}
    >
      <Icon size={14} aria-hidden />
      <span>{label}</span>
    </div>
  );
}

const dividerStyle: React.CSSProperties = {
  height: 1,
  margin: '4px 8px',
  background: 'var(--ls-border-glass)',
};

/**
 * AppleMenu — leftmost dropdown opened by clicking the brand icon.
 *
 * Liquid Sand chrome: <GlassPanel> dropdown with monoline icons throughout.
 * Restart closes all windows; Shut Down switches the site theme back to
 * 'classic' so the desktop deactivates.
 */
export default function AppleMenu({ onLaunch, onClose }: AppleMenuProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <GlassPanel
      data-apple-menu
      role="menu"
      // HIG: menu surfaces over arbitrary content require heavy blur
      // (apple-hig platforms/visionos.md "glass over arbitrary content").
      // Radius 10pt small graphic corners (apple-hig SKILL.md).
      blur="heavy"
      radius="md"
      style={{
        position: 'absolute',
        // Drop the menu just below the 24pt menu bar.
        top: 26,
        left: 6,
        minWidth: 220,
        // HIG: 4pt vertical inset around menu items.
        padding: '4px 0',
        zIndex: 1100,
      }}
      onClick={e => e.stopPropagation()}
    >
      <MenuItem label="About this Berry" Icon={Info} onSelect={() => onLaunch('settings')} />
      <div style={dividerStyle} />
      <MenuItem label="Auction" Icon={Coin} onSelect={() => onLaunch('auction')} />
      <MenuItem label="Vote" Icon={Diamond} onSelect={() => onLaunch('vote')} />
      <MenuItem label="Candidates" Icon={Document} onSelect={() => onLaunch('candidates')} />
      <div style={dividerStyle} />
      <MenuItem
        label="Settings…"
        Icon={SettingsIcon}
        onSelect={() => onLaunch('settings')}
      />
      <div style={dividerStyle} />
      <MenuItem
        label="Restart"
        Icon={Restart}
        onSelect={() => {
          windowStore.closeAll();
          onClose();
        }}
      />
      <MenuItem
        label="Shut Down"
        Icon={Power}
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
    </GlassPanel>
  );
}
