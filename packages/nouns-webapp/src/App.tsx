import { lazy, Suspense, useEffect, useState } from 'react';

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useAccount } from 'wagmi';

import CandleGate from '@/components/CandleGate';
import DreamWindow from '@/components/DreamWindow';
import { Footer } from '@/components/Footer';
import HeliosStatusBar from '@/components/HeliosStatusBar';
import LolLogo from '@/components/LolLogo';
import NavBar from '@/components/NavBar';
import TerminalFeedShell from '@/components/TerminalFeed/TerminalFeedShell';
import { useSiteTheme } from '@/contexts/SiteThemeContext';

import 'bootstrap/dist/css/bootstrap.min.css';
import '@/index.css';

// Register all miniapps
import '@/miniapps';

import NetworkAlert from '@/components/NetworkAlert';
import { Toaster } from '@/components/ui/sonner';
import { CHAIN_ID } from '@/config';
import { useAppDispatch, useAppSelector } from '@/hooks';
import AuctionPage from '@/pages/Auction';
import CandidatePage from '@/pages/Candidate';
import CreateCandidatePage from '@/pages/CreateCandidate';
import CreateProposalPage from '@/pages/CreateProposal';
import DelegatePage from '@/pages/DelegatePage';
import DreamCreatePage from '@/pages/DreamCreatePage';
import DreamsPage from '@/pages/DreamsPage';
import EditProposalPage from '@/pages/EditProposal';
import GovernancePage from '@/pages/Governance';
import GrantsPage from '@/pages/Grants';
import CreateGrantPage from '@/pages/Grants/CreateGrant';
import GrantDetailPage from '@/pages/Grants/GrantDetail';
import HackathonPage from '@/pages/Hackathon';
import NotFoundPage from '@/pages/NotFound';
import NoundersPage from '@/pages/Nounders';
import NounsPage from '@/pages/NounsPage';
import Playground from '@/pages/Playground';
import UndergroundPage from '@/pages/Underground';
import ProposalHistory from '@/pages/ProposalHistory';
import SettlersPage from '@/pages/SettlersPage';
import StatsPage from '@/pages/StatsPage';
import StudioPage from '@/pages/StudioPage';
import TraitsPage from '@/pages/TraitsPage';
import VotePage from '@/pages/Vote';
import { setActiveAccount } from '@/state/slices/account';
import NocTicker from '@/components/NocTicker';
import SaberOverlay from '@/components/SaberOverlay';
import TorchOverlay from '@/components/TorchOverlay';
import {
  FeedSkeleton,
  GenericSkeleton,
  GovernanceSkeleton,
  TerminalSkeleton,
} from '@/components/Skeleton';

import classes from './App.module.css';

// Lazy-loaded miniapp pages
const TerminalPage = lazy(() => import('@/miniapps/terminal/TerminalPage'));
const FeedPage = lazy(() => import('@/miniapps/feed/FeedPage'));
const HighwayPage = lazy(() => import('@/miniapps/highway/HighwayPage'));
const CandidatesListPage = lazy(() => import('@/miniapps/candidates/CandidatesPage'));
const TerraformsPage = lazy(() => import('@/miniapps/terraforms/TerraformsPage'));
const CrystalBallPage = lazy(() => import('@/miniapps/crystal-ball/CrystalBallPage'));
const Pip3Page = lazy(() => import('@/pages/Pip3Page'));
const WorldPage = lazy(() => import('@/miniapps/world/WorldPage'));

