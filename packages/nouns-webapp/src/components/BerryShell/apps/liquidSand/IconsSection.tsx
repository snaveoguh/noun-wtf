/**
 * Icons — grid of every monoline icon.
 *
 * Hover any tile to reveal the import statement + a copy button. The hover
 * state is implemented by tracking which tile id is currently focused (one
 * at a time), so the small reveal animation stays smooth without dozens of
 * portals open at once.
 */

import * as React from 'react';

import {
  Battery,
  BatteryCharging,
  BatteryLow,
  Bell,
  Boot,
  Brush,
  Calculator,
  Calendar,
  ChatBubble,
  Clipboard,
  Clock,
  Close,
  Coin,
  Console,
  CpuChip,
  Diamond,
  Document,
  DocumentImage,
  DocumentMusic,
  DocumentText,
  DocumentVideo,
  Eject,
  FileGeneric,
  Folder,
  FolderOpen,
  Globe,
  Heart,
  Info,
  Joystick,
  Key,
  Lock,
  MagnifyingGlass,
  Mail,
  Maximize,
  Megaphone,
  Minimize,
  Power,
  Restart,
  Sandglass,
  Settings,
  Shutdown,
  Sleep,
  Sparkle,
  Star,
  StickyNote,
  Trash,
  VolumeHigh,
  VolumeMuted,
  Wallet,
  Wifi,
} from '@/liquid-sand/icons';

import { Card, SectionHeader, fireToast } from './shared';

interface IconEntry {
  name: string;
  Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}

// Order roughly matches groups in icons/index.ts so the grid reads as a
// taxonomy rather than an alphabetical wall.
const ICONS: ReadonlyArray<IconEntry> = [
  // System
  { name: 'Power', Icon: Power },
  { name: 'Lock', Icon: Lock },
  { name: 'Settings', Icon: Settings },
  { name: 'Shutdown', Icon: Shutdown },
  { name: 'Restart', Icon: Restart },
  { name: 'Sleep', Icon: Sleep },
  { name: 'Boot', Icon: Boot },
  { name: 'Eject', Icon: Eject },
  // Files
  { name: 'Folder', Icon: Folder },
  { name: 'FolderOpen', Icon: FolderOpen },
  { name: 'Document', Icon: Document },
  { name: 'DocumentText', Icon: DocumentText },
  { name: 'DocumentImage', Icon: DocumentImage },
  { name: 'DocumentMusic', Icon: DocumentMusic },
  { name: 'DocumentVideo', Icon: DocumentVideo },
  { name: 'FileGeneric', Icon: FileGeneric },
  // Window controls
  { name: 'Close', Icon: Close },
  { name: 'Minimize', Icon: Minimize },
  { name: 'Maximize', Icon: Maximize },
  // Apps
  { name: 'Joystick', Icon: Joystick },
  { name: 'Calculator', Icon: Calculator },
  { name: 'Clock', Icon: Clock },
  { name: 'Calendar', Icon: Calendar },
  { name: 'StickyNote', Icon: StickyNote },
  { name: 'Brush', Icon: Brush },
  { name: 'Bell', Icon: Bell },
  { name: 'Key', Icon: Key },
  { name: 'CpuChip', Icon: CpuChip },
  { name: 'Console', Icon: Console },
  // Communication
  { name: 'ChatBubble', Icon: ChatBubble },
  { name: 'Mail', Icon: Mail },
  { name: 'MagnifyingGlass', Icon: MagnifyingGlass },
  { name: 'Megaphone', Icon: Megaphone },
  // Status
  { name: 'Wifi', Icon: Wifi },
  { name: 'Battery', Icon: Battery },
  { name: 'BatteryLow', Icon: BatteryLow },
  { name: 'BatteryCharging', Icon: BatteryCharging },
  { name: 'VolumeHigh', Icon: VolumeHigh },
  { name: 'VolumeMuted', Icon: VolumeMuted },
  // Web3
  { name: 'Wallet', Icon: Wallet },
  { name: 'Coin', Icon: Coin },
  { name: 'Diamond', Icon: Diamond },
  // Misc
  { name: 'Sparkle', Icon: Sparkle },
  { name: 'Heart', Icon: Heart },
  { name: 'Star', Icon: Star },
  { name: 'Sandglass', Icon: Sandglass },
  { name: 'Clipboard', Icon: Clipboard },
  { name: 'Info', Icon: Info },
  { name: 'Globe', Icon: Globe },
  { name: 'Trash', Icon: Trash },
] as const;

function importLine(name: string): string {
  return `import { ${name} } from '@/liquid-sand/icons';`;
}

