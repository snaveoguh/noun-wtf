import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { formatEther } from 'viem';

import { useDraggableScroll } from '@/hooks/useDraggableScroll';

interface FundedProp {
  id: string;
  title: string;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  totalEth: string; // formatted ETH amount
}

const SUBGRAPH_URL =
  import.meta.env.VITE_MAINNET_SUBGRAPH ||
  'https://spirited-flexibility-production-3c30.up.railway.app';

/**
 * Scrolling banner of funded (EXECUTED) Nouns DAO proposals.
 * "Nouns World" — stories of what the DAO has funded.
 */
const FundedPropsBanner: FC = () => {
  const [props, setProps] = useState<FundedProp[]>([]);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const { onPointerDown, onClickCapture } = useDraggableScroll(scrollRef, pausedRef);

  const fetchProps = useCallback(async () => {
    try {
      const res = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{
            proposals(
              limit: 1000
              orderBy: "createdAtBlock"
              orderDirection: "desc"
              where: { status: "EXECUTED" }
            ) {
              items {
                id
                description
                forVotes
                againstVotes
                abstainVotes
                transactions(limit: 100) {
                  items {
                    value
                  }
                }
              }
            }
          }`,
        }),
      });
      if (!res.ok) return;
      const json = await res.json();
      const items = json?.data?.proposals?.items ?? [];

      const mapped: FundedProp[] = items.map(
        (p: {
          id: string;
          description: string;
          forVotes: string | number;
          againstVotes: string | number;
          abstainVotes: string | number;
          transactions?: { items?: { value: string }[] };
        }) => {
          // Extract title from description (first line, strip markdown #)
          const firstLine = (p.description ?? '').split('\n')[0] ?? '';
          const title = firstLine.replace(/^#+\s*/, '').trim() || `Prop ${p.id}`;

          // Sum ETH from all transactions
          const totalWei = (p.transactions?.items ?? []).reduce(
            (sum: bigint, tx: { value: string }) => sum + BigInt(tx.value || '0'),
            0n,
          );
          const totalEth = formatEther(totalWei);

          return {
            id: p.id,
            title,
            forVotes: Number(p.forVotes),
            againstVotes: Number(p.againstVotes),
            abstainVotes: Number(p.abstainVotes),
            totalEth,
          };
        },
      );

      setProps(mapped);
    } catch {
      // Non-critical — silently fail
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchProps();
  }, [fetchProps]);

  // Auto-scroll animation (slightly slower than NocTicker)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || props.length === 0) return;

    const speed = 0.4;
    let pos = el.scrollLeft;
    let wasPaused = false;

    const tick = () => {
      if (pausedRef.current) {
        wasPaused = true;
      } else {
        if (wasPaused) { pos = el.scrollLeft; wasPaused = false; }
        pos += speed;
        const halfWidth = el.scrollWidth / 2;
        if (halfWidth > 0 && pos >= halfWidth) pos -= halfWidth;
        el.scrollLeft = pos;
      }
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [props]);

  // Memoize display items (duplicate for seamless loop)
  const displayProps = useMemo(() => [...props, ...props], [props]);

  if (!loaded || props.length === 0) return null;

  return (
    <div
      style={{
        width: '100%',
        overflow: 'hidden',
        background: 'linear-gradient(90deg, #1a1a2e 0%, #16213e 50%, #1a1a2e 100%)',
        padding: '8px 0',
        position: 'relative',
        borderBottom: '2px solid rgba(124,58,237,0.3)',
      }}
    >
      {/* Label */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: '12px',
          paddingRight: '20px',
          background: 'linear-gradient(90deg, #1a1a2e 60%, rgba(26,26,46,0) 100%)',
          fontWeight: 900,
          fontSize: '0.6rem',
          letterSpacing: '0.15em',
          textTransform: 'uppercase' as const,
          whiteSpace: 'nowrap' as const,
        }}
      >
        <span style={{ color: '#facc15' }}>⌐◨-◨</span>
        <span style={{ color: '#e2e8f0', marginLeft: '6px' }}>FUNDED</span>
      </div>

      {/* Right fade */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          zIndex: 2,
          width: '40px',
          background: 'linear-gradient(270deg, #1a1a2e 0%, rgba(26,26,46,0) 100%)',
          pointerEvents: 'none',
        }}
      />

      <div
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
        onMouseEnter={() => { pausedRef.current = true; }}
        onMouseLeave={() => { pausedRef.current = false; }}
        style={{
          display: 'flex',
          gap: '0',
          overflow: 'hidden',
          scrollbarWidth: 'none' as const,
          paddingLeft: '80px',
          cursor: 'grab',
        }}
      >
        {displayProps.map((prop, i) => (
          <a
            key={`${prop.id}-${i}`}
            href={`/vote/${prop.id}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '4px 20px',
              flexShrink: 0,
              textDecoration: 'none',
              color: 'inherit',
              borderRight: '1px solid rgba(255,255,255,0.06)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            {/* Prop number badge */}
            <span
              style={{
                fontSize: '0.6rem',
                fontWeight: 800,
                color: '#7c3aed',
                background: 'rgba(124,58,237,0.15)',
                padding: '2px 6px',
                borderRadius: '3px',
                whiteSpace: 'nowrap' as const,
                flexShrink: 0,
              }}
            >
              #{prop.id}
            </span>

            {/* Title */}
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                color: '#e2e8f0',
                whiteSpace: 'nowrap' as const,
                maxWidth: '280px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                textTransform: 'none' as const,
              }}
            >
              {prop.title.length > 60 ? prop.title.slice(0, 60) + '...' : prop.title}
            </span>

            {/* Vote tally */}
            <span
              style={{
                fontSize: '0.55rem',
                fontWeight: 700,
                whiteSpace: 'nowrap' as const,
                flexShrink: 0,
              }}
            >
              <span style={{ color: '#4ade80' }}>✓{prop.forVotes}</span>
              <span style={{ color: '#6b7280', margin: '0 2px' }}>/</span>
              <span style={{ color: '#f87171' }}>✗{prop.againstVotes}</span>
            </span>

            {/* ETH amount if > 0 */}
            {Number(prop.totalEth) > 0 && (
              <span
                style={{
                  fontSize: '0.55rem',
                  fontWeight: 700,
                  color: '#facc15',
                  whiteSpace: 'nowrap' as const,
                  flexShrink: 0,
                }}
              >
                Ξ{Number(prop.totalEth).toFixed(Number(prop.totalEth) >= 10 ? 0 : 1)}
              </span>
            )}
          </a>
        ))}
      </div>
    </div>
  );
};

export default FundedPropsBanner;
