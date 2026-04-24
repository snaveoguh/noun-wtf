/* eslint-disable import/order, @eslint-react/hooks-extra/no-direct-set-state-in-use-effect */
import type { EditableSceneViewState, Tool, VoxelMap } from '@nouns/voxel-engine';
import type * as THREE from 'three';
import { getHeadOffset } from '@/lib/headNudges';
import { loadCuratedVoxelMap } from '@/lib/loadCuratedVoxelMap';
import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import { useNavigate } from 'react-router';

import AuctionActivity from '@/components/AuctionActivity';
import AuctionActivityDateHeadline from '@/components/AuctionActivityDateHeadline';
import AuctionActivityNounTitle from '@/components/AuctionActivityNounTitle';
import BurnedNounContent from '@/components/BurnedNounContent';
import DerivativeAuction from '@/components/DerivativeAuction';
import HomePrompt from '@/components/HomePrompt';
import { LoadingNoun } from '@/components/LegacyNoun';
import NounderNounContent from '@/components/NounderNounContent';
import NounParallax, { LIGHTING_PRESETS, type LightingPreset } from '@/components/NounParallax';
import PanZoomImage from '@/components/PanZoomImage';
import { getNoun, StandaloneNounWithSeed } from '@/components/StandaloneNoun';
import { useAppDispatch, useAppSelector } from '@/hooks';
import { useAuctionKeyboardShortcuts } from '@/hooks/useAuctionKeyboardShortcuts';
import {
  DEFAULT_VISIBILITY,
  mergeLayersToGrid,
  resolveEditableVisibility,
  seedToPixelLayers,
} from '@/lib/nounDecoder';
import { createEmptyGrid, createInitialHistory, historyReducer } from '@/lib/pixelHistory';
import { useReadNounsAuctionHouseReservePrice } from '@/contracts';
import { setCurrentNounSeed, setStateBackgroundColor } from '@/state/slices/application';
import type { RootState } from '@/store';
import { isBurnedAuction } from '@/utils/burnedAuction';
import { nounPath } from '@/utils/history';
import { beige, grey } from '@/utils/nounBgColors';
import { isNounderNoun } from '@/utils/nounderNoun';
import { hasDerivativesContract, useCreateDerivative } from '@/wrappers/nounDerivatives';
import type { Auction as IAuction } from '@/wrappers/nounsAuction';
import type { INounSeed } from '@/wrappers/nounToken';

import classes from './Auction.module.css';

const AsciiNounCanvas = React.lazy(() => import('@/components/AsciiNoun'));
const InlineEditor = React.lazy(() => import('@/components/Auction/InlineEditor'));
const KeyboardShortcutsHelp = React.lazy(
  () => import('@/components/Auction/KeyboardShortcutsHelp'),
);
const DerivativeUploadForm = React.lazy(() => import('@/components/DerivativeGallery'));

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
  name?: string;
  ogImage?: string;
  ogTitle?: string;
  createdAt: string;
}

interface PixelDraft {
  image: string;
  pixels: string[][];
  updatedAt: string;
}

interface VoxelDraft extends PixelDraft {
  voxelData: string;
}

interface NounDayDrafts {
  nounId: number;
  pixel?: PixelDraft;
  voxel?: VoxelDraft;
}

type HeroViewMode =
  | 'real'
  | '3d'
  | 'ascii'
  | 'edit-2d'
  | 'edit-3d'
  | 'sprite'
  | `deriv-${string}`
  | `link-${string}`;

type InteractionMode = 'scroll' | 'grab' | 'twist';
type EditMode = '2d' | '3d' | null;
type ComposerMode = 'art' | 'link';
type Edit3DInteractionMode = 'sculpt' | 'grab' | 'twist';

const DERIVATIVES_API = '/.netlify/functions/derivatives';
const NOUN_LINKS_API = '/.netlify/functions/noun-links';
const LIVE_DRAFTS_API = '/.netlify/functions/noun-day-drafts';

function buildPixelImage(pixels: string[][]) {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const color = pixels[y]?.[x];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  return canvas.toDataURL('image/png');
}

function serializeVoxelMap(map: VoxelMap | null) {
  if (!map) return '';
  return JSON.stringify(Object.fromEntries(map));
}

function parseVoxelMap(voxelData?: string) {
  if (!voxelData) return null;
  try {
    const parsed = JSON.parse(voxelData) as Record<string, string>;
    return new Map(Object.entries(parsed)) as VoxelMap;
  } catch {
    return null;
  }
}

