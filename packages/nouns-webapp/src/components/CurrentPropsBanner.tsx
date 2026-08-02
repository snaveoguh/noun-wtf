/* eslint-disable react/prop-types -- the component's list state is named
   `props`, which react/prop-types misreads as component props. */
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { X } from 'lucide-react';
import ReactDOM from 'react-dom';
import { decodeFunctionResult, encodeFunctionData, multicall3Abi } from 'viem';

import { useDraggableScroll } from '@/hooks/useDraggableScroll';
import useModalBodyLock from '@/hooks/useModalBodyLock';

type ComputedStatus = 'Upcoming' | 'Active' | 'Passed' | 'Failed' | 'Cancelled';

interface CurrentProp {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  status: ComputedStatus;
}

const SUBGRAPH_URL =
  (import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app';

const RPC_URL =
  (import.meta.env.VITE_MAINNET_JSONRPC as string | undefined) ??
  'https://mainnet.rpc.buidlguidl.com';

// NounsGovernor mainnet address
const NOUNS_GOVERNOR = '0x6f3E6272A167e8AcCb32072d08E0957F9c79223d';
// state(uint256) function selector
const STATE_SELECTOR = '0x3e4f49e6';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MD_IMAGE_RE = /!\[[^\]]*]\(([^)]+)\)/;
const HTML_IMG_RE = /<img[^>]+src=["']([^"']+)["']/i;

function extractImageUrl(text: string): string | null {
  const mdMatch = text.match(MD_IMAGE_RE);
  if (mdMatch) return mdMatch[1];
  const htmlMatch = text.match(HTML_IMG_RE);
  if (htmlMatch) return htmlMatch[1];
  return null;
}

function extractTitle(text: string): string {
  const firstLine = text.split('\n').find(l => l.trim().length > 0) ?? '';
  const cleaned = firstLine.replace(/^#+\s*/, '').trim();
  if (cleaned.length > 80) return cleaned.slice(0, 77) + '...';
  return cleaned || 'Untitled Proposal';
}

/**
 * Map on-chain state(proposalId) enum to display status.
 * On-chain enum: 0=Pending, 1=Active, 2=Canceled, 3=Defeated,
 * 4=Succeeded, 5=Queued, 6=Expired, 7=Executed, 8=Vetoed,
 * 9=ObjectionPeriod, 10=Updatable
 */
function onChainStateToStatus(stateNum: number): ComputedStatus {
  switch (stateNum) {
    case 0:
      return 'Upcoming'; // Pending
    case 1:
      return 'Active'; // Active
    case 2:
      return 'Cancelled'; // Canceled
    case 3:
      return 'Failed'; // Defeated
    case 4:
      return 'Passed'; // Succeeded
    case 5:
      return 'Passed'; // Queued (passed, awaiting execution)
    case 6:
      return 'Failed'; // Expired
    case 7:
      return 'Passed'; // Executed
    case 8:
      return 'Cancelled'; // Vetoed
    case 9:
      return 'Active'; // ObjectionPeriod
    case 10:
      return 'Active'; // Updatable
    default:
      return 'Failed';
  }
}

// Multicall3 — same address on every chain.
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

/**
 * Batch-fetch on-chain state() for all proposals in ONE eth_call via
 * Multicall3. This used to be a 30-item JSON-RPC batch, but dRPC's free plan
 * rejects batches of more than 3 requests ("code 31"), which emptied the map
 * and made every prop render as Failed. A single aggregate3 call works on any
 * plan and any provider.
 */
async function batchFetchStates(proposalIds: string[]): Promise<Map<string, number>> {
  const stateMap = new Map<string, number>();
  if (proposalIds.length === 0) return stateMap;

  const calls = proposalIds.map(id => ({
    target: NOUNS_GOVERNOR as `0x${string}`,
    allowFailure: true,
    callData: (STATE_SELECTOR + BigInt(id).toString(16).padStart(64, '0')) as `0x${string}`,
  }));

  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [
        {
          to: MULTICALL3,
          data: encodeFunctionData({
            abi: multicall3Abi,
            functionName: 'aggregate3',
            args: [calls],
          }),
        },
        'latest',
      ],
    }),
  });
  const json = await res.json();
  if (typeof json?.result !== 'string') return stateMap;

  const decoded = decodeFunctionResult({
    abi: multicall3Abi,
    functionName: 'aggregate3',
    data: json.result as `0x${string}`,
  });
  decoded.forEach((r, i) => {
    if (r.success && r.returnData && r.returnData !== '0x') {
      stateMap.set(proposalIds[i], parseInt(r.returnData, 16));
    }
  });
  return stateMap;
}

/**
 * Fallback when the on-chain state read fails entirely: map the indexer's
 * stored status. It can lag a state transition by a beat, but a slightly
 * stale label beats the old behaviour of painting every prop "Failed".
 */
