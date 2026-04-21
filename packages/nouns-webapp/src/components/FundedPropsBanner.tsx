import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { X } from 'lucide-react';
import ReactDOM from 'react-dom';
import { formatEther } from 'viem';

import { useDraggableScroll } from '@/hooks/useDraggableScroll';

interface FundedProp {
  id: string;
  title: string;
  description: string;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  totalEth: string; // formatted ETH amount
}

// ─── Modal ───────────────────────────────────────────────────────────────────

const FundedPropModal: FC<{ prop: FundedProp; onClose: () => void }> = ({ prop, onClose }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const cleanText = prop.description
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();

  const imgMatch =
    prop.description.match(/!\[[^\]]*\]\(([^)]+)\)/) ||
    prop.description.match(/<img[^>]+src=["']([^"']+)["']/i);
  const imageUrl = imgMatch ? imgMatch[1] : null;

  const totalVotes = prop.forVotes + prop.againstVotes + prop.abstainVotes;
  const forPct = totalVotes > 0 ? Math.round((prop.forVotes / totalVotes) * 100) : 0;

  const backdrop = (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10,
        background: 'rgba(20, 20, 31, 0.5)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.25s ease',
        cursor: 'pointer',
      }}
    />
  );

  const modal = (
    <div
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: visible
          ? 'translate(-50%, -50%) scale(1)'
          : 'translate(-50%, -50%) scale(0.92)',
        zIndex: 100,
        maxWidth: 640,
        width: '90vw',
        maxHeight: '85vh',
        borderRadius: 20,
        background: 'rgba(255, 255, 255, 0.9)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: '0 8px 40px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.3) inset',
        overflow: 'hidden',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.25s ease, transform 0.25s ease',
        display: 'flex',
        flexDirection: 'column' as const,
      }}
    >
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 10,
          width: 36,
          height: 36,
          borderRadius: 10,
          border: 'none',
          background: 'rgba(0, 0, 0, 0.4)',
          color: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <X size={18} />
      </button>
      {imageUrl && (
        <div style={{ flexShrink: 0 }}>
          <img
            src={imageUrl}
            alt={prop.title}
            style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }}
          />
        </div>
      )}
      <div style={{ padding: '16px 28px 24px', overflowY: 'auto', flex: 1 }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 6,
            background: 'rgba(124, 58, 237, 0.12)',
            fontSize: '0.7rem',
            fontWeight: 700,
            color: '#7c3aed',
            marginBottom: 10,
          }}
        >
          Prop {prop.id} · Executed
          {Number(prop.totalEth) > 0 && (
            <span style={{ marginLeft: 8, color: '#b45309' }}>
              Ξ{Number(prop.totalEth).toFixed(Number(prop.totalEth) >= 10 ? 0 : 2)}
            </span>
          )}
        </div>
        <h2
          style={{
            fontFamily: "'Londrina Solid'",
            fontSize: '1.6rem',
            fontWeight: 400,
            margin: '0 0 10px',
            lineHeight: 1.2,
            color: '#14141f',
          }}
        >
          {prop.title}
        </h2>
        {totalVotes > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.7rem',
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              <span style={{ color: '#4ade80' }}>For {prop.forVotes}</span>
              <span style={{ color: '#f87171' }}>Against {prop.againstVotes}</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: '#f1f5f9', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${forPct}%`,
                  background: 'linear-gradient(90deg, #4ade80, #22c55e)',
                }}
              />
            </div>
          </div>
        )}
        <p
          style={{
            fontFamily: "'PT Root UI'",
            fontSize: '0.82rem',
            lineHeight: 1.6,
            color: '#4a4a5a',
            margin: '0 0 16px',
            whiteSpace: 'pre-wrap',
            maxHeight: '30vh',
            overflow: 'auto',
          }}
        >
          {cleanText.slice(0, 600)}
          {cleanText.length > 600 && '...'}
        </p>
        <a
          href={`/vote/${prop.id}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            borderRadius: 10,
            background: '#14141f',
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.82rem',
            textDecoration: 'none',
          }}
        >
          View Proposal →
        </a>
        <div
          style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: '1px solid rgba(0,0,0,0.06)',
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: '#b0a890',
            textTransform: 'uppercase' as const,
          }}
        >
          <span>💎</span> <span>funded proposals</span>
        </div>
      </div>
    </div>
  );

  const backdropRoot = document.getElementById('backdrop-root');
  const overlayRoot = document.getElementById('overlay-root');
  if (!backdropRoot || !overlayRoot) return null;

  return (
    <>
      {ReactDOM.createPortal(backdrop, backdropRoot)}
      {ReactDOM.createPortal(modal, overlayRoot)}
    </>
  );
};

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
  const [selectedProp, setSelectedProp] = useState<FundedProp | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const { onPointerDown, onClickCapture } = useDraggableScroll(scrollRef, pausedRef);

  const handleClose = useCallback(() => setSelectedProp(null), []);

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
            description: p.description ?? '',
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
    <>
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
        <span>💎</span>
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
          <div
            key={`${prop.id}-${i}`}
            onClick={() => setSelectedProp(prop)}
            role="button"
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === 'Enter') setSelectedProp(prop);
            }}
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
              cursor: 'pointer',
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
          </div>
        ))}
      </div>
    </div>
    {selectedProp && <FundedPropModal prop={selectedProp} onClose={handleClose} />}
    </>
  );
};

export default FundedPropsBanner;
