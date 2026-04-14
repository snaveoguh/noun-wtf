/**
 * CrystalBallPage — Full-page crystal ball Noun prediction with twin matching.
 *
 * Uses the CrystalBall orb, compares predicted traits against all existing nouns
 * to find "twins". Shows match count and optional SETTLE button for 4/5 or 5/5.
 */
import type { NounSeed, PredictResponse } from '@/components/CrystalBall';

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { traitName } from '@/lib/traitName';

const CrystalBall = lazy(() => import('@/components/CrystalBall'));

const TRAIT_KEYS = ['head', 'glasses', 'body', 'accessory', 'background'] as const;

const TRAIT_LABELS: Record<string, string> = {
  head: 'HEAD',
  glasses: 'NOGGLES',
  body: 'BODY',
  accessory: 'ACCESSORY',
  background: 'BG',
};

const API_BASE = (
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app'
);

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

// ─── Page ───────────────────────────────────────────────────────────────
export default function CrystalBallPage() {
  const [prediction, setPrediction] = useState<PredictResponse | null>(null);
  const [settling, setSettling] = useState(false);
  const [settleTx, setSettleTx] = useState<string | null>(null);
  const ballSize = useBallSize();
  const allSeeds = useNounSeeds();

  const handlePredict = useCallback((data: PredictResponse) => {
    setPrediction(data);
  }, []);

  const traits = prediction?.seed
    ? TRAIT_KEYS.map(key => ({
        key,
        label: TRAIT_LABELS[key],
        value: traitName(key, prediction.seed![key]),
      }))
    : null;

  const bestMatch = useMemo(() => {
    if (!prediction?.seed || allSeeds.length === 0) return null;
    return findBestMatch(prediction.seed, allSeeds);
  }, [prediction?.seed, allSeeds]);

  const matchColor =
    bestMatch?.matches === 5
      ? CRYSTAL_PURPLE
      : bestMatch?.matches === 4
        ? NOUNS_RED
        : bestMatch && bestMatch.matches >= 3
          ? '#eab308'
          : '#444';

  const showSettle =
    bestMatch && bestMatch.matches >= 4 && prediction?.auctionEnded && !settleTx;

  const settleColor = bestMatch?.matches === 5 ? CRYSTAL_PURPLE : NOUNS_RED;

  async function handleSettle() {
    setSettling(true);
    try {
      const res = await fetch(`${API_BASE}/api/agent/settle`, { method: 'POST' });
      const data = await res.json();
      if (data.txHash) {
        setSettleTx(data.txHash);
      }
    } catch {
      /* silent */
    } finally {
      setSettling(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(ellipse at 50% 40%, rgba(15,15,25,1), rgba(5,5,8,1))',
        fontFamily: '"Courier New", monospace',
        color: '#888',
        padding: '20px',
        gap: 20,
      }}
    >
      {/* Orb + match panel side by side on desktop, stacked on mobile */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 32,
          flexWrap: 'wrap',
        }}
      >
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
          <CrystalBall size={ballSize} interactive onPredict={handlePredict} />
        </Suspense>

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
            const isMatch = bestMatch?.matchingTraits.includes(t.key);
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
