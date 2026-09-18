import { lazy, Suspense, useEffect, useState } from 'react';

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useAccount } from 'wagmi';

import AmbientMusic from '@/components/AmbientMusic';
import CandleGate from '@/components/CandleGate';
import DreamWindow from '@/components/DreamWindow';
import { Footer } from '@/components/Footer';
import { openProposalDraft } from '@/components/GameShell/openProposalDraft';
import NavBar from '@/components/NavBar';
import TerminalFeedShell from '@/components/TerminalFeed/TerminalFeedShell';
import { THEME_NAMES, useSiteTheme, type ThemeName } from '@/contexts/SiteThemeContext';

import 'bootstrap/dist/css/bootstrap.min.css';
import '@/index.css';

// Register all miniapps
import '@/miniapps';

import { ChainNotificationsMount } from '@/components/Notifications/useChainNotifications';
import { MiniWindowHost } from '@/components/MiniWindow';
import ReindexingBanner from '@/components/Nounsweeper/ReindexingBanner';
import { Toaster } from '@/components/ui/sonner';
import { useAppDispatch, useAppSelector } from '@/hooks';
import { usePageviewBeacon } from '@/hooks/usePageviewBeacon';
import AuctionPage from '@/pages/Auction';
import CandidatePage from '@/pages/Candidate';
import CreateCandidatePage from '@/pages/CreateCandidate';
import CreateProposalPage from '@/pages/CreateProposal';
import DelegatePage from '@/pages/DelegatePage';
import EditCandidatePage from '@/pages/EditCandidate';
import EditProposalPage from '@/pages/EditProposal';
import GovernancePage from '@/pages/Governance';
import GrantsPage from '@/pages/Grants';
import CreateGrantPage from '@/pages/Grants/CreateGrant';
import GrantDetailPage from '@/pages/Grants/GrantDetail';
import HackathonPage from '@/pages/Hackathon';
import NotFoundPage from '@/pages/NotFound';
import NoundersPage from '@/pages/Nounders';
import NounV2Page from '@/pages/NounV2';
import CreateNounV2ProposalPage from '@/pages/NounV2/CreateProposal';
import NounV2DetailPage from '@/pages/NounV2/Detail';
const ProbePage = lazy(() => import('@/pages/Probe/ProbePage'));
const PredictionsPage = lazy(() => import('@/pages/Predictions'));
const MarketplacePage = lazy(() => import('@/pages/Marketplace'));
const NounDetailPage = lazy(() => import('@/pages/Marketplace/NounDetail'));
import Playground from '@/pages/Playground';
import ProposalHistory from '@/pages/ProposalHistory';
import SettlersPage from '@/pages/SettlersPage';
import GasLeaderboardPage from '@/pages/GasLeaderboardPage';
import StatsPage from '@/pages/StatsPage';
import TreasuryPage from '@/pages/TreasuryPage';
import UndergroundPage from '@/pages/Underground';
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
import NonsensePage from '@/pages/NonsensePage';
const WalletProfilePage = lazy(() => import('@/pages/WalletProfile'));
import StudioPage from '@/pages/StudioPage';
import TraitsPage from '@/pages/TraitsPage';
const VotePageRouter = lazy(() => import('@/pages/Vote/VotePageRouter'));
import { setActiveAccount } from '@/state/slices/account';
import NocTicker from '@/components/NocTicker';
import { useHomeSections } from '@/hooks/useHomeSections';
import SaberOverlay from '@/components/SaberOverlay';
import TorchOverlay from '@/components/TorchOverlay';
import { FeedSkeleton, GenericSkeleton, GovernanceSkeleton } from '@/components/Skeleton';

import classes from './App.module.css';

// Lazy-loaded miniapp pages
const FeedPage = lazy(() => import('@/miniapps/feed/FeedPage'));
const HighwayPage = lazy(() => import('@/miniapps/highway/HighwayPage'));
const CandidatesListPage = lazy(() => import('@/miniapps/candidates/CandidatesPage'));
const TerraformsPage = lazy(() => import('@/miniapps/terraforms/TerraformsPage'));
const CrystalBallPage = lazy(() => import('@/miniapps/crystal-ball/CrystalBallPage'));
const Pip3Page = lazy(() => import('@/pages/Pip3Page'));
const WorldPage = lazy(() => import('@/miniapps/world/WorldPage'));

