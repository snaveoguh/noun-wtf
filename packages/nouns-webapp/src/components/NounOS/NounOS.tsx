// ── NounOS: noun.wtf as one place ───────────────────────────────────────
//
// Layers, back to front:
//   1. Noun World (the game). Default on `/`. When the desk comes forward it
//      freezes, blurs and sinks back in z.
//   2. The desk: a perspective space where every page/app is a window with
//      real depth (front window at z=0, the rest recede and haze out), tilted
//      gently by the pointer.
//   3. The pond: water at the bottom reflecting whatever windows are open,
//      with reeds, lily pads and fireflies.
//   4. The tray: windows, live auction (hover card), wallet, world/desk switch.
//   5. Toasts + chain notifications — always on, also while you skate.
//
// ` (backtick) flips between world and desk. Clicking the open sky of the desk
// drops you back into the world; clicking the water makes ripples.

import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { ConnectKitButton } from 'connectkit';
import { useLocation, useNavigate } from 'react-router';

import { ChainNotificationsMount } from '@/components/Notifications/useChainNotifications';
import { Toaster } from '@/components/ui/sonner';
import { useSiteTheme } from '@/contexts/SiteThemeContext';

import AccessoryIcon from './AccessoryIcon';
import AgentHome from './AgentHome';
import { AuctionChip, Directory, Manifesto } from './apps';
import { titleForPath, type Entry } from './catalog';
import { cx, isMobile, os, useOS, type AppKind } from './osStore';
import OSWindow from './OSWindow';
import { NOS_CSS } from './styles';
import WaterGarden, { waterHeight, type WaterHandle } from './WaterGarden';

const World2Page = lazy(() => import('@/miniapps/world2/World2Page'));
const TerminalFeedShell = lazy(() => import('@/components/TerminalFeed/TerminalFeedShell'));
const Pip3Page = lazy(() => import('@/pages/Pip3Page'));

const README_KEY = 'nounos-readme-seen';
const WORLD_PATHS = new Set(['/world', '/world/']);
const HOME_PATHS = new Set(['/', '']);

const APP_TITLES: Record<Exclude<AppKind, 'navigator'>, string> = {
  terminal: 'TERMINAL.EXE',
  manifesto: 'README_CAPTURED.TXT',
  directory: 'INDEX // NOUN.WTF',
  pip3: 'PIP3 // 60r90',
};

const SHORT: Record<Exclude<AppKind, 'navigator'>, string> = {
  terminal: 'TERMINAL',
  manifesto: 'README',
  directory: 'INDEX',
  pip3: 'PIP3',
};

const Loading = () => <div className="nos-loading">loading…</div>;

