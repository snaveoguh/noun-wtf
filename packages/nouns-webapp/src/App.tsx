import { lazy, Suspense, useEffect, useState } from 'react';

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useAccount } from 'wagmi';

import AmbientMusic from '@/components/AmbientMusic';
import CandleGate from '@/components/CandleGate';
import DreamWindow from '@/components/DreamWindow';
import { openProposalDraft } from '@/components/GameShell/openProposalDraft';
import { MiniWindowHost } from '@/components/MiniWindow';
import NounOS from '@/components/NounOS/NounOS';
import { THEME_NAMES, useSiteTheme } from '@/contexts/SiteThemeContext';

import 'bootstrap/dist/css/bootstrap.min.css';
import '@/index.css';

// Register all miniapps
import '@/miniapps';

import ReindexingBanner from '@/components/Nounsweeper/ReindexingBanner';
import { useAppDispatch, useAppSelector } from '@/hooks';
import { usePageviewBeacon } from '@/hooks/usePageviewBeacon';
const AuctionPage = lazy(() => import('@/pages/Auction'));
const CandidatePage = lazy(() => import('@/pages/Candidate'));
const CreateCandidatePage = lazy(() => import('@/pages/CreateCandidate'));
const CreateProposalPage = lazy(() => import('@/pages/CreateProposal'));
const DelegatePage = lazy(() => import('@/pages/DelegatePage'));
const EditCandidatePage = lazy(() => import('@/pages/EditCandidate'));
const EditProposalPage = lazy(() => import('@/pages/EditProposal'));
const GovernancePage = lazy(() => import('@/pages/Governance'));
const GrantsPage = lazy(() => import('@/pages/Grants'));
const CreateGrantPage = lazy(() => import('@/pages/Grants/CreateGrant'));
const GrantDetailPage = lazy(() => import('@/pages/Grants/GrantDetail'));
const HackathonPage = lazy(() => import('@/pages/Hackathon'));
const NotFoundPage = lazy(() => import('@/pages/NotFound'));
const NoundersPage = lazy(() => import('@/pages/Nounders'));
const NounV2Page = lazy(() => import('@/pages/NounV2'));
const CreateNounV2ProposalPage = lazy(() => import('@/pages/NounV2/CreateProposal'));
const NounV2DetailPage = lazy(() => import('@/pages/NounV2/Detail'));
const ProbePage = lazy(() => import('@/pages/Probe/ProbePage'));
const PredictionsPage = lazy(() => import('@/pages/Predictions'));
const MarketplacePage = lazy(() => import('@/pages/Marketplace'));
const NounDetailPage = lazy(() => import('@/pages/Marketplace/NounDetail'));
const Playground = lazy(() => import('@/pages/Playground'));
const ProposalHistory = lazy(() => import('@/pages/ProposalHistory'));
const SettlersPage = lazy(() => import('@/pages/SettlersPage'));
const GasLeaderboardPage = lazy(() => import('@/pages/GasLeaderboardPage'));
const StatsPage = lazy(() => import('@/pages/StatsPage'));
const UndergroundPage = lazy(() => import('@/pages/Underground'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const NonsensePage = lazy(() => import('@/pages/NonsensePage'));
const WalletProfilePage = lazy(() => import('@/pages/WalletProfile'));
const StudioPage = lazy(() => import('@/pages/StudioPage'));
const TraitsPage = lazy(() => import('@/pages/TraitsPage'));
const VotePageRouter = lazy(() => import('@/pages/Vote/VotePageRouter'));
import { setActiveAccount } from '@/state/slices/account';
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
        <Route key={t} path={`/${t}/*`} element={<LegacyThemePrefixRedirect />} />
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
  const { theme, setTheme } = useSiteTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const torchMode = useAppSelector(state => state.application.torchMode);
  const [dreamOpen, setDreamOpen] = useState(false);

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

  // Classic world — full-screen canvas, no chrome
  if (location.pathname === '/world/classic') {
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

  // Everything else lives in NounOS: the game on `/`, every page in a window.
  return (
    <>
      <NounOS routes={<SiteRoutes />} />
      {/* Dream creation retro window (opened via the 'open-dream-window' event) */}
      <DreamWindow open={dreamOpen} onClose={() => setDreamOpen(false)} />
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