function ponderStatusToStatus(s: string | null | undefined): ComputedStatus {
  switch ((s ?? '').toUpperCase()) {
    case 'PENDING':
    case 'UPDATABLE':
      return 'Upcoming';
    case 'ACTIVE':
    case 'OBJECTION_PERIOD':
      return 'Active';
    case 'SUCCEEDED':
    case 'QUEUED':
    case 'EXECUTED':
      return 'Passed';
    case 'CANCELLED':
    case 'VETOED':
      return 'Cancelled';
    case 'DEFEATED':
    case 'EXPIRED':
    default:
      return 'Failed';
  }
}

function statusLabel(status: ComputedStatus): string {
  switch (status) {
    case 'Active':
      return 'Voting';
    case 'Upcoming':
      return 'Upcoming';
    case 'Passed':
      return 'Passed';
    case 'Failed':
      return 'Failed';
    case 'Cancelled':
      return 'Cancelled';
  }
}

function statusColor(status: ComputedStatus): string {
  switch (status) {
    case 'Active':
      return '#f59e0b';
    case 'Upcoming':
      return '#3b82f6';
    case 'Passed':
      return '#22c55e';
    case 'Failed':
      return '#ef4444';
    case 'Cancelled':
      return '#6b7280';
  }
}

// ─── Modal ────────────────────────────────────────────────────────────────────