export default function NounOS({ routes }: { routes: ReactNode }) {
  const { mode, windows } = useOS();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useSiteTheme();
  const waterRef = useRef<WaterHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const path = location.pathname;
  const onWorldPath = WORLD_PATHS.has(path);
  const [gameMounted, setGameMounted] = useState(onWorldPath);
  const [readmeSeen, setReadmeSeen] = useState(() => {
    try {
      return localStorage.getItem(README_KEY) === '1';
    } catch {
      return true;
    }
  });
  const [navKey, setNavKey] = useState(0);
  const [clock, setClock] = useState(() => new Date());

  // One theme: pages render in the light "paper" skin, the OS owns the rest.
  useEffect(() => {
    if (theme !== 'abacus') setTheme('abacus');
  }, [theme, setTheme]);

  // Route ↔ windows: any real page opens the navigator and brings the desk up.
  useEffect(() => {
    if (onWorldPath) {
      os.close('navigator');
      os.setMode('world');
      setGameMounted(true);
    } else if (HOME_PATHS.has(path)) {
      // Home = the agent console over the poster; the game only loads on demand
      os.close('navigator');
      os.setMode('desk');
    } else {
      os.open('navigator');
    }
  }, [path, onWorldPath]);

  useEffect(() => {
    if (mode === 'world') setGameMounted(true);
  }, [mode]);

  useEffect(() => {
    const t = window.setInterval(() => setClock(new Date()), 15000);
    return () => window.clearInterval(t);
  }, []);

  // ` toggles world/desk (never while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el !== null &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.code === 'Backquote' && !typing) {
        e.preventDefault();
        if (os.get().mode === 'world' && !os.isOpen('terminal')) os.open('terminal');
        else os.toggleMode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Pointer parallax: the whole desk leans toward the cursor
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || isMobile()) return;
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      tx = e.clientX / window.innerWidth - 0.5;
      ty = e.clientY / window.innerHeight - 0.5;
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      cx += (tx - cx) * 0.06;
      cy += (ty - cy) * 0.06;
      // On the root so the desk AND the home poster both lean with the pointer
      const host = stage.parentElement ?? stage;
      host.style.setProperty('--rx', `${(-cy * 3.2).toFixed(3)}deg`);
      host.style.setProperty('--ry', `${(cx * 4.5).toFixed(3)}deg`);
    };
    window.addEventListener('pointermove', onMove);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  const goWorld = useCallback(() => {
    setGameMounted(true);
    os.setMode('world');
    if (!onWorldPath) navigate('/world');
  }, [navigate, onWorldPath]);

  const openEntry = useCallback(
    (e: Entry) => {
      if (e.path === '/world') {
        goWorld();
        return;
      }
      if (e.app !== undefined) {
        os.open(e.app);
        return;
      }
      if (e.path === '/world/classic') {
        window.location.assign(e.path);
        return;
      }
      navigate(e.path);
    },
    [goWorld, navigate],
  );

  const openPath = useCallback(
    (p: string) => {
      if (WORLD_PATHS.has(p)) goWorld();
      else navigate(p);
    },
    [goWorld, navigate],
  );

  const closeNavigator = useCallback(() => {
    os.close('navigator');
    navigate('/');
    // Leaving a page shouldn't yank you into the game if other windows are up
    if (os.get().windows.length > 0) os.setMode('desk');
  }, [navigate]);

  const markReadme = () => {
    setReadmeSeen(true);
    try {
      localStorage.setItem(README_KEY, '1');
    } catch {
      // ignore
    }
  };

  const onStageDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    const horizon = window.innerHeight - waterHeight();
    if (e.clientY > horizon) waterRef.current?.ripple(e.clientX, e.clientY, 1);
    else
      document.querySelector<HTMLInputElement>('.nos-prompt input')?.focus({ preventScroll: true });
  };

  const visible = windows.filter(w => !w.minimized);
  const rankOf = (id: AppKind) => {
    const i = visible.findIndex(w => w.id === id);
    return i < 0 ? 0 : visible.length - 1 - i;
  };
  const desk = mode === 'desk';

  const renderApp = (id: AppKind): ReactNode => {
    switch (id) {
      case 'navigator':
        return (
          <Suspense fallback={<Loading />}>
            <div key={navKey} className="nos-page">
              {routes}
            </div>
          </Suspense>
        );
      case 'terminal':
        return (
          <Suspense fallback={<Loading />}>
            <TerminalFeedShell windowed />
          </Suspense>
        );
      case 'manifesto':
        return (
          <Manifesto
            onEnterWorld={() => {
              markReadme();
              goWorld();
            }}
            onOpen={e => {
              markReadme();
              openEntry(e);
            }}
          />
        );
      case 'directory':
        return <Directory onOpen={openEntry} />;
      case 'pip3':
        return (
          <Suspense fallback={<Loading />}>
            <Pip3Page />
          </Suspense>
        );
    }
  };

  return (
    <div className={`nos-root mode-${mode}`}>
      <style>{NOS_CSS}</style>

      {/* 1. the world */}
      <div className="nos-world" aria-hidden={desk}>
        {gameMounted && (
          <Suspense fallback={<div className="nos-world-fallback" />}>
            <World2Page paused={desk} />
          </Suspense>
        )}
      </div>

      {/* 1b. home: the agent, over the Noun World poster (hidden while skating) */}
      {!gameMounted || desk ? (
        <AgentHome
          active={desk && visible.length === 0}
          gameLoaded={gameMounted}
          onEnterWorld={goWorld}
          onOpen={id => os.open(id)}
          onNavigate={openPath}
        />
      ) : null}

      {/* 2. the desk */}
      {/* background clicks (sky → world, water → ripples) land here, under the 3D stage */}
      <div className="nos-backdrop" onPointerDown={onStageDown} />
      <div ref={stageRef} className="nos-stage">
        <div className="nos-space">
          {windows.map(w => (
            <OSWindow
              key={w.id}
              win={w}
              rank={rankOf(w.id)}
              title={w.id === 'navigator' ? `${titleForPath(path)} — NAVIGATOR` : APP_TITLES[w.id]}
              dark={w.id === 'terminal' || w.id === 'pip3' || w.id === 'manifesto'}
              onClose={
                w.id === 'navigator'
                  ? closeNavigator
                  : w.id === 'manifesto'
                    ? () => {
                        markReadme();
                        os.close('manifesto');
                      }
                    : undefined
              }
              contentProps={w.id === 'terminal' ? { 'data-theme': 'terminal' } : undefined}
              toolbar={
                w.id === 'navigator' ? (
                  <NavToolbar
                    path={`${location.pathname}${location.search}`}
                    onGo={openPath}
                    onReload={() => setNavKey(k => k + 1)}
                  />
                ) : undefined
              }
            >
              {renderApp(w.id)}
            </OSWindow>
          ))}
        </div>
      </div>

      {/* 3. the pond */}
      <WaterGarden ref={waterRef} active={desk} />

      <AccessoryIcon onClick={() => os.open('directory')} />

      {/* 4. the tray */}
      <nav className="nos-tray" aria-label="noun.wtf">
        <button type="button" className="nos-chip is-brand" onClick={() => os.open('directory')}>
          <span className="nos-glyph">⌐◨-◨</span> NOUN.WTF
        </button>
        {desk &&
          windows.map(w => (
            <button
              type="button"
              key={w.id}
              className={cx(
                'nos-chip',
                rankOf(w.id) === 0 && !w.minimized && 'is-on',
                w.minimized && 'is-sunk',
              )}
              onClick={() => os.focus(w.id)}
            >
              {w.id === 'navigator' ? titleForPath(path) : SHORT[w.id]}
            </button>
          ))}
        {!desk && (
          <button type="button" className="nos-chip" onClick={() => os.open('terminal')}>
            TERMINAL <span className="nos-key">`</span>
          </button>
        )}
        {!readmeSeen && !os.isOpen('manifesto') && (
          <button type="button" className="nos-chip is-alert" onClick={() => os.open('manifesto')}>
            {desk ? 'README_CAPTURED.TXT' : 'README'}
          </button>
        )}
        <AuctionChip onOpen={openPath} />
        {desk && !os.isOpen('pip3') && (
          <button type="button" className="nos-chip" onClick={() => os.open('pip3')}>
            PIP3
          </button>
        )}
        {desk && (
          <ConnectKitButton.Custom>
            {({ isConnected, show, truncatedAddress, ensName }) => (
              <button type="button" className="nos-chip" onClick={show}>
                {isConnected ? (ensName ?? truncatedAddress) : 'CONNECT'}
              </button>
            )}
          </ConnectKitButton.Custom>
        )}
        <button
          type="button"
          className="nos-chip is-mode"
          onClick={() => (desk ? goWorld() : os.setMode('desk'))}
          title="` toggles"
        >
          {desk ? 'WORLD ↗' : 'DESK ↘'}
        </button>
        {desk && (
          <span className="nos-clock">
            {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </nav>

      {/* 5. always-on notifications */}
      <ChainNotificationsMount />
      <Toaster expand closeButton position="top-right" />
    </div>
  );
}

function NavToolbar({
  path,
  onGo,
  onReload,
}: {
  path: string;
  onGo: (p: string) => void;
  onReload: () => void;
}) {
  const navigate = useNavigate();
  const [val, setVal] = useState(path);
  useEffect(() => setVal(path), [path]);
  return (
    <form
      className="nos-navbar"
      onSubmit={e => {
        e.preventDefault();
        const p = val.replace(/^https?:\/\/(www\.)?noun\.wtf/, '').trim();
        onGo(p.startsWith('/') ? p : `/${p}`);
      }}
    >
      <button type="button" onClick={() => navigate(-1)} title="back">
        ←
      </button>
      <button type="button" onClick={() => navigate(1)} title="forward">
        →
      </button>
      <button type="button" onClick={onReload} title="reload">
        ⟳
      </button>
      <span className="nos-proto">noun.wtf</span>
      <input value={val} onChange={e => setVal(e.target.value)} spellCheck={false} />
    </form>
  );
}
