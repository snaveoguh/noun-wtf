import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { Col, Container, Row } from 'react-bootstrap';
import { useNavigate } from 'react-router';

import AuctionActivity from '@/components/AuctionActivity';
import { LoadingNoun } from '@/components/LegacyNoun';
import NounderNounContent from '@/components/NounderNounContent';
// eslint-disable-next-line sonarjs/deprecation
import { StandaloneNounWithSeed } from '@/components/StandaloneNoun';
import { useAppDispatch, useAppSelector } from '@/hooks';
import { setCurrentNounSeed, setStateBackgroundColor } from '@/state/slices/application';
import { RootState } from '@/store';
import { nounPath } from '@/utils/history';
import { beige, grey } from '@/utils/nounBgColors';
import { isNounderNoun } from '@/utils/nounderNoun';
import { Auction as IAuction } from '@/wrappers/nounsAuction';
import { INounSeed } from '@/wrappers/nounToken';

import DerivativeAuction from '@/components/DerivativeAuction';
import HomePrompt from '@/components/HomePrompt';
import { useCreateDerivative, hasDerivativesContract } from '@/wrappers/nounDerivatives';

import classes from './Auction.module.css';

// Lazy-load AsciiNoun (uses Three.js)
const AsciiNounCanvas = React.lazy(() => import('@/components/AsciiNoun'));
// Lazy-load Derivative upload form
const DerivativeUploadForm = React.lazy(() => import('@/components/DerivativeGallery'));
// ─── Derivative type ────────────────────────────────────────────────────────

interface Derivative {
  id: string;
  name: string;
  image: string;
  nounId?: number;
  auctionUrl?: string; // external auction link (Manifold, Zora, etc.)
  tokenId?: number; // onchain ERC721 token ID (set after mint)
  tokenURI?: string; // IPFS metadata URI
  createdAt: string;
}

const DERIVATIVES_API = '/.netlify/functions/derivatives';

