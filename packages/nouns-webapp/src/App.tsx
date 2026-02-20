import { lazy, Suspense, useEffect, useState } from 'react';

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useAccount } from 'wagmi';

import 'bootstrap/dist/css/bootstrap.min.css';
import '@/index.css';

// Register all miniapps
import '@/miniapps';

import { Footer } from '@/components/Footer';
import NavBar from '@/components/NavBar';
import NetworkAlert from '@/components/NetworkAlert';
import { Toaster } from '@/components/ui/sonner';
import { CHAIN_ID } from '@/config';
import { useAppDispatch } from '@/hooks';
import AuctionPage from '@/pages/Auction';
import CandidatePage from '@/pages/Candidate';
import CreateCandidatePage from '@/pages/CreateCandidate';
import CreateProposalPage from '@/pages/CreateProposal';
import DelegatePage from '@/pages/DelegatePage';
import EditProposalPage from '@/pages/EditProposal';
import GovernancePage from '@/pages/Governance';
import NotFoundPage from '@/pages/NotFound';
import NoundersPage from '@/pages/Nounders';
import NounsPage from '@/pages/NounsPage';
import Playground from '@/pages/Playground';
import ProposalHistory from '@/pages/ProposalHistory';
import DreamCreatePage from '@/pages/DreamCreatePage';
import DreamsPage from '@/pages/DreamsPage';
import SettlersPage from '@/pages/SettlersPage';
import StudioPage from '@/pages/StudioPage';
import TraitsPage from '@/pages/TraitsPage';
import VotePage from '@/pages/Vote';
import { setActiveAccount } from '@/state/slices/account';

import DreamWindow from '@/components/DreamWindow';
import { ProbeButton } from '@/components/ProbeButton';
import SaberOverlay from '@/components/SaberOverlay';
import TorchOverlay from '@/components/TorchOverlay';
import { useAppSelector } from '@/hooks';

import classes from './App.module.css';

// Lazy-loaded miniapp pages
const TerminalPage = lazy(() => import('@/miniapps/terminal/TerminalPage'));
const FeedPage = lazy(() => import('@/miniapps/feed/FeedPage'));
const HighwayPage = lazy(() => import('@/miniapps/highway/HighwayPage'));
const SaberArenaPage = lazy(() => import('@/miniapps/saber/SaberArenaPage'));

function App() {
  const { address: account, chainId } = useAccount();
  const [dreamOpen, setDreamOpen] = useState(false);
  const [saberMode, setSaberMode] = useState(false);
  const torchMode = useAppSelector(state => state.application.torchMode);

  const dispatch = useAppDispatch();
  dayjs.extend(relativeTime);

  useEffect(() => {
    // Local account array updated
    dispatch(setActiveAccount(account));
  }, [account, dispatch]);

  // Listen for "dream a lil dream" button on auction page
  useEffect(() => {
    const handler = () => setDreamOpen(true);
    window.addEventListener('open-dream-window', handler);
    return () => window.removeEventListener('open-dream-window', handler);
  }, []);

  return (
    <div className={`${classes.wrapper}`} style={torchMode ? { cursor: 'none' } : undefined}>
      {chainId !== undefined && Number(CHAIN_ID) !== chainId && <NetworkAlert />}
      <BrowserRouter>
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
          <Route path="/candidates/:id" element={<CandidatePage />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="/delegate" element={<DelegatePage />} />
          <Route path="/traits" element={<TraitsPage />} />
          <Route path="/explore" element={<Navigate to="/nouns" replace />} />
          <Route path="/nouns" element={<NounsPage />} />
          <Route path="/studio" element={<StudioPage />} />
          <Route path="/settlers" element={<SettlersPage />} />
          <Route path="/dreams" element={<DreamsPage />} />
          <Route path="/dreams/create" element={<DreamCreatePage />} />
          {/* Miniapp routes (lazy loaded) */}
          <Route path="/terminal" element={<Suspense fallback={null}><TerminalPage /></Suspense>} />
          <Route path="/feed" element={<Suspense fallback={null}><FeedPage /></Suspense>} />
          <Route path="/highway" element={<Suspense fallback={null}><HighwayPage /></Suspense>} />
          <Route path="/saber" element={<Suspense fallback={null}><SaberArenaPage /></Suspense>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        <Footer />
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

        {/* Fixed bottom-right buttons */}
        <div style={{ position: 'fixed', bottom: '1rem', right: '1rem', zIndex: 900, paddingRight: '0.5rem', paddingBottom: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
          <ProbeButton onClick={() => setSaberMode(s => !s)}>
            {saberMode ? '⚔ EXIT' : '⚔ SABER'}
          </ProbeButton>
          <ProbeButton onClick={() => setDreamOpen(true)}>
            Dream
          </ProbeButton>
        </div>

        {/* Dream creation retro window */}
        <DreamWindow open={dreamOpen} onClose={() => setDreamOpen(false)} />

        {/* Saber battle overlay */}
        <SaberOverlay active={saberMode} onClose={() => setSaberMode(false)} />

        {/* Torch / dungeon mode overlay */}
        <TorchOverlay active={torchMode} />
      </BrowserRouter>
    </div>
  );
}

export default App;
