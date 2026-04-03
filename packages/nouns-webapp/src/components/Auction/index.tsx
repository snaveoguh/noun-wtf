import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import { Container } from 'react-bootstrap';
import { useNavigate } from 'react-router';

import AuctionActivity from '@/components/AuctionActivity';
import DerivativeAuction from '@/components/DerivativeAuction';
import HomePrompt from '@/components/HomePrompt';
import { LoadingNoun } from '@/components/LegacyNoun';
import NounderNounContent from '@/components/NounderNounContent';
import NounParallax from '@/components/NounParallax';
import PanZoomImage from '@/components/PanZoomImage';
import { getNoun, StandaloneNounWithSeed } from '@/components/StandaloneNoun';
import { type Tool } from '@/components/Studio/PixelCanvas';
import { useAppDispatch, useAppSelector } from '@/hooks';
import { useAuctionKeyboardShortcuts } from '@/hooks/useAuctionKeyboardShortcuts';
import { seedToPixelLayers, mergeLayersToGrid, DEFAULT_VISIBILITY } from '@/lib/nounDecoder';
import { historyReducer, createInitialHistory } from '@/lib/pixelHistory';
import { setCurrentNounSeed, setStateBackgroundColor } from '@/state/slices/application';
import { RootState } from '@/store';
import { nounPath } from '@/utils/history';
import { beige, grey } from '@/utils/nounBgColors';
import { isNounderNoun } from '@/utils/nounderNoun';
import { useCreateDerivative, hasDerivativesContract } from '@/wrappers/nounDerivatives';
import { Auction as IAuction } from '@/wrappers/nounsAuction';
import { INounSeed } from '@/wrappers/nounToken';

import classes from './Auction.module.css';

// Lazy-load heavy components
const AsciiNounCanvas = React.lazy(() => import('@/components/AsciiNoun'));
const InlineEditor = React.lazy(() => import('@/components/Auction/InlineEditor'));
const KeyboardShortcutsHelp = React.lazy(
  () => import('@/components/Auction/KeyboardShortcutsHelp'),
);
const DerivativeUploadForm = React.lazy(() => import('@/components/DerivativeGallery'));

// ─── Types ──────────────────────────────────────────────────────────────────

interface Derivative {
  id: string;
  name: string;
  image: string;
  nounId?: number;
  auctionUrl?: string;
  voxelData?: string;
  tokenId?: number;
  tokenURI?: string;
  createdAt: string;
}

interface NounLink {
  id: string;
  nounId: number;
  url: string;
  ogImage?: string;
  ogTitle?: string;
  createdAt: string;
}

const DERIVATIVES_API = '/.netlify/functions/derivatives';
const NOUN_LINKS_API = '/.netlify/functions/noun-links';

// ─── Main Auction ───────────────────────────────────────────────────────────

interface AuctionProps {
  auction?: IAuction;
}

