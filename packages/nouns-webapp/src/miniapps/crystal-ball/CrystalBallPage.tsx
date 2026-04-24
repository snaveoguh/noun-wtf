/**
 * CrystalBallPage — Full-page crystal ball Noun prediction with twin matching.
 *
 * Uses the CrystalBall orb, compares predicted traits against all existing nouns
 * to find "twins". Shows match count and optional SETTLE button for 4/5 or 5/5.
 *
 * Two user-controlled toggles at the top:
 *   • View mode — 2D / 3D / ASCII (swap the primary renderer for the current
 *     seed). ASCII keeps the original orb; 2D renders the SVG noun; 3D drops
 *     in the full NounParallax voxel scene.
 *   • DAO — v1 Nouns / v2 Nouns (persisted via useActiveDao). For v1 we keep
 *     the existing /api/agent/predict polling. For v2 we read the current
 *     auction + seed directly from the NounV2 contracts, and twin-matching is
 *     disabled (no aggregated v2 seeds endpoint yet).
 */
import type { NounSeed, PredictResponse } from '@/components/CrystalBall';

import type { CSSProperties } from 'react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getNounData, ImageData as NounsImageData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';
import { useReadContract } from 'wagmi';

import {
  NOUNV2_AUCTION_HOUSE_ADDRESS,
  nounV2AuctionHouseAbi,
} from '@/contracts/nounv2-auction-house';
import { NOUNV2_TOKEN_ADDRESS, nounV2TokenAbi } from '@/contracts/nounv2-token';
import { useActiveDao, type ActiveDao } from '@/hooks/useActiveDao';
import { traitName } from '@/lib/traitName';

const CrystalBall = lazy(() => import('@/components/CrystalBall'));
const NounParallax = lazy(() => import('@/components/NounParallax'));

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
 * For `dao=nounv2`, synthesise a CrystalBall-compatible prediction straight
 * from the v2 auction house + token. The v2 indexer has no prediction
 * endpoint yet, so we surface the current live auction instead — it's the
 * closest analogue and keeps the orb/twin pipeline usable.
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
  const nounId = auction?.[0];
  const endTime = auction?.[3];

  const { data: seedData } = useReadContract({
    address: NOUNV2_TOKEN_ADDRESS,
    abi: nounV2TokenAbi,
    functionName: 'seeds',
    args: nounId != null ? [nounId] : undefined,
    query: {
      enabled: enabled && nounId != null && NOUNV2_TOKEN_ADDRESS !== ZERO_ADDRESS,
    },
  });

  return useMemo(() => {
    if (!enabled) return null;
    if (!auction || nounId == null) return null;
    const seed: NounSeed | null = seedData
      ? {
          background: Number(seedData[0]),
          body: Number(seedData[1]),
          accessory: Number(seedData[2]),
          head: Number(seedData[3]),
          glasses: Number(seedData[4]),
        }
      : null;
    const auctionEnd = endTime != null ? Number(endTime) : 0;
    const now = Math.floor(Date.now() / 1000);
    const payload: PredictResponse = {
      block: 0,
      nextNounId: Number(nounId),
      seed,
      traits: null,
      auctionEnd,
      auctionEnded: auctionEnd > 0 && auctionEnd <= now,
      running: true,
      checkedAt: new Date().toISOString(),
    };
    return payload;
  }, [enabled, auction, nounId, seedData, endTime]);
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

// ─── Primary visualisation for 2D / 3D modes ───────────────────────────
function SeedVisual({
  seed,
  mode,
  size,
  isNounOClock,
}: {
  seed: NounSeed | null;
  mode: '2d' | '3d';
  size: number;
  isNounOClock: boolean;
}) {
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
      ? '0 0 20px rgba(239,68,68,0.4), 0 0 40px rgba(239,68,68,0.15), inset 0 0 30px rgba(239,68,68,0.1)'
      : '0 0 20px rgba(100,200,255,0.15), 0 0 40px rgba(100,200,255,0.05), inset 0 0 30px rgba(100,150,255,0.08)',
    border: isNounOClock ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(100,200,255,0.15)',
    transition: 'box-shadow 0.5s, border-color 0.5s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  if (!seed) {
    return (
      <div style={frameStyle}>
        <span
          style={{
            fontFamily: '"Courier New", monospace',
            fontSize: 12,
            color: 'rgba(100,200,255,0.35)',
            letterSpacing: '0.2em',
          }}
        >
          SCRYING...
        </span>
      </div>
    );
  }

  if (mode === '2d') {
    const src = seedToSvgDataUri(seed);
    return (
      <div style={frameStyle}>
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
    );
  }

  // 3D voxel mode
  return (
    <div style={frameStyle}>
      <div style={{ width: '100%', height: '100%' }}>
        <Suspense fallback={null}>
          <NounParallax seed={seed} autoRotate interactive lightingPreset="storefront" />
        </Suspense>
      </div>
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
      }}
    >
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
              <SeedVisual
                seed={effectivePrediction?.seed ?? null}
                mode={viewMode}
                size={ballSize}
                isNounOClock={isNounOClock}
              />
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
                    marginTop: 6,
                  }}
                >
                  <span
                    style={{
                      color: effectivePrediction.running ? '#4ade80' : '#ef4444',
                      marginRight: 4,
                    }}
                  >
                    {effectivePrediction.running ? '\u25CF' : '\u25CB'}
                  </span>
                  {activeDao === 'nounv2' ? 'NOUNV2' : 'NOUN'} #{effectivePrediction.nextNounId}
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
