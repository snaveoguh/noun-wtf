/**
 * CrystalBallPage — Full-page crystal ball Noun prediction with twin matching.
 *
 * Uses the CrystalBall orb, compares predicted traits against all existing nouns
 * to find "twins". Shows match count and optional SETTLE button for 4/5 or 5/5.
 *
 * Two user-controlled toggles at the top:
 *   • View mode — 2D / 3D / ASCII (swap the primary renderer for the current
 *     seed). ASCII keeps the original orb; 2D renders the SVG noun; 3D drops
 *     in MorphingNounVoxels — a Tetris-style voxel-reshuffle scene that
 *     keeps the canvas mounted between seed changes and animates per-voxel
 *     transitions instead of cross-fading the wrapper.
 *   • DAO — v1 Nouns / v2 Nouns (persisted via useActiveDao). For v1 we keep
 *     the existing /api/agent/predict polling. For v2 we read the live v2
 *     auction's `nounId` from the NounV2 auction house, then predict the
 *     *next* noun's seed client-side via NounsSeeder math (keccak256 of
 *     parent block hash + nextNounId). Twin-matching against v1 seeds stays
 *     disabled on v2 — no aggregated v2 seeds endpoint yet.
 */
import type { NounSeed, PredictResponse } from '@/components/CrystalBall';

import type { CSSProperties } from 'react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getNounData, ImageData as NounsImageData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';
import { ConnectKitButton } from 'connectkit';
import { encodePacked, keccak256, type Hex } from 'viem';
import { useAccount, useBlock, useReadContract, useWriteContract } from 'wagmi';

import {
  nounsAuctionHouseAddress,
  useWriteNounsAuctionHouseSettleCurrentAndCreateNewAuction,
} from '@/contracts';
import {
  NOUNV2_AUCTION_HOUSE_ADDRESS,
  nounV2AuctionHouseAbi,
} from '@/contracts/nounv2-auction-house';
import { useActiveDao, type ActiveDao } from '@/hooks/useActiveDao';
import { traitName } from '@/lib/traitName';
import { defaultChain } from '@/wagmi';

const CrystalBall = lazy(() => import('@/components/CrystalBall'));
const MorphingNounVoxels = lazy(() => import('@/components/MorphingNounVoxels'));

const TRAIT_KEYS = ['head', 'glasses', 'body', 'accessory', 'background'] as const;

const TRAIT_LABELS: Record<string, string> = {
  head: 'HEAD',
  glasses: 'NOGGLES',
  body: 'BODY',
  accessory: 'ACCESSORY',
  background: 'BG',
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app';

// ─── View mode ─────────────────────────────────────────────────────────
type ViewMode = '2d' | '3d' | 'ascii';

const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: '2d', label: '2D' },
  { value: '3d', label: '3D' },
  { value: 'ascii', label: 'ASCII' },
];

// ─── Colors ─────────────────────────────────────────────────────────────
const NOUNS_RED = '#e40536';
const CRYSTAL_PURPLE = '#8b5cf6';

// ─── Types ──────────────────────────────────────────────────────────────
interface NounSeedWithId extends NounSeed {
  id: number;
}

interface MatchResult {
  nounId: number;
  matches: number;
  matchingTraits: string[];
}

// ─── Trait counts ───────────────────────────────────────────────────────
// These mirror the on-chain NounsDescriptorV2 counts. Both Nouns and NounV2
// share the same descriptor so the same counts apply for seed prediction.
// Source: packages/nouns-api/src/agent/constants.ts
const TRAIT_COUNTS = {
  background: 2,
  body: 31,
  accessory: 144,
  head: 258,
  glasses: 24,
} as const;

// ─── Seed Prediction ────────────────────────────────────────────────────
// Mirrors NounsSeeder.sol — see packages/nouns-api/src/agent/traitPredictor.ts.
//   pseudorandomness = keccak256(abi.encodePacked(blockhash(block.number - 1), nounId))
// Reused here so the v2 path can compute the next-noun prediction client-side
// without needing a v2-aware /api/agent/predict endpoint yet.
function predictSeed(blockHash: Hex, nounId: number): NounSeed {
  const pseudorandomness = BigInt(
    keccak256(encodePacked(['bytes32', 'uint256'], [blockHash, BigInt(nounId)])),
  );
  const mask48 = (1n << 48n) - 1n;
  return {
    background: Number((pseudorandomness & mask48) % BigInt(TRAIT_COUNTS.background)),
    body: Number(((pseudorandomness >> 48n) & mask48) % BigInt(TRAIT_COUNTS.body)),
    accessory: Number(((pseudorandomness >> 96n) & mask48) % BigInt(TRAIT_COUNTS.accessory)),
    head: Number(((pseudorandomness >> 144n) & mask48) % BigInt(TRAIT_COUNTS.head)),
    glasses: Number(((pseudorandomness >> 192n) & mask48) % BigInt(TRAIT_COUNTS.glasses)),
  };
}