const Auction: React.FC<AuctionProps> = props => {
  const { auction: currentAuction } = props;

  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const stateBgColor = useAppSelector((state: RootState) => state.application.stateBackgroundColor);
  const lastNounId = useAppSelector((state: RootState) => state.onDisplayAuction.lastAuctionNounId);
  const currentNounSeed = useAppSelector((state: RootState) => state.application.currentNounSeed);

  const currentNounId = currentAuction ? Number(currentAuction.nounId) : 0;

  // View mode — default to 2D, with a 3D intro overlay that fades out
  const [viewMode, setViewMode] = useState<string>('real');
  const [showIntro, setShowIntro] = useState(true);
  const [introOpacity, setIntroOpacity] = useState(1);

  // Inline editor state
  const [isEditing, setIsEditing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const editorToolRef = useRef<{
    setTool: (t: Tool) => void;
    undo: () => void;
    redo: () => void;
    getActiveTool: () => Tool;
    getActiveColor: () => string;
  } | null>(null);
  const panZoomRef = useRef<{ zoomIn: () => void; zoomOut: () => void; reset: () => void } | null>(
    null,
  );

  // Shared 3D editor state (used when editing in 3D mode)
  const [edit3dHistory, edit3dDispatch] = useReducer(historyReducer, createInitialHistory());
  const [edit3dTool, setEdit3dTool] = useState<Tool>('pencil');
  const [edit3dColor, setEdit3dColor] = useState('#000000');
  const [edit3dVoxelDepth, setEdit3dVoxelDepth] = useState(3);
  const voxelMapRef = useRef<import('@nouns/voxel-engine').VoxelMap | null>(null);
  const [showDerivativeSaveModal, setShowDerivativeSaveModal] = useState(false);
  const [derivativeSaveMode, setDerivativeSaveMode] = useState<'pixel' | 'voxel'>('pixel');
  const [derivativeSaveName, setDerivativeSaveName] = useState('');
  const [derivativeSaveLink, setDerivativeSaveLink] = useState('');
  const [derivativeSaveImage, setDerivativeSaveImage] = useState('');
  const [derivativeSavePending, setDerivativeSavePending] = useState(false);
  const [derivativeSaveError, setDerivativeSaveError] = useState('');

  // Load noun pixels when entering edit mode in 3D
  useEffect(() => {
    if (isEditing && viewMode === '3d' && currentNounSeed) {
      const layers = seedToPixelLayers(currentNounSeed);
      const grid = mergeLayersToGrid(layers, DEFAULT_VISIBILITY);
      edit3dDispatch({ type: 'LOAD', pixels: grid });
    }
  }, [isEditing, viewMode, currentNounSeed]);

  // Per-noun derivatives
  const [derivatives, setDerivatives] = useState<Derivative[]>([]);
  const [editingAuctionUrl, setEditingAuctionUrl] = useState(false);
  const [auctionUrlDraft, setAuctionUrlDraft] = useState('');
  const [listingForAuction, setListingForAuction] = useState(false);
  const [reservePriceDraft, setReservePriceDraft] = useState('0.01');
  const [listingStep, setListingStep] = useState<'idle' | 'pinning' | 'minting' | 'done'>('idle');
  const {
    create: createDerivativeOnchain,
    isPending: mintPending,
    isSuccess: mintSuccess,
    receipt: mintReceipt,
  } = useCreateDerivative();

  // Per-noun links
  const [nounLinks, setNounLinks] = useState<NounLink[]>([]);

  // + menu state
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  // Add link form
  const [addingLink, setAddingLink] = useState(false);
  const [linkUrlDraft, setLinkUrlDraft] = useState('');
  const [linkSubmitting, setLinkSubmitting] = useState(false);

  // ─── Data fetching ──────────────────────────────────────────────────────

  const fetchDerivativesForNoun = useCallback(async (nId: number) => {
    try {
      const res = await fetch(`${DERIVATIVES_API}?nounId=${nId}`);
      if (!res.ok) return;
      const data = (await res.json()) as Derivative[];
      setDerivatives(data);
    } catch {
      /* silent */
    }
  }, []);

  const fetchLinksForNoun = useCallback(async (nId: number) => {
    try {
      const res = await fetch(`${NOUN_LINKS_API}?nounId=${nId}`);
      if (!res.ok) return;
      const data = (await res.json()) as NounLink[];
      setNounLinks(data);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    if (currentAuction) {
      fetchDerivativesForNoun(currentNounId);
      fetchLinksForNoun(currentNounId);
    }
  }, [currentAuction, currentNounId, fetchDerivativesForNoun, fetchLinksForNoun]);

  // Reset view mode when noun changes
  useEffect(() => {
    setViewMode('3d');
    setEditingAuctionUrl(false);
    setAddMenuOpen(false);
    setAddingLink(false);
  }, [currentNounId]);

  // Active items
  const activeDerivative = viewMode.startsWith('deriv-')
    ? derivatives.find(d => `deriv-${d.id}` === viewMode)
    : null;

  const activeLink = viewMode.startsWith('link-')
    ? nounLinks.find(l => `link-${l.id}` === viewMode)
    : null;

  // ─── Derivative handlers ────────────────────────────────────────────────

  const handleDerivativeUploaded = useCallback(() => {
    if (currentAuction) {
      fetchDerivativesForNoun(currentNounId).then(() => {
        fetch(`${DERIVATIVES_API}?nounId=${currentNounId}`)
          .then(r => r.json())
          .then((data: Derivative[]) => {
            setDerivatives(data);
            if (data.length > 0) setViewMode(`deriv-${data[0].id}`);
          })
          .catch(() => {});
      });
    }
  }, [currentAuction, currentNounId, fetchDerivativesForNoun]);

  const resetDerivativeSaveModal = useCallback(() => {
    setShowDerivativeSaveModal(false);
    setDerivativeSaveMode('pixel');
    setDerivativeSaveName('');
    setDerivativeSaveLink('');
    setDerivativeSaveImage('');
    setDerivativeSavePending(false);
    setDerivativeSaveError('');
  }, []);

  const openDerivativeSaveModal = useCallback(
    (mode: 'pixel' | 'voxel', image: string, defaultName: string) => {
      setDerivativeSaveMode(mode);
      setDerivativeSaveImage(image);
      setDerivativeSaveName(defaultName);
      setDerivativeSaveLink('');
      setDerivativeSavePending(false);
      setDerivativeSaveError('');
      setShowDerivativeSaveModal(true);
    },
    [],
  );

  const handleSaveDerivative = useCallback(async () => {
    if (!derivativeSaveName.trim() || !currentAuction) return;
    if (!derivativeSaveImage) {
      setDerivativeSaveError('Could not capture the current creation. Please try again.');
      return;
    }

    setDerivativeSavePending(true);
    setDerivativeSaveError('');

    try {
      const voxelData =
        derivativeSaveMode === 'voxel' && voxelMapRef.current
          ? JSON.stringify(Object.fromEntries(voxelMapRef.current))
          : undefined;

      const res = await fetch(DERIVATIVES_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: derivativeSaveName.trim(),
          image: derivativeSaveImage,
          nounId: currentNounId,
          auctionUrl: derivativeSaveLink.trim() || undefined,
          ...(voxelData && { voxelData }),
        }),
      });

      const data = (await res.json()) as Derivative | { error?: string };
      if (!res.ok || !('id' in data)) {
        setDerivativeSaveError(
          'error' in data && data.error ? data.error : 'Failed to save derivative',
        );
        setDerivativeSavePending(false);
        return;
      }

      setDerivatives(prev => [data, ...prev.filter(d => d.id !== data.id)]);
      setViewMode(`deriv-${data.id}`);
      setIsEditing(false);
      resetDerivativeSaveModal();
    } catch (err) {
      setDerivativeSaveError(
        err instanceof Error && err.message ? err.message : 'Failed to save derivative',
      );
      setDerivativeSavePending(false);
    }
  }, [
    currentNounId,
    derivativeSaveImage,
    derivativeSaveLink,
    derivativeSaveMode,
    derivativeSaveName,
    resetDerivativeSaveModal,
  ]);

  const handleSaveAuctionUrl = useCallback(async (derivId: string, url: string) => {
    try {
      const res = await fetch(DERIVATIVES_API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: derivId, auctionUrl: url }),
      });
      if (res.ok) {
        setDerivatives(prev =>
          prev.map(d => (d.id === derivId ? { ...d, auctionUrl: url || undefined } : d)),
        );
        setEditingAuctionUrl(false);
      }
    } catch {
      /* silent */
    }
  }, []);

  const handleListForAuction = useCallback(
    async (deriv: Derivative) => {
      if (deriv.nounId === undefined) return;
      setListingStep('pinning');
      try {
        const pinRes = await fetch(DERIVATIVES_API, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: deriv.id }),
        });
        if (!pinRes.ok) throw new Error('Pin failed');
        const { tokenURI } = (await pinRes.json()) as { tokenURI: string };
        setListingStep('minting');
        createDerivativeOnchain(deriv.nounId, tokenURI, reservePriceDraft);
      } catch (err) {
        console.error('[ListForAuction]', err);
        setListingStep('idle');
      }
    },
    [createDerivativeOnchain, reservePriceDraft],
  );

  useEffect(() => {
    if (mintSuccess && mintReceipt && activeDerivative) {
      const createdLog = mintReceipt.logs.find(l => l.topics.length >= 2);
      if (createdLog && createdLog.topics[1]) {
        const tokenId = Number(BigInt(createdLog.topics[1]));
        fetch(DERIVATIVES_API, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: activeDerivative.id, tokenId }),
        })
          .then(() => {
            setDerivatives(prev =>
              prev.map(d => (d.id === activeDerivative.id ? { ...d, tokenId } : d)),
            );
            setListingStep('done');
            setListingForAuction(false);
          })
          .catch(() => {
            setListingStep('done');
          });
      } else {
        setListingStep('done');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintSuccess, mintReceipt]);

  // ─── Link handlers ──────────────────────────────────────────────────────

  const handleAddLink = useCallback(async () => {
    if (!linkUrlDraft.trim() || !currentAuction) return;
    setLinkSubmitting(true);
    try {
      const res = await fetch(NOUN_LINKS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nounId: currentNounId, url: linkUrlDraft.trim() }),
      });
      if (res.ok) {
        const link = (await res.json()) as NounLink;
        setNounLinks(prev => [link, ...prev]);
        setViewMode(`link-${link.id}`);
        setAddingLink(false);
        setLinkUrlDraft('');
      }
    } catch {
      /* silent */
    }
    setLinkSubmitting(false);
  }, [currentAuction, currentNounId, linkUrlDraft]);

  // ─── Seed / navigation handlers ────────────────────────────────────────

  const lastSeedKeyRef = useRef('');
  const loadedNounHandler = useCallback(
    (seed: INounSeed) => {
      const key = `${seed.background}-${seed.body}-${seed.accessory}-${seed.head}-${seed.glasses}`;
      if (key === lastSeedKeyRef.current) return;
      lastSeedKeyRef.current = key;
      dispatch(setStateBackgroundColor(seed.background === 0 ? grey : beige));
      dispatch(setCurrentNounSeed(seed));
    },
    [dispatch],
  );

  const prevAuctionHandler = () => {
    if (currentAuction) navigate(nounPath(Number(currentAuction.nounId) - 1));
  };
  const nextAuctionHandler = () => {
    if (currentAuction) navigate(nounPath(Number(currentAuction.nounId) + 1));
  };

  // Build 2D SVG image
  const nounSvg = useMemo(() => {
    if (!currentNounSeed || !currentAuction) return null;
    return getNoun(BigInt(currentAuction.nounId), currentNounSeed).image;
  }, [currentNounSeed, currentAuction]);

  // ─── Keyboard shortcuts ────────────────────────────────────────────────

  useAuctionKeyboardShortcuts({
    isEditing,
    viewMode,
    onPrevNoun: prevAuctionHandler,
    onNextNoun: nextAuctionHandler,
    isFirstAuction: currentAuction?.nounId === 0n,
    isLastAuction: currentAuction?.nounId === BigInt(lastNounId ?? 0),
    onSetViewMode: setViewMode,
    onEnterEdit: () => setIsEditing(true),
    onExitEdit: () => {
      setIsEditing(false);
      setShowHelp(false);
    },
    onZoomIn: () => panZoomRef.current?.zoomIn(),
    onZoomOut: () => panZoomRef.current?.zoomOut(),
    onResetView: () => panZoomRef.current?.reset(),
    onToggleFullscreen: () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    },
    onSaveScreenshot: () => {
      const canvas = document.querySelector('canvas');
      if (canvas) {
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `noun-${currentNounId}.png`;
        a.click();
      }
    },
    onToggleHelp: () => setShowHelp(s => !s),
    onSetTool: (t: Tool) => {
      if (viewMode === '3d') setEdit3dTool(t);
      else editorToolRef.current?.setTool(t);
    },
    onUndo: () => {
      if (viewMode === '3d') edit3dDispatch({ type: 'UNDO' });
      else editorToolRef.current?.undo();
    },
    onRedo: () => {
      if (viewMode === '3d') edit3dDispatch({ type: 'REDO' });
      else editorToolRef.current?.redo();
    },
  });

  // Reset editing state on noun change
  useEffect(() => {
    setIsEditing(false);
    setShowHelp(false);
  }, [currentNounId]);

  // Cinematic intro: 3D spin overlay — start fading at 2.2s, unmount at 3.2s
  useEffect(() => {
    if (!showIntro) return;
    const fadeTimer = setTimeout(() => setIntroOpacity(0), 2200);
    const removeTimer = setTimeout(() => setShowIntro(false), 3200);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, [showIntro]);

  // ─── Activity content ──────────────────────────────────────────────────

  const hasAuctionBounds = currentAuction !== undefined && lastNounId !== undefined;

  const activityContent = hasAuctionBounds ? (
    isNounderNoun(BigInt(currentAuction.nounId)) ? (
      <NounderNounContent
        mintTimestamp={BigInt(currentAuction.startTime)}
        nounId={BigInt(currentAuction.nounId)}
        isFirstAuction={currentAuction.nounId === 0n}
        isLastAuction={currentAuction.nounId === BigInt(lastNounId)}
        onPrevAuctionClick={prevAuctionHandler}
        onNextAuctionClick={nextAuctionHandler}
      />
    ) : (
      <AuctionActivity
        auction={currentAuction}
        isFirstAuction={currentAuction.nounId === 0n}
        isLastAuction={currentAuction.nounId === BigInt(lastNounId)}
        onPrevAuctionClick={prevAuctionHandler}
        onNextAuctionClick={nextAuctionHandler}
        displayGraphDepComps={false}
      />
    )
  ) : null;

  // ─── Hero background per mode ──────────────────────────────────────────

  const renderHeroBackground = () => {
    if (viewMode === '3d' && currentNounSeed) {
      return (
        <NounParallax
          seed={currentNounSeed}
          interactive
          fullscreen
          editable={
            isEditing
              ? {
                  pixels: edit3dHistory.present,
                  activeTool: editorToolRef.current?.getActiveTool() ?? edit3dTool,
                  activeColor: editorToolRef.current?.getActiveColor() ?? edit3dColor,
                  onPixelChange: (x, y, color) =>
                    edit3dDispatch({ type: 'SET_PIXEL', x, y, color }),
                  onPixelsFill: changes => edit3dDispatch({ type: 'SET_PIXELS', changes }),
                  onColorPick: color => {
                    setEdit3dColor(color);
                    editorToolRef.current?.setTool('pencil');
                  },
                  voxelDepth: edit3dVoxelDepth,
                  onVoxelMapChange: map => {
                    voxelMapRef.current = map;
                  },
                }
              : undefined
          }
        />
      );
    }

    if (viewMode === 'ascii' && currentNounSeed) {
      return (
        <div style={{ position: 'absolute', inset: 0 }}>
          <Suspense
            fallback={
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.8rem',
                  color: '#94a3b8',
                }}
              >
                Loading 3D...
              </div>
            }
          >
            <AsciiNounCanvas seed={currentNounSeed} />
          </Suspense>
        </div>
      );
    }

    if (activeDerivative) {
      return (
        <PanZoomImage src={activeDerivative.image} alt={`${activeDerivative.name} derivative`} />
      );
    }

    if (activeLink && activeLink.ogImage) {
      return <PanZoomImage src={activeLink.ogImage} alt={activeLink.ogTitle || activeLink.url} />;
    }

    // Default: 2D pixel SVG
    if (nounSvg) {
      return <PanZoomImage src={nounSvg} alt={`Noun ${currentAuction?.nounId}`} pixelated />;
    }

    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <LoadingNoun />
      </div>
    );
  };

  // ─── Derivative info badge ─────────────────────────────────────────────

  const derivativeBadge = activeDerivative && (
    <div className={classes.heroBadge}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>
          by {activeDerivative.name} ·{' '}
          {new Date(activeDerivative.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {activeDerivative.tokenId === undefined && (
            <>
              {activeDerivative.auctionUrl && (
                <a
                  href={activeDerivative.auctionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={classes.bidBtn}
                >
                  BID
                </a>
              )}
              {hasDerivativesContract && !listingForAuction && (
                <button
                  className={classes.bidBtn}
                  onClick={() => setListingForAuction(true)}
                  style={{ background: '#fbbf24', color: '#000' }}
                >
                  LIST
                </button>
              )}
            </>
          )}
          <button
            className={classes.editBtn}
            onClick={() => {
              setEditingAuctionUrl(!editingAuctionUrl);
              setAuctionUrlDraft(activeDerivative.auctionUrl || '');
            }}
            title="Edit auction link"
          >
            ✎
          </button>
        </div>
      </div>

      {activeDerivative.tokenId !== undefined && (
        <DerivativeAuction tokenId={activeDerivative.tokenId} />
      )}

      {listingForAuction && activeDerivative.tokenId === undefined && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span
            style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}
          >
            {listingStep === 'pinning'
              ? 'Pinning to IPFS...'
              : listingStep === 'minting'
                ? 'Confirm in wallet...'
                : 'Reserve:'}
          </span>
          {listingStep === 'idle' && (
            <>
              <input
                type="number"
                step="0.001"
                min="0.001"
                value={reservePriceDraft}
                onChange={e => setReservePriceDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleListForAuction(activeDerivative);
                  if (e.key === 'Escape') setListingForAuction(false);
                }}
                autoFocus
                className={classes.inlineInput}
                style={{ width: 70 }}
              />
              <span style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.4)' }}>ETH</span>
              <button
                className={classes.editSaveBtn}
                onClick={() => handleListForAuction(activeDerivative)}
              >
                ✓
              </button>
              <button
                className={classes.editBtn}
                onClick={() => setListingForAuction(false)}
                style={{ fontSize: '0.55rem' }}
              >
                ×
              </button>
            </>
          )}
          {(listingStep === 'pinning' || listingStep === 'minting') && (
            <span
              style={{
                fontSize: '0.5rem',
                color: '#fbbf24',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            >
              {mintPending ? 'Waiting for confirmation...' : ''}
            </span>
          )}
        </div>
      )}

      {editingAuctionUrl && (
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="url"
            placeholder="Paste auction URL…"
            value={auctionUrlDraft}
            onChange={e => setAuctionUrlDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter')
                handleSaveAuctionUrl(activeDerivative.id, auctionUrlDraft.trim());
              if (e.key === 'Escape') setEditingAuctionUrl(false);
            }}
            autoFocus
            className={classes.inlineInput}
            style={{ flex: 1 }}
          />
          <button
            className={classes.editSaveBtn}
            onClick={() => handleSaveAuctionUrl(activeDerivative.id, auctionUrlDraft.trim())}
          >
            ✓
          </button>
        </div>
      )}
    </div>
  );

  // ─── Link info badge ───────────────────────────────────────────────────

  const linkBadge = activeLink && (
    <div className={classes.heroBadge}>
      <a
        href={activeLink.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: '#fff',
          textDecoration: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ fontWeight: 700 }}>
          {activeLink.ogTitle || new URL(activeLink.url).hostname}
        </span>
        <span style={{ fontSize: '0.5rem', opacity: 0.6 }}>↗</span>
      </a>
    </div>
  );

  // ─── + menu (add art or add link) ──────────────────────────────────────

  const isAddMode = viewMode === 'add-derivative' || viewMode === 'add-link';

  // ─── Toggle pill ───────────────────────────────────────────────────────

  const togglePill = (
    <div
      className={`${classes.sketchToggle} ${classes.heroToggle}`}
      onPointerDown={e => e.stopPropagation()}
      onPointerUp={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onMouseUp={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <button
        className={`${classes.toggleBtn} ${viewMode === 'real' ? classes.toggleActive : ''}`}
        onClick={() => setViewMode('real')}
      >
        Real
      </button>
      <button
        className={`${classes.toggleBtn} ${viewMode === '3d' ? classes.toggleActive : ''}`}
        onClick={() => setViewMode('3d')}
      >
        3D
      </button>
      <button
        className={`${classes.toggleBtn} ${viewMode === 'ascii' ? classes.toggleActive : ''}`}
        onClick={() => setViewMode('ascii')}
      >
        ASCII
      </button>
      <button
        className={`${classes.toggleBtn} ${classes.editToggleBtn}`}
        onClick={() => setIsEditing(true)}
        title="Edit Noun (E)"
      >
        ✏
      </button>

      {derivatives.map(d => (
        <button
          key={d.id}
          className={`${classes.toggleBtn} ${classes.derivativeBtn} ${viewMode === `deriv-${d.id}` ? classes.toggleActive : ''}`}
          onClick={() => setViewMode(`deriv-${d.id}`)}
          title={`${d.name} · ${new Date(d.createdAt).toLocaleDateString()}`}
        >
          {d.name}
        </button>
      ))}

      {nounLinks.map(l => (
        <button
          key={l.id}
          className={`${classes.toggleBtn} ${classes.linkBtn} ${viewMode === `link-${l.id}` ? classes.toggleActive : ''}`}
          onClick={() => setViewMode(`link-${l.id}`)}
          title={l.ogTitle || l.url}
        >
          {l.ogTitle ? l.ogTitle.substring(0, 12) : new URL(l.url).hostname}
        </button>
      ))}

      {/* + menu */}
      <div style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          className={`${classes.toggleBtn} ${classes.addBtn} ${isAddMode ? classes.toggleActive : ''}`}
          onClick={() => setAddMenuOpen(o => !o)}
          title="Add content"
        >
          + Add
        </button>
        {addMenuOpen && (
          <div className={classes.addMenu}>
            <button
              className={classes.addMenuItem}
              onClick={() => {
                setViewMode('add-derivative');
                setAddMenuOpen(false);
              }}
            >
              Add Art
            </button>
            <button
              className={classes.addMenuItem}
              onClick={() => {
                setAddingLink(true);
                setAddMenuOpen(false);
              }}
            >
              Add Link
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // ─── Draggable activity panel ────────────────────────────────────────

  const panelRef = useRef<HTMLDivElement>(null);
  const panelDragging = useRef(false);
  const panelOffset = useRef({ x: 0, y: 0 });
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);

  // Reset panel position when noun changes
  useEffect(() => {
    setPanelPos(null);
  }, [currentNounId]);

  const onPanelPointerDown = useCallback((e: React.PointerEvent) => {
    // Only drag from the panel header area (first 40px)
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (e.clientY - rect.top > 44) return; // only drag from top bar
    panelDragging.current = true;
    panelOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPanelPointerMove = useCallback((e: React.PointerEvent) => {
    if (!panelDragging.current) return;
    setPanelPos({
      x: e.clientX - panelOffset.current.x,
      y: e.clientY - panelOffset.current.y,
    });
  }, []);

  const onPanelPointerUp = useCallback(() => {
    panelDragging.current = false;
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div style={{ backgroundColor: stateBgColor }}>
      <div className={classes.heroWrapper}>
        {/* Background artwork — mode-appropriate */}
        <div className={classes.hero3dBg} data-hero-artwork-root="true">
          {renderHeroBackground()}
        </div>

        {/* Cinematic 3D intro overlay — spins then fades out */}
        {showIntro && currentNounSeed && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 10,
              opacity: introOpacity,
              transition: 'opacity 1s ease-out',
              pointerEvents: 'none',
            }}
          >
            <NounParallax seed={currentNounSeed} fullscreen autoSpin />
          </div>
        )}

        {/* Prev/Next noun arrows */}
        {hasAuctionBounds && !isEditing && (
          <>
            {BigInt(currentAuction.nounId) > 0n && (
              <button
                type="button"
                onClick={prevAuctionHandler}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 20,
                  background: 'rgba(255,255,255,0.15)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '50%',
                  width: 44,
                  height: 44,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  color: '#333',
                  transition: 'background 0.15s',
                }}
                title="Previous Noun"
              >
                &#8249;
              </button>
            )}
            {BigInt(currentAuction.nounId) < BigInt(lastNounId) && (
              <button
                type="button"
                onClick={nextAuctionHandler}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  zIndex: 20,
                  background: 'rgba(255,255,255,0.15)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '50%',
                  width: 44,
                  height: 44,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  color: '#333',
                  transition: 'background 0.15s',
                }}
                title="Next Noun"
              >
                &#8250;
              </button>
            )}
          </>
        )}

        {/* Hidden: fires onLoadSeed for bg color + seed */}
        {currentAuction && (
          <div
            style={{
              position: 'absolute',
              width: 0,
              height: 0,
              overflow: 'hidden',
              pointerEvents: 'none',
            }}
          >
            <StandaloneNounWithSeed
              nounId={BigInt(currentAuction.nounId)}
              onLoadSeed={loadedNounHandler}
              shouldLinkToProfile={false}
            />
          </div>
        )}

        {/* Prompt bar */}
        <div className={classes.heroPromptBar} onPointerDown={e => e.stopPropagation()}>
          <Container fluid="xl">
            <HomePrompt />
          </Container>
        </div>

        {/* Draggable frosted glass activity panel — hidden while editing */}
        {!isEditing && (
          <div
            ref={panelRef}
            className={classes.glassPanel}
            style={panelPos ? { left: panelPos.x, top: panelPos.y } : undefined}
            onPointerDown={e => {
              e.stopPropagation();
              onPanelPointerDown(e);
            }}
            onPointerMove={onPanelPointerMove}
            onPointerUp={onPanelPointerUp}
            onPointerCancel={onPanelPointerUp}
          >
            <div className={classes.glassPanelDragBar}>
              <div className={classes.glassPanelGrip} />
            </div>
            {currentAuction ? activityContent : <LoadingNoun />}
          </div>
        )}

        {/* Derivative / Link info badge — bottom-left */}
        {derivativeBadge}
        {linkBadge}

        {/* Upload form overlay */}
        {viewMode === 'add-derivative' && (
          <div className={classes.heroFormOverlay}>
            <Suspense
              fallback={
                <div
                  style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}
                >
                  Loading...
                </div>
              }
            >
              <DerivativeUploadForm nounId={currentNounId} onUploaded={handleDerivativeUploaded} />
            </Suspense>
          </div>
        )}

        {/* Add link form overlay */}
        {addingLink && (
          <div className={classes.heroFormOverlay}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span
                style={{
                  fontFamily: "'PT Root UI', sans-serif",
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: 'rgba(0,0,0,0.7)',
                }}
              >
                Add a link for Noun {currentNounId}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="url"
                  placeholder="https://..."
                  value={linkUrlDraft}
                  onChange={e => setLinkUrlDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleAddLink();
                    if (e.key === 'Escape') setAddingLink(false);
                  }}
                  autoFocus
                  className={classes.inlineInput}
                  style={{
                    flex: 1,
                    background: 'rgba(0,0,0,0.05)',
                    color: '#14141f',
                    border: '1px solid rgba(0,0,0,0.15)',
                  }}
                />
                <button
                  onClick={handleAddLink}
                  disabled={linkSubmitting || !linkUrlDraft.trim()}
                  style={{
                    border: 'none',
                    borderRadius: 6,
                    padding: '6px 14px',
                    background: '#14141f',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    fontFamily: "'PT Root UI', sans-serif",
                    opacity: linkSubmitting ? 0.5 : 1,
                  }}
                >
                  {linkSubmitting ? '...' : 'Add'}
                </button>
                <button
                  onClick={() => setAddingLink(false)}
                  style={{
                    border: 'none',
                    borderRadius: 6,
                    padding: '6px 10px',
                    background: 'rgba(0,0,0,0.1)',
                    color: '#14141f',
                    cursor: 'pointer',
                    fontSize: '0.65rem',
                    fontFamily: "'PT Root UI', sans-serif",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Toggle pill — hidden while editing */}
        {!isEditing && togglePill}

        {/* Inline pixel editor — only in 2D mode (3D uses NounParallax EditableScene) */}
        {isEditing && viewMode !== '3d' && currentNounSeed && (
          <Suspense fallback={null}>
            <InlineEditor
              seed={currentNounSeed}
              nounSvg={nounSvg}
              onExit={() => setIsEditing(false)}
              toolRef={editorToolRef}
              onSave={(_, thumbnail) => {
                openDerivativeSaveModal('pixel', thumbnail, `Noun ${currentNounId} edit`);
              }}
            />
          </Suspense>
        )}

        {/* 3D edit mode: full tool panels (3D canvas handles voxels via EditableScene) */}
        {isEditing && viewMode === '3d' && currentNounSeed && (
          <Suspense fallback={null}>
            <InlineEditor
              seed={currentNounSeed}
              nounSvg={null}
              panelsOnly
              externalPixels={edit3dHistory.present}
              externalDispatch={edit3dDispatch}
              externalPast={edit3dHistory.past}
              externalFuture={edit3dHistory.future}
              voxelDepth={edit3dVoxelDepth}
              onVoxelDepthChange={setEdit3dVoxelDepth}
              onExit={() => setIsEditing(false)}
              toolRef={editorToolRef}
              onSave={() => {
                const canvas = document.querySelector(
                  '[data-hero-artwork-root="true"] [data-noun-parallax-root="true"] canvas',
                ) as HTMLCanvasElement | null;
                const image = canvas?.toDataURL('image/jpeg', 0.88) ?? '';
                openDerivativeSaveModal('voxel', image, `Noun ${currentNounId} voxel`);
              }}
            />
          </Suspense>
        )}

        {/* Keyboard shortcuts help */}
        {showHelp && (
          <Suspense fallback={null}>
            <KeyboardShortcutsHelp onClose={() => setShowHelp(false)} />
          </Suspense>
        )}

        {/* Derivative save modal */}
        {showDerivativeSaveModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              background: 'rgba(0,0,0,0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onClick={resetDerivativeSaveModal}
          >
            <div
              style={{
                background: '#1a1a2e',
                borderRadius: 12,
                padding: 24,
                width: 340,
                border: '1px solid rgba(255,255,255,0.1)',
              }}
              onClick={e => e.stopPropagation()}
            >
              <h3 style={{ margin: '0 0 16px', color: '#fff', fontSize: 16 }}>
                Save {derivativeSaveMode === 'voxel' ? '3D' : '2D'} Derivative
              </h3>
              <input
                type="text"
                placeholder="Artist / title (required)"
                value={derivativeSaveName}
                onChange={e => setDerivativeSaveName(e.target.value)}
                maxLength={30}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: '#0d0d1a',
                  color: '#fff',
                  fontSize: 14,
                  marginBottom: 8,
                  boxSizing: 'border-box',
                }}
                autoFocus
              />
              <input
                type="url"
                placeholder="Link (optional — site, social, auction)"
                value={derivativeSaveLink}
                onChange={e => setDerivativeSaveLink(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: '#0d0d1a',
                  color: '#fff',
                  fontSize: 14,
                  marginBottom: 16,
                  boxSizing: 'border-box',
                }}
              />
              {derivativeSaveError && (
                <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 12 }}>
                  {derivativeSaveError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={resetDerivativeSaveModal}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    border: '1px solid rgba(255,255,255,0.2)',
                    background: 'transparent',
                    color: '#999',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={derivativeSavePending || !derivativeSaveName.trim()}
                  onClick={handleSaveDerivative}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    border: 'none',
                    background: derivativeSaveName.trim() ? '#4ade80' : '#333',
                    color: derivativeSaveName.trim() ? '#000' : '#666',
                    cursor: derivativeSaveName.trim() ? 'pointer' : 'not-allowed',
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {derivativeSavePending ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Auction;
