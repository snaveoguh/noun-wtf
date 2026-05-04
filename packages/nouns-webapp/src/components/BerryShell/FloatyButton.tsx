/**
 * FloatyButton — fixed bottom-right control puck that exposes utility chrome
 * stripped from the menu bar (wallet, theme, spotlight, notifications, clock,
 * berryos.wtf link).
 *
 * Liquid Sand: round 44pt glass button (HIG min touch target). Click opens a
 * <GlassPanel> popover anchored above. Click-outside + Escape dismiss.
 *
 * Anchored above the dock (dock pill sits at bottom: 16pt + ~60pt height) so
 * the button at bottom: 86pt rests on the desktop, not on top of the dock.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { ConnectKitButton } from 'connectkit';

import ShortAddress from '@/components/ShortAddress';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import { GlassPanel } from '@/liquid-sand/glass';
import { Bell, Globe, MagnifyingGlass, Sparkle } from '@/liquid-sand/icons';
import { BlendIcon } from '@/liquid-sand/inversion';

import { berryBus } from './system/eventBus';
import { useUnreadCount } from './system/notifications';
import { notificationCenterStore } from './system/notificationCenterStore';

interface RowProps {
  label: string;
  Icon: typeof Sparkle;
  onSelect: () => void;
  trailing?: ReactElement | string;
}

function Row({ label, Icon, onSelect, trailing }: RowProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--ls-glass-tint)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 12px',
        margin: 0,
        background: 'transparent',
        border: 'none',
        borderRadius: 'var(--ls-r-sm)',
        cursor: 'pointer',
        fontFamily: 'var(--ls-font-sans)',
        fontSize: 13,
        color: 'var(--ls-fg-primary)',
        textAlign: 'left',
        transition: 'background var(--ls-dur-fast) var(--ls-ease-soft)',
      }}
    >
      <Icon size={16} aria-hidden />
      <span style={{ flex: 1 }}>{label}</span>
      {trailing && (
        <span
          style={{
            fontFamily: 'var(--ls-font-mono)',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 11,
            opacity: 0.7,
          }}
        >
          {trailing}
        </span>
      )}
    </button>
  );
}

const dividerStyle: React.CSSProperties = {
  height: 1,
  margin: '4px 8px',
  background: 'var(--ls-border-glass)',
};

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export default function FloatyButton(): ReactElement {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const unread = useUnreadCount();
  const now = useNow();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = now.toLocaleDateString([], { weekday: 'short' });

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'fixed',
        // Dock floats at bottom: 16 with ~60pt height → keep this above the
        // dock pill so the puck sits clear on the desktop.
        right: 16,
        bottom: 86,
        zIndex: 1200,
      }}
    >
      {open && (
        <GlassPanel
          role="dialog"
          aria-label="System utilities"
          blur="heavy"
          radius="lg"
          // Slide-up animation handled by inline keyframes below via style.
          style={{
            position: 'absolute',
            // Anchor the popover above the button with a small floating gap.
            bottom: 52,
            right: 0,
            width: 240,
            padding: '6px 0',
            boxShadow:
              'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass), var(--ls-shadow-lg, 0 12px 40px rgba(0,0,0,0.18))',
            transformOrigin: 'bottom right',
            animation: 'floaty-pop var(--ls-dur-base) var(--ls-ease-spring)',
          }}
          onClick={e => e.stopPropagation()}
        >
          <ConnectKitButton.Custom>
            {({ isConnected, show, address }) => (
              <Row
                label={
                  isConnected && address
                    ? // ShortAddress is a span; render via trailing instead.
                      'Wallet'
                    : 'Connect Wallet'
                }
                Icon={Sparkle}
                onSelect={() => {
                  if (show) show();
                  setOpen(false);
                }}
                trailing={
                  isConnected && address ? (
                    <ShortAddress address={address} avatar={false} />
                  ) : undefined
                }
              />
            )}
          </ConnectKitButton.Custom>

          <div style={dividerStyle} />

          {/* Theme picker — reuse existing dropdown.
              Wrap in a row so the chrome matches surrounding items. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 12px',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--ls-font-sans)',
                fontSize: 13,
                color: 'var(--ls-fg-primary)',
                flex: 1,
              }}
            >
              Theme
            </span>
            <ThemeSwitcher variant="navbar" />
          </div>

          <div style={dividerStyle} />

          <Row
            label="Spotlight Search"
            Icon={MagnifyingGlass}
            onSelect={() => {
              berryBus.emit('spotlight:toggle', {});
              setOpen(false);
            }}
            trailing="⌘ Space"
          />
          <Row
            label="Notifications"
            Icon={Bell}
            onSelect={() => {
              notificationCenterStore.toggle();
              setOpen(false);
            }}
            trailing={unread > 0 ? (unread > 99 ? '99+' : String(unread)) : undefined}
          />

          <div style={dividerStyle} />

          <Row
            label="berryos.wtf"
            Icon={Globe}
            onSelect={() => {
              window.open('https://berryos.wtf', '_blank', 'noopener,noreferrer');
              setOpen(false);
            }}
            trailing="↗"
          />

          <div style={dividerStyle} />

          {/* Clock — passive display, not a button. */}
          <div
            style={{
              padding: '6px 12px 8px',
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              fontFamily: 'var(--ls-font-mono)',
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--ls-fg-primary)',
              opacity: 0.85,
            }}
          >
            <span style={{ fontSize: 11, opacity: 0.7 }}>{day}</span>
            <span style={{ fontSize: 14 }}>{time}</span>
          </div>
        </GlassPanel>
      )}

      <button
        type="button"
        aria-label="System utilities"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{
          // HIG: 44pt minimum touch target.
          width: 44,
          height: 44,
          borderRadius: '50%',
          // Frosted glass surface — mirrors GlassPanel chemistry but as a circle.
          background: 'var(--ls-glass-light, rgba(255,255,255,0.55))',
          backdropFilter: 'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
          WebkitBackdropFilter: 'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
          border: '1px solid var(--ls-border-glass)',
          color: 'var(--ls-fg-primary)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow:
            'var(--ls-shadow-inset-glass), var(--ls-shadow-md, 0 4px 16px rgba(0,0,0,0.15))',
          transition:
            'transform var(--ls-dur-base) var(--ls-ease-spring), background var(--ls-dur-fast) var(--ls-ease-soft)',
          padding: 0,
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'scale(1.06)';
          e.currentTarget.style.background = 'var(--ls-glass-light-strong, rgba(255,255,255,0.7))';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.background = 'var(--ls-glass-light, rgba(255,255,255,0.55))';
        }}
      >
        <BlendIcon mode="difference">
          <Sparkle size={20} />
        </BlendIcon>
      </button>

      {/* Inline keyframes for the popover slide-up. Scoped via <style> so we
          don't pollute the global stylesheet with a one-off animation. */}
      <style>{`
        @keyframes floaty-pop {
          from { opacity: 0; transform: translateY(6px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