function formatUpdateLabel(updatedAt?: string) {
  if (!updatedAt) return 'Waiting for the first live save';
  return `Live on site · ${new Date(updatedAt).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

/** Collapsible lighting preset picker — hover expands on desktop, tap cycles on mobile */
function LightingPicker({
  preset,
  onChange,
}: {
  preset: LightingPreset;
  onChange: (p: LightingPreset) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 2,
        display: 'flex',
        gap: 3,
        alignItems: 'center',
        height: 22,
        background: 'rgba(0,0,0,0.5)',
        borderRadius: 999,
        padding: '0 8px',
        fontFamily: 'monospace',
        fontSize: 9,
        letterSpacing: '0.05em',
        cursor: 'pointer',
      }}
      onMouseEnter={() => !isMobile && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        if (isMobile) {
          const idx = LIGHTING_PRESETS.findIndex(p => p.name === preset);
          onChange(LIGHTING_PRESETS[(idx + 1) % LIGHTING_PRESETS.length].name);
        }
      }}
    >
      <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10, marginRight: 3, lineHeight: 1 }}>
        💡
      </span>
      {LIGHTING_PRESETS.map(p => {
        const isActive = p.name === preset;
        const show = hovered || isActive;
        return (
          <button
            key={p.name}
            type="button"
            onClick={e => {
              e.stopPropagation();
              onChange(p.name);
            }}
            style={{
              fontSize: 9,
              border: 'none',
              borderRadius: 4,
              lineHeight: '14px',
              padding: show ? '2px 5px' : '2px 0',
              maxWidth: show ? 50 : 0,
              opacity: show ? 1 : 0,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              background: isActive ? 'rgba(255,255,255,0.25)' : 'transparent',
              color: isActive ? '#fff' : 'rgba(255,255,255,0.5)',
              fontFamily: 'monospace',
              cursor: 'pointer',
              letterSpacing: '0.05em',
              transition: 'max-width 0.25s ease, opacity 0.2s ease, padding 0.25s ease',
            }}
          >
            {p.label}
          </button>
        );
      })}
      {!isMobile && !hovered && (
        <span
          style={{
            color: 'rgba(255,255,255,0.35)',
            fontSize: 10,
            marginLeft: 1,
            transition: 'opacity 0.2s',
          }}
        >
          ‹
        </span>
      )}
    </div>
  );
}

interface AuctionProps {
  auction?: IAuction;
}

const Auction: React.FC<AuctionProps> = ({ auction: currentAuction }) => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const stateBgColor = useAppSelector((state: RootState) => state.application.stateBackgroundColor);
  const lastNounId = useAppSelector((state: RootState) => state.onDisplayAuction.lastAuctionNounId);
  const currentNounSeed = useAppSelector((state: RootState) => state.application.currentNounSeed);

  const currentNounId = currentAuction ? Number(currentAuction.nounId) : 0;

  // Pull the NounsAuctionHouse reservePrice. Post the recent governance prop
  // this is 2.8 ETH on mainnet — we surface it as context on the bid UI and
  // on burned-auction placeholder rows ("X ETH reserve · 0 qualifying bids").
  // The hook runs against the active chain; returns undefined while loading.
  const { data: reservePriceWei } = useReadNounsAuctionHouseReservePrice();
  const isBurned = isBurnedAuction(currentAuction);

  const [viewMode, setViewMode] = useState<HeroViewMode>('3d');
  const [lightingPreset, setLightingPreset] = useState<LightingPreset>('storefront');
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('scroll');
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [playIntroSpin, setPlayIntroSpin] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>('art');

  // Listen for "Make Art" from navbar hamburger menu
  useEffect(() => {
    const handler = () => {
      setComposerOpen(true);
      setComposerMode('art');
    };
    window.addEventListener('noun-make-art', handler);
    return () => window.removeEventListener('noun-make-art', handler);
  }, []);
  const [liveDrafts, setLiveDrafts] = useState<NounDayDrafts | null>(null);
  const [liveSaveMode, setLiveSaveMode] = useState<EditMode>(null);
  const [voxelMapVersion, setVoxelMapVersion] = useState(0);

  const editorToolRef = useRef<{
    setTool: (tool: Tool) => void;
    setColor: (color: string) => void;
    undo: () => void;
    redo: () => void;
    getActiveTool: () => Tool;
    getActiveColor: () => string;
  } | null>(null);
  const panZoomRef = useRef<{ zoomIn: () => void; zoomOut: () => void; reset: () => void } | null>(
    null,
  );
  const voxelMapRef = useRef<VoxelMap | null>(null);
  const edit3dViewStateRef = useRef<EditableSceneViewState | null>(null);
  const live2dSignatureRef = useRef('');
  const live3dSignatureRef = useRef('');

  const [edit2dHistory, edit2dDispatch] = useReducer(historyReducer, createInitialHistory());
  const [edit3dHistory, edit3dDispatch] = useReducer(historyReducer, createInitialHistory());
  const [edit2dVisibility, setEdit2dVisibility] = useState({ ...DEFAULT_VISIBILITY });
  const [edit3dVisibility, setEdit3dVisibility] = useState({ ...DEFAULT_VISIBILITY });
  const [edit3dTool, setEdit3dTool] = useState<Tool | 'build'>('pencil');
  const [edit3dColor, setEdit3dColor] = useState('#000000');
  const [edit3dVoxelDepth, setEdit3dVoxelDepth] = useState(3);
  const [edit3dStartVoxelMap, setEdit3dStartVoxelMap] = useState<VoxelMap | null>(null);
  const [edit3dInteractionMode, setEdit3dInteractionMode] =
    useState<Edit3DInteractionMode>('sculpt');

  // Mesh editor state (when GLB head is available)
  const [meshGlbPath, setMeshGlbPath] = useState<string | null>(null);
  const [meshHeadTrait, setMeshHeadTrait] = useState<string | null>(null);
  const [meshBrushSize, setMeshBrushSize] = useState(5);
  const meshUndoRef = useRef<(() => void) | null>(null);
  const meshRedoRef = useRef<(() => void) | null>(null);
  const meshSceneRef = useRef<THREE.Object3D | null>(null);
  const meshSnapshotRef = useRef<(() => string | null) | null>(null);

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

  const [nounLinks, setNounLinks] = useState<NounLink[]>([]);
  const [linkNameDraft, setLinkNameDraft] = useState('');
  const [linkUrlDraft, setLinkUrlDraft] = useState('');
  const [linkSubmitting, setLinkSubmitting] = useState(false);

  const isEditing = editMode !== null;
  const nounLayers = useMemo(
    () => (currentNounSeed ? seedToPixelLayers(currentNounSeed) : null),
    [currentNounSeed],
  );
  const baseGrid = useMemo(() => {
    if (!nounLayers) return createEmptyGrid();
    return mergeLayersToGrid(nounLayers, DEFAULT_VISIBILITY);
  }, [nounLayers]);

  const activeDerivative = viewMode.startsWith('deriv-')
    ? derivatives.find(derivative => `deriv-${derivative.id}` === viewMode)
    : null;
  const activeLink = viewMode.startsWith('link-')
    ? nounLinks.find(link => `link-${link.id}` === viewMode)
    : null;
  const liveVoxelMap = useMemo(() => parseVoxelMap(liveDrafts?.voxel?.voxelData), [liveDrafts]);
  const is3dView = viewMode === '3d' || viewMode === 'edit-3d' || editMode === '3d';
  const edit3dVisiblePixels = useMemo(
    () =>
      nounLayers
        ? resolveEditableVisibility(edit3dHistory.present, nounLayers, edit3dVisibility)
        : edit3dHistory.present,
    [edit3dHistory.present, edit3dVisibility, nounLayers],
  );
  const edit3dVisibilityMask = useMemo(
    () => edit3dVisiblePixels.map(row => row.map(color => Boolean(color))),
    [edit3dVisiblePixels],
  );

  const fetchDerivativesForNoun = useCallback(async (nounId: number) => {
    try {
      const res = await fetch(`${DERIVATIVES_API}?nounId=${nounId}`);
      if (!res.ok) return;
      setDerivatives((await res.json()) as Derivative[]);
    } catch {
      setDerivatives([]);
    }
  }, []);

  const fetchLinksForNoun = useCallback(async (nounId: number) => {
    try {
      const res = await fetch(`${NOUN_LINKS_API}?nounId=${nounId}`);
      if (!res.ok) return;
      setNounLinks((await res.json()) as NounLink[]);
    } catch {
      setNounLinks([]);
    }
  }, []);

  const fetchLiveDraftsForNoun = useCallback(async (nounId: number) => {
    try {
      const res = await fetch(`${LIVE_DRAFTS_API}?nounId=${nounId}`);
      if (!res.ok) return;
      setLiveDrafts((await res.json()) as NounDayDrafts | null);
    } catch {
      setLiveDrafts(null);
    }
  }, []);

  // Close download menu on outside click
  useEffect(() => {
    if (!downloadMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.('[class*="downloadWrap"]')) {
        setDownloadMenuOpen(false);
      }
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [downloadMenuOpen]);

  useEffect(() => {
    if (!currentAuction) return;
    fetchDerivativesForNoun(currentNounId);
    fetchLinksForNoun(currentNounId);
    fetchLiveDraftsForNoun(currentNounId);
  }, [
    currentAuction,
    currentNounId,
    fetchDerivativesForNoun,
    fetchLinksForNoun,
    fetchLiveDraftsForNoun,
  ]);

  useEffect(() => {
    if (!currentAuction || isEditing) return;
    const interval = window.setInterval(() => {
      fetchLiveDraftsForNoun(currentNounId);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [currentAuction, currentNounId, fetchLiveDraftsForNoun, isEditing]);

  const resetHeroState = useCallback(() => {
    setViewMode('3d');
    setInteractionMode('scroll');
    setEditMode(null);
    setShowHelp(false);
    setComposerOpen(false);
    setComposerMode('art');
    setListingForAuction(false);
    setEditingAuctionUrl(false);
    setEdit3dStartVoxelMap(null);
    setEdit3dInteractionMode('sculpt');
    voxelMapRef.current = null;
    edit3dViewStateRef.current = null;
    setEdit2dVisibility({ ...DEFAULT_VISIBILITY });
    setEdit3dVisibility({ ...DEFAULT_VISIBILITY });
    setLinkNameDraft('');
    setLinkUrlDraft('');
    setPlayIntroSpin(true);
  }, []);

  useEffect(() => {
    resetHeroState();
    const timer = window.setTimeout(() => setPlayIntroSpin(false), 2600);
    return () => window.clearTimeout(timer);
  }, [currentNounId, resetHeroState]);

  useEffect(() => {
    if (!is3dView && interactionMode === 'twist') {
      setInteractionMode('scroll');
    }
  }, [interactionMode, is3dView]);

  const resetLive2dSignature = useCallback(
    (pixels: string[][]) => {
      live2dSignatureRef.current = JSON.stringify(pixels);
      edit2dDispatch({ type: 'LOAD', pixels });
    },
    [edit2dDispatch],
  );

  const resetLive3dSignature = useCallback(
    (pixels: string[][], voxelData?: string) => {
      live3dSignatureRef.current = JSON.stringify({
        pixels,
        voxelData: voxelData ?? '',
      });
      edit3dDispatch({ type: 'LOAD', pixels });
    },
    [edit3dDispatch],
  );

  const startEditing = useCallback(
    async (mode: Exclude<EditMode, null>) => {
      if (mode === '2d') {
        const pixels = liveDrafts?.pixel?.pixels ?? baseGrid;
        resetLive2dSignature(pixels);
        setViewMode('edit-2d');
      } else {
        const pixels = liveDrafts?.voxel?.pixels ?? liveDrafts?.pixel?.pixels ?? baseGrid;
        resetLive3dSignature(pixels, liveDrafts?.voxel?.voxelData);

        // Try to resolve GLB path from manifest for mesh editor
        let resolvedGlbPath: string | null = null;
        let resolvedTraitName: string | null = null;
        if (currentNounSeed) {
          try {
            const manifestRes = await fetch('/models/heads/manifest.json');
            if (manifestRes.ok) {
              const manifest: Array<{ traitName?: string; threeDNounsGlb?: string }> =
                await manifestRes.json();
              const entry = manifest[currentNounSeed.head];
              if (entry?.threeDNounsGlb != null) {
                resolvedGlbPath = entry.threeDNounsGlb;
                resolvedTraitName = entry.traitName ?? null;
                console.log(`[Editor] Mesh editor: using GLB ${resolvedGlbPath}`);
              }
            }
          } catch {
            /* no manifest */
          }
        }
        setMeshGlbPath(resolvedGlbPath);
        setMeshHeadTrait(resolvedTraitName);

        // Fallback: load curated voxel map for heads without GLB
        let startMap = liveVoxelMap;
        if (!resolvedGlbPath && !startMap && currentNounSeed) {
          try {
            const curated = await loadCuratedVoxelMap(currentNounSeed.head);
            if (curated && curated.size > 0) {
              startMap = curated;
              console.log(
                `[Editor] Voxel fallback: loaded curated head for trait ${currentNounSeed.head}`,
              );
            }
          } catch {
            /* no curated head available */
          }
        }

        setEdit3dStartVoxelMap(startMap);
        voxelMapRef.current = startMap;
        edit3dViewStateRef.current = null;
        setEdit3dInteractionMode('sculpt');
        setViewMode('edit-3d');
        setInteractionMode('grab');
      }
      setEditMode(mode);
    },
    [
      baseGrid,
      liveDrafts,
      liveVoxelMap,
      currentNounSeed,
      resetLive2dSignature,
      resetLive3dSignature,
    ],
  );

  // Load a curated 3D head into the editor as a starting point
  const loadCuratedHeadIntoEditor = useCallback(
    async (headIndex: number) => {
      const voxelMap = await loadCuratedVoxelMap(headIndex);
      if (!voxelMap) return;
      setEdit3dStartVoxelMap(voxelMap);
      voxelMapRef.current = voxelMap;
      setVoxelMapVersion(v => v + 1);
      if (editMode !== '3d') {
        startEditing('3d');
      }
    },
    [editMode, startEditing],
  );

  // Expose to window for console testing / external triggers
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__loadCuratedHead = loadCuratedHeadIntoEditor;
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__loadCuratedHead;
    };
  }, [loadCuratedHeadIntoEditor]);

  // Listen for Noundry trait clicks — open 2D editor
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { category: string; index: number } | undefined;
      if (!detail) return;
      startEditing('2d');
    };
    window.addEventListener('noundry-trait-edit', handler);
    return () => window.removeEventListener('noundry-trait-edit', handler);
  }, [startEditing]);

  const persistLiveDraft = useCallback(
    async (
      mode: Exclude<EditMode, null>,
      pixels: string[][],
      voxelData?: string,
      options?: { keepalive?: boolean; imageOverride?: string },
    ) => {
      const image = options?.imageOverride || buildPixelImage(pixels);
      if (!currentAuction) return;
      if (!image && !voxelData) return;

      setLiveSaveMode(mode);
      try {
        const res = await fetch(LIVE_DRAFTS_API, {
          method: 'PUT',
          keepalive: options?.keepalive,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nounId: currentNounId,
            mode,
            pixels,
            image,
            ...(mode === '3d' ? { voxelData } : {}),
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as NounDayDrafts;
        setLiveDrafts(data);
        if (mode === '2d') {
          live2dSignatureRef.current = JSON.stringify(pixels);
        } else {
          live3dSignatureRef.current = JSON.stringify({
            pixels,
            voxelData: voxelData ?? '',
          });
        }
      } finally {
        setLiveSaveMode(null);
      }
    },
    [currentAuction, currentNounId],
  );

  const stopEditing = useCallback(() => {
    if (editMode === '2d') {
      const signature = JSON.stringify(edit2dHistory.present);
      if (signature !== live2dSignatureRef.current) {
        void persistLiveDraft('2d', edit2dHistory.present);
      }
    }

    if (editMode === '3d') {
      if (meshGlbPath) {
        // Mesh mode: flush canvas snapshot
        const snapshotFn = meshSnapshotRef.current;
        if (snapshotFn) {
          const image = snapshotFn();
          if (image) {
            void persistLiveDraft('3d', edit3dHistory.present, undefined, {
              keepalive: true,
              imageOverride: image,
            });
          }
        }
      } else {
        const voxelData = serializeVoxelMap(voxelMapRef.current);
        const signature = JSON.stringify({
          pixels: edit3dHistory.present,
          voxelData,
        });
        if (voxelData && signature !== live3dSignatureRef.current) {
          void persistLiveDraft('3d', edit3dHistory.present, voxelData, { keepalive: true });
        }
      }
    }

    setEditMode(null);
    setEdit3dStartVoxelMap(null);
    voxelMapRef.current = null;
    edit3dViewStateRef.current = null;
    setInteractionMode('scroll');
  }, [edit2dHistory.present, edit3dHistory.present, editMode, meshGlbPath, persistLiveDraft]);

  useEffect(() => {
    if (editMode !== '2d') return;
    const signature = JSON.stringify(edit2dHistory.present);
    if (signature === live2dSignatureRef.current) return;

    const timer = window.setTimeout(() => {
      persistLiveDraft('2d', edit2dHistory.present);
    }, 850);
    return () => window.clearTimeout(timer);
  }, [edit2dHistory.present, editMode, persistLiveDraft]);

  useEffect(() => {
    if (editMode !== '3d') return;
    const voxelData = serializeVoxelMap(voxelMapRef.current);
    const signature = JSON.stringify({
      pixels: edit3dHistory.present,
      voxelData,
    });
    if (!voxelData || signature === live3dSignatureRef.current) return;

    const timer = window.setTimeout(() => {
      persistLiveDraft('3d', edit3dHistory.present, voxelData);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [edit3dHistory.present, editMode, persistLiveDraft, voxelMapVersion]);

  // Mesh editor auto-save to server (vertex color deltas don't produce voxelData,
  // so the effect above skips mesh mode — this one captures a canvas snapshot instead)
  useEffect(() => {
    if (editMode !== '3d' || !meshGlbPath) return;

    const timer = window.setTimeout(() => {
      const snapshotFn = meshSnapshotRef.current;
      if (!snapshotFn) return;
      const image = snapshotFn();
      if (!image) return;
      void persistLiveDraft('3d', edit3dHistory.present, undefined, { imageOverride: image });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [voxelMapVersion, editMode, meshGlbPath, persistLiveDraft, edit3dHistory.present]);

  useEffect(() => {
    const flushOnPageHide = () => {
      if (editMode === '2d') {
        const signature = JSON.stringify(edit2dHistory.present);
        if (signature !== live2dSignatureRef.current) {
          void persistLiveDraft('2d', edit2dHistory.present, undefined, { keepalive: true });
        }
      }

      if (editMode === '3d') {
        // Mesh mode: snapshot canvas
        if (meshGlbPath) {
          const snapshotFn = meshSnapshotRef.current;
          if (snapshotFn) {
            const image = snapshotFn();
            if (image) {
              void persistLiveDraft('3d', edit3dHistory.present, undefined, {
                keepalive: true,
                imageOverride: image,
              });
            }
          }
        } else {
          // Voxel mode: serialize voxel map
          const voxelData = serializeVoxelMap(voxelMapRef.current);
          const signature = JSON.stringify({
            pixels: edit3dHistory.present,
            voxelData,
          });
          if (voxelData && signature !== live3dSignatureRef.current) {
            void persistLiveDraft('3d', edit3dHistory.present, voxelData, { keepalive: true });
          }
        }
      }
    };

    window.addEventListener('pagehide', flushOnPageHide);
    return () => window.removeEventListener('pagehide', flushOnPageHide);
  }, [edit2dHistory.present, edit3dHistory.present, editMode, meshGlbPath, persistLiveDraft]);

  const handleDerivativeUploaded = useCallback(() => {
    if (!currentAuction) return;
    fetchDerivativesForNoun(currentNounId).then(() => {
      fetch(`${DERIVATIVES_API}?nounId=${currentNounId}`)
        .then(res => res.json())
        .then((data: Derivative[]) => {
          setComposerOpen(false);
          setDerivatives(data);
          if (data.length > 0) setViewMode(`deriv-${data[0].id}`);
        })
        .catch(() => undefined);
    });
  }, [currentAuction, currentNounId, fetchDerivativesForNoun]);

  const handleSaveAuctionUrl = useCallback(async (derivativeId: string, url: string) => {
    try {
      const res = await fetch(DERIVATIVES_API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: derivativeId, auctionUrl: url }),
      });
      if (!res.ok) return;
      setDerivatives(prev =>
        prev.map(derivative =>
          derivative.id === derivativeId
            ? { ...derivative, auctionUrl: url || undefined }
            : derivative,
        ),
      );
      setEditingAuctionUrl(false);
    } catch {
      return;
    }
  }, []);

  const handleListForAuction = useCallback(
    async (derivative: Derivative) => {
      if (derivative.nounId === undefined) return;
      setListingStep('pinning');
      try {
        const pinRes = await fetch(DERIVATIVES_API, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: derivative.id }),
        });
        if (!pinRes.ok) throw new Error('Pin failed');
        const { tokenURI } = (await pinRes.json()) as { tokenURI: string };
        setListingStep('minting');
        createDerivativeOnchain(derivative.nounId, tokenURI, reservePriceDraft);
      } catch {
        setListingStep('idle');
      }
    },
    [createDerivativeOnchain, reservePriceDraft],
  );

  const markListingDone = useCallback(() => {
    setListingStep('done');
  }, []);

  useEffect(() => {
    if (!mintSuccess || !mintReceipt || !activeDerivative) return;
    const createdLog = mintReceipt.logs.find(log => log.topics.length >= 2);
    if (!(createdLog && createdLog.topics[1])) {
      markListingDone();
      return;
    }

    const tokenId = Number(BigInt(createdLog.topics[1]));
    fetch(DERIVATIVES_API, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: activeDerivative.id, tokenId }),
    })
      .then(() => {
        setDerivatives(prev =>
          prev.map(derivative =>
            derivative.id === activeDerivative.id ? { ...derivative, tokenId } : derivative,
          ),
        );
        markListingDone();
        setListingForAuction(false);
      })
      .catch(() => {
        markListingDone();
      });
  }, [activeDerivative, markListingDone, mintReceipt, mintSuccess]);

  const handleAddLink = useCallback(async () => {
    if (!linkUrlDraft.trim() || !linkNameDraft.trim() || !currentAuction) return;
    setLinkSubmitting(true);
    try {
      const res = await fetch(NOUN_LINKS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nounId: currentNounId,
          name: linkNameDraft.trim(),
          url: linkUrlDraft.trim(),
        }),
      });
      if (!res.ok) return;
      const link = (await res.json()) as NounLink;
      setNounLinks(prev => [link, ...prev]);
      setComposerOpen(false);
      setComposerMode('art');
      setLinkNameDraft('');
      setLinkUrlDraft('');
      setViewMode(`link-${link.id}`);
    } finally {
      setLinkSubmitting(false);
    }
  }, [currentAuction, currentNounId, linkNameDraft, linkUrlDraft]);

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

  // Note on burned IDs: we intentionally do NOT skip over them here. Instead
  // the landing page renders BurnedNounContent + a burned-placeholder hero
  // image so history navigation stays linear. Skipping forward/back would
  // risk traversing a long run of burns if the reserve stays unmet and
  // feels disorienting; keeping users on the page with a clear "burned"
  // state is more honest.
  const prevAuctionHandler = useCallback(() => {
    if (!currentAuction) return;
    navigate(nounPath(Number(currentAuction.nounId) - 1));
  }, [currentAuction, navigate]);

  const nextAuctionHandler = useCallback(() => {
    if (!currentAuction) return;
    navigate(nounPath(Number(currentAuction.nounId) + 1));
  }, [currentAuction, navigate]);

  const nounSvg = useMemo(() => {
    if (!currentNounSeed || !currentAuction) return null;
    return getNoun(BigInt(currentAuction.nounId), currentNounSeed).image;
  }, [currentAuction, currentNounSeed]);

  useAuctionKeyboardShortcuts({
    isEditing,
    viewMode,
    onPrevNoun: prevAuctionHandler,
    onNextNoun: nextAuctionHandler,
    isFirstAuction: currentAuction?.nounId === 0n,
    isLastAuction: currentAuction?.nounId === BigInt(lastNounId ?? 0),
    onSetViewMode: mode => setViewMode(mode as HeroViewMode),
    onEnterEdit: () => {
      const mode = viewMode === 'real' || viewMode === 'edit-2d' ? '2d' : '3d';
      startEditing(mode);
    },
    onExitEdit: () => {
      stopEditing();
      setShowHelp(false);
    },
    onZoomIn: () => panZoomRef.current?.zoomIn(),
    onZoomOut: () => panZoomRef.current?.zoomOut(),
    onResetView: () => {
      panZoomRef.current?.reset();
      setInteractionMode('scroll');
    },
    onToggleFullscreen: () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen().catch(() => undefined);
      }
    },
    onSaveScreenshot: () => {
      const canvas = document.querySelector(
        '[data-hero-artwork-root="true"] [data-noun-parallax-root="true"] canvas',
      ) as HTMLCanvasElement | null;
      if (canvas) {
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = `noun-${currentNounId}.png`;
        link.click();
        return;
      }

      const imageSource =
        activeDerivative?.image ?? activeLink?.ogImage ?? liveDrafts?.pixel?.image ?? nounSvg ?? '';
      if (!imageSource) return;
      const link = document.createElement('a');
      link.href = imageSource;
      link.download = `noun-${currentNounId}.png`;
      link.click();
    },
    onToggleHelp: () => setShowHelp(value => !value),
    onSetTool: tool => {
      if (editMode === '3d') setEdit3dTool(tool);
      else if (tool !== 'build') editorToolRef.current?.setTool(tool);
    },
    onUndo: () => {
      if (editMode === '3d') {
        // Mesh editor handles its own undo via ref
        if (meshGlbPath && meshUndoRef.current) meshUndoRef.current();
        else edit3dDispatch({ type: 'UNDO' });
      } else {
        edit2dDispatch({ type: 'UNDO' });
      }
    },
    onRedo: () => {
      if (editMode === '3d') {
        if (meshGlbPath && meshRedoRef.current) meshRedoRef.current();
        else edit3dDispatch({ type: 'REDO' });
      } else {
        edit2dDispatch({ type: 'REDO' });
      }
    },
  });

  // Download mesh from the editor scene ref (noun only, no environment)
  const downloadMesh = useCallback(
    async (format: 'glb' | 'stl' | 'obj') => {
      const obj = meshSceneRef.current;
      if (!obj) return;

      const filename = `noun-${currentNounId}.${format}`;
      if (format === 'glb') {
        // @ts-expect-error — types at three/examples/jsm, runtime at three/addons
        const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
        const exporter = new GLTFExporter();
        exporter.parse(
          obj,
          (result: ArrayBuffer) => {
            const blob = new Blob([result], { type: 'model/gltf-binary' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            URL.revokeObjectURL(a.href);
          },
          (err: unknown) => console.error('GLB export failed:', err),
          { binary: true },
        );
      } else if (format === 'stl') {
        // @ts-expect-error — three.js addon types at examples/jsm, runtime at addons
        const { STLExporter } = await import('three/addons/exporters/STLExporter.js');
        const buffer = new STLExporter().parse(obj, { binary: true });
        const blob = new Blob([buffer], { type: 'model/stl' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      } else {
        // @ts-expect-error — three.js addon types at examples/jsm, runtime at addons
        const { OBJExporter } = await import('three/addons/exporters/OBJExporter.js');
        const result = new OBJExporter().parse(obj);
        const blob = new Blob([result], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    },
    [currentNounId],
  );

  const downloadAs = useCallback(
    async (format: 'png' | 'svg' | 'webp' | 'glb' | 'stl' | 'obj') => {
      setDownloadMenuOpen(false);
      const canvas = document.querySelector(
        '[data-hero-artwork-root="true"] [data-noun-parallax-root="true"] canvas',
      ) as HTMLCanvasElement | null;

      if (format === 'glb' || format === 'stl' || format === 'obj') {
        // 3D export uses the mesh scene ref directly (noun only, no environment)
        if (meshSceneRef.current) {
          await downloadMesh(format as 'glb' | 'stl' | 'obj');
        }
        return;
      }

      if (format === 'svg') {
        // SVG: use the raw noun SVG data
        const svgSource = nounSvg ?? '';
        if (!svgSource) return;
        const link = document.createElement('a');
        link.href = svgSource.startsWith('data:')
          ? svgSource
          : `data:image/svg+xml;base64,${btoa(svgSource)}`;
        link.download = `noun-${currentNounId}.svg`;
        link.click();
        return;
      }

      const mimeType = format === 'webp' ? 'image/webp' : 'image/png';
      if (canvas) {
        const link = document.createElement('a');
        link.href = canvas.toDataURL(mimeType);
        link.download = `noun-${currentNounId}.${format}`;
        link.click();
        return;
      }

      // Fallback: derivative/link/draft image
      const imageSource =
        activeDerivative?.image ?? activeLink?.ogImage ?? liveDrafts?.pixel?.image ?? nounSvg ?? '';
      if (!imageSource) return;
      const link = document.createElement('a');
      link.href = imageSource;
      link.download = `noun-${currentNounId}.${format}`;
      link.click();
    },
    [currentNounId, nounSvg, activeDerivative, activeLink, liveDrafts, downloadMesh],
  );

  const hasAuctionBounds = currentAuction !== undefined && lastNounId !== undefined;
  // Nounder-noun detection must take precedence over burned detection because
  // Nounder nouns share the burned auction shape (amount=0, no bidder) even
  // though they're minted, not burned.
  const isNounder = hasAuctionBounds && isNounderNoun(BigInt(currentAuction.nounId));
  const showBurnedPanel = hasAuctionBounds && !isNounder && isBurned;
  const activityContent = hasAuctionBounds ? (
    isNounder ? (
      <NounderNounContent
        mintTimestamp={BigInt(currentAuction.startTime)}
        nounId={BigInt(currentAuction.nounId)}
        isFirstAuction={currentAuction.nounId === 0n}
        isLastAuction={currentAuction.nounId === BigInt(lastNounId)}
        onPrevAuctionClick={prevAuctionHandler}
        onNextAuctionClick={nextAuctionHandler}
      />
    ) : showBurnedPanel ? (
      <BurnedNounContent
        mintTimestamp={BigInt(currentAuction.startTime)}
        nounId={BigInt(currentAuction.nounId)}
        isFirstAuction={currentAuction.nounId === 0n}
        isLastAuction={currentAuction.nounId === BigInt(lastNounId)}
        reservePriceWei={reservePriceWei !== undefined ? BigInt(reservePriceWei) : undefined}
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

  const renderHeroArtwork = () => {
    const imageInteractive = interactionMode !== 'scroll';
    const parallaxInteractive =
      interactionMode === 'grab' || interactionMode === 'twist' || editMode === '3d';
    const showSpin = playIntroSpin && !isEditing && (viewMode === '3d' || viewMode === 'edit-3d');
    const displayVoxelMap = viewMode === 'edit-3d' || editMode === '3d' ? liveVoxelMap : null;

    if ((viewMode === '3d' || viewMode === 'edit-3d') && (currentNounSeed || displayVoxelMap)) {
      return (
        <NounParallax
          seed={displayVoxelMap ? undefined : (currentNounSeed ?? undefined)}
          voxelMap={displayVoxelMap ?? undefined}
          interactive={parallaxInteractive}
          interactionMode={interactionMode === 'grab' ? 'grab' : 'twist'}
          autoRotate={interactionMode === 'twist' && !showSpin}
          autoSpin={showSpin}
          fullscreen
          pointerEnabled={parallaxInteractive}
          lightingPreset={lightingPreset}
          layerVisibility={editMode === '3d' ? edit3dVisibility : undefined}
          editable={
            editMode === '3d'
              ? {
                  pixels: edit3dHistory.present,
                  initialVoxelMap: meshGlbPath ? undefined : edit3dStartVoxelMap,
                  activeTool: edit3dTool,
                  activeColor: edit3dColor,
                  onPixelChange: (x, y, color) =>
                    edit3dDispatch({ type: 'SET_PIXEL', x, y, color }),
                  onPixelsFill: changes => edit3dDispatch({ type: 'SET_PIXELS', changes }),
                  onColorPick: color => {
                    // Update parent state — InlineEditor now reads these as
                    // controlled props (activeTool/activeColor) so its swatch
                    // and tool highlight stay in sync with the picked color.
                    setEdit3dColor(color);
                    setEdit3dTool('pencil');
                  },
                  voxelDepth: edit3dVoxelDepth,
                  interactionMode: edit3dInteractionMode,
                  visibilityMask: edit3dStartVoxelMap ? undefined : edit3dVisibilityMask,
                  displayPixels: edit3dStartVoxelMap ? undefined : edit3dVisiblePixels,
                  viewStateRef: edit3dViewStateRef,
                  onVoxelMapChange: map => {
                    voxelMapRef.current = map;
                    setVoxelMapVersion(version => version + 1);
                  },
                  backgroundSeed: currentNounSeed ?? undefined,
                  backgroundVisibility: edit3dVisibility,
                  // Mesh editor config — when GLB available, render actual mesh instead of voxels
                  meshConfig:
                    meshGlbPath && currentNounSeed
                      ? {
                          glbPath: meshGlbPath,
                          glassesIndex: currentNounSeed.glasses,
                          brushSize: meshBrushSize,
                          persistenceKey: `noun-${currentNounId}-head-${currentNounSeed.head}`,
                          onStateChange: () => setVoxelMapVersion(v => v + 1),
                          undoRef: meshUndoRef,
                          redoRef: meshRedoRef,
                          sceneRef: meshSceneRef,
                          headOffset: meshHeadTrait ? getHeadOffset(meshHeadTrait) : undefined,
                          snapshotRef: meshSnapshotRef,
                        }
                      : undefined,
                }
              : undefined
          }
        />
      );
    }

    if (viewMode === 'ascii' && currentNounSeed) {
      return (
        <div
          className={classes.heroAscii}
          style={{ pointerEvents: imageInteractive ? 'auto' : 'none' }}
        >
          <Suspense fallback={<div className={classes.heroLoading}>Loading ASCII...</div>}>
            <AsciiNounCanvas seed={currentNounSeed} />
          </Suspense>
        </div>
      );
    }

    if (activeDerivative) {
      return (
        <PanZoomImage
          ref={panZoomRef}
          src={activeDerivative.image}
          alt={`${activeDerivative.name} derivative`}
          interactive={imageInteractive}
        />
      );
    }

    if (activeLink?.ogImage) {
      return (
        <PanZoomImage
          ref={panZoomRef}
          src={activeLink.ogImage}
          alt={activeLink.ogTitle || activeLink.url}
          interactive={imageInteractive}
        />
      );
    }

    if (viewMode === 'edit-2d' && liveDrafts?.pixel?.image) {
      return (
        <PanZoomImage
          ref={panZoomRef}
          src={liveDrafts.pixel.image}
          alt={`Live 2D edit for Noun ${currentNounId}`}
          pixelated
          interactive={imageInteractive}
        />
      );
    }

    if (nounSvg) {
      return (
        <PanZoomImage
          ref={panZoomRef}
          src={nounSvg}
          alt={`Noun ${currentAuction?.nounId}`}
          pixelated
          interactive={imageInteractive}
        />
      );
    }

    return (
      <div className={classes.heroLoading}>
        <LoadingNoun />
      </div>
    );
  };

  const renderInfoCard = () => {
    if (activeDerivative) {
      return (
        <div className={classes.metaCard}>
          <div className={classes.metaHeader}>
            <div>
              <p className={classes.metaEyebrow}>Derivative</p>
              <h3 className={classes.metaTitle}>{activeDerivative.name}</h3>
              <p className={classes.metaBody}>
                Added {new Date(activeDerivative.createdAt).toLocaleDateString('en-US')}
              </p>
            </div>
            <button
              type="button"
              className={classes.metaIconBtn}
              onClick={() => {
                setEditingAuctionUrl(!editingAuctionUrl);
                setAuctionUrlDraft(activeDerivative.auctionUrl || '');
              }}
              title="Edit auction link"
            >
              ✎
            </button>
          </div>

          {activeDerivative.tokenId !== undefined && (
            <DerivativeAuction tokenId={activeDerivative.tokenId} />
          )}

          {activeDerivative.tokenId === undefined && (
            <div className={classes.metaActions}>
              {activeDerivative.auctionUrl && (
                <a
                  href={activeDerivative.auctionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={classes.metaPrimaryBtn}
                >
                  Open Auction
                </a>
              )}
              {hasDerivativesContract && !listingForAuction && (
                <button
                  type="button"
                  className={classes.metaAccentBtn}
                  onClick={() => setListingForAuction(true)}
                >
                  Start Derivative Auction
                </button>
              )}
            </div>
          )}

          {listingForAuction && activeDerivative.tokenId === undefined && (
            <div className={classes.inlineActionRow}>
              <span className={classes.inlineLabel}>
                {listingStep === 'pinning'
                  ? 'Pinning to IPFS...'
                  : listingStep === 'minting'
                    ? 'Confirm in wallet...'
                    : 'Reserve'}
              </span>
              {listingStep === 'idle' ? (
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
                    className={classes.inlineInput}
                  />
                  <button
                    type="button"
                    className={classes.metaPrimaryBtn}
                    onClick={() => handleListForAuction(activeDerivative)}
                  >
                    Go
                  </button>
                  <button
                    type="button"
                    className={classes.metaGhostBtn}
                    onClick={() => setListingForAuction(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <span className={classes.metaBody}>
                  {mintPending ? 'Waiting for confirmation...' : 'Almost there...'}
                </span>
              )}
            </div>
          )}

          {editingAuctionUrl && (
            <div className={classes.inlineActionRow}>
              <input
                type="url"
                placeholder="Paste auction URL..."
                value={auctionUrlDraft}
                onChange={e => setAuctionUrlDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    handleSaveAuctionUrl(activeDerivative.id, auctionUrlDraft.trim());
                  }
                  if (e.key === 'Escape') setEditingAuctionUrl(false);
                }}
                className={classes.inlineInput}
              />
              <button
                type="button"
                className={classes.metaPrimaryBtn}
                onClick={() => handleSaveAuctionUrl(activeDerivative.id, auctionUrlDraft.trim())}
              >
                Save
              </button>
            </div>
          )}
        </div>
      );
    }

    if (activeLink) {
      return (
        <div className={classes.metaCard}>
          <p className={classes.metaEyebrow}>Linked Work</p>
          <h3 className={classes.metaTitle}>
            {activeLink.name || activeLink.ogTitle || 'Open link'}
          </h3>
          <p className={classes.metaBody}>{activeLink.url}</p>
          <div className={classes.metaActions}>
            <a
              href={activeLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className={classes.metaPrimaryBtn}
            >
              Visit Link
            </a>
          </div>
        </div>
      );
    }

    if (viewMode === 'edit-2d' || editMode === '2d') {
      return (
        <div className={classes.metaCard}>
          <p className={classes.metaEyebrow}>Live 2D Edit</p>
          <h3 className={classes.metaTitle}>Community pixel remix</h3>
          <p className={classes.metaBody}>{formatUpdateLabel(liveDrafts?.pixel?.updatedAt)}</p>
          <div className={classes.metaActions}>
            {!isEditing && (
              <button
                type="button"
                className={classes.metaPrimaryBtn}
                onClick={() => startEditing('2d')}
              >
                Jump In
              </button>
            )}
            {liveSaveMode === '2d' && <span className={classes.metaSaving}>Autosaving...</span>}
          </div>
        </div>
      );
    }

    if (viewMode === 'edit-3d' || editMode === '3d') {
      return (
        <div className={classes.metaCard}>
          <p className={classes.metaEyebrow}>Live 3D Edit</p>
          <h3 className={classes.metaTitle}>Shared voxel build</h3>
          <p className={classes.metaBody}>{formatUpdateLabel(liveDrafts?.voxel?.updatedAt)}</p>
          <div className={classes.metaActions}>
            {!isEditing && (
              <button
                type="button"
                className={classes.metaPrimaryBtn}
                onClick={() => startEditing('3d')}
              >
                Sculpt It
              </button>
            )}
            {liveSaveMode === '3d' && <span className={classes.metaSaving}>Autosaving...</span>}
          </div>
        </div>
      );
    }

    return (
      <div className={classes.metaCard}>
        {currentAuction && (
          <div>
            <AuctionActivityDateHeadline startTime={BigInt(currentAuction.startTime)} />
            <AuctionActivityNounTitle
              isCool={currentNounSeed?.background === 0}
              nounId={BigInt(currentAuction.nounId)}
            />
          </div>
        )}
        <HomePrompt nounId={currentNounId} seed={currentNounSeed ?? undefined} />
      </div>
    );
  };

  const statusIcon = isEditing
    ? '✎'
    : interactionMode === 'grab'
      ? '🖐'
      : interactionMode === 'twist'
        ? '🌀'
        : '📱';
  const statusLabel = isEditing
    ? editMode === '3d'
      ? `${statusIcon} Live 3D editing`
      : `${statusIcon} Live 2D editing`
    : interactionMode === 'grab'
      ? `${statusIcon} Grab mode`
      : interactionMode === 'twist'
        ? `${statusIcon} Twist mode`
        : `${statusIcon} Scroll mode`;

  return (
    <div style={{ backgroundColor: stateBgColor }}>
      <div className={classes.heroWrapper}>
        <div className={classes.heroShell}>
          {currentAuction && (
            <div className={classes.hiddenSeedLoader}>
              <StandaloneNounWithSeed
                nounId={BigInt(currentAuction.nounId)}
                onLoadSeed={loadedNounHandler}
                shouldLinkToProfile={false}
              />
            </div>
          )}

          <div className={classes.heroTopRow}>
            <div
              className={classes.heroTabs}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
            >
              {[
                ['real', 'Real'],
                ['3d', '3D'],
                ['ascii', 'ASCII'],
                ['sprite', 'Sprite'],
                ['edit-2d', '2D Edit'],
                ['edit-3d', '3D Edit'],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={`${classes.tabBtn} ${viewMode === value ? classes.tabActive : ''}`}
                  onClick={() => {
                    if (value === 'sprite') {
                      // Batman transition sound + spin then enter world
                      new Audio('/sounds/batman-transition.mp3').play().catch(() => {});
                      setViewMode('sprite');
                      const s = currentNounSeed;
                      const seedParam = s
                        ? `?seed=${s.background}-${s.body}-${s.accessory}-${s.head}-${s.glasses}`
                        : '';
                      setTimeout(() => navigate(`/world${seedParam}`), 800);
                      return;
                    }
                    if (value === 'edit-2d') {
                      startEditing('2d');
                      return;
                    }
                    if (value === 'edit-3d') {
                      startEditing('3d');
                      return;
                    }
                    if (isEditing) stopEditing();
                    setViewMode(value as HeroViewMode);
                  }}
                >
                  {label}
                </button>
              ))}

              {derivatives.map(derivative => (
                <button
                  type="button"
                  key={derivative.id}
                  className={`${classes.tabBtn} ${classes.derivativeTab} ${viewMode === `deriv-${derivative.id}` ? classes.tabActive : ''}`}
                  onClick={() => {
                    if (isEditing) stopEditing();
                    setViewMode(`deriv-${derivative.id}`);
                  }}
                  title={`${derivative.name} · ${new Date(derivative.createdAt).toLocaleDateString()}`}
                >
                  {derivative.name}
                </button>
              ))}

              {nounLinks.map(link => (
                <button
                  type="button"
                  key={link.id}
                  className={`${classes.tabBtn} ${classes.linkTab} ${viewMode === `link-${link.id}` ? classes.tabActive : ''}`}
                  onClick={() => {
                    if (isEditing) stopEditing();
                    setViewMode(`link-${link.id}`);
                  }}
                  title={link.ogTitle || link.url}
                >
                  {link.name || link.ogTitle?.slice(0, 14) || new URL(link.url).hostname}
                </button>
              ))}

              <button
                type="button"
                className={`${classes.tabBtn} ${classes.addTab}`}
                onClick={() => {
                  if (isEditing) stopEditing();
                  setComposerOpen(true);
                  setComposerMode('art');
                }}
              >
                MAKE ART
              </button>
            </div>
          </div>

          <div className={classes.heroMain}>
            <section
              className={`${classes.heroStage} ${viewMode === 'real' && currentNounSeed ? (currentNounSeed.background === 0 ? classes.bgCool : classes.bgWarm) : ''}`}
            >
              <div
                className={`${classes.heroArtFrame} ${viewMode === 'sprite' ? classes.spriteTransition : ''}`}
                data-hero-artwork-root="true"
              >
                {renderHeroArtwork()}
              </div>

              {!isEditing && (
                <div className={classes.heroControlRail}>
                  <button
                    type="button"
                    className={`${classes.railBtn} ${interactionMode === 'scroll' ? classes.railBtnActive : ''}`}
                    onClick={() => {
                      setInteractionMode('scroll');
                      setPlayIntroSpin(false);
                    }}
                    title="Default scroll mode"
                  >
                    <span className={classes.railIcon}>📱</span>
                    <span className={classes.railLabel}>Scroll</span>
                  </button>
                  <button
                    type="button"
                    className={`${classes.railBtn} ${interactionMode === 'grab' ? classes.railBtnActive : ''}`}
                    onClick={() => setInteractionMode('grab')}
                    title="Grab and inspect"
                  >
                    <span className={classes.railIcon}>🖐</span>
                    <span className={classes.railLabel}>Grab</span>
                  </button>
                  {is3dView && (
                    <button
                      type="button"
                      className={`${classes.railBtn} ${interactionMode === 'twist' ? classes.railBtnActive : ''}`}
                      onClick={() => setInteractionMode('twist')}
                      title="Rotate the 3D noun"
                    >
                      <span className={classes.railIcon}>🌀</span>
                      <span className={classes.railLabel}>Twist</span>
                    </button>
                  )}
                  <div className={classes.downloadWrap}>
                    <button
                      type="button"
                      className={classes.railBtn}
                      onClick={() => setDownloadMenuOpen(v => !v)}
                      title="Download artwork (S)"
                    >
                      <span className={classes.railIcon}>💾</span>
                      <span className={classes.railLabel}>Save</span>
                    </button>
                    {downloadMenuOpen && (
                      <div className={classes.downloadMenu}>
                        <button type="button" onClick={() => downloadAs('png')}>
                          PNG
                        </button>
                        <button type="button" onClick={() => downloadAs('svg')}>
                          SVG
                        </button>
                        <button type="button" onClick={() => downloadAs('webp')}>
                          WebP
                        </button>
                        {is3dView && (
                          <button type="button" onClick={() => downloadAs('glb')}>
                            GLB
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!isEditing && is3dView && (
                <LightingPicker preset={lightingPreset} onChange={setLightingPreset} />
              )}

              <div className={classes.stageStatus}>{statusLabel}</div>

              {!isEditing && (
                <>
                  {hasAuctionBounds && BigInt(currentAuction.nounId) > 0n && (
                    <button
                      type="button"
                      onClick={prevAuctionHandler}
                      className={`${classes.navArrow} ${classes.navArrowLeft}`}
                      title="Previous Noun"
                    >
                      &#8249;
                    </button>
                  )}
                  {hasAuctionBounds && BigInt(currentAuction.nounId) < BigInt(lastNounId) && (
                    <button
                      type="button"
                      onClick={nextAuctionHandler}
                      className={`${classes.navArrow} ${classes.navArrowRight}`}
                      title="Next Noun"
                    >
                      &#8250;
                    </button>
                  )}
                </>
              )}

              {!isEditing && viewMode === 'edit-2d' && !liveDrafts?.pixel?.image && (
                <div className={classes.emptyDraftNotice}>
                  No live 2D edit yet. Hit edit and your version becomes the tab everyone sees.
                </div>
              )}

              {!isEditing && viewMode === 'edit-3d' && !liveDrafts?.voxel?.voxelData && (
                <div className={classes.emptyDraftNotice}>
                  No live 3D edit yet. Spin in, sculpt it, and the page updates for everyone.
                </div>
              )}

              {editMode === '2d' && currentNounSeed && (
                <Suspense fallback={null}>
                  <InlineEditor
                    seed={currentNounSeed}
                    nounSvg={nounSvg}
                    onExit={stopEditing}
                    toolRef={editorToolRef}
                    externalPixels={edit2dHistory.present}
                    externalDispatch={edit2dDispatch}
                    externalPast={edit2dHistory.past}
                    externalFuture={edit2dHistory.future}
                    visibility={edit2dVisibility}
                    onVisibilityChange={setEdit2dVisibility}
                  />
                </Suspense>
              )}

              {editMode === '3d' && currentNounSeed && (
                <Suspense fallback={null}>
                  <InlineEditor
                    seed={currentNounSeed}
                    nounSvg={null}
                    panelsOnly
                    externalPixels={edit3dHistory.present}
                    externalDispatch={edit3dDispatch}
                    externalPast={edit3dHistory.past}
                    externalFuture={edit3dHistory.future}
                    voxelDepth={meshGlbPath ? undefined : edit3dVoxelDepth}
                    onVoxelDepthChange={meshGlbPath ? undefined : setEdit3dVoxelDepth}
                    meshBrushSize={meshGlbPath ? meshBrushSize : undefined}
                    onMeshBrushSizeChange={meshGlbPath ? setMeshBrushSize : undefined}
                    isMeshMode={!!meshGlbPath}
                    activeTool={edit3dTool}
                    activeColor={edit3dColor}
                    onToolChange={setEdit3dTool}
                    onColorChange={setEdit3dColor}
                    onDownload={
                      meshGlbPath ? (fmt: 'glb' | 'stl' | 'obj') => downloadMesh(fmt) : undefined
                    }
                    onExit={stopEditing}
                    visibility={edit3dVisibility}
                    onVisibilityChange={setEdit3dVisibility}
                    interactionMode={edit3dInteractionMode}
                    onInteractionModeChange={setEdit3dInteractionMode}
                    toolRef={editorToolRef}
                  />
                </Suspense>
              )}
            </section>

            <aside className={classes.heroSidebar}>
              {renderInfoCard()}
              <div className={classes.auctionCard}>
                {currentAuction ? activityContent : <LoadingNoun />}
              </div>
            </aside>
          </div>
        </div>

        {composerOpen && (
          <div className={classes.composerOverlay} onClick={() => setComposerOpen(false)}>
            <div className={classes.composerCard} onClick={e => e.stopPropagation()}>
              <div className={classes.composerTabs}>
                <button
                  type="button"
                  className={`${classes.composerTabBtn} ${composerMode === 'art' ? classes.composerTabActive : ''}`}
                  onClick={() => setComposerMode('art')}
                >
                  Add Art
                </button>
                <button
                  type="button"
                  className={`${classes.composerTabBtn} ${composerMode === 'link' ? classes.composerTabActive : ''}`}
                  onClick={() => setComposerMode('link')}
                >
                  Add Link
                </button>
              </div>

              {composerMode === 'art' ? (
                <Suspense fallback={<div className={classes.heroLoading}>Loading form...</div>}>
                  <DerivativeUploadForm
                    nounId={currentNounId}
                    onUploaded={handleDerivativeUploaded}
                  />
                </Suspense>
              ) : (
                <div className={classes.linkComposer}>
                  <div>
                    <p className={classes.metaEyebrow}>Add Link</p>
                    <h3 className={classes.metaTitle}>Claim a pill on today&apos;s noun</h3>
                    <p className={classes.metaBody}>
                      Add your name and a link, then the tab shows up for everyone on this day.
                    </p>
                  </div>
                  <input
                    type="text"
                    placeholder="Your name"
                    value={linkNameDraft}
                    onChange={e => setLinkNameDraft(e.target.value)}
                    className={classes.composerInput}
                    maxLength={40}
                  />
                  <input
                    type="url"
                    placeholder="https://..."
                    value={linkUrlDraft}
                    onChange={e => setLinkUrlDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleAddLink();
                      if (e.key === 'Escape') setComposerOpen(false);
                    }}
                    className={classes.composerInput}
                  />
                  <div className={classes.composerActions}>
                    <button
                      type="button"
                      className={classes.metaGhostBtn}
                      onClick={() => setComposerOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={classes.metaPrimaryBtn}
                      onClick={handleAddLink}
                      disabled={linkSubmitting || !linkNameDraft.trim() || !linkUrlDraft.trim()}
                    >
                      {linkSubmitting ? 'Adding...' : 'Add Link'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {showHelp && (
          <Suspense fallback={null}>
            <KeyboardShortcutsHelp onClose={() => setShowHelp(false)} />
          </Suspense>
        )}
      </div>
    </div>
  );
};

export default Auction;