/** Floating mega menu — + button top-left, centered LOL, mode toggles top-right */
function MiniNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { mode, setMode } = useSiteTheme();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const torchMode = useAppSelector(state => state.application.torchMode);

  const go = (path: string) => { setMenuOpen(false); navigate(path); };
  const ext = (url: string) => { setMenuOpen(false); window.open(url, '_blank'); };

  return (
    <>
      {/* Floating + button — top left */}
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        style={{
          position: 'fixed', top: 12, left: 12, zIndex: 10000,
          width: 36, height: 36, borderRadius: 10,
          border: 'none',
          background: menuOpen
            ? '#111'
            : 'linear-gradient(135deg, #d5584d, #e8a54d, #d5584d)',
          color: menuOpen ? '#fff' : '#fff',
          fontSize: 22, fontWeight: 900, lineHeight: 1,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: menuOpen ? '0 2px 20px rgba(0,0,0,0.3)' : '0 2px 8px rgba(213,88,77,0.3)',
          transition: 'all 0.2s ease',
        }}
      >
        {menuOpen ? '×' : '+'}
      </button>

      {/* Mode toggles — top right */}
      <div style={{
        position: 'fixed', top: 12, right: 12, zIndex: 10000,
        display: 'flex', gap: 6, alignItems: 'center',
      }}>
        <button onClick={() => setMode(mode === 'new' ? 'classic' : 'new')} style={{
          padding: '6px 12px', borderRadius: 8, border: 'none',
          background: 'rgba(0,0,0,0.06)', cursor: 'pointer',
          fontSize: 11, fontFamily: 'monospace', fontWeight: 600,
          color: '#555', backdropFilter: 'blur(8px)',
          transition: 'all 0.15s',
        }}>
          {mode === 'new' ? 'classic' : 'new'}
        </button>
        <button onClick={() => dispatch({ type: 'application/setTorchMode', payload: !torchMode })} style={{
          width: 32, height: 32, borderRadius: 8, border: 'none',
          background: 'rgba(0,0,0,0.06)', cursor: 'pointer',
          fontSize: 16, backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {torchMode ? '☀️' : '🌙'}
        </button>
        <ConnectKitButton.Custom>
          {({ isConnected, show, address }) => (
            <button onClick={show} style={{
              padding: '6px 12px', borderRadius: 8, border: 'none',
              background: isConnected ? 'rgba(0,0,0,0.06)' : 'linear-gradient(135deg, #d5584d, #e8a54d)',
              color: isConnected ? '#333' : '#fff',
              cursor: 'pointer', fontSize: 11, fontFamily: 'monospace', fontWeight: 600,
              backdropFilter: 'blur(8px)',
            }}>
              {isConnected ? `${address?.slice(0, 6)}...${address?.slice(-4)}` : 'connect'}
            </button>
          )}
        </ConnectKitButton.Custom>
      </div>

      {/* Mega menu — dark, full screen, sexy */}
      {menuOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(8,8,12,0.95)', backdropFilter: 'blur(30px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setMenuOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 48, maxWidth: 900, width: '100%', padding: '0 32px',
            }}
          >
            {[
              {
                title: 'GOVERN',
                items: [
                  { label: 'Proposals', action: () => go('/vote') },
                  { label: 'Candidates', action: () => go('/candidates') },
                  { label: 'Grants', action: () => go('/grants') },
                  { label: 'Submit Proposal', action: () => go('/create-proposal') },
                ],
              },
              {
                title: 'EXPLORE',
                items: [
                  { label: '⌐◧-◧ World', action: () => go('/world') },
                  { label: 'Crystal Ball', action: () => go('/crystal-ball') },
                  { label: 'Hack the Treasury', action: () => go('/hackathons') },
                  { label: 'Terminal', action: () => go('/terminal') },
                  { label: 'Gallery', action: () => go('/nouns') },
                  { label: 'Studio', action: () => go('/studio') },
                ],
              },
              {
                title: 'ECOSYSTEM',
                items: [
                  { label: 'Probe', action: () => ext('https://probe.wtf'), external: true },
                  { label: 'Dreams', action: () => ext('https://probe.wtf/dreams/create'), external: true },
                  { label: 'Pooter', action: () => ext('https://pooter.world'), external: true },
                  { label: 'Lils', action: () => ext('https://lils.wtf'), external: true },
                  { label: 'Nouns.wtf', action: () => ext('https://nouns.wtf'), external: true },
                ],
              },
              {
                title: 'MORE',
                items: [
                  { label: 'Stats', action: () => go('/stats') },
                  { label: 'Settlers', action: () => go('/settlers') },
                  { label: 'Feed', action: () => go('/feed') },
                  { label: 'Highway', action: () => go('/highway') },
                  { label: 'Nounders', action: () => go('/nounders') },
                ],
              },
            ].map(section => (
              <div key={section.title}>
                <div style={{
                  fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)',
                  marginBottom: 16, fontFamily: 'monospace', fontWeight: 700,
                }}>
                  {section.title}
                </div>
                {section.items.map(item => (
                  <div
                    key={item.label}
                    onClick={item.action}
                    style={{
                      padding: '10px 0', color: 'rgba(255,255,255,0.75)',
                      fontSize: 16, fontFamily: 'monospace', cursor: 'pointer',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      transition: 'color 0.15s, padding-left 0.15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.color = '#fff';
                      e.currentTarget.style.paddingLeft = '8px';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.color = 'rgba(255,255,255,0.75)';
                      e.currentTarget.style.paddingLeft = '0px';
                    }}
                  >
                    {item.label}
                    {(item as any).external && <span style={{ opacity: 0.4, marginLeft: 6 }}>↗</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** Inner router — uses useLocation to conditionally show chrome vs terminal */
function AppRouter() {
  const { mode } = useSiteTheme();
  const location = useLocation();
  const torchMode = useAppSelector(state => state.application.torchMode);
  const [dreamOpen, setDreamOpen] = useState(false);
  const [saberMode, setSaberMode] = useState(false);

  const isTerminalHome = mode === 'new' && location.pathname === '/';

  useEffect(() => {
    const handler = () => setDreamOpen(true);
    window.addEventListener('open-dream-window', handler);
    return () => window.removeEventListener('open-dream-window', handler);
  }, []);

  // Terminal mode on root — render only the terminal feed, nothing else
  if (isTerminalHome) {
    return <TerminalFeedShell />;
  }

  // World — full-screen canvas, no chrome
  if (location.pathname === '/world') {
    return (
      <Suspense fallback={<div style={{ background: '#1a4f8a', width: '100vw', height: '100vh' }} />}>
        <WorldPage />
      </Suspense>
    );
  }

  // Classic mode or deep link — show full site chrome
  return (
    <>
      <NocTicker />
      <NavBar />
      <Routes>
        <Route path="/" element={<AuctionPage />} />
        <Route path="/auction/:id" element={<Navigate to="/noun/:id" replace />} />
        <Route path="/noun/:id" element={<AuctionPage />} />
        <Route path="/nounders" element={<NoundersPage />} />
        <Route path="/create-proposal" element={<CreateProposalPage />} />
        <Route path="/create-candidate" element={<CreateCandidatePage />} />
        <Route path="/vote" element={<GovernancePage />} />
        <Route path="/vote/:id" element={<VotePage />} />
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
        <Route path="/hackathons" element={<HackathonPage />} />
        <Route path="/underground" element={<UndergroundPage />} />
        <Route path="/delegate" element={<DelegatePage />} />
        <Route path="/traits" element={<TraitsPage />} />
        <Route path="/explore" element={<Navigate to="/nouns" replace />} />
        <Route path="/nouns" element={<NounsPage />} />
        <Route path="/studio" element={<StudioPage />} />
        <Route path="/settlers" element={<SettlersPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/dreams" element={<DreamsPage />} />
        <Route path="/dreams/create" element={<DreamCreatePage />} />
        {/* Miniapp routes (lazy loaded) */}
        <Route
          path="/terminal"
          element={
            <Suspense fallback={<TerminalSkeleton />}>
              <TerminalPage />
            </Suspense>
          }
        />
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
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <Footer />
      <HeliosStatusBar />
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
