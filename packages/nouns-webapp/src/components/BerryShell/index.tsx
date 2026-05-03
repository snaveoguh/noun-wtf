import { useEffect, useRef, useState, type ReactNode } from 'react';

import { ConnectKitButton } from 'connectkit';

import ShortAddress from '@/components/ShortAddress';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import { useAppDispatch, useAppSelector } from '@/hooks';
import { setOnDisplayAuctionNounId } from '@/state/slices/onDisplayAuction';

import AppleMenu from './AppleMenu';
import DraggableWindow from './DraggableWindow';
import { APP_REGISTRY } from './apps/registry';
import { PINNED_APPS } from './store/dockStore';
import {
  useBerryFocusedId,
  useBerryWindows,
  useRunningAppIds,
  windowStore,
} from './store/windowStore';
import NotificationCenter from './system/NotificationCenter';
import PermissionPrompt from './system/PermissionPrompt';
import SpotlightSystem from './system/SpotlightSystem';
import ToastStack from './system/ToastStack';
import { bootBerrySystems } from './system/bootstrap';

/**
 * Menu bar clock — updates once per 30s. Drops the day-of-week on narrow
 * viewports so the bar doesn't crowd the connect/theme controls.
 */
function MenuBarClock() {
  const [now, setNow] = useState(() => new Date());
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false,
  );
  useEffect(() => {
    // Tick every 30s — close enough to the minute boundary, cheap.
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const time = now.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  const day = now.toLocaleDateString([], { weekday: 'short' });
  return (
    <span
      aria-label="Clock"
      style={{
        fontFamily: 'var(--theme-font-display)',
        fontSize: 12,
        padding: '0 8px',
        color: 'var(--theme-text-primary)',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {compact ? time : `${day} ${time}`}
    </span>
  );
}

interface BerryShellProps {
  children?: ReactNode;
}

const MENU_ITEMS = ['File', 'Edit', 'View', 'Go', 'Window', 'Help'] as const;

const menuItemStyle: React.CSSProperties = {
  fontFamily: 'var(--theme-font-display)',
  fontSize: 13,
  color: 'var(--theme-text-primary)',
  padding: '0 8px',
  height: '100%',
  display: 'inline-flex',
  alignItems: 'center',
  cursor: 'default',
  userSelect: 'none',
};

/**
 * BerryShell — site-wide chrome wrapper for the Berry theme.
 *
 * Real desktop now: draggable windows, focus stack, working dock with running
 * indicators, Apple-menu dropdown. App registry lives in `./apps/registry`.
 *
 * Auction "loading…" bug fix: when `state.onDisplayAuction.lastAuctionNounId`
 * is hydrated by the global ChainSubscriber but `onDisplayAuctionNounId` has
 * never been set (because BerryShell renders instead of AuctionPage on `/`,
 * and AuctionPage was the only thing that dispatched that action), the fix is
 * to mirror that effect here.
 */
export default function BerryShell({ children: _children }: BerryShellProps) {
  const dispatch = useAppDispatch();
  const lastAuctionNounId = useAppSelector(state => state.onDisplayAuction.lastAuctionNounId);
  const onDisplayAuctionNounId = useAppSelector(
    state => state.onDisplayAuction.onDisplayAuctionNounId,
  );

  // Sync the on-display noun to the live auction whenever the live auction
  // moves on. Mirrors the effect in pages/Auction/index.tsx so BerryHome's
  // useOnDisplayAuction returns a real auction instead of undefined.
  useEffect(() => {
    if (lastAuctionNounId == null) return;
    if (onDisplayAuctionNounId === Number(lastAuctionNounId)) return;
    dispatch(setOnDisplayAuctionNounId(Number(lastAuctionNounId)));
  }, [lastAuctionNounId, onDisplayAuctionNounId, dispatch]);

  const windows = useBerryWindows();
  const focusedId = useBerryFocusedId();
  const runningAppIds = useRunningAppIds();

  // Compact mode: drop decorative menu items (File / Edit / …) on small
  // viewports so the wallet + theme controls + clock keep room.
  const [compact, setCompact] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 720 : false,
  );
  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < 720);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Boot the permissions + services subsystem once on shell mount. Idempotent
  // — safe to call again (e.g. from a future system:bootComplete trigger).
  useEffect(() => {
    bootBerrySystems();
  }, []);

  // Open Finder once on first mount so the desktop never starts empty.
  const didOpenFinder = useRef(false);
  useEffect(() => {
    if (didOpenFinder.current) return;
    didOpenFinder.current = true;
    const finder = APP_REGISTRY.finder;
    windowStore.open({
      appId: finder.appId,
      title: finder.title,
      icon: finder.emoji,
      width: finder.width,
      height: finder.height,
      x: 80,
      y: 60,
    });
    const auction = APP_REGISTRY.auction;
    windowStore.open({
      appId: auction.appId,
      title: auction.title,
      icon: auction.emoji,
      width: auction.width,
      height: auction.height,
    });
  }, []);

  const [appleOpen, setAppleOpen] = useState(false);

  function launchAppId(appId: string) {
    const def = APP_REGISTRY[appId];
    if (!def) return;
    // Static emulation — `externalRoute` entries (none in registry today) are
    // intentionally ignored so users can't break out of the desktop.
    windowStore.open({
      appId: def.appId,
      title: def.title,
      icon: def.emoji,
      width: def.width,
      height: def.height,
    });
  }

  // Active app name shown next to the strawberry — falls back to the site name
  // when no window is focused (cleared desktop / minimized everything).
  const activeWindow = windows.find(w => w.id === focusedId);
  const focusedTitle = activeWindow?.title ?? 'Noun.wtf';

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        width: '100%',
        // Aqua/early-OS-X desktop: vertical blue-grey gradient with a subtle
        // 2px pinstripe overlay. The gradient stays light enough that windows
        // and dock icons read clearly.
        background:
          'repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.03) 0px, rgba(0, 0, 0, 0.03) 1px, transparent 1px, transparent 3px), linear-gradient(180deg, #6e9bcf 0%, #5a85b8 35%, #4d76a4 70%, #406088 100%)',
        backgroundColor: 'var(--theme-desktop-bg)',
        color: 'var(--theme-text-primary)',
        fontFamily: 'var(--theme-font-body)',
        overflow: 'hidden',
      }}
      onPointerDown={e => {
        // Click on empty desktop closes the Apple menu.
        if ((e.target as HTMLElement).closest('[data-apple-menu]')) return;
        if (appleOpen) setAppleOpen(false);
      }}
    >
      {/* Top menu bar */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1000,
          height: 24,
          display: 'flex',
          alignItems: 'stretch',
          // Aqua-era brushed gradient with a 1px pinstripe over the top —
          // gives the bar depth without screaming retro.
          background:
            'repeating-linear-gradient(0deg, rgba(0,0,0,0.03) 0px, rgba(0,0,0,0.03) 1px, transparent 1px, transparent 2px), linear-gradient(180deg, #fbfbfb 0%, #e6e6e6 60%, #d8d8d8 100%)',
          borderBottom: '1px solid #888',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.85), 0 1px 0 rgba(0, 0, 0, 0.08)',
          paddingLeft: 6,
          paddingRight: 6,
          fontFamily: 'var(--theme-font-display)',
          color: 'var(--theme-text-primary)',
        }}
      >
        <button
          data-apple-menu
          type="button"
          onClick={e => {
            e.stopPropagation();
            setAppleOpen(o => !o);
          }}
          aria-haspopup="menu"
          aria-expanded={appleOpen}
          aria-label="Apple menu"
          style={{
            ...menuItemStyle,
            background: appleOpen ? 'var(--theme-accent)' : 'transparent',
            color: appleOpen ? '#fff' : 'var(--theme-text-primary)',
            fontSize: 15,
            paddingLeft: 8,
            paddingRight: 10,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <span aria-hidden="true">🍓</span>
        </button>
        <span
          style={{
            ...menuItemStyle,
            fontWeight: 700,
            paddingLeft: 4,
            paddingRight: 14,
            color: 'var(--theme-text-primary)',
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          aria-label="active app"
          title={focusedTitle}
        >
          {focusedTitle}
        </span>
        {!compact &&
          MENU_ITEMS.map(label => (
            <span
              key={label}
              style={{
                ...menuItemStyle,
                color: 'var(--theme-text-primary)',
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
              {label}
            </span>
          ))}
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 4 }}>
          <a
            href="https://berryos.wtf"
            target="_blank"
            rel="noopener noreferrer"
            title="Open berryos.wtf in a new tab"
            onMouseEnter={e => {
              e.currentTarget.style.filter = 'brightness(1.06)';
              e.currentTarget.style.boxShadow =
                'inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 1px rgba(0, 64, 160, 0.25), 0 2px 4px rgba(0, 70, 180, 0.45)';
              const arrow = e.currentTarget.querySelector('[data-arrow]') as HTMLElement | null;
              if (arrow) arrow.style.transform = 'translate(1.5px, -1.5px)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.filter = '';
              e.currentTarget.style.boxShadow =
                'inset 0 1px 0 rgba(255, 255, 255, 0.85), inset 0 -1px 1px rgba(0, 64, 160, 0.2), 0 1px 2px rgba(0, 70, 180, 0.35)';
              const arrow = e.currentTarget.querySelector('[data-arrow]') as HTMLElement | null;
              if (arrow) arrow.style.transform = '';
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: 18,
              padding: '0 10px',
              borderRadius: 10,
              // Aqua-pill: blue gradient + glossy sheen
              background:
                'linear-gradient(180deg, #b3d4ff 0%, #5fa3ee 38%, #2d7ad8 60%, #1c5fb0 100%)',
              border: '1px solid #0a4a90',
              color: '#fff',
              fontFamily: 'var(--theme-font-display)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.2,
              textShadow: '0 1px 0 rgba(0, 0, 0, 0.35)',
              textDecoration: 'none',
              boxShadow:
                'inset 0 1px 0 rgba(255, 255, 255, 0.85), inset 0 -1px 1px rgba(0, 64, 160, 0.2), 0 1px 2px rgba(0, 70, 180, 0.35)',
              transition: 'filter 120ms ease, box-shadow 120ms ease',
              whiteSpace: 'nowrap',
            }}
            aria-label="Go to berryos.wtf"
          >
            <span>berryos.wtf</span>
            <span
              data-arrow
              aria-hidden
              style={{ fontSize: 11, lineHeight: 1, transition: 'transform 160ms ease' }}
            >
              ↗
            </span>
          </a>
          <ConnectKitButton.Custom>
            {({ isConnected, show, address }) => (
              <button
                onClick={show}
                style={{
                  ...menuItemStyle,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0 6px',
                  fontSize: 12,
                }}
                aria-label={isConnected ? 'Wallet menu' : 'Connect wallet'}
              >
                {isConnected && address ? (
                  <ShortAddress address={address} avatar={false} />
                ) : (
                  <span>Connect</span>
                )}
              </button>
            )}
          </ConnectKitButton.Custom>
          <ThemeSwitcher variant="navbar" />
          <MenuBarClock />
        </div>
      </div>

      {/* Apple menu dropdown */}
      {appleOpen && (
        <AppleMenu
          onLaunch={appId => {
            setAppleOpen(false);
            launchAppId(appId);
          }}
          onClose={() => setAppleOpen(false)}
        />
      )}

      {/* Desktop / window manager region */}
      <div
        style={{
          position: 'absolute',
          inset: '24px 0 76px 0',
          overflow: 'hidden',
        }}
        onPointerDown={e => {
          // Clicking on empty desktop blurs windows. Cheap "deselect" UX.
          if (e.target === e.currentTarget) {
            // no-op for now; full blurAll could be added here
          }
        }}
      >
        {windows.map(win => {
          const def = APP_REGISTRY[win.appId];
          const Component = def?.Component ?? (() => null);
          return (
            <DraggableWindow key={win.id} win={win}>
              <Component />
            </DraggableWindow>
          );
        })}
      </div>

      {/* Dock — Aqua glass slab with subtle highlight + drop shadow */}
      <nav
        aria-label="Dock"
        style={{
          position: 'fixed',
          bottom: 10,
          left: '50%',
          transform: 'translateX(-50%)',
          height: 60,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 14px',
          background:
            'linear-gradient(180deg, rgba(255, 255, 255, 0.65) 0%, rgba(220, 220, 220, 0.55) 100%)',
          backdropFilter: 'blur(12px) saturate(160%)',
          WebkitBackdropFilter: 'blur(12px) saturate(160%)',
          border: '1px solid rgba(255, 255, 255, 0.7)',
          borderRadius: 14,
          boxShadow:
            'inset 0 1px 0 rgba(255, 255, 255, 0.9), inset 0 -1px 0 rgba(0, 0, 0, 0.08), 0 8px 24px rgba(0, 0, 0, 0.28), 0 2px 6px rgba(0, 0, 0, 0.18)',
          zIndex: 800,
        }}
      >
        {PINNED_APPS.map(app => {
          const isRunning = runningAppIds.has(app.appId);
          return (
            <button
              key={app.appId}
              type="button"
              title={app.title}
              aria-label={app.title}
              onClick={() => launchAppId(app.appId)}
              style={{
                position: 'relative',
                width: 44,
                height: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 26,
                lineHeight: 1,
                background: 'transparent',
                border: 'none',
                borderRadius: 6,
                transition: 'transform 0.12s ease',
                cursor: 'pointer',
                padding: 0,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-4px) scale(1.15)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0) scale(1)';
              }}
            >
              <span aria-hidden="true">{app.emoji}</span>
              {isRunning && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    bottom: -1,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    background:
                      'radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(180,180,180,1) 50%, rgba(80,80,80,1) 100%)',
                    boxShadow: '0 0 4px rgba(0, 0, 0, 0.4)',
                  }}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Spotlight + global hotkeys + cmd-hold cheat sheet — single mount */}
      <SpotlightSystem />

      {/* Permission prompt — modal that listens for permission:requested */}
      <PermissionPrompt />

      {/* Notification system — toast stack (top-right) + slide-out center */}
      <ToastStack />
      <NotificationCenter />
    </div>
  );
}
