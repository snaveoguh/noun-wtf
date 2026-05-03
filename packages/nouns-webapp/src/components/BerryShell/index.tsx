import {
  type ComponentType,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ConnectKitButton } from 'connectkit';

import ShortAddress from '@/components/ShortAddress';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import { useAppDispatch, useAppSelector } from '@/hooks';
import { GlassDock, GlassMenuBar } from '@/liquid-sand/glass';
import {
  Coin,
  Diamond,
  Document,
  Folder,
  Settings as SettingsIcon,
  Sparkle,
} from '@/liquid-sand/icons';
import { BlendIcon } from '@/liquid-sand/inversion';
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
import MenuBarClock from './system/MenuBarClock';
import MenuBarNotificationBell from './system/MenuBarNotificationBell';
import MenuBarSpotlightTrigger from './system/MenuBarSpotlightTrigger';
import NotificationCenter from './system/NotificationCenter';
import PermissionPrompt from './system/PermissionPrompt';
import SpotlightSystem from './system/SpotlightSystem';
import ToastStack from './system/ToastStack';
import { bootBerrySystems } from './system/bootstrap';

interface BerryShellProps {
  children?: ReactNode;
}

const MENU_ITEMS = ['File', 'Edit', 'View', 'Go', 'Window', 'Help'] as const;

const menuItemStyle: React.CSSProperties = {
  fontFamily: 'var(--ls-font-sans)',
  fontSize: 13,
  color: 'var(--ls-fg-primary)',
  padding: '0 8px',
  height: '100%',
  display: 'inline-flex',
  alignItems: 'center',
  cursor: 'default',
  userSelect: 'none',
  borderRadius: 'var(--ls-r-sm)',
  transition: 'background var(--ls-dur-fast) var(--ls-ease-soft)',
};

/**
 * Map from registered appId → monoline icon. Anything not listed gets the
 * generic <Document> placeholder. Replaces the emoji column on each dock
 * button + menu surfaces.
 */
const APP_ICON: Record<string, ComponentType<{ size?: number | string }>> = {
  finder: Folder,
  auction: Coin,
  vote: Diamond,
  candidates: Document,
  settings: SettingsIcon,
};

function appIconFor(appId: string): ComponentType<{ size?: number | string }> {
  return APP_ICON[appId] ?? Document;
}

/**
 * BerryShell — site-wide chrome wrapper for the Berry theme.
 *
 * Liquid Sand chrome rewrite — frosted glass throughout, monoline icons
 * (sparkle brand, monoline app icons in the dock), warm sepia/sand desktop
 * gradient. Behavior is unchanged: draggable windows, focus stack, working
 * dock with running indicators, Apple-menu dropdown.
 *
 * Auction "loading…" bug fix: when `state.onDisplayAuction.lastAuctionNounId`
 * is hydrated by the global ChainSubscriber but `onDisplayAuctionNounId` has
 * never been set, mirror that effect here.
 */