// ─── Match logic ────────────────────────────────────────────────────────
function findBestMatch(predicted: NounSeed, allNouns: NounSeedWithId[]): MatchResult | null {
  let best: MatchResult | null = null;

  for (const noun of allNouns) {
    const matching: string[] = [];
    for (const key of TRAIT_KEYS) {
      if (predicted[key] === noun[key]) matching.push(key);
    }
    if (!best || matching.length > best.matches) {
      best = { nounId: noun.id, matches: matching.length, matchingTraits: matching };
    }
  }
  return best;
}

// ─── Hooks ──────────────────────────────────────────────────────────────
function useBallSize() {
  const [size, setSize] = useState(() =>
    Math.min(420, window.innerWidth - 60, window.innerHeight * 0.45),
  );
  useEffect(() => {
    const onResize = () =>
      setSize(Math.min(420, window.innerWidth - 60, window.innerHeight * 0.45));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return Math.round(size);
}

function useNounSeeds() {
  const [seeds, setSeeds] = useState<NounSeedWithId[]>([]);
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    fetch(`${API_BASE}/api/nouns/seeds`)
      .then(r => r.json())
      .then((data: NounSeedWithId[]) => setSeeds(data))
      .catch(() => {});
  }, []);

  return seeds;
}

/**
 * Predict the seed of the next NounV2 to be minted, using the on-chain
 * NounsSeeder math (`keccak256(parentBlockHash, nextNounId)`). The v2 indexer
 * has no prediction endpoint yet, so we replicate the agent's predictSeed
 * here using the live auction house's `auction.nounId + 1` and the latest
 * block hash. This means the orb/twin pipeline stays usable for v2 and
 * predicts the *correct* next NounV2 instead of leaking through to a v1
 * mainnet prediction.
 */
function useNounV2Prediction(enabled: boolean): PredictResponse | null {
  const { data: auctionData } = useReadContract({
    address: NOUNV2_AUCTION_HOUSE_ADDRESS,
    abi: nounV2AuctionHouseAbi,
    functionName: 'auction',
    query: {
      enabled: enabled && NOUNV2_AUCTION_HOUSE_ADDRESS !== ZERO_ADDRESS,
      refetchInterval: 12_000,
    },
  });

  const auction = auctionData as
    | readonly [bigint, bigint, bigint, bigint, `0x${string}`, boolean]
    | undefined;
  const currentNounId = auction?.[0];
  const endTime = auction?.[3];

  // Pull the latest block so we can hash with the current parent block hash.
  // NounsSeeder.sol uses blockhash(block.number - 1); when our settlement tx
  // lands in block N+1 the seeder hashes block N, which is the latest block
  // visible to us right now.
  const { data: blockData } = useBlock({
    watch: true,
    query: { enabled: enabled && NOUNV2_AUCTION_HOUSE_ADDRESS !== ZERO_ADDRESS },
  });

  return useMemo(() => {
    if (!enabled) return null;
    if (!auction || currentNounId == null) return null;
    if (!blockData?.hash) return null;

    const nextNounId = Number(currentNounId) + 1;
    const seed = predictSeed(blockData.hash, nextNounId);
    const auctionEnd = endTime != null ? Number(endTime) : 0;
    const now = Math.floor(Date.now() / 1000);
    const payload: PredictResponse = {
      block: Number(blockData.number ?? 0n),
      nextNounId,
      seed,
      traits: null,
      auctionEnd,
      auctionEnded: auctionEnd > 0 && auctionEnd <= now,
      running: true,
      checkedAt: new Date().toISOString(),
    };
    return payload;
  }, [enabled, auction, currentNounId, blockData?.hash, blockData?.number, endTime]);
}