const PropModal: FC<{
  prop: CurrentProp;
  onClose: () => void;
}> = ({ prop, onClose }) => {
  useModalBodyLock(true);
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

  // Clean markdown for preview
  const cleanText = prop.description
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\|[^\n]+\|/g, '') // strip markdown tables
    .replace(/[:-]+\|[:|-]+/g, '')
    .trim();

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
        transform: visible ? 'translate(-50%, -50%) scale(1)' : 'translate(-50%, -50%) scale(0.92)',
        zIndex: 100,
        maxWidth: 640,
        width: '90vw',
        maxHeight: '85vh',
        borderRadius: 20,
        background: 'rgba(255, 255, 255, 0.88)',
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
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          color: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.6)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.4)')}
      >
        <X size={18} />
      </button>

      {prop.imageUrl && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <img
            src={prop.imageUrl}
            alt={prop.title}
            style={{
              width: '100%',
              aspectRatio: '16 / 9',
              objectFit: 'cover',
              display: 'block',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 60,
              background:
                'linear-gradient(0deg, rgba(255,255,255,0.88) 0%, rgba(255,255,255,0) 100%)',
            }}
          />
        </div>
      )}

      <div
        style={{
          padding: '16px 28px 24px',
          overflowY: 'auto',
          flex: 1,
        }}
      >
        {/* Status + Prop badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '4px 10px',
              borderRadius: 6,
              background: `${statusColor(prop.status)}20`,
              fontSize: '0.7rem',
              fontWeight: 700,
              color: statusColor(prop.status),
            }}
          >
            Prop {prop.id} &middot; {statusLabel(prop.status)}
          </span>
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

        {/* Vote bar */}
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
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: '#f1f5f9',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${forPct}%`,
                  background: 'linear-gradient(90deg, #4ade80, #22c55e)',
                  borderRadius: 3,
                  transition: 'width 0.3s',
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
            fontFamily: "'PT Root UI'",
            fontWeight: 700,
            fontSize: '0.82rem',
            textDecoration: 'none',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#2a2a3f')}
          onMouseLeave={e => (e.currentTarget.style.background = '#14141f')}
        >
          View Proposal
          <span style={{ fontSize: '1rem' }}>&#8594;</span>
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
          <span>🏛️</span> <span>current props</span>
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

// ─── Banner ───────────────────────────────────────────────────────────────────

const PLACEHOLDER_GRADIENT = 'linear-gradient(135deg, #fff3e0 0%, #ffe0b2 50%, #ffcc80 100%)';

/**
 * CurrentPropsBanner — auto-scrolling horizontal banner of recent Nouns proposals.
 * Computes real status from block numbers + vote data (Ponder statuses are stale).
 */
const CurrentPropsBanner: FC = () => {
  const [props, setProps] = useState<CurrentProp[]>([]);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const [selectedProp, setSelectedProp] = useState<CurrentProp | null>(null);
  const { onPointerDown, onClickCapture } = useDraggableScroll(scrollRef, pausedRef);

  const fetchProps = useCallback(async () => {
    try {
      // Fetch recent proposals from Ponder
      const gqlRes = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{
            proposals(
              limit: 30
              orderBy: "createdAtBlock"
              orderDirection: "desc"
            ) {
              items {
                id
                description
                forVotes
                againstVotes
                abstainVotes
                status
              }
            }
          }`,
        }),
      });

      if (!gqlRes.ok) return;
      const json = await gqlRes.json();
      const items = json?.data?.proposals?.items ?? [];

      // Batch-fetch authoritative on-chain state for all proposals.
      // This correctly handles dynamic quorum, objection periods, etc.
      const proposalIds = items.map((p: { id: string }) => p.id);
      const stateMap = await batchFetchStates(proposalIds);

      const allProps: CurrentProp[] = [];
      for (const p of items) {
        const desc = p.description ?? '';
        const onChainState = stateMap.get(p.id);
        const realStatus =
          onChainState !== undefined
            ? onChainStateToStatus(onChainState)
            : ponderStatusToStatus(p.status); // RPC failed — trust the indexer over a blanket "Failed"

        // Skip Cancelled props (they clutter the banner)
        if (realStatus === 'Cancelled') continue;

        allProps.push({
          id: p.id,
          title: extractTitle(desc),
          description: desc,
          imageUrl: extractImageUrl(desc),
          forVotes: Number(p.forVotes),
          againstVotes: Number(p.againstVotes),
          abstainVotes: Number(p.abstainVotes),
          status: realStatus,
        });
      }

      // Prioritize: Active first, then Upcoming, then Passed, then Failed
      const order: Record<ComputedStatus, number> = {
        Active: 0,
        Upcoming: 1,
        Passed: 2,
        Failed: 3,
        Cancelled: 4,
      };
      allProps.sort((a, b) => {
        const d = order[a.status] - order[b.status];
        if (d !== 0) return d;
        return Number(b.id) - Number(a.id); // newest first within same status
      });

      setProps(allProps.slice(0, 20));
    } catch {
      // Non-critical
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchProps();
  }, [fetchProps]);

  // Auto-scroll (1.5x speed — between NounsWorld 1.0 and Propdates 2.0)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || props.length === 0) return;

    const speed = 1.5;
    let pos = el.scrollLeft;
    let wasPaused = false;

    const tick = () => {
      if (pausedRef.current) {
        wasPaused = true;
      } else {
        if (wasPaused) {
          pos = el.scrollLeft;
          wasPaused = false;
        }
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

  const displayProps = useMemo(() => {
    if (props.length === 0) return [];
    return [...props, ...props];
  }, [props]);

  const handleClose = useCallback(() => setSelectedProp(null), []);

  if (!loaded || props.length === 0) return null;

  return (
    <>
      <div
        style={{
          width: '100%',
          overflow: 'hidden',
          background: 'linear-gradient(90deg, #fef3e2 0%, #fdebd0 50%, #fef3e2 100%)',
          padding: '10px 0',
          position: 'relative',
          borderBottom: '1px solid rgba(245, 158, 11, 0.2)',
        }}
      >
        {/* Left label */}
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
            paddingRight: '24px',
            background: 'linear-gradient(90deg, #fef3e2 70%, rgba(254,243,226,0) 100%)',
            fontWeight: 900,
            fontSize: '0.55rem',
            letterSpacing: '0.15em',
            textTransform: 'uppercase' as const,
            whiteSpace: 'nowrap' as const,
          }}
        >
          <span>🏛️</span>
          <span style={{ color: '#92400e', marginLeft: '6px' }}>PROPS</span>
        </div>

        {/* Right fade */}
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            zIndex: 2,
            width: '50px',
            background: 'linear-gradient(270deg, #fef3e2 0%, rgba(254,243,226,0) 100%)',
            pointerEvents: 'none',
          }}
        />

        <div
          ref={scrollRef}
          onPointerDown={onPointerDown}
          onClickCapture={onClickCapture}
          onMouseEnter={() => {
            pausedRef.current = true;
          }}
          onMouseLeave={() => {
            pausedRef.current = false;
          }}
          style={{
            display: 'flex',
            gap: '10px',
            overflow: 'hidden',
            scrollbarWidth: 'none' as const,
            paddingLeft: '100px',
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
                flexShrink: 0,
                width: 220,
                height: 124,
                borderRadius: 10,
                overflow: 'hidden',
                position: 'relative',
                cursor: 'pointer',
                display: 'block',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                transition: 'transform 0.15s, box-shadow 0.15s',
                background: prop.imageUrl ? undefined : PLACEHOLDER_GRADIENT,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'scale(1.03)';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.15)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
              }}
            >
              {prop.imageUrl ? (
                <img
                  src={prop.imageUrl}
                  alt={prop.title}
                  loading="lazy"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '2.5rem',
                    opacity: 0.3,
                  }}
                >
                  🏛️
                </div>
              )}

              {/* Title overlay */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background: 'linear-gradient(0deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)',
                  padding: '28px 10px 8px',
                }}
              >
                {/* Status + ID badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      fontSize: '0.5rem',
                      fontWeight: 800,
                      background: `${statusColor(prop.status)}cc`,
                      color: '#fff',
                      padding: '1px 5px',
                      borderRadius: 3,
                      letterSpacing: '0.03em',
                    }}
                  >
                    #{prop.id} {statusLabel(prop.status)}
                  </span>
                  {prop.forVotes + prop.againstVotes > 0 && (
                    <span
                      style={{
                        fontSize: '0.45rem',
                        fontWeight: 700,
                        color: '#fff',
                        opacity: 0.8,
                      }}
                    >
                      <span style={{ color: '#4ade80' }}>&#10003;{prop.forVotes}</span>
                      <span style={{ margin: '0 1px' }}>/</span>
                      <span style={{ color: '#f87171' }}>&#10007;{prop.againstVotes}</span>
                    </span>
                  )}
                </div>
                <span
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    color: '#fff',
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    lineHeight: 1.3,
                    textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                  }}
                >
                  {prop.title}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedProp && <PropModal prop={selectedProp} onClose={handleClose} />}
    </>
  );
};

export default CurrentPropsBanner;
