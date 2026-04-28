import { lazy, Suspense, useEffect, useState } from 'react';

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useAccount } from 'wagmi';

import AmbientMusic from '@/components/AmbientMusic';
import CandleGate from '@/components/CandleGate';
import DreamWindow from '@/components/DreamWindow';
import { Footer } from '@/components/Footer';
import NavBar from '@/components/NavBar';
import NetworkAlert from '@/components/NetworkAlert';
import TerminalFeedShell from '@/components/TerminalFeed/TerminalFeedShell';
import { useSiteTheme } from '@/contexts/SiteThemeContext';

import 'bootstrap/dist/css/bootstrap.min.css';
import '@/index.css';

// Register all miniapps
import '@/miniapps';

import { Toaster } from '@/components/ui/sonner';
import { CHAIN_ID } from '@/config';
import { useAppDispatch, useAppSelector } from '@/hooks';
import AuctionPage from '@/pages/Auction';
import CandidatePage from '@/pages/Candidate';
import CreateCandidatePage from '@/pages/CreateCandidate';
import CreateProposalPage from '@/pages/CreateProposal';
import DelegatePage from '@/pages/DelegatePage';
import EditProposalPage from '@/pages/EditProposal';
import GovernancePage from '@/pages/Governance';
import GrantsPage from '@/pages/Grants';
import CreateGrantPage from '@/pages/Grants/CreateGrant';
import GrantDetailPage from '@/pages/Grants/GrantDetail';
import HackathonPage from '@/pages/Hackathon';
import NounV2Page from '@/pages/NounV2';
import NounV2DetailPage from '@/pages/NounV2/Detail';
import CreateNounV2ProposalPage from '@/pages/NounV2/CreateProposal';
import NotFoundPage from '@/pages/NotFound';
import NoundersPage from '@/pages/Nounders';
const ProbePage = lazy(() => import('@/pages/Probe/ProbePage'));
const PredictionsPage = lazy(() => import('@/pages/Predictions'));
const MarketplacePage = lazy(() => import('@/pages/Marketplace'));
const NounDetailPage = lazy(() => import('@/pages/Marketplace/NounDetail'));
import Playground from '@/pages/Playground';
import ProposalHistory from '@/pages/ProposalHistory';
import SettlersPage from '@/pages/SettlersPage';
import GasLeaderboardPage from '@/pages/GasLeaderboardPage';
import StatsPage from '@/pages/StatsPage';
import UndergroundPage from '@/pages/Underground';
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
import NonsensePage from '@/pages/NonsensePage';
import StudioPage from '@/pages/StudioPage';
import TraitsPage from '@/pages/TraitsPage';
const VotePageRouter = lazy(() => import('@/pages/Vote/VotePageRouter'));
import { setActiveAccount } from '@/state/slices/account';
import NocTicker from '@/components/NocTicker';
import SaberOverlay from '@/components/SaberOverlay';
import TorchOverlay from '@/components/TorchOverlay';
import {
  FeedSkeleton,
  GenericSkeleton,
  GovernanceSkeleton,
} from '@/components/Skeleton';

import classes from './App.module.css';

// Lazy-loaded miniapp pages
const FeedPage = lazy(() => import('@/miniapps/feed/FeedPage'));
const HighwayPage = lazy(() => import('@/miniapps/highway/HighwayPage'));
const CandidatesListPage = lazy(() => import('@/miniapps/candidates/CandidatesPage'));
const TerraformsPage = lazy(() => import('@/miniapps/terraforms/TerraformsPage'));
const CrystalBallPage = lazy(() => import('@/miniapps/crystal-ball/CrystalBallPage'));
const Pip3Page = lazy(() => import('@/pages/Pip3Page'));
const WorldPage = lazy(() => import('@/miniapps/world/WorldPage'));