/**
 * The full set of <Route> definitions extracted into a component so the same
 * routing tree can render either inside the default chrome (NavBar + Footer)
 * or wrapped by a theme shell that owns its own chrome (e.g. BerryShell's
 * Mac window so internal nav stays inside Berry's desktop instead of
 * navigating away to the default site chrome).
 */
/**
 * The main site route table. Paths are written **relative** so the same
 * `<Routes>` tree can be mounted at the site root (`/vote/123`) AND under a
 * theme prefix (`/abacus/vote/123`) without duplicating definitions. The parent
 * `<Route>` consumes the prefix, react-router's descendant `<Routes>` then
 * matches against what's left.
 */
function SiteRoutes() {
  return (
    <Routes>
      <Route index element={<AuctionPage />} />
      <Route path="auction/:id" element={<Navigate to="/noun/:id" replace />} />
      <Route path="noun/:id" element={<AuctionPage />} />
      <Route path="v2" element={<AuctionPage />} />
      <Route path="v2/noun/:id" element={<AuctionPage />} />
      <Route path="nounders" element={<NoundersPage />} />
      <Route path="create-proposal" element={<CreateProposalPage />} />
      <Route path="create-candidate" element={<CreateCandidatePage />} />
      <Route path="vote" element={<GovernancePage />} />
      <Route
        path="vote/:id"
        element={
          <Suspense fallback={<GenericSkeleton />}>
            <VotePageRouter />
          </Suspense>
        }
      />
      <Route path="vote/:id/history" element={<ProposalHistory />} />
      <Route path="vote/:id/history/:versionNumber" element={<ProposalHistory />} />
      <Route
        path="vote/:id/edit"
        element={<EditProposalPage match={{ params: { id: ':id' } }} />}
      />
      <Route
        path="candidates"
        element={
          <Suspense fallback={<GovernanceSkeleton />}>
            <CandidatesListPage />
          </Suspense>
        }
      />
      {/* splat, not :id — candidate slugs can contain "/" (e.g. "24/7/365-…") */}
      <Route path="candidates/*" element={<CandidatePage />} />
      <Route path="candidates/:id/edit" element={<EditCandidatePage />} />
      <Route path="playground" element={<Playground />} />
      <Route path="grants" element={<GrantsPage />} />
      <Route path="grants/create" element={<CreateGrantPage />} />
      <Route path="grants/:id" element={<GrantDetailPage />} />
      <Route path="nounv2" element={<NounV2Page />} />
      <Route path="nounv2/create" element={<CreateNounV2ProposalPage />} />
      <Route path="nounv2/:id" element={<NounV2DetailPage />} />
      <Route path="hackathons" element={<HackathonPage />} />
      <Route path="underground" element={<UndergroundPage />} />
      <Route path="delegate" element={<DelegatePage />} />
      <Route path="traits" element={<TraitsPage />} />
      <Route path="explore" element={<Navigate to="/probe" replace />} />
      <Route path="nouns" element={<Navigate to="/probe" replace />} />
      <Route
        path="probe"
        element={
          <Suspense fallback={<GenericSkeleton />}>
            <ProbePage />
          </Suspense>
        }
      />
      <Route path="studio" element={<StudioPage />} />
      <Route path="settlers" element={<SettlersPage />} />
      <Route path="gas" element={<GasLeaderboardPage />} />
      <Route path="stats" element={<StatsPage />} />
      <Route path="treasury" element={<TreasuryPage />} />
      <Route
        path="dashboard"
        element={
          <Suspense fallback={<GenericSkeleton />}>
            <DashboardPage />
          </Suspense>
        }
      />
      <Route path="nonsense" element={<NonsensePage />} />
      {/* Wallet gamer profile — /gamer is the canonical alias, /explore/wallet kept for old links */}
      {['explore/wallet', 'explore/wallet/:identity', 'gamer', 'gamer/:identity'].map(path => (
        <Route
          key={path}
          path={path}
          element={
            <Suspense fallback={<GenericSkeleton />}>
              <WalletProfilePage />
            </Suspense>
          }
        />
      ))}
      <Route path="dreams" element={<Navigate to="/probe?tab=dreams" replace />} />
      <Route path="dreams/create" element={<Navigate to="/probe?tab=dreams" replace />} />
      <Route
        path="crystal-ball"
        element={
          <Suspense fallback={<GenericSkeleton />}>
            <CrystalBallPage />
          </Suspense>
        }
      />
      <Route
        path="v2/crystal-ball"
        element={
          <Suspense fallback={<GenericSkeleton />}>
            <CrystalBallPage />
          </Suspense>
        }
      />
      <Route
        path="feed"
        element={
          <Suspense fallback={<FeedSkeleton />}>
            <FeedPage />
          </Suspense>
        }
      />
      <Route
        path="highway"
        element={
          <Suspense fallback={<GenericSkeleton />}>
            <HighwayPage />
          </Suspense>
        }
      />
      <Route
        path="terraforms"
        element={
          <Suspense fallback={<GenericSkeleton />}>
            <TerraformsPage />
          </Suspense>
        }
      />
      <Route
        path="terraforms/:id"
        element={
          <Suspense fallback={<GenericSkeleton />}>
            <TerraformsPage />
          </Suspense>
        }
      />
      <Route
        path="pip3"
        element={
          <Suspense fallback={<GenericSkeleton />}>
            <Pip3Page />
          </Suspense>
        }
      />
      <Route
        path="predictions"
        element={
          <Suspense fallback={<GenericSkeleton />}>
            <PredictionsPage />
          </Suspense>
        }
      />
      <Route
        path="marketplace"
        element={
          <Suspense fallback={<GenericSkeleton />}>
            <MarketplacePage />
          </Suspense>
        }
      />
      <Route
        path="marketplace/:nounId"
        element={
          <Suspense fallback={<GenericSkeleton />}>
            <NounDetailPage />
          </Suspense>
        }
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

/**
 * Legacy theme prefixes — themes sunset from the picker but whose share links
 * still exist in the wild. `/pro/vote/123` redirects to `/vote/123` etc. so
 * old links land on the (abacus) default rather than a 404.
 */
const LEGACY_THEME_PREFIXES = ['pro', 'classic', 'game', 'berry', 'catalogue', 'camp'] as const;

function LegacyThemePrefixRedirect() {
  const location = useLocation();
  const firstSegment = location.pathname.split('/').filter(Boolean)[0] ?? '';
  const rest = location.pathname.slice(`/${firstSegment}`.length) || '/';
  return <Navigate to={`${rest}${location.search}`} replace />;
}

/**
 * Wrapper for `/<theme>/*` routes — sets the active theme based on the URL
 * param, then renders the appropriate shell. Both themes pass through to the
 * full SiteRoutes tree under their prefix — `/abacus/vote/123` and
 * `/terminal/candidates` both work because `logicalPath` strips the prefix
 * before downstream routing.
 */
function ThemePrefixRoute() {
  const { theme: currentTheme, setTheme } = useSiteTheme();
  const location = useLocation();

  // Detect which theme prefix is in the URL — we mount one of these per
  // theme above, so the first segment is guaranteed to be a real theme name
  // by the time we render here.
  const firstSegment = location.pathname.split('/').filter(Boolean)[0] ?? '';
  const targetTheme = (THEME_NAMES as readonly string[]).includes(firstSegment)
    ? (firstSegment as ThemeName)
    : null;

  // Sync URL → theme state. Persists to localStorage via setTheme so reloads
  // and ?theme= fallbacks both work.
  useEffect(() => {
    if (targetTheme && targetTheme !== currentTheme) {
      setTheme(targetTheme);
    }
  }, [targetTheme, currentTheme, setTheme]);

  if (!targetTheme) {
    return <Navigate to="/" replace />;
  }

  // Once theme is set, defer to `ThemedAppContent`, which handles the actual
  // shell dispatch and is a single source of truth for which UI renders for
  // a given (theme, path) pair.
  // NOTE: we render `ThemedAppContent` even when `targetTheme !== currentTheme`
  // (the sync effect above hasn't committed yet). This used to `return null`,
  // which blanked the screen for a frame — a visible flash on every theme
  // switch. Rendering through means the worst case is one frame of the previous
  // theme's home instead of an empty screen.
  return <ThemedAppContent />;
}

/** Inner router — uses useLocation to conditionally show chrome vs terminal */
function AppRouter() {
  const navigate = useNavigate();
  const location = useLocation();
  usePageviewBeacon();

  useEffect(() => {
    // Backwards-compat: legacy share links of the form `/?theme=foo` redirect
    // to the new `/foo` URL prefix. We do this once on mount per location so
    // share links keep working without growing the URL state.
    const params = new URLSearchParams(location.search);
    const themeParam = params.get('theme');
    const isThemePrefixed = THEME_NAMES.some(
      t => location.pathname === `/${t}` || location.pathname.startsWith(`/${t}/`),
    );
    if (themeParam && (THEME_NAMES as readonly string[]).includes(themeParam) && !isThemePrefixed) {
      params.delete('theme');
      const remaining = params.toString();
      navigate(`/${themeParam}${remaining ? `?${remaining}` : ''}`, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  return (
    <Routes>
      {/* Theme-prefixed routes — one per known theme so we don't shadow other
          top-level routes like `/vote` or `/probe` with a wildcard
          `:themeName` that would also greedily match them. */}
      {THEME_NAMES.map(t => (
        <Route key={t} path={`/${t}/*`} element={<ThemePrefixRoute />} />
      ))}
      {/* Sunset theme prefixes — redirect old share links into the default theme. */}
      {LEGACY_THEME_PREFIXES.map(t => (
        <Route key={t} path={`/${t}/*`} element={<LegacyThemePrefixRedirect />} />
      ))}
      {/* Default route — renders whichever theme is currently active. */}
      <Route path="*" element={<ThemedAppContent />} />
    </Routes>
  );
}

/**
 * The original AppRouter body, factored out so it can render either at the
 * site root or beneath a `/<theme>` prefix. All path checks are normalised
 * against `logicalPath` — the pathname with any active theme prefix stripped
 * — so a hard-coded check like `logicalPath === '/'` matches both `/` (when
 * theme='terminal') AND `/terminal` (which strips to `/`).
 */
function ThemedAppContent() {
  const { mode, theme, setTheme } = useSiteTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const torchMode = useAppSelector(state => state.application.torchMode);
  const [dreamOpen, setDreamOpen] = useState(false);
  const [saberMode, setSaberMode] = useState(false);

  // Strip any `/<theme>` prefix from the pathname for downstream checks. The
  // checks below all compare against canonical `/`, `/create-proposal` etc;
  // we want them to match regardless of whether the URL has a theme prefix.
  const themePrefix =
    THEME_NAMES.find(
      t => location.pathname === `/${t}` || location.pathname.startsWith(`/${t}/`),
    ) ?? null;
  const logicalPath = themePrefix
    ? location.pathname.slice(`/${themePrefix}`.length) || '/'
    : location.pathname;

  const isTerminalHome = mode === 'new' && logicalPath === '/';

  // The desktop noc ticker is global chrome, but on the auction home it's one
  // of the opt-in "sections" (default off) so the Dice home stays just noun +
  // auction. Every other route keeps it unconditionally.
  const { isEnabled: isHomeSectionEnabled } = useHomeSections();
  const isAuctionHome =
    logicalPath === '/' ||
    logicalPath === '/v2' ||
    logicalPath.startsWith('/noun/') ||
    logicalPath.startsWith('/v2/noun/');
  const showDesktopTicker = !isAuctionHome || isHomeSectionEnabled('nocTicker');

  useEffect(() => {
    const handler = () => setDreamOpen(true);
    window.addEventListener('open-dream-window', handler);
    return () => window.removeEventListener('open-dream-window', handler);
  }, []);

  // Backwards-compat: rewrite legacy `?dao=nounv2` URLs to the new `/v2`
  // namespace before any route-level rendering. Sits at the router level
  // so it fires even when terminal mode preempts AuctionPage on `/`.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('dao') !== 'nounv2') return;
    const isAuctionRoute = logicalPath === '/' || logicalPath.startsWith('/noun/');
    if (!isAuctionRoute) return;
    const idMatch = logicalPath.match(/^\/noun\/(.+)$/);
    const nextPath = idMatch ? `/v2/noun/${idMatch[1]}` : '/v2';
    navigate(nextPath, { replace: true });
  }, [logicalPath, location.search, navigate]);

  // Terminal only owns the home page (the feed). Any other route silently
  // switches the user to `abacus` so internal pages render with the full
  // (abacus-skinned) site chrome. Skipped when the URL explicitly carries a
  // `/terminal/...` prefix — that's the escape hatch for browsing internal
  // pages in terminal skin on purpose.
  useEffect(() => {
    if (themePrefix) return;
    if (logicalPath === '/') return;
    if (theme === 'abacus') return;
    setTheme('abacus');
  }, [logicalPath, themePrefix, theme, setTheme]);

  // Terminal mode on root — render only the terminal feed, nothing else
  if (isTerminalHome) {
    return <TerminalFeedShell />;
  }

  // World — full-screen canvas, no chrome
  if (location.pathname === '/world') {
    return (
      <Suspense
        fallback={<div style={{ background: '#1a4f8a', width: '100vw', height: '100vh' }} />}
      >
        <WorldPage />
        {/* Ambient music FAB — autostarts on /world, same procedural player
            used on /probe and /terraforms. */}
        <div
          style={{
            position: 'fixed',
            bottom: '1rem',
            right: '1rem',
            zIndex: 900,
          }}
        >
          <AmbientMusic variant="inline" autoStart />
        </div>
      </Suspense>
    );
  }

  // Classic mode or deep link — show full site chrome
  return (
    <>
      {showDesktopTicker && (
        <div className="hidden lg:block">
          <NocTicker />
        </div>
      )}
      <NavBar />
      <SiteRoutes />
      <Footer />
      {/* <HeliosStatusBar /> — disabled: a16z consensus endpoints are down, causes infinite 502 retry loop */}
      <ChainNotificationsMount />
      <Toaster
        expand
        closeButton
        toastOptions={{
          classNames: {
            closeButton:
              '[--toast-close-button-start:auto] [--toast-close-button-end:0] [--toast-close-button-transform:translate(35%,-35%)]',
          },
        }}
      />

      {/* Fixed bottom-right liquid glass icon buttons */}
      <div
        style={{
          position: 'fixed',
          bottom: '1rem',
          right: '1rem',
          zIndex: 900,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          alignItems: 'center',
        }}
      >
        {/* Ambient music play/pause above the saber button — shown on Probe, Terraforms, and World (autostarts on /world) */}
        {(location.pathname.startsWith('/probe') ||
          location.pathname.startsWith('/terraforms') ||
          location.pathname.startsWith('/world')) && (
          <AmbientMusic variant="inline" autoStart={location.pathname.startsWith('/world')} />
        )}
        <button
          onClick={() => setSaberMode(s => !s)}
          title={saberMode ? 'Exit Saber' : 'Saber'}
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.4)',
            background: saberMode ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.2)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.1), 0 0 0 1px rgba(255,255,255,0.15) inset',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.2rem',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = saberMode
              ? 'rgba(239, 68, 68, 0.4)'
              : 'rgba(255, 255, 255, 0.35)';
            e.currentTarget.style.transform = 'scale(1.08)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = saberMode
              ? 'rgba(239, 68, 68, 0.25)'
              : 'rgba(255, 255, 255, 0.2)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          {saberMode ? '\u2716' : '\u2694\uFE0F'}
        </button>
        <button
          onClick={() => setDreamOpen(true)}
          title="Dream"
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.4)',
            background: 'rgba(255, 255, 255, 0.2)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.1), 0 0 0 1px rgba(255,255,255,0.15) inset',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.2rem',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.35)';
            e.currentTarget.style.transform = 'scale(1.08)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          {'\uD83D\uDCA4'}
        </button>
      </div>

      {/* Dream creation retro window */}
      <DreamWindow open={dreamOpen} onClose={() => setDreamOpen(false)} />

      {/* Saber battle overlay */}
      <SaberOverlay active={saberMode} onClose={() => setSaberMode(false)} />

      {/* Torch / dungeon mode overlay + music */}
      <TorchOverlay active={torchMode} />
      <CandleGate />
    </>
  );
}

function App() {
  const { address: account } = useAccount();
  const torchMode = useAppSelector(state => state.application.torchMode);

  const dispatch = useAppDispatch();
  dayjs.extend(relativeTime);

  useEffect(() => {
    dispatch(setActiveAccount(account));
  }, [account, dispatch]);

  // Expose proposal-draft entrypoint for NounIRL + dev console invocation.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as unknown as { __openProposalDraft: typeof openProposalDraft }).__openProposalDraft =
      openProposalDraft;
  }, []);

  return (
    <div className={`${classes.wrapper}`} style={torchMode ? { cursor: 'none' } : undefined}>
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
      <MiniWindowHost />
      <ReindexingBanner />
    </div>
  );
}

export default App;