// ─── Main Auction ────────────────────────────────────────────────────────────

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

  // View mode — dynamic (string)
  const [viewMode, setViewMode] = useState<string>('real');

  // ASCII 3D resizable height (null = square / auto)
  const [asciiHeight, setAsciiHeight] = useState<number | null>(null);
  const asciiWrapRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Per-noun derivatives
  const [derivatives, setDerivatives] = useState<Derivative[]>([]);
  const [editingAuctionUrl, setEditingAuctionUrl] = useState(false);
  const [auctionUrlDraft, setAuctionUrlDraft] = useState('');
  const [listingForAuction, setListingForAuction] = useState(false);
  const [reservePriceDraft, setReservePriceDraft] = useState('0.01');
  const [listingStep, setListingStep] = useState<'idle' | 'pinning' | 'minting' | 'done'>('idle');
  const { create: createDerivativeOnchain, isPending: mintPending, isSuccess: mintSuccess, receipt: mintReceipt } = useCreateDerivative();

  const fetchDerivativesForNoun = useCallback(async (nId: number) => {
    try {
      const res = await fetch(`${DERIVATIVES_API}?nounId=${nId}`);
      if (!res.ok) return;
      const data = (await res.json()) as Derivative[];
      setDerivatives(data);
    } catch {
      // silent
    }
  }, []);

  // Fetch derivatives when noun changes
  useEffect(() => {
    if (currentNounId > 0) {
      fetchDerivativesForNoun(currentNounId);
    }
  }, [currentNounId, fetchDerivativesForNoun]);

  // Reset view mode when noun changes
  useEffect(() => {
    setViewMode('real');
    setEditingAuctionUrl(false);
  }, [currentNounId]);

  // Find active derivative (if viewing one)
  const activeDerivative = viewMode.startsWith('deriv-')
    ? derivatives.find(d => `deriv-${d.id}` === viewMode)
    : null;

  // After upload: refetch and switch to the new tab
  const handleDerivativeUploaded = useCallback(() => {
    if (currentNounId > 0) {
      fetchDerivativesForNoun(currentNounId).then(() => {
        fetch(`${DERIVATIVES_API}?nounId=${currentNounId}`)
          .then(r => r.json())
          .then((data: Derivative[]) => {
            setDerivatives(data);
            if (data.length > 0) {
              setViewMode(`deriv-${data[0].id}`);
            }
          })
          .catch(() => {});
      });
    }
  }, [currentNounId, fetchDerivativesForNoun]);

  const handleSaveAuctionUrl = useCallback(async (derivId: string, url: string) => {
    try {
      const res = await fetch(DERIVATIVES_API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: derivId, auctionUrl: url }),
      });
      if (res.ok) {
        // Update local state
        setDerivatives(prev => prev.map(d =>
          d.id === derivId ? { ...d, auctionUrl: url || undefined } : d
        ));
        setEditingAuctionUrl(false);
      }
    } catch { /* silent */ }
  }, []);

  // Handle "List for Auction" — pin to IPFS then mint onchain
  const handleListForAuction = useCallback(async (deriv: Derivative) => {
    if (!deriv.nounId) return;
    setListingStep('pinning');
    try {
      // 1. Pin to IPFS
      const pinRes = await fetch(DERIVATIVES_API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deriv.id }),
      });
      if (!pinRes.ok) throw new Error('Pin failed');
      const { tokenURI } = (await pinRes.json()) as { tokenURI: string };

      // 2. Mint onchain
      setListingStep('minting');
      createDerivativeOnchain(deriv.nounId, tokenURI, reservePriceDraft);
    } catch (err) {
      console.error('[ListForAuction]', err);
      setListingStep('idle');
    }
  }, [createDerivativeOnchain, reservePriceDraft]);

  // After successful mint, link tokenId back to blob record
  useEffect(() => {
    if (mintSuccess && mintReceipt && activeDerivative) {
      // Parse DerivativeCreated event to get tokenId
      // Event topic[1] = tokenId (indexed)
      const createdLog = mintReceipt.logs.find(
        l => l.topics.length >= 2,
      );
      if (createdLog && createdLog.topics[1]) {
        const tokenId = Number(BigInt(createdLog.topics[1]));
        // PATCH the blob record with tokenId
        fetch(DERIVATIVES_API, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: activeDerivative.id, tokenId }),
        }).then(() => {
          setDerivatives(prev => prev.map(d =>
            d.id === activeDerivative.id ? { ...d, tokenId } : d,
          ));
          setListingStep('done');
          setListingForAuction(false);
        }).catch(() => {
          setListingStep('done');
        });
      } else {
        setListingStep('done');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintSuccess, mintReceipt]);

  // ASCII resize drag handler
  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;

    const startY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const wrapper = asciiWrapRef.current;
    const startHeight = wrapper ? wrapper.getBoundingClientRect().height : 400;

    const handleMove = (ev: MouseEvent | TouchEvent) => {
      if (!isDraggingRef.current) return;
      const currentY = 'touches' in ev ? ev.touches[0].clientY : (ev as MouseEvent).clientY;
      const delta = currentY - startY;
      const newHeight = Math.max(200, Math.min(startHeight + delta, window.innerHeight - 100));
      setAsciiHeight(newHeight);
    };

    const handleUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleUp);
  }, []);

  // Reset ASCII height when switching away from ascii mode or changing noun
  useEffect(() => {
    setAsciiHeight(null);
  }, [currentNounId]);

  // Ref guard for seed
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
    if (currentAuction) {
      navigate(nounPath(Number(currentAuction.nounId) - 1));
    }
  };
  const nextAuctionHandler = () => {
    if (currentAuction) {
      navigate(nounPath(Number(currentAuction.nounId) + 1));
    }
  };

  const nounContent = currentAuction && (
    <div className={classes.nounWrapper} style={{ position: 'relative' }}>
      {/* Real Noun — always render for seed/bg color, but hide when not active */}
      <div
        style={{
          opacity: viewMode === 'real' ? 1 : 0,
          transition: 'opacity 0.4s ease',
          position: viewMode === 'real' ? 'relative' : 'absolute',
          inset: 0,
          zIndex: 1,
          pointerEvents: viewMode === 'real' ? 'auto' : 'none',
        }}
      >
        {/* eslint-disable-next-line sonarjs/deprecation */}
        <StandaloneNounWithSeed
          nounId={BigInt(currentAuction.nounId)}
          onLoadSeed={loadedNounHandler}
          shouldLinkToProfile={false}
        />
      </div>

      {/* ASCII 3D Voxel — rendered when ascii mode (resizable) */}
      {viewMode === 'ascii' && currentNounSeed && (
        <div
          ref={asciiWrapRef}
          style={{
            position: 'relative',
            width: '100%',
            ...(asciiHeight != null
              ? { height: asciiHeight }
              : { paddingTop: '100%' }),
            zIndex: 2,
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'absolute', inset: 0 }}>
            <Suspense
              fallback={
                <div style={{
                  width: '100%', height: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.8rem', color: '#94a3b8',
                }}>
                  Loading 3D...
                </div>
              }
            >
              <AsciiNounCanvas seed={currentNounSeed} />
            </Suspense>
          </div>

          {/* Drag handle to resize */}
          <div
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
            onDoubleClick={() => {
              // Double-click: toggle between square and tall
              if (asciiHeight != null) {
                setAsciiHeight(null);
              } else {
                const w = asciiWrapRef.current?.getBoundingClientRect().width ?? 400;
                setAsciiHeight(Math.min(w * 1.4, window.innerHeight - 100));
              }
            }}
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 18,
              cursor: 'ns-resize',
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(transparent, rgba(0,0,0,0.15))',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(transparent, rgba(0,0,0,0.35))'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(transparent, rgba(0,0,0,0.15))'; }}
            title="Drag to resize · Double-click to expand"
          >
            <div style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              background: 'rgba(255,255,255,0.5)',
            }} />
          </div>
        </div>
      )}

      {/* Derivative image — shown when a specific derivative tab is active */}
      {activeDerivative && (
        <div
          style={{
            position: 'relative',
            width: '100%',
            zIndex: 2,
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <div className={classes.sketchImgWrapper}>
            <img
              src={activeDerivative.image}
              alt={`${activeDerivative.name} derivative`}
              className={classes.sketchImg}
              style={{ objectFit: 'contain' }}
            />
          </div>
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '6px 10px',
            background: 'linear-gradient(transparent, rgba(0,0,0,0.4))',
            fontFamily: "'PT Root UI', sans-serif",
            fontSize: '0.6rem',
            fontWeight: 600,
            color: 'rgba(255,255,255,0.8)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                by {activeDerivative.name} · {new Date(activeDerivative.createdAt).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric',
                })}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {/* Minted derivative: show onchain auction */}
                {activeDerivative.tokenId !== undefined ? null : (
                  <>
                    {/* External auction link (legacy) */}
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
                    {/* List for Auction button (only if contract is deployed and not yet minted) */}
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

            {/* Onchain auction panel (for minted derivatives) */}
            {activeDerivative.tokenId !== undefined && (
              <DerivativeAuction tokenId={activeDerivative.tokenId} />
            )}

            {/* List for Auction flow */}
            {listingForAuction && activeDerivative.tokenId === undefined && (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>
                  {listingStep === 'pinning' ? 'Pinning to IPFS...' :
                   listingStep === 'minting' ? 'Confirm in wallet...' :
                   'Reserve:'}
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
                      style={{
                        width: 70,
                        border: '1px solid rgba(255,255,255,0.3)',
                        borderRadius: 4,
                        padding: '3px 6px',
                        fontSize: '0.6rem',
                        fontFamily: "'PT Root UI', sans-serif",
                        background: 'rgba(0,0,0,0.4)',
                        color: '#fff',
                        outline: 'none',
                      }}
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
                  <span style={{
                    fontSize: '0.5rem', color: '#fbbf24',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}>
                    {mintPending ? 'Waiting for confirmation...' : ''}
                  </span>
                )}
              </div>
            )}

            {/* Legacy: edit external auction URL */}
            {editingAuctionUrl && (
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  type="url"
                  placeholder="Paste auction URL…"
                  value={auctionUrlDraft}
                  onChange={e => setAuctionUrlDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveAuctionUrl(activeDerivative.id, auctionUrlDraft.trim());
                    if (e.key === 'Escape') setEditingAuctionUrl(false);
                  }}
                  autoFocus
                  style={{
                    flex: 1,
                    border: '1px solid rgba(255,255,255,0.3)',
                    borderRadius: 4,
                    padding: '3px 6px',
                    fontSize: '0.6rem',
                    fontFamily: "'PT Root UI', sans-serif",
                    background: 'rgba(0,0,0,0.4)',
                    color: '#fff',
                    outline: 'none',
                  }}
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
        </div>
      )}

      {/* Upload form — shown when [+] tab is active */}
      {viewMode === 'add-derivative' && (
        <div
          style={{
            position: 'relative',
            width: '100%',
            zIndex: 2,
            borderRadius: 12,
            padding: 16,
            background: 'rgba(255,255,255,0.5)',
            backdropFilter: 'blur(6px)',
            minHeight: 300,
          }}
        >
          <Suspense
            fallback={
              <div style={{
                width: '100%', padding: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.8rem', color: '#94a3b8',
              }}>
                Loading...
              </div>
            }
          >
            <DerivativeUploadForm nounId={currentNounId} onUploaded={handleDerivativeUploaded} />
          </Suspense>
        </div>
      )}

      {/* Toggle pill — below the artwork */}
      <div className={classes.sketchToggle}>
        <button
          className={`${classes.toggleBtn} ${viewMode === 'real' ? classes.toggleActive : ''}`}
          onClick={() => setViewMode('real')}
        >
          Real
        </button>
        <button
          className={`${classes.toggleBtn} ${viewMode === 'ascii' ? classes.toggleActive : ''}`}
          onClick={() => setViewMode('ascii')}
        >
          ASCII 3D
        </button>

        {/* Per-noun derivative tabs */}
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

        {/* [+] add derivative */}
        <button
          className={`${classes.toggleBtn} ${classes.addBtn} ${viewMode === 'add-derivative' ? classes.toggleActive : ''}`}
          onClick={() => setViewMode('add-derivative')}
          title="Add your derivative"
        >
          +
        </button>
      </div>

    </div>
  );

  const loadingNoun = (
    <div className={classes.nounWrapper}>
      <LoadingNoun />
    </div>
  );

  const currentAuctionActivityContent = currentAuction && lastNounId && (
    <AuctionActivity
      auction={currentAuction}
      isFirstAuction={currentAuction.nounId === 0n}
      isLastAuction={currentAuction.nounId === BigInt(lastNounId)}
      onPrevAuctionClick={prevAuctionHandler}
      onNextAuctionClick={nextAuctionHandler}
      displayGraphDepComps={true}
    />
  );
  const nounderNounContent = currentAuction && lastNounId && (
    <NounderNounContent
      mintTimestamp={BigInt(currentAuction.startTime)}
      nounId={BigInt(currentAuction.nounId)}
      isFirstAuction={currentAuction.nounId === 0n}
      isLastAuction={currentAuction.nounId === BigInt(lastNounId)}
      onPrevAuctionClick={prevAuctionHandler}
      onNextAuctionClick={nextAuctionHandler}
    />
  );

  return (
    <div style={{ backgroundColor: stateBgColor }} className={classes.wrapper}>
      <Container fluid="xl">
        {/* Inline AI prompt */}
        <div style={{ paddingTop: '1rem', paddingBottom: '0.5rem' }}>
          <HomePrompt />
        </div>
        <Row>
          <Col lg={{ span: 5 }} className={classes.auctionActivityCol}>
            {currentAuction &&
              (isNounderNoun(BigInt(currentAuction.nounId))
                ? nounderNounContent
                : currentAuctionActivityContent)}
          </Col>
          <Col lg={{ span: 7 }} className={classes.nounContentCol}>
            {currentAuction ? nounContent : loadingNoun}
          </Col>
        </Row>
      </Container>
    </div>
  );
};

export default Auction;