function IconTile({ name, Icon }: IconEntry) {
  const [hover, setHover] = React.useState(false);

  async function copyImport(e: React.MouseEvent): Promise<void> {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(importLine(name));
      fireToast(`Copied: import { ${name} }`);
    } catch {
      fireToast('Copy failed — clipboard blocked');
    }
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: '12px 6px',
        borderRadius: 'var(--ls-r-md)',
        backgroundColor: hover
          ? 'var(--ls-glass-light-strong)'
          : 'rgba(255, 250, 240, 0.45)',
        backdropFilter: 'blur(var(--ls-blur-subtle))',
        WebkitBackdropFilter: 'blur(var(--ls-blur-subtle))',
        boxShadow:
          'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass)',
        transition:
          'background-color var(--ls-dur-fast) var(--ls-ease-soft), transform var(--ls-dur-fast) var(--ls-ease-spring)',
        transform: hover ? 'translateY(-1px)' : 'translateY(0)',
        cursor: 'pointer',
      }}
      tabIndex={0}
      role="button"
      aria-label={`Copy import for ${name}`}
      onClick={copyImport}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          copyImport(e as unknown as React.MouseEvent);
        }
      }}
    >
      <Icon size={22} style={{ color: 'var(--ls-fg-primary)' }} />
      <div
        style={{
          fontFamily: 'var(--ls-font-mono)',
          fontSize: 10,
          color: 'var(--ls-fg-secondary)',
          textAlign: 'center',
          lineHeight: 1.2,
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </div>
      {hover && (
        <div
          style={{
            position: 'absolute',
            bottom: -2,
            left: '50%',
            transform: 'translate(-50%, 100%)',
            padding: '4px 8px',
            backgroundColor: 'rgba(60, 45, 25, 0.92)',
            color: '#fbf6ee',
            fontFamily: 'var(--ls-font-mono)',
            fontSize: 10,
            borderRadius: 'var(--ls-r-sm)',
            whiteSpace: 'nowrap',
            boxShadow: 'var(--ls-shadow-md)',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          click to copy import
        </div>
      )}
    </div>
  );
}

export function IconsSection() {
  const [filter, setFilter] = React.useState('');
  const filtered = filter.trim()
    ? ICONS.filter(i => i.name.toLowerCase().includes(filter.toLowerCase()))
    : ICONS;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionHeader
        title="Icons"
        badge={`${ICONS.length}`}
        description="50 monoline icons. 24×24 viewBox, 1.75 stroke, rounded line caps + joins. Every stroke uses currentColor — set color in CSS and the icon flips."
      />

      <Card>
        <input
          type="text"
          placeholder="Filter icons by name…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            fontFamily: 'var(--ls-font-sans)',
            fontSize: 'var(--ls-text-sm)',
            color: 'var(--ls-fg-primary)',
            backgroundColor: 'var(--ls-glass-light-strong)',
            border: 'none',
            outline: 'none',
            borderRadius: 'var(--ls-r-md)',
            boxShadow:
              'inset 0 1px 2px rgba(60,45,25,0.10), 0 0 0 1px var(--ls-border-glass)',
            backdropFilter: 'blur(var(--ls-blur-medium))',
            WebkitBackdropFilter: 'blur(var(--ls-blur-medium))',
          }}
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
            gap: 8,
          }}
        >
          {filtered.map(entry => (
            <IconTile key={entry.name} {...entry} />
          ))}
          {filtered.length === 0 && (
            <div
              style={{
                gridColumn: '1 / -1',
                padding: 24,
                textAlign: 'center',
                fontFamily: 'var(--ls-font-sans)',
                fontSize: 'var(--ls-text-sm)',
                color: 'var(--ls-fg-muted)',
              }}
            >
              No icons match &ldquo;{filter}&rdquo;.
            </div>
          )}
        </div>
      </Card>

      <Card title="How they work" subtitle="currentColor + monoline = paint with CSS">
        <div
          style={{
            fontFamily: 'var(--ls-font-sans)',
            fontSize: 'var(--ls-text-sm)',
            color: 'var(--ls-fg-secondary)',
            lineHeight: 1.55,
          }}
        >
          Every icon is a <code style={{ fontFamily: 'var(--ls-font-mono)' }}>{`<svg>`}</code> with{' '}
          <code style={{ fontFamily: 'var(--ls-font-mono)' }}>fill=&quot;none&quot;</code> and{' '}
          <code style={{ fontFamily: 'var(--ls-font-mono)' }}>stroke=&quot;currentColor&quot;</code>.
          Default size is <code style={{ fontFamily: 'var(--ls-font-mono)' }}>1em</code> so they
          inherit the surrounding text size; pass <code style={{ fontFamily: 'var(--ls-font-mono)' }}>size</code>{' '}
          to override.
        </div>
        <div
          style={{
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            padding: '12px 14px',
            backgroundColor: 'rgba(255, 250, 240, 0.5)',
            borderRadius: 'var(--ls-r-sm)',
            boxShadow: '0 0 0 1px var(--ls-border-glass)',
          }}
        >
          <Sparkle size={16} style={{ color: 'var(--ls-accent)' }} />
          <Sparkle size={24} style={{ color: 'var(--ls-fg-primary)' }} />
          <Sparkle size={32} style={{ color: 'var(--ls-danger)' }} />
          <Sparkle size={48} style={{ color: 'var(--ls-success)' }} />
          <div
            style={{
              fontFamily: 'var(--ls-font-mono)',
              fontSize: 'var(--ls-text-xs)',
              color: 'var(--ls-fg-muted)',
              marginLeft: 'auto',
            }}
          >
            same icon, different color + size
          </div>
        </div>
      </Card>
    </div>
  );
}