// ─── 2D SVG rendering ──────────────────────────────────────────────────
function seedToSvgDataUri(seed: NounSeed): string {
  const { parts, background } = getNounData(seed);
  const svg = buildSVG(parts, NounsImageData.palette, background);
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// ─── Pill toggle (matches HeaderDaoToggle aesthetic) ───────────────────
interface PillProps<T extends string> {
  label: string;
  value: T;
  active: boolean;
  onSelect: (value: T) => void;
  accent?: 'neutral' | 'red' | 'purple';
}

function Pill<T extends string>({
  label,
  value,
  active,
  onSelect,
  accent = 'neutral',
}: PillProps<T>) {
  const activeClasses =
    accent === 'red'
      ? 'bg-red-600 text-white shadow-[0_1px_2px_rgba(220,38,38,0.35)]'
      : accent === 'purple'
        ? 'bg-purple-600 text-white shadow-[0_1px_2px_rgba(147,51,234,0.35)]'
        : 'bg-neutral-900 text-white shadow-[0_1px_2px_rgba(0,0,0,0.25)]';
  const inactiveClasses =
    accent === 'red'
      ? 'text-red-700 hover:bg-red-50'
      : accent === 'purple'
        ? 'text-purple-700 hover:bg-purple-50'
        : 'text-neutral-700 hover:bg-neutral-100';

  const ringClass =
    accent === 'red'
      ? 'focus-visible:ring-red-500'
      : accent === 'purple'
        ? 'focus-visible:ring-purple-500'
        : 'focus-visible:ring-neutral-500';

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(value)}
      className={`relative flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${ringClass} ${
        active ? activeClasses : inactiveClasses
      }`}
    >
      <span className="leading-none">{label}</span>
    </button>
  );
}

function ViewModeToggle({ mode, setMode }: { mode: ViewMode; setMode: (m: ViewMode) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Select view mode"
      className="inline-flex items-center gap-0.5 rounded-full border border-neutral-200 bg-white/70 p-0.5 shadow-sm backdrop-blur-sm"
    >
      {VIEW_MODES.map(m => (
        <Pill
          key={m.value}
          label={m.label}
          value={m.value}
          active={mode === m.value}
          onSelect={setMode}
          accent="purple"
        />
      ))}
    </div>
  );
}

function DaoToggle({
  activeDao,
  setActiveDao,
}: {
  activeDao: ActiveDao;
  setActiveDao: (d: ActiveDao) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Select DAO"
      className="inline-flex items-center gap-0.5 rounded-full border border-neutral-200 bg-white/70 p-0.5 shadow-sm backdrop-blur-sm"
    >
      <Pill
        label="Nouns"
        value={'nouns' as ActiveDao}
        active={activeDao === 'nouns'}
        onSelect={setActiveDao}
        accent="neutral"
      />
      <Pill
        label="V2"
        value={'nounv2' as ActiveDao}
        active={activeDao === 'nounv2'}
        onSelect={setActiveDao}
        accent="red"
      />
    </div>
  );
}

// ─── Seed key (stable identity for transitions) ─────────────────────────
function seedKey(seed: NounSeed): string {
  return `${seed.background}-${seed.body}-${seed.accessory}-${seed.head}-${seed.glasses}`;
}