export default function BerryShell({ children: _children }: BerryShellProps) {
  const dispatch = useAppDispatch();
  const lastAuctionNounId = useAppSelector(state => state.onDisplayAuction.lastAuctionNounId);
  const onDisplayAuctionNounId = useAppSelector(
    state => state.onDisplayAuction.onDisplayAuctionNounId,
  );

  // Sync the on-display noun to the live auction whenever the live auction
  // moves on. Mirrors the effect in pages/Auction/index.tsx.
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

  // Boot the permissions + services subsystem once on shell mount. Idempotent.
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
    windowStore.open({
      appId: def.appId,
      title: def.title,
      icon: def.emoji,
      width: def.width,
      height: def.height,
    });
  }

  // Active app name shown next to the brand — falls back to the site name.
  const activeWindow = windows.find(w => w.id === focusedId);
  const focusedTitle = activeWindow?.title ?? 'Noun.wtf';

  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        width: '100%',
        // Background is now painted by <BerryDesktopBackground> as a
        // fixed-position layer behind the shell. Reset the wrapper so it
        // doesn't fight the wallpaper.
        backgroundColor: 'transparent',
        color: 'var(--ls-fg-primary)',
        fontFamily: 'var(--ls-font-sans)',
        overflow: 'hidden',
      }}
      onPointerDown={e => {
        // Click on empty desktop closes the Apple menu.
        if ((e.target as HTMLElement).closest('[data-apple-menu]')) return;
        if (appleOpen) setAppleOpen(false);
      }}
    >
      {/* Wallpaper is painted by BerryDesktopBackground (mounted by
          LifecycleMount); this shell renders on top with a transparent bg. */}

      {/* Top menu bar — Liquid Sand frosted glass */}
      <GlassMenuBar
        height={28}
        sticky
        style={{
          position: 'sticky',
          top: 0,
          // Reserve a comfortable height so monoline icons + 13px text
          // breathe in the bar.
        }}
        start={
          <>
            <button
              data-apple-menu
              type="button"
              onClick={e => {
                e.stopPropagation();
                setAppleOpen(o => !o);
              }}
              aria-haspopup="menu"
              aria-expanded={appleOpen}
              aria-label="Berry menu"
              style={{
                ...menuItemStyle,
                background: appleOpen ? 'var(--ls-glass-light-strong)' : 'transparent',
                color: 'var(--ls-fg-primary)',
                paddingLeft: 8,
                paddingRight: 10,
                border: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              <BlendIcon mode="difference">
                <Sparkle size={16} />
              </BlendIcon>
            </button>
            <span
              style={{
                ...menuItemStyle,
                fontWeight: 600,
                paddingLeft: 4,
                paddingRight: 14,
                color: 'var(--ls-fg-primary)',
                maxWidth: 200,
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
                    color: 'var(--ls-fg-primary)',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'var(--ls-glass-light-strong)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {label}
                </span>
              ))}
          </>
        }
        end={
          <>
            <a
              href="https://berryos.wtf"
              target="_blank"
              rel="noopener noreferrer"
              title="Open berryos.wtf in a new tab"
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--ls-glass-light-strong)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                height: 20,
                padding: '0 10px',
                borderRadius: 'var(--ls-r-full)',
                background: 'transparent',
                border: '1px solid var(--ls-border-glass)',
                color: 'var(--ls-fg-primary)',
                fontFamily: 'var(--ls-font-sans)',
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: 0.2,
                textDecoration: 'none',
                transition: 'background var(--ls-dur-fast) var(--ls-ease-soft)',
                whiteSpace: 'nowrap',
              }}
              aria-label="Go to berryos.wtf"
            >
              <span>berryos.wtf</span>
              <span
                aria-hidden
                style={{ fontSize: 11, lineHeight: 1, opacity: 0.7 }}
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
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'var(--ls-glass-light-strong)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'transparent';
                  }}
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
            <MenuBarSpotlightTrigger />
            <MenuBarNotificationBell />
            <MenuBarClock />
          </>
        }
      />

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
          inset: '28px 0 76px 0',
          overflow: 'hidden',
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

      {/* Dock — Liquid Sand glass pill with monoline app icons */}
      <GlassDock bottom={16} reflection>
        {PINNED_APPS.map(app => {
          const isRunning = runningAppIds.has(app.appId);
          const Icon = appIconFor(app.appId);
          return (
            <button
              key={app.appId}
              type="button"
              title={app.title}
              aria-label={app.title}
              onClick={() => launchAppId(app.appId)}
              style={{
                position: 'relative',
                width: 40,
                height: 40,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                color: 'var(--ls-fg-primary)',
                border: 'none',
                borderRadius: 'var(--ls-r-md)',
                transition:
                  'transform var(--ls-dur-base) var(--ls-ease-spring), background var(--ls-dur-fast) var(--ls-ease-soft)',
                cursor: 'pointer',
                padding: 0,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-3px) scale(1.10)';
                e.currentTarget.style.background = 'var(--ls-glass-tint)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0) scale(1)';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <BlendIcon mode="difference">
                <Icon size={22} />
              </BlendIcon>
              {isRunning && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    bottom: -2,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    background: 'var(--ls-accent)',
                    boxShadow: '0 0 6px rgba(184,147,82,0.6)',
                  }}
                />
              )}
            </button>
          );
        })}
      </GlassDock>

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
