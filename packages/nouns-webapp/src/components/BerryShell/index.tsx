import {
  type ComponentType,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

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
import FloatyButton from './FloatyButton';
import { APP_REGISTRY } from './apps/registry';
import { PINNED_APPS } from './store/dockStore';
import {
  BERRY_MOBILE_BREAKPOINT,
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

interface BerryShellProps {
  children?: ReactNode;
}

// HIG (apple-hig platforms/macos.md): menu bar items use 13pt regular type
// with 8pt horizontal padding between top-level items. Kept for the brand
// button — file/edit/view items now live in the floaty popover.
const menuItemStyle: React.CSSProperties = {
  fontFamily: 'var(--ls-font-sans)',
  fontSize: 13,
  color: 'var(--ls-fg-primary)',
  padding: '0 8px', // HIG: 8pt horizontal between top-level items
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
 * Track viewport-as-mobile (≤ HIG mobile breakpoint) for chrome that
 * needs to shrink — dock icon size, desktop bottom inset, etc.
 */
function useIsMobileShell(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= BERRY_MOBILE_BREAKPOINT : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsMobile(window.innerWidth <= BERRY_MOBILE_BREAKPOINT);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return isMobile;
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
  const isMobile = useIsMobileShell();
  // HIG: 44pt is the iOS minimum touch target — keep that on mobile but
  // tighten icon size + gap so 5+ apps fit a 375pt-wide dock pill.
  const dockButtonSize = isMobile ? 40 : 44;
  const dockIconSize = isMobile ? 22 : 24;
  // Bottom inset for the desktop region — taller dock + 16pt floating gap
  // on desktop, slightly tighter on mobile.
  const desktopBottomInset = isMobile ? 64 : 76;

  // Boot the permissions + services subsystem once on shell mount. Idempotent.
  useEffect(() => {
    bootBerrySystems();
  }, []);

  // Open Finder once on first mount so the desktop never starts empty.
  // On mobile (<=768pt) we open Finder ONLY — auction-on-top would obscure
  // the entire viewport since each window already fills the available
  // width tightly.
  const didOpenFinder = useRef(false);
  useEffect(() => {
    if (didOpenFinder.current) return;
    didOpenFinder.current = true;
    const isMobileBoot =
      typeof window !== 'undefined' && window.innerWidth <= 768;
    const finder = APP_REGISTRY.finder;
    windowStore.open({
      appId: finder.appId,
      title: finder.title,
      icon: finder.emoji,
      width: finder.width,
      height: finder.height,
      // Skip the desktop cascade origin on mobile so the store's mobile
      // gutter logic owns placement.
      ...(isMobileBoot ? {} : { x: 80, y: 60 }),
    });
    if (!isMobileBoot) {
      const auction = APP_REGISTRY.auction;
      windowStore.open({
        appId: auction.appId,
        title: auction.title,
        icon: auction.emoji,
        width: auction.width,
        height: auction.height,
      });
    }
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

      {/* Top menu bar — Liquid Sand frosted glass.
          HIG: macOS Tahoe menu bar is 24pt tall. apple-hig platforms/macos.md */}
      <GlassMenuBar
        height={24}
        sticky
        style={{
          position: 'sticky',
          top: 0,
        }}
        start={
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
            title={focusedTitle}
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
        }
        end={<ThemeSwitcher variant="navbar" />}
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

      {/* Desktop / window manager region.
          HIG: top inset = menu bar height (24pt). Bottom inset reserves
          dock pill (44pt icons + 16pt padding + 16pt floating gap = 76pt
          on desktop, slightly tighter on mobile). */}
      <div
        style={{
          position: 'absolute',
          inset: `24px 0 ${desktopBottomInset}px 0`,
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

      {/* Dock — Liquid Sand glass pill with monoline app icons.
          HIG (apple-hig SKILL.md "Key Numbers" + platforms/macos.md):
            44pt min touch target; 24pt icon content with 10pt margin around;
            4pt gap between icons; small 4pt active indicator beneath; no
            dock reflection (Mojave+ removed it). */}
      <GlassDock
        bottom={isMobile ? 8 : 16}
        reflection={false}
        // Cap pill width so it can never overflow on mobile — iPhone
        // viewport at 375pt fits 5 × 40pt + gap + padding comfortably,
        // but a sixth app icon could overrun. The pill scrolls horizontally
        // inside `maxWidth` rather than clipping.
        style={{
          maxWidth: 'calc(100vw - 16px)',
        }}
      >
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
                // HIG: 44pt minimum touch target on desktop, 40pt on mobile
                // (still well above 32pt iOS minimum, with extra room from
                // the 4pt inter-icon gap).
                width: dockButtonSize,
                height: dockButtonSize,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                color: 'var(--ls-fg-primary)',
                border: 'none',
                // HIG: small graphic corners 10pt (--ls-r-md after retune).
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
                {/* HIG: 24pt icon content within the 44pt target. */}
                <Icon size={dockIconSize} />
              </BlendIcon>
              {isRunning && (
                <span
                  aria-hidden="true"
                  // HIG: 4pt active-app indicator dot, centered under icon
                  // (current macOS dock convention).
                  style={{
                    position: 'absolute',
                    bottom: 2,
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

      {/* Floaty utility puck (bottom-right) — wallet, theme, spotlight,
          notifications, clock, berryos.wtf. Replaces what we stripped from
          the menu bar. */}
      <FloatyButton />
    </div>
  );
}