// ─── Primary visualisation for 2D / 3D modes ───────────────────────────
//
// 2D mode keeps the cross-fade morph (rotate + opacity wobble between two
// stacked SVG layers). 3D mode delegates to MorphingNounVoxels which keeps
// a single Canvas mounted across seed changes and reshuffles voxels in-place
// — voxels shared between seeds stay put, voxels only in the old seed fall
// out, voxels only in the new seed drop in (Tetris-style cascade).
function SeedVisual({
  seed,
  mode,
  size,
  isNounOClock,
  variant,
}: {
  seed: NounSeed | null;
  mode: '2d' | '3d';
  size: number;
  isNounOClock: boolean;
  /** Visual hint — the "match" variant tints the halo purple. */
  variant?: 'predicted' | 'match';
}) {
  const haloColor = variant === 'match' ? CRYSTAL_PURPLE : '#aaccff';

  // Match the orb's round framing so 2D and 3D slot into the same slot the
  // crystal ball previously occupied without reflowing the match panel.
  const frameStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    overflow: 'hidden',
    position: 'relative',
    background: 'radial-gradient(circle at 35% 35%, rgba(40,40,60,0.9), rgba(5,5,15,0.95))',
    boxShadow: isNounOClock
      ? `0 0 20px rgba(239,68,68,0.4), 0 0 40px rgba(239,68,68,0.15), inset 0 0 30px rgba(239,68,68,0.1)`
      : variant === 'match'
        ? `0 0 22px ${CRYSTAL_PURPLE}55, 0 0 44px ${CRYSTAL_PURPLE}22, inset 0 0 28px ${CRYSTAL_PURPLE}1f`
        : `0 0 20px rgba(100,200,255,0.15), 0 0 40px rgba(100,200,255,0.05), inset 0 0 30px rgba(100,150,255,0.08)`,
    border: isNounOClock
      ? '1px solid rgba(239,68,68,0.3)'
      : variant === 'match'
        ? `1px solid ${CRYSTAL_PURPLE}55`
        : '1px solid rgba(100,200,255,0.15)',
    transition: 'box-shadow 0.6s, border-color 0.6s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  // ── Cross-fade morph ──
  // We render two stacked seed layers: the previous one fading out, and the
  // current one fading + wobbling in. Triggered by `seedKey` changing.
  const currentKey = seed ? seedKey(seed) : null;
  const [prevSeed, setPrevSeed] = useState<NounSeed | null>(null);
  const [, setMorphTick] = useState(0);
  const lastKeyRef = useRef<string | null>(null);
  const fadeRef = useRef<{ from: NounSeed | null; to: NounSeed | null; startedAt: number }>({
    from: null,
    to: null,
    startedAt: 0,
  });
  const MORPH_MS = 800;

  useEffect(() => {
    if (lastKeyRef.current === currentKey) return;
    fadeRef.current = {
      from: prevSeed,
      to: seed,
      startedAt: performance.now(),
    };
    setPrevSeed(seed);
    lastKeyRef.current = currentKey;

    let raf = 0;
    const tick = () => {
      const elapsed = performance.now() - fadeRef.current.startedAt;
      setMorphTick(t => t + 1);
      if (elapsed < MORPH_MS) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // We deliberately only track currentKey here — `seed` and `prevSeed`
    // are read for branch logic but the trigger is the key flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  const elapsed = fadeRef.current.startedAt
    ? performance.now() - fadeRef.current.startedAt
    : MORPH_MS;
  const tRaw = Math.min(1, Math.max(0, elapsed / MORPH_MS));
  // easeInOutCubic
  const t = tRaw < 0.5 ? 4 * tRaw * tRaw * tRaw : 1 - Math.pow(-2 * tRaw + 2, 3) / 2;
  // Wobble — small ±8deg rotation that decays over the morph.
  const wobble = (1 - t) * 8 * Math.sin(tRaw * Math.PI * 2);

  if (!seed) {
    return (
      <div style={frameStyle}>
        <span
          style={{
            fontFamily: '"Courier New", monospace',
            fontSize: 12,
            color: `${haloColor}59`,
            letterSpacing: '0.2em',
          }}
        >
          SCRYING...
        </span>
      </div>
    );
  }

  const layerStyle = (opacity: number, rotateDeg: number, scale: number): CSSProperties => ({
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity,
    transform: `rotate(${rotateDeg}deg) scale(${scale})`,
    willChange: 'opacity, transform',
    pointerEvents: 'none',
  });

  if (mode === '2d') {
    const src = seedToSvgDataUri(seed);
    const fromSeed = fadeRef.current.from;
    const fromSrc = fromSeed && fromSeed !== seed ? seedToSvgDataUri(fromSeed) : null;
    return (
      <div style={frameStyle}>
        {fromSrc && t < 1 && (
          <div style={layerStyle(1 - t, -wobble, 1 + (1 - t) * 0.04)}>
            <img
              src={fromSrc}
              alt=""
              style={{
                width: '78%',
                height: '78%',
                imageRendering: 'pixelated',
                objectFit: 'contain',
              }}
            />
          </div>
        )}
        <div style={layerStyle(t, wobble, 1 - (1 - t) * 0.04)}>
          <img
            src={src}
            alt="predicted noun"
            style={{
              width: '78%',
              height: '78%',
              imageRendering: 'pixelated',
              objectFit: 'contain',
            }}
          />
        </div>
      </div>
    );
  }

  // 3D voxel mode — instead of cross-fading the wrapper, we hand the seed to
  // MorphingNounVoxels which keeps the same Canvas instance across seed
  // changes and reshuffles voxels in-place (Tetris-style cascade). The outer
  // halo + ring still react to the variant (predicted vs. match) but the
  // voxels themselves do all the morphing work.
  return (
    <div style={frameStyle}>
      <div style={layerStyle(1, 0, 1)}>
        <Suspense fallback={null}>
          <MorphingNounVoxels seed={seed} autoRotate />
        </Suspense>
      </div>
    </div>
  );
}

// ─── User-driven settle (crystal ball emoji button) ────────────────────
//
// Sends `settleCurrentAndCreateNewAuction()` from the connected wallet to the
// active DAO's auction house. Same method name on v1 and v2 — only the
// address differs. Returns helpers + status so the page can render disabled
// states / tx hash without re-implementing wagmi plumbing.
interface UserSettleResult {
  trigger: () => void;
  txHash: `0x${string}` | undefined;
  isPending: boolean;
  canSettle: boolean;
  /** Disabled reason for tooltip — `null` when the button is callable. */
  disabledReason: string | null;
}

function useUserSettle(
  activeDao: ActiveDao,
  effectivePrediction: PredictResponse | null,
): UserSettleResult {
  const { isConnected } = useAccount();
  const chainId = defaultChain.id as keyof typeof nounsAuctionHouseAddress;

  // v1 path uses the gen'd writer (cleaner types), v2 falls back to the
  // generic useWriteContract because we ship a hand-written ABI.
  const v1Writer = useWriteNounsAuctionHouseSettleCurrentAndCreateNewAuction();
  const v2Writer = useWriteContract();

  const isV2 = activeDao === 'nounv2';
  const txHash = isV2 ? v2Writer.data : v1Writer.data;
  const isPending = isV2 ? v2Writer.isPending : v1Writer.isPending;

  const v2Configured = NOUNV2_AUCTION_HOUSE_ADDRESS !== ZERO_ADDRESS;

  const auctionEnded = effectivePrediction?.auctionEnded ?? false;

  const disabledReason: string | null = !isConnected
    ? 'Connect wallet'
    : !auctionEnded
      ? 'Auction still live'
      : isV2 && !v2Configured
        ? 'NounV2 not deployed'
        : null;

  const canSettle = disabledReason === null && !isPending;

  const trigger = useCallback(() => {
    if (!canSettle) return;
    if (isV2) {
      v2Writer.writeContract({
        address: NOUNV2_AUCTION_HOUSE_ADDRESS,
        abi: nounV2AuctionHouseAbi,
        functionName: 'settleCurrentAndCreateNewAuction',
        args: [],
      });
      return;
    }
    // v1 — pre-bound to nounsAuctionHouseAddress[chainId] / nounsAuctionHouseAbi.
    void chainId;
    v1Writer.writeContract({});
  }, [canSettle, isV2, v1Writer, v2Writer, chainId]);

  return { trigger, txHash, isPending, canSettle, disabledReason };
}

interface SettleOrbButtonProps {
  state: UserSettleResult;
  isConnected: boolean;
  /** Visual ring colour matches the Noun-O'Clock state when available. */
  active: boolean;
}

/**
 * Top-right floating crystal-ball-emoji button. When wallet is disconnected,
 * wraps the icon in ConnectKit's custom hook so a click opens the connect
 * modal instead of a no-op alert.
 */
function SettleOrbButton({ state, isConnected, active }: SettleOrbButtonProps) {
  const containerStyle: CSSProperties = {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 20,
  };

  const baseBtnStyle: CSSProperties = {
    width: 44,
    height: 44,
    borderRadius: '50%',
    border: active ? '1px solid rgba(239,68,68,0.55)' : '1px solid rgba(139,92,246,0.4)',
    background: active
      ? 'radial-gradient(circle at 35% 35%, rgba(239,68,68,0.25), rgba(20,5,15,0.85))'
      : 'radial-gradient(circle at 35% 35%, rgba(139,92,246,0.25), rgba(10,10,25,0.85))',
    boxShadow: active
      ? '0 0 16px rgba(239,68,68,0.4), inset 0 0 12px rgba(239,68,68,0.2)'
      : '0 0 14px rgba(139,92,246,0.25), inset 0 0 10px rgba(139,92,246,0.15)',
    fontSize: 22,
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: state.canSettle ? 'pointer' : 'not-allowed',
    opacity: state.canSettle ? 1 : 0.55,
    transition: 'opacity 0.2s, box-shadow 0.3s, border-color 0.3s',
    color: '#fff',
  };

  const tooltip =
    state.disabledReason != null
      ? state.disabledReason
      : state.isPending
        ? 'Settling...'
        : 'Settle auction';

  if (!isConnected) {
    return (
      <div style={containerStyle}>
        <ConnectKitButton.Custom>
          {({ show }) => (
            <button
              type="button"
              aria-label="Connect wallet to settle"
              title="Connect wallet to settle"
              onClick={() => show?.()}
              style={baseBtnStyle}
            >
              <span aria-hidden="true">{'\uD83D\uDD2E'}</span>
            </button>
          )}
        </ConnectKitButton.Custom>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <button
        type="button"
        aria-label={tooltip}
        title={tooltip}
        onClick={state.trigger}
        disabled={!state.canSettle}
        style={baseBtnStyle}
      >
        <span aria-hidden="true">{state.isPending ? '\u23F3' : '\uD83D\uDD2E'}</span>
      </button>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────
export default function CrystalBallPage() {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'ascii';
    const saved = window.localStorage.getItem('crystal-ball:view-mode');
    if (saved === '2d' || saved === '3d' || saved === 'ascii') return saved;
    return 'ascii';
  });
  const { activeDao, setActiveDao } = useActiveDao();

  useEffect(() => {
    try {
      window.localStorage.setItem('crystal-ball:view-mode', viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  const [prediction, setPrediction] = useState<PredictResponse | null>(null);
  const [settling, setSettling] = useState(false);
  const [settleTx, setSettleTx] = useState<string | null>(null);
  const ballSize = useBallSize();
  const allSeeds = useNounSeeds();

  const nounV2Prediction = useNounV2Prediction(activeDao === 'nounv2');

  // Track the active prediction from whichever data source is driving the
  // page so 2D / 3D modes and the twin matcher can all read one shape.
  const effectivePrediction = activeDao === 'nounv2' ? nounV2Prediction : prediction;

  const { isConnected } = useAccount();
  const userSettle = useUserSettle(activeDao, effectivePrediction);

  const handlePredict = useCallback((data: PredictResponse) => {
    setPrediction(data);
  }, []);

  // Reset prediction state when DAO flips so a stale v1 seed doesn't briefly
  // show through while the v2 read is in flight.
  useEffect(() => {
    if (activeDao === 'nounv2') setPrediction(null);
  }, [activeDao]);

  const traits = effectivePrediction?.seed
    ? TRAIT_KEYS.map(key => ({
        key,
        label: TRAIT_LABELS[key],
        value: traitName(key, effectivePrediction.seed![key]),
      }))
    : null;

  // Twin matching is only meaningful against the aggregated v1 seeds dataset.
  // Once a v2 seeds endpoint exists this can widen; for now, skip on v2.
  const bestMatch = useMemo(() => {
    if (activeDao !== 'nouns') return null;
    if (!effectivePrediction?.seed || allSeeds.length === 0) return null;
    return findBestMatch(effectivePrediction.seed, allSeeds);
  }, [activeDao, effectivePrediction?.seed, allSeeds]);

  // The historical twin's actual seed (looked up from the aggregated dataset)
  // — used by the carousel toggle to morph between predicted and matched.
  const twinSeed = useMemo<NounSeed | null>(() => {
    if (!bestMatch || allSeeds.length === 0) return null;
    const found = allSeeds.find(s => s.id === bestMatch.nounId);
    if (!found) return null;
    return {
      background: found.background,
      body: found.body,
      accessory: found.accessory,
      head: found.head,
      glasses: found.glasses,
    };
  }, [bestMatch, allSeeds]);

  // Carousel index — 0 = predicted, 1 = twin match. We reset to 0 whenever
  // the underlying prediction changes so a fresh prediction always shows
  // first; the user can step over to the twin via the chevrons.
  const [carouselIndex, setCarouselIndex] = useState(0);
  useEffect(() => {
    setCarouselIndex(0);
  }, [effectivePrediction?.seed]);

  const carouselHasTwin = twinSeed != null;
  const showingTwin = carouselHasTwin && carouselIndex === 1;
  const visibleSeed: NounSeed | null = showingTwin ? twinSeed : (effectivePrediction?.seed ?? null);

  const matchColor =
    bestMatch?.matches === 5
      ? CRYSTAL_PURPLE
      : bestMatch?.matches === 4
        ? NOUNS_RED
        : bestMatch != null && bestMatch.matches >= 3
          ? '#eab308'
          : '#444';

  const showSettle =
    bestMatch != null &&
    bestMatch.matches >= 4 &&
    effectivePrediction?.auctionEnded === true &&
    settleTx == null;

  const settleColor = bestMatch?.matches === 5 ? CRYSTAL_PURPLE : NOUNS_RED;

  async function handleSettle() {
    setSettling(true);
    try {
      const res = await fetch(`${API_BASE}/api/agent/settle`, { method: 'POST' });
      const data = (await res.json()) as { txHash?: string };
      if (typeof data.txHash === 'string' && data.txHash.length > 0) {
        setSettleTx(data.txHash);
      }
    } catch {
      /* silent */
    } finally {
      setSettling(false);
    }
  }

  const isNounOClock = effectivePrediction?.auctionEnded ?? false;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        background: 'radial-gradient(ellipse at 50% 40%, rgba(15,15,25,1), rgba(5,5,8,1))',
        fontFamily: '"Courier New", monospace',
        color: '#888',
        padding: '20px',
        gap: 20,
        position: 'relative',
      }}
    >
      {/* Floating crystal-ball settle button — top right of the page. */}
      <SettleOrbButton state={userSettle} isConnected={isConnected} active={isNounOClock} />

      {/* Settle tx hash — small breadcrumb under the orb button when broadcast. */}
      {userSettle.txHash && (
        <a
          href={`https://etherscan.io/tx/${userSettle.txHash}`}
          target="_blank"
          rel="noreferrer"
          style={{
            position: 'absolute',
            top: 64,
            right: 16,
            fontSize: 9,
            color: '#4ade80',
            fontFamily: 'monospace',
            letterSpacing: '0.05em',
            textDecoration: 'none',
            zIndex: 20,
          }}
        >
          TX: {userSettle.txHash.slice(0, 8)}…
        </a>
      )}

      {/* Toggles — view mode on top row, DAO on second row (mirrors HeaderDaoToggle aesthetic). */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          paddingTop: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              fontSize: 9,
              letterSpacing: '0.2em',
              color: '#555',
              fontWeight: 700,
              minWidth: 36,
            }}
          >
            VIEW
          </span>
          <ViewModeToggle mode={viewMode} setMode={setViewMode} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              fontSize: 9,
              letterSpacing: '0.2em',
              color: '#555',
              fontWeight: 700,
              minWidth: 36,
            }}
          >
            DAO
          </span>
          <DaoToggle activeDao={activeDao} setActiveDao={setActiveDao} />
        </div>
      </div>

      {/* Orb + match panel side by side on desktop, stacked on mobile */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 32,
          flexWrap: 'wrap',
          marginTop: 8,
        }}
      >
        {viewMode === 'ascii' ? (
          <Suspense
            fallback={
              <div
                style={{
                  width: ballSize,
                  height: ballSize,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'rgba(100,200,255,0.3)',
                  fontSize: 14,
                  letterSpacing: '0.15em',
                }}
              >
                SCRYING...
              </div>
            }
          >
            <CrystalBall
              size={ballSize}
              interactive
              onPredict={activeDao === 'nouns' ? handlePredict : undefined}
              predictionOverride={activeDao === 'nounv2' ? nounV2Prediction : undefined}
            />
          </Suspense>
        ) : (
          <Suspense
            fallback={
              <div
                style={{
                  width: ballSize,
                  height: ballSize,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'rgba(100,200,255,0.3)',
                  fontSize: 14,
                  letterSpacing: '0.15em',
                }}
              >
                SCRYING...
              </div>
            }
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <div style={{ position: 'relative' }}>
                <SeedVisual
                  seed={visibleSeed}
                  mode={viewMode}
                  size={ballSize}
                  isNounOClock={isNounOClock}
                  variant={showingTwin ? 'match' : 'predicted'}
                />
                {/* Carousel chevrons — only mounted when there's a twin to morph to. */}
                {carouselHasTwin && (
                  <>
                    <button
                      type="button"
                      aria-label="Previous"
                      onClick={() => setCarouselIndex(i => (i === 0 ? 1 : 0))}
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: -8,
                        transform: 'translateY(-50%)',
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        border: '1px solid rgba(255,255,255,0.18)',
                        background: 'rgba(20,20,30,0.7)',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: 14,
                        fontFamily: '"Courier New", monospace',
                      }}
                    >
                      {'<'}
                    </button>
                    <button
                      type="button"
                      aria-label="Next"
                      onClick={() => setCarouselIndex(i => (i === 0 ? 1 : 0))}
                      style={{
                        position: 'absolute',
                        top: '50%',
                        right: -8,
                        transform: 'translateY(-50%)',
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        border: '1px solid rgba(255,255,255,0.18)',
                        background: 'rgba(20,20,30,0.7)',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: 14,
                        fontFamily: '"Courier New", monospace',
                      }}
                    >
                      {'>'}
                    </button>
                    {/* Carousel dots */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: -16,
                        left: 0,
                        right: 0,
                        display: 'flex',
                        justifyContent: 'center',
                        gap: 6,
                      }}
                    >
                      {[0, 1].map(i => (
                        <button
                          key={i}
                          type="button"
                          aria-label={i === 0 ? 'Predicted' : 'Twin'}
                          onClick={() => setCarouselIndex(i)}
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            border: 'none',
                            padding: 0,
                            background:
                              carouselIndex === i ? (i === 0 ? '#aaccff' : CRYSTAL_PURPLE) : '#333',
                            cursor: 'pointer',
                          }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
              {/* Keep the seed-pulling CrystalBall mounted invisibly on v1
                  so the prediction pipeline stays live when the user picks
                  2D or 3D. On v2 the on-chain hook supplies the seed, so we
                  skip this shadow instance. */}
              {activeDao === 'nouns' && (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    width: 0,
                    height: 0,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                    opacity: 0,
                  }}
                >
                  <CrystalBall size={32} interactive={false} onPredict={handlePredict} />
                </div>
              )}
              {/* Info line under the visual when not showing the orb */}
              {effectivePrediction && (
                <div
                  style={{
                    fontSize: 10,
                    color: '#666',
                    letterSpacing: '0.05em',
                    marginTop: showingTwin ? 18 : 6,
                  }}
                >
                  <span
                    style={{
                      color: showingTwin
                        ? CRYSTAL_PURPLE
                        : effectivePrediction.running
                          ? '#4ade80'
                          : '#ef4444',
                      marginRight: 4,
                    }}
                  >
                    {showingTwin ? '\u2605' : effectivePrediction.running ? '\u25CF' : '\u25CB'}
                  </span>
                  {showingTwin && bestMatch
                    ? `TWIN — NOUN #${bestMatch.nounId}`
                    : `${activeDao === 'nounv2' ? 'NOUNV2' : 'NOUN'} #${effectivePrediction.nextNounId}`}
                </div>
              )}
              {/* 3D ASCII preview when requested via mode=ascii handled above;
                  this branch only runs for 2D/3D so we don't render it here. */}
            </div>
          </Suspense>
        )}

        {/* Match panel */}
        {bestMatch && bestMatch.matches > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              minWidth: 160,
            }}
          >
            {/* Match count */}
            <div
              style={{
                fontSize: 48,
                fontWeight: 900,
                color: matchColor,
                lineHeight: 1,
                textShadow:
                  bestMatch.matches >= 4
                    ? `0 0 20px ${matchColor}60, 0 0 40px ${matchColor}30`
                    : 'none',
              }}
            >
              {bestMatch.matches}/5
            </div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.2em',
                color: matchColor,
                fontWeight: 700,
              }}
            >
              {bestMatch.matches === 5
                ? 'PERFECT TWIN'
                : bestMatch.matches === 4
                  ? 'NEAR TWIN'
                  : 'MATCH'}
            </div>

            {/* Twin noun link */}
            <a
              href={`/noun/${bestMatch.nounId}`}
              style={{
                fontSize: 14,
                color: '#aaccff',
                textDecoration: 'none',
                letterSpacing: '0.05em',
                borderBottom: '1px solid rgba(170,204,255,0.3)',
              }}
            >
              NOUN #{bestMatch.nounId}
            </a>

            {/* Matching trait indicators */}
            <div
              style={{
                display: 'flex',
                gap: 6,
                marginTop: 4,
              }}
            >
              {TRAIT_KEYS.map(key => {
                const isMatch = bestMatch.matchingTraits.includes(key);
                return (
                  <div
                    key={key}
                    title={TRAIT_LABELS[key]}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: isMatch ? matchColor : '#333',
                      transition: 'background 0.3s',
                    }}
                  />
                );
              })}
            </div>

            {/* SETTLE button — only for 4/5 or 5/5 when auction ended */}
            {showSettle && (
              <button
                type="button"
                onClick={handleSettle}
                disabled={settling}
                style={{
                  marginTop: 12,
                  padding: '16px 48px',
                  fontSize: 18,
                  fontWeight: 900,
                  fontFamily: '"Courier New", monospace',
                  letterSpacing: '0.15em',
                  color: '#fff',
                  background: settleColor,
                  border: 'none',
                  borderRadius: 8,
                  cursor: settling ? 'wait' : 'pointer',
                  opacity: settling ? 0.6 : 1,
                  boxShadow: `0 0 24px ${settleColor}50, 0 0 48px ${settleColor}25`,
                  transition: 'opacity 0.2s, box-shadow 0.2s',
                  animation: 'settle-pulse 2s ease-in-out infinite',
                }}
              >
                {settling ? 'SETTLING...' : 'SETTLE'}
              </button>
            )}

            {/* Settlement tx hash */}
            {settleTx && (
              <a
                href={`https://etherscan.io/tx/${settleTx}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: 10,
                  color: '#4ade80',
                  fontFamily: 'monospace',
                  letterSpacing: '0.05em',
                }}
              >
                TX: {settleTx.slice(0, 10)}...
              </a>
            )}
          </div>
        )}
      </div>

      {/* Trait display */}
      {traits && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '12px 32px',
          }}
        >
          {traits.map(t => {
            const isMatch = bestMatch?.matchingTraits.includes(t.key) === true;
            return (
              <div
                key={t.key}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                <span
                  style={{
                    fontSize: 9,
                    color: isMatch ? matchColor : '#555',
                    letterSpacing: '0.15em',
                    fontWeight: 700,
                  }}
                >
                  {t.label}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: isMatch ? '#fff' : '#aaccff',
                    letterSpacing: '0.05em',
                    textShadow: isMatch ? `0 0 8px ${matchColor}80` : 'none',
                  }}
                >
                  {t.value}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* v2: surface a small note that twin matching is still v1-only. */}
      {activeDao === 'nounv2' && effectivePrediction?.seed && (
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.15em',
            color: '#666',
            textAlign: 'center',
            maxWidth: 420,
            lineHeight: 1.5,
          }}
        >
          TWIN MATCHING DISABLED FOR V2 — NO AGGREGATED SEED ENDPOINT YET
        </div>
      )}

      {/* Settle pulse animation */}
      <style>{`
        @keyframes settle-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
        }
      `}</style>
    </div>
  );
}