/** Inner router — uses useLocation to conditionally show chrome vs terminal */
function AppRouter() {
  const { mode } = useSiteTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const torchMode = useAppSelector(state => state.application.torchMode);
  const [dreamOpen, setDreamOpen] = useState(false);
  const [saberMode, setSaberMode] = useState(false);

  const isTerminalHome = mode === 'new' && location.pathname === '/';

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
    const isAuctionRoute =
      location.pathname === '/' || location.pathname.startsWith('/noun/');
    if (!isAuctionRoute) return;
    const idMatch = location.pathname.match(/^\/noun\/(.+)$/);
    const nextPath = idMatch ? `/v2/noun/${idMatch[1]}` : '/v2';
    navigate(nextPath, { replace: true });
  }, [location.pathname, location.search, navigate]);

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
      <div className="hidden lg:block">
        <NocTicker />
      </div>
      <NavBar />
      <Routes>
        <Route path="/" element={<AuctionPage />} />
        <Route path="/auction/:id" element={<Navigate to="/noun/:id" replace />} />
        <Route path="/noun/:id" element={<AuctionPage />} />
        {/* V2 auction routes — split namespace so URL alone owns DAO context.
             The Auction page detects `/v2*` via useActiveDao and swaps in the
             V2 contracts/seed loader/holder reads. */}
        <Route path="/v2" element={<AuctionPage />} />
        <Route path="/v2/noun/:id" element={<AuctionPage />} />
        <Route path="/nounders" element={<NoundersPage />} />
        <Route path="/create-proposal" element={<CreateProposalPage />} />
        <Route path="/create-candidate" element={<CreateCandidatePage />} />
        <Route path="/vote" element={<GovernancePage />} />
        <Route
          path="/vote/:id"
          element={
            <Suspense fallback={<GenericSkeleton />}>
              <VotePageRouter />
            </Suspense>
          }
        />
        <Route path="/vote/:id/history" element={<ProposalHistory />} />
        <Route path="/vote/:id/history/:versionNumber" element={<ProposalHistory />} />
        <Route
          path="/vote/:id/edit"
          element={<EditProposalPage match={{ params: { id: ':id' } }} />}
        />
        <Route
          path="/candidates"
          element={
            <Suspense fallback={<GovernanceSkeleton />}>
              <CandidatesListPage />
            </Suspense>
          }
        />
        <Route path="/candidates/:id" element={<CandidatePage />} />
        <Route path="/playground" element={<Playground />} />
        <Route path="/grants" element={<GrantsPage />} />
        <Route path="/grants/create" element={<CreateGrantPage />} />
        <Route path="/grants/:id" element={<GrantDetailPage />} />
        <Route path="/nounv2" element={<NounV2Page />} />
        <Route path="/nounv2/create" element={<CreateNounV2ProposalPage />} />
        <Route path="/nounv2/:id" element={<NounV2DetailPage />} />
        <Route path="/hackathons" element={<HackathonPage />} />
        <Route path="/underground" element={<UndergroundPage />} />
        <Route path="/delegate" element={<DelegatePage />} />
        <Route path="/traits" element={<TraitsPage />} />
        <Route path="/explore" element={<Navigate to="/probe" replace />} />
        <Route path="/nouns" element={<Navigate to="/probe" replace />} />
        <Route
          path="/probe"
          element={
            <Suspense fallback={<GenericSkeleton />}>
              <ProbePage />
            </Suspense>
          }
        />
        <Route path="/studio" element={<StudioPage />} />
        <Route path="/settlers" element={<SettlersPage />} />
        <Route path="/gas" element={<GasLeaderboardPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route
          path="/dashboard"
          element={
            <Suspense fallback={<GenericSkeleton />}>
              <DashboardPage />
            </Suspense>
          }
        />
        <Route path="/nonsense" element={<NonsensePage />} />
        <Route path="/dreams" element={<Navigate to="/probe?tab=dreams" replace />} />
        <Route path="/dreams/create" element={<Navigate to="/probe?tab=dreams" replace />} />
        {/* Miniapp routes (lazy loaded) */}
        {/* /terminal sunset 2026-04-27 — consolidated into homepage TerminalFeed
            (see TerminalFeedShell on `/` when site mode === 'new'). Keep redirect
            so old links/CTAs land on the merged feed. */}
        <Route path="/terminal" element={<Navigate to="/" replace />} />
        <Route
          path="/crystal-ball"
          element={
            <Suspense fallback={<GenericSkeleton />}>
              <CrystalBallPage />
            </Suspense>
          }
        />
        <Route
          path="/feed"
          element={
            <Suspense fallback={<FeedSkeleton />}>
              <FeedPage />
            </Suspense>
          }
        />
        <Route
          path="/highway"
          element={
            <Suspense fallback={<GenericSkeleton />}>
              <HighwayPage />
            </Suspense>
          }
        />
        <Route
          path="/terraforms"
          element={
            <Suspense fallback={<GenericSkeleton />}>
              <TerraformsPage />
            </Suspense>
          }
        />
        <Route
          path="/terraforms/:id"
          element={
            <Suspense fallback={<GenericSkeleton />}>
              <TerraformsPage />
            </Suspense>
          }
        />
        <Route
          path="/pip3"
          element={
            <Suspense fallback={<GenericSkeleton />}>
              <Pip3Page />
            </Suspense>
          }
        />
        <Route
          path="/predictions"
          element={
            <Suspense fallback={<GenericSkeleton />}>
              <PredictionsPage />
            </Suspense>
          }
        />
        <Route
          path="/marketplace"
          element={
            <Suspense fallback={<GenericSkeleton />}>
              <MarketplacePage />
            </Suspense>
          }
        />
        <Route
          path="/marketplace/:nounId"
          element={
            <Suspense fallback={<GenericSkeleton />}>
              <NounDetailPage />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <Footer />
      {/* <HeliosStatusBar /> — disabled: a16z consensus endpoints are down, causes infinite 502 retry loop */}
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
  const { address: account, chainId } = useAccount();
  const torchMode = useAppSelector(state => state.application.torchMode);

  const dispatch = useAppDispatch();
  dayjs.extend(relativeTime);

  useEffect(() => {
    dispatch(setActiveAccount(account));
  }, [account, dispatch]);

  return (
    <div className={`${classes.wrapper}`} style={torchMode ? { cursor: 'none' } : undefined}>
      {chainId !== undefined && Number(CHAIN_ID) !== chainId && <NetworkAlert />}
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
    </div>
  );
}

export default App;
