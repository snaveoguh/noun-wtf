/**
 * TreasuryFlowSection — 3D Three.js visualization of all fund flows
 * through the Nouns DAO treasury (nouns.eth).
 *
 * "Neural Treasury" — dark void, glowing nodes, particle streams,
 * type-specific 3D shapes, bloom post-processing.
 *
 * HTML overlays: stats bar, type filter pills, detail panel, tooltip, legend.
 * Three.js scene: Scene.tsx (force layout, instanced nodes, particles, bloom).
 */
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Canvas } from '@react-three/fiber';
import { useQuery as useReactQuery } from '@tanstack/react-query';
import { ChevronDown, Lock, Pause, Play, Search, Unlock, X } from 'lucide-react';
import ReactDOM from 'react-dom';

import useModalBodyLock from '@/hooks/useModalBodyLock';

import TreasuryScene from './Scene';

const SUBGRAPH_URL =
  import.meta.env.VITE_MAINNET_SUBGRAPH ||
  'https://spirited-flexibility-production-3c30.up.railway.app';

// ─── Entity Type Definitions ────────────────────────────────────────────────

const ENTITY_TYPES: Record<string, { label: string; color: string; shape: string }> = {
  treasury: { label: 'Treasury', color: '#f59e0b', shape: '⬢' },
  governance: { label: 'Governance', color: '#6366f1', shape: '⬡' },
  nounder: { label: 'Nounders', color: '#ec4899', shape: '⬠' },
  delegate: { label: 'Delegates', color: '#a855f7', shape: '◈' },
  subdao: { label: 'Sub-DAOs', color: '#8b5cf6', shape: '⬡' },
  builder: { label: 'Builders', color: '#f59e0b', shape: '◆' },
  culture: { label: 'Culture', color: '#f97316', shape: '◆' },
  infra: { label: 'Infrastructure', color: '#06b6d4', shape: '◎' },
  education: { label: 'Education', color: '#10b981', shape: '◉' },
  publicgoods: { label: 'Public Goods', color: '#22c55e', shape: '◉' },
  art: { label: 'Art & Creative', color: '#f472b6', shape: '◆' },
  events: { label: 'Events & IRL', color: '#fb923c', shape: '◆' },
  media: { label: 'Media & Content', color: '#38bdf8', shape: '◆' },
  dev: { label: 'Development', color: '#a78bfa', shape: '◎' },
  community: { label: 'Community', color: '#fbbf24', shape: '◆' },
  bidder: { label: 'Bidders', color: '#6b7280', shape: '●' },
  wallet: { label: 'Wallets', color: '#64748b', shape: '●' },
};

// Category dropdown groups
const CATEGORY_GROUPS: { label: string; types: string[] }[] = [
  { label: 'Governance', types: ['governance', 'delegate', 'nounder'] },
  { label: 'Builders', types: ['builder', 'dev', 'infra'] },
  { label: 'Creative', types: ['art', 'culture', 'media', 'events'] },
  { label: 'Impact', types: ['publicgoods', 'education', 'community'] },
  { label: 'Participants', types: ['bidder', 'wallet', 'subdao'] },
];

// ─── Proposal-Based Categorization ──────────────────────────────────────────

const CATEGORY_KEYWORDS: { type: string; keywords: RegExp }[] = [
  { type: 'publicgoods', keywords: /\b(public good|charity|charit|donat|retro(?:active)?\s*(?:public\s*)?good|retroPGF|open[\s-]?source\s+fund|grant(?:s\s+(?:for|to)))\b/i },
  { type: 'art', keywords: /\b(art(?:ist|work)?|nft|gallery|museum|sculpture|mural|paint|illustrat|animation|comic|3d\s+noun|cc0|creative\s+commons|generative|pixel)\b/i },
  { type: 'events', keywords: /\b(event|conference|hackathon|meetup|irl|party|fest(?:ival)?|summit|pop[\s-]?up|activation|camp|retreat)\b/i },
  { type: 'media', keywords: /\b(podcast|youtube|video|film|documentary|show|series|content|newsletter|magazine|blog|media|broadcast|stream(?:ing)?|tv)\b/i },
  { type: 'dev', keywords: /\b(sdk|api|protocol|contract|smart[\s-]?contract|audit|security|tool(?:ing)?|framework|library|open[\s-]?source|github|software|app(?:lication)?|platform|website|frontend|backend|infra(?:structure)?|devrel)\b/i },
  { type: 'education', keywords: /\b(education|school|teach|learn|workshop|bootcamp|course|curriculum|student|universit|academ|research|fellowsh)\b/i },
  { type: 'community', keywords: /\b(community|govern|dao|sub[\s-]?dao|proliferat|brand|merch|marketing|onboard|ambassador|outreach|awareness|campaign|social)\b/i },
  { type: 'culture', keywords: /\b(culture|music|fashion|clothing|wearable|sport|game|gaming|play|toy|book|publish|zine|story|lore)\b/i },
];

function categorizeByProposalTitles(titles: string[]): string {
  // Count category matches across all proposal titles
  const scores: Record<string, number> = {};
  for (const title of titles) {
    for (const cat of CATEGORY_KEYWORDS) {
      const matches = title.match(cat.keywords);
      if (matches) {
        scores[cat.type] = (scores[cat.type] || 0) + matches.length;
      }
    }
  }
  // Return the highest-scoring category, or 'builder' as fallback
  let best = 'builder';
  let bestScore = 0;
  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) { best = type; bestScore = score; }
  }
  return best;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface NounSeed { background: number; body: number; accessory: number; head: number; glasses: number }

interface FlowNode {
  id: string;
  name: string;
  type: string;
  description: string;
  url?: string;
  totalIn: number;
  totalOut: number;
  netFlow: number;
  color: string;
  size: number;
  proposals: string[];
  auctionCount: number;
  // Governance metrics
  votesCount: number;
  totalVotingWeight: number;
  proposalsCreated: number;
  proposalsCreatedIds: string[];
  participationRate: number;
  // Flow role
  flowRole: number;
  outboundConnections: number;
  inboundConnections: number;
  // Identity
  ensName: string | null;
  ensAvatar: string | null;
  nounIds: string[];
  firstNounSeed: NounSeed | null;
  delegatedVotes: number;
}

interface FlowLink {
  source: string | FlowNode;
  target: string | FlowNode;
  value: number;
  label: string;
  direction: string;
}

interface TimelineEvent {
  t: number;   // unix timestamp (seconds)
  type: string; // 'auction' | 'funding' | 'stream' | 'noun_mint'
  from: string;
  to: string;
  value: number; // ETH
  nounId?: string;
  proposalId?: string;
}

interface FlowData {
  nodes: FlowNode[];
  links: FlowLink[];
  timeline?: TimelineEvent[];
  stats: {
    totalInflow: number;
    totalOutflow: number;
    uniqueAddresses: number;
    totalTransactions: number;
    nounsSettled?: number;
    totalBids?: number;
    propsPassed?: number;
    propsFailed?: number;
    propsCancelled?: number;
    propsExpired?: number;
    totalVotes?: number;
    uniqueVoters?: number;
    totalStreams?: number;
    activeStreams?: number;
  };
}

// ─── Data Hook ───────────────────────────────────────────────────────────────

function useTreasuryFlows() {
  return useReactQuery<FlowData>({
    queryKey: ['treasuryFlows'],
    queryFn: async () => {
      const res = await fetch(`${SUBGRAPH_URL}/api/treasury/flows`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 2,
  });
}

// ─── Detail Panel ────────────────────────────────────────────────────────────

const DetailPanel: FC<{ node: FlowNode; onClose: () => void }> = ({ node, onClose }) => {
  useModalBodyLock(true);
  const [visible, setVisible] = useState(false);

  // Slide-in animation
  useState(() => {
    requestAnimationFrame(() => setVisible(true));
  });

  // Escape key handler
  useState(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const etherscanUrl = node.id !== 'treasury'
    ? `https://etherscan.io/address/${node.id}`
    : 'https://etherscan.io/address/0x0BC3807Ec262cB779b38D65b38158acC3bfedE10';

  const backdrop = (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1040,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(8px)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.2s',
      }}
    />
  );

  const typeColor = ENTITY_TYPES[node.type]?.color ?? '#64748b';

  const panel = (
    <div
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: Math.min(420, window.innerWidth * 0.9),
        zIndex: 1050,
        background: '#0f0f1a',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
        transform: visible ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s ease',
        display: 'flex', flexDirection: 'column' as const,
        fontFamily: "'PT Root UI', sans-serif",
        color: '#e2e8f0',
      }}
    >
      {/* Header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{
              width: 14, height: 14, borderRadius: '50%', background: node.color,
              border: '2px solid rgba(255,255,255,0.15)', flexShrink: 0,
              boxShadow: `0 0 8px ${node.color}60`,
            }} />
            <h3 style={{ margin: 0, fontFamily: "'Londrina Solid'", fontSize: '1.5rem', lineHeight: 1.1, color: '#fff' }}>
              {node.name}
            </h3>
          </div>
          <span style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: 4,
            background: `${typeColor}20`, fontSize: '0.7rem', fontWeight: 600,
            textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: typeColor,
          }}>
            {ENTITY_TYPES[node.type]?.label ?? node.type}
          </span>
          {node.id !== 'treasury' && (
            <span style={{ marginLeft: 8, fontSize: '0.65rem', color: '#64748b', fontFamily: 'monospace' }}>
              {node.id.slice(0, 6)}...{node.id.slice(-4)}
            </span>
          )}
          {node.nounIds && node.nounIds.length > 0 && (
            <span style={{
              display: 'inline-block', marginLeft: 8, padding: '2px 6px', borderRadius: 4,
              background: '#1a1500', fontSize: '0.65rem', fontWeight: 600, color: '#fbbf24',
              border: '1px solid #3b3011',
            }}>
              {node.nounIds.length} Noun{node.nounIds.length !== 1 ? 's' : ''} held
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            width: 32, height: 32, borderRadius: 8, border: 'none',
            background: '#1e293b', cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center', color: '#94a3b8',
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {node.description && (
          <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: 20, lineHeight: 1.5 }}>
            {node.description}
          </p>
        )}

        {/* Flow stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <div style={{ background: '#1a0a0a', border: '1px solid #3b1111', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 4 }}>
              {node.id === 'treasury' ? 'Total Out' : 'Received'}
            </div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#fca5a5' }}>
              {node.totalIn.toLocaleString()} <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>ETH</span>
            </div>
          </div>
          <div style={{ background: '#0a1a0a', border: '1px solid #113b11', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#22c55e', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 4 }}>
              {node.id === 'treasury' ? 'Total In' : 'Contributed'}
            </div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#86efac' }}>
              {node.totalOut.toLocaleString()} <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>ETH</span>
            </div>
          </div>
        </div>

        {/* Net flow */}
        <div style={{ marginBottom: 20, padding: '12px 16px', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10 }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 4 }}>
            Net Flow
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: node.netFlow >= 0 ? '#22c55e' : '#ef4444' }}>
            {node.netFlow >= 0 ? '+' : ''}{node.netFlow.toLocaleString()} ETH
          </div>
        </div>

        {/* Governance metrics */}
        {(node.votesCount > 0 || node.proposalsCreated > 0) && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 8 }}>
              Governance Activity
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase' as const }}>Votes Cast</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>{node.votesCount}</div>
              </div>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase' as const }}>Voting Weight</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>{(node.totalVotingWeight ?? 0).toLocaleString()}</div>
              </div>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase' as const }}>Props Authored</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>{node.proposalsCreated}</div>
              </div>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase' as const }}>Participation</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0' }}>{node.participationRate ?? 0}%</div>
              </div>
            </div>
          </div>
        )}

        {/* Flow role indicator */}
        {node.id !== 'treasury' && (node.outboundConnections > 0 || node.inboundConnections > 0) && (
          <div style={{ marginBottom: 20, padding: '12px 16px', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10 }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 6 }}>
              Flow Role
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: (node.flowRole ?? 0) > 0.3 ? '#22c55e' : (node.flowRole ?? 0) < -0.3 ? '#ef4444' : '#f59e0b' }}>
                {(node.flowRole ?? 0) > 0.3 ? 'Proliferator' : (node.flowRole ?? 0) < -0.3 ? 'Beneficiary' : 'Steward'}
              </span>
              <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                ({node.outboundConnections ?? 0} out / {node.inboundConnections ?? 0} in)
              </span>
            </div>
          </div>
        )}

        {/* Authored proposals */}
        {node.proposalsCreatedIds && node.proposalsCreatedIds.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 8 }}>
              Authored Proposals ({node.proposalsCreatedIds.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
              {node.proposalsCreatedIds.slice(0, 20).map(id => (
                <a
                  key={`authored-${id}`}
                  href={`/vote/${id}`}
                  style={{
                    display: 'inline-block', padding: '4px 10px', borderRadius: 6,
                    background: '#1a0f2e', fontSize: '0.8rem', fontWeight: 600,
                    color: '#a78bfa', textDecoration: 'none',
                    transition: 'background 0.1s', border: '1px solid #2d1f54',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#2d1f54')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#1a0f2e')}
                >
                  Prop #{id}
                </a>
              ))}
              {node.proposalsCreatedIds.length > 20 && (
                <span style={{ fontSize: '0.75rem', color: '#64748b', padding: '4px 8px' }}>
                  +{node.proposalsCreatedIds.length - 20} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Proposals */}
        {node.proposals.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: 8 }}>
              Related Proposals ({node.proposals.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
              {node.proposals.slice(0, 20).map(id => (
                <a
                  key={id}
                  href={`/vote/${id}`}
                  style={{
                    display: 'inline-block', padding: '4px 10px', borderRadius: 6,
                    background: '#1e293b', fontSize: '0.8rem', fontWeight: 600,
                    color: '#94a3b8', textDecoration: 'none',
                    transition: 'background 0.1s', border: '1px solid #334155',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#334155')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#1e293b')}
                >
                  Prop #{id}
                </a>
              ))}
              {node.proposals.length > 20 && (
                <span style={{ fontSize: '0.75rem', color: '#64748b', padding: '4px 8px' }}>
                  +{node.proposals.length - 20} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Auctions */}
        {node.auctionCount > 0 && (
          <div style={{ marginBottom: 20, padding: '12px 16px', background: '#1a1500', border: '1px solid #3b3011', borderRadius: 10 }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fbbf24' }}>
              Won {node.auctionCount} auction{node.auctionCount !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* External links */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
          <a
            href={etherscanUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 16px', borderRadius: 10, border: '1px solid #1e293b',
              fontSize: '0.85rem', fontWeight: 600, color: '#94a3b8',
              textDecoration: 'none', transition: 'background 0.1s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#1e293b')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            View on Etherscan &#8599;
          </a>
          {node.url && (
            <a
              href={node.url}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 16px', borderRadius: 10, border: '1px solid #1e293b',
                fontSize: '0.85rem', fontWeight: 600, color: '#94a3b8',
                textDecoration: 'none', transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#1e293b')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              Visit Website &#8599;
            </a>
          )}
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
      {ReactDOM.createPortal(panel, overlayRoot)}
    </>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────

const TreasuryFlowSection: FC = () => {
  const { data, isLoading, error } = useTreasuryFlows();
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<FlowNode | null>(null);
  const [scenePaused, setScenePaused] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchHighlight, setSearchHighlight] = useState(0);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Default: all types except wallet and bidder
  const [activeTypes, setActiveTypes] = useState<Set<string>>(() =>
    new Set(['treasury', 'governance', 'nounder', 'delegate', 'subdao', 'builder', 'culture', 'infra', 'education']),
  );
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [minConnections, setMinConnections] = useState(1); // Min connections filter

  // Time slider state — provenance timeline
  const NOUNS_GENESIS = 1628380800; // 2021-08-08T00:00:00Z
  const NOW = Math.floor(Date.now() / 1000);
  const [timePosition, setTimePosition] = useState(NOW);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1); // 1=1 month/sec, 2=faster, 3=fastest
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeEnabled = timePosition < NOW;

  // Play/pause animation
  useEffect(() => {
    if (isPlaying) {
      const speeds = [2592000, 5184000, 10368000]; // months/sec at 60fps: 1mo, 2mo, 4mo
      const increment = speeds[playSpeed - 1] / 60;
      playRef.current = setInterval(() => {
        setTimePosition(prev => {
          const next = prev + increment;
          if (next >= NOW) { setIsPlaying(false); return NOW; }
          return next;
        });
      }, 1000 / 60);
    }
    return () => { if (playRef.current) clearInterval(playRef.current); };
  }, [isPlaying, playSpeed, NOW]);

  // Compute first-seen time for each node from timeline
  const timeline = data?.timeline ?? [];
  const nodeFirstSeen = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of timeline) {
      if (event.from && event.from !== 'treasury') {
        const existing = map.get(event.from) ?? Infinity;
        map.set(event.from, Math.min(existing, event.t));
      }
      if (event.to && event.to !== 'treasury') {
        const existing = map.get(event.to) ?? Infinity;
        map.set(event.to, Math.min(existing, event.t));
      }
    }
    return map;
  }, [timeline]);

  // Time-filtered stats (running totals at current time position)
  const timeStats = useMemo(() => {
    if (!timeEnabled || timeline.length === 0) return null;
    let auctionRevenue = 0, funded = 0, nounsMinted = 0;
    for (const e of timeline) {
      if (e.t > timePosition) break;
      if (e.type === 'auction') { auctionRevenue += e.value; }
      if (e.type === 'funding') { funded += e.value; }
      if (e.type === 'noun_mint') { nounsMinted++; }
    }
    return { auctionRevenue: Math.round(auctionRevenue), funded: Math.round(funded), nounsMinted };
  }, [timeline, timePosition, timeEnabled]);

  // Enhance nodes: auto-classify wallets with proposals as builders
  // Batch ENS resolution for top addresses
  const [ensMap, setEnsMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!data) return;
    // Resolve ENS for ALL addresses using ENS subgraph (batch query)
    const addresses = data.nodes
      .filter(n => n.id.startsWith('0x') && !n.ensName)
      .map(n => n.id.toLowerCase());

    if (addresses.length === 0) return;
    let cancelled = false;

    const resolve = async () => {
      const batch = new Map<string, string>();
      // Query ENS subgraph in batches of 500
      const ENS_SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/ensdomains/ens';
      const BATCH_SIZE = 500;

      for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        if (cancelled) break;
        const chunk = addresses.slice(i, i + BATCH_SIZE);
        try {
          const query = `{
            domains(where: { resolvedAddress_in: [${chunk.map(a => `"${a}"`).join(',')}] }, first: 1000) {
              name
              resolvedAddress { id }
            }
          }`;
          const res = await fetch(ENS_SUBGRAPH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
          });
          if (res.ok) {
            const json = await res.json();
            const domains = json?.data?.domains ?? [];
            for (const d of domains) {
              if (d.name && d.resolvedAddress?.id) {
                const addr = d.resolvedAddress.id.toLowerCase();
                const existing = batch.get(addr);
                // Prefer direct .eth names over subdomains, then shortest
                const isDirect = (d.name.match(/\./g) || []).length === 1;
                const existingIsDirect = existing ? (existing.match(/\./g) || []).length === 1 : false;
                if (!existing || (isDirect && !existingIsDirect) || (isDirect === existingIsDirect && d.name.length < existing.length)) {
                  batch.set(addr, d.name);
                }
              }
            }
          }
        } catch { /* skip failed batch */ }
        // Progressive update after each batch
        if (!cancelled && batch.size > 0) {
          setEnsMap(new Map(batch));
        }
      }
      if (!cancelled) setEnsMap(new Map(batch));
    };
    resolve();
    return () => { cancelled = true; };
  }, [data]);

  // Fetch proposal titles for categorization
  const [proposalTitles, setProposalTitles] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!data) return;
    // Collect all unique proposal IDs referenced by nodes
    const propIds = new Set<string>();
    for (const n of data.nodes) {
      if (n.proposals) for (const p of n.proposals) propIds.add(p);
    }
    if (propIds.size === 0) return;
    let cancelled = false;

    const fetchTitles = async () => {
      const titles = new Map<string, string>();
      const BATCH = 100;
      const allIds = [...propIds];

      for (let i = 0; i < allIds.length; i += BATCH) {
        if (cancelled) break;
        const chunk = allIds.slice(i, i + BATCH);
        try {
          const query = `{
            proposals(where: { id_in: [${chunk.map(id => `"${id}"`).join(',')}] }, limit: ${BATCH}) {
              items { id description }
            }
          }`;
          const res = await fetch(`${SUBGRAPH_URL}/graphql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
          });
          if (res.ok) {
            const json = await res.json();
            const items = json?.data?.proposals?.items ?? [];
            for (const p of items) {
              // Title is the first line of description (strip markdown #)
              const title = (p.description || '').split('\n')[0].replace(/^#+\s*/, '').trim();
              if (title) titles.set(p.id, title);
            }
          }
        } catch { /* skip batch */ }
        if (!cancelled && titles.size > 0) setProposalTitles(new Map(titles));
      }
      if (!cancelled) setProposalTitles(new Map(titles));
    };
    fetchTitles();
    return () => { cancelled = true; };
  }, [data]);

  const enhancedNodes = useMemo(() => {
    if (!data) return [];
    return data.nodes.map(n => {
      // Apply resolved ENS names
      const resolvedEns = ensMap.get(n.id.toLowerCase());
      const withEns = resolvedEns ? { ...n, ensName: resolvedEns, name: resolvedEns } : n;

      // Categorize funded wallets by proposal titles
      if ((withEns.type === 'wallet' || withEns.type === 'builder') && withEns.proposals.length > 0) {
        const titles = withEns.proposals
          .map((pid: string) => proposalTitles.get(pid))
          .filter(Boolean) as string[];

        const category = titles.length > 0
          ? categorizeByProposalTitles(titles)
          : 'builder';

        const topTitle = titles[0] || '';
        const propLabel = withEns.proposals.length <= 3
          ? `Props #${withEns.proposals.join(', #')}`
          : `${withEns.proposals.length} Props`;

        return {
          ...withEns,
          type: category,
          name: withEns.ensName || withEns.name,
          description: topTitle || withEns.description || `Funded via ${propLabel}`,
          color: (ENTITY_TYPES[category] || ENTITY_TYPES.builder).color,
        };
      }
      return withEns;
    });
  }, [data, ensMap, proposalTitles]);

  // Count nodes by type
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of enhancedNodes) {
      if (n.id === 'treasury') continue;
      counts[n.type] = (counts[n.type] || 0) + 1;
    }
    return counts;
  }, [enhancedNodes]);

  const toggleType = useCallback((type: string) => {
    setActiveTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // Searchable node list for dropdown
  const searchableNodes = useMemo(() => {
    if (!data) return [];
    return enhancedNodes
      .filter(n => n.id !== 'treasury')
      .sort((a, b) => (b.totalIn + b.totalOut) - (a.totalIn + a.totalOut))
      .map(n => ({
        id: n.id,
        label: n.ensName || n.name,
        type: n.type,
        volume: n.totalIn + n.totalOut,
        node: n,
      }));
  }, [data, enhancedNodes]);

  // Filtered search results
  const searchResults = useMemo(() => {
    if (!search.trim()) return searchableNodes.slice(0, 50);
    const q = search.toLowerCase();
    return searchableNodes
      .filter(n => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q))
      .slice(0, 50);
  }, [searchableNodes, search]);

  // Multi-ENS search: comma-separated terms
  const searchTerms = useMemo(() => {
    if (!search.trim()) return [];
    return search.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  }, [search]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
      if (openDropdown) {
        const target = e.target as HTMLElement;
        if (!target.closest('[data-category-dropdown]')) {
          setOpenDropdown(null);
        }
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openDropdown]);

  // Filter nodes by type + search + time
  const filteredData = useMemo(() => {
    if (enhancedNodes.length === 0) return { nodes: [], links: [] };

    // Time filter: only show nodes that existed at this point in history
    let timeNodes = enhancedNodes;
    if (timeEnabled && nodeFirstSeen.size > 0) {
      timeNodes = enhancedNodes.filter(n => {
        if (n.id === 'treasury') return true;
        const firstSeen = nodeFirstSeen.get(n.id);
        return firstSeen != null && firstSeen <= timePosition;
      });
    }

    const hasSearch = searchTerms.length > 0;

    if (hasSearch) {
      const isMatch = (n: FlowNode) =>
        searchTerms.some(t => n.name.toLowerCase().includes(t) || n.id.toLowerCase().includes(t));
      const matchedNodes = timeNodes.filter(n => n.id === 'treasury' || isMatch(n));
      const matchedIds = new Set(matchedNodes.map(n => n.id));

      const partnerIds = new Set<string>();
      for (const l of data?.links ?? []) {
        const sid = typeof l.source === 'string' ? l.source : (l.source as FlowNode).id;
        const tid = typeof l.target === 'string' ? l.target : (l.target as FlowNode).id;
        if (matchedIds.has(sid) && !matchedIds.has(tid)) partnerIds.add(tid);
        if (matchedIds.has(tid) && !matchedIds.has(sid)) partnerIds.add(sid);
      }

      const allIds = new Set([...matchedIds, ...partnerIds]);
      const nodes = timeNodes.filter(n => allIds.has(n.id));
      const nodeIds = new Set(nodes.map(n => n.id));
      const links = (data?.links ?? []).filter(l => {
        const sid = typeof l.source === 'string' ? l.source : (l.source as FlowNode).id;
        const tid = typeof l.target === 'string' ? l.target : (l.target as FlowNode).id;
        return nodeIds.has(sid) && nodeIds.has(tid);
      });
      return { nodes, links };
    }

    let nodes = timeNodes.filter(n =>
      n.id === 'treasury' || activeTypes.has(n.type),
    );
    // Connection count filter
    if (minConnections > 1) {
      nodes = nodes.filter(n =>
        n.id === 'treasury' || (n.outboundConnections + n.inboundConnections) >= minConnections,
      );
    }
    // Limit low-activity types to top 80 by volume
    const limitTypes = ['wallet', 'bidder'];
    for (const lt of limitTypes) {
      const ltNodes = nodes.filter(n => n.type === lt);
      if (ltNodes.length > 80) {
        const sorted = [...ltNodes].sort((a, b) => (b.totalIn + b.totalOut) - (a.totalIn + a.totalOut));
        const keep = new Set(sorted.slice(0, 80).map(n => n.id));
        nodes = nodes.filter(n => n.type !== lt || keep.has(n.id));
      }
    }
    const nodeIds = new Set(nodes.map(n => n.id));
    const links = (data?.links ?? []).filter(l => {
      const sid = typeof l.source === 'string' ? l.source : (l.source as FlowNode).id;
      const tid = typeof l.target === 'string' ? l.target : (l.target as FlowNode).id;
      return nodeIds.has(sid) && nodeIds.has(tid);
    });
    return { nodes, links };
  }, [enhancedNodes, activeTypes, data, searchTerms, timeEnabled, nodeFirstSeen, timePosition, minConnections]);

  const handleClose = useCallback(() => setSelectedNode(null), []);

  const handleSearchSelect = useCallback((node: FlowNode) => {
    setSearch(node.ensName || node.name);
    setSearchOpen(false);
    setSelectedNode(node);
  }, []);

  if (isLoading) {
    return (
      <div style={{
        width: '100%', padding: '3rem 1rem', textAlign: 'center',
        background: '#0a0a0f', fontFamily: "'PT Root UI', sans-serif",
      }}>
        <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
          <span style={{ display: 'inline-block', animation: 'pulse 2s infinite', opacity: 0.6 }}>
            Loading treasury flows...
          </span>
        </div>
      </div>
    );
  }

  if (error || !data || data.nodes.length === 0) return null;

  const s = data.stats;

  return (
    <>
      <div style={{ width: '100%', height: '100%', background: '#0a0a0f', color: '#e2e8f0', position: 'relative' }}>
        {/* Stats bar — floating overlay on top of canvas */}
        <div style={{
          display: 'flex', flexWrap: 'wrap' as const, gap: '12px 20px',
          padding: '8px 24px',
          fontSize: '0.7rem', fontFamily: "'PT Root UI', sans-serif", color: '#94a3b8',
          justifyContent: 'center',
          position: 'relative', zIndex: 5, background: 'rgba(10,10,15,0.7)', backdropFilter: 'blur(8px)',
          pointerEvents: 'none',
        }}>
          {timeStats ? (
            <>
              <span><strong style={{ color: '#e2e8f0' }}>{timeStats.nounsMinted}</strong> nouns minted</span>
              <span><strong style={{ color: '#16a34a' }}>{timeStats.auctionRevenue.toLocaleString()}</strong> ETH raised</span>
              <span><strong style={{ color: '#dc2626' }}>{timeStats.funded.toLocaleString()}</strong> ETH funded</span>
              <span style={{ color: '#b45309', fontWeight: 700 }}>
                {new Date(timePosition * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </span>
            </>
          ) : (
            <>
              <span><strong style={{ color: '#e2e8f0' }}>{s.nounsSettled ?? s.uniqueAddresses}</strong> nouns settled</span>
              <span><strong style={{ color: '#e2e8f0' }}>{(s.totalBids ?? 0).toLocaleString()}</strong> bids</span>
              <span><strong style={{ color: '#16a34a' }}>{s.totalInflow.toLocaleString()}</strong> ETH raised</span>
              <span><strong style={{ color: '#dc2626' }}>{s.totalOutflow.toLocaleString()}</strong> ETH funded</span>
              <span><strong style={{ color: '#e2e8f0' }}>{s.propsPassed ?? 0}</strong> props passed</span>
              <span><strong style={{ color: '#dc2626' }}>{s.propsFailed ?? 0}</strong> defeated</span>
              <span><strong style={{ color: '#7c3aed' }}>{(s.totalVotes ?? 0).toLocaleString()}</strong> votes</span>
              <span><strong style={{ color: '#7c3aed' }}>{s.uniqueVoters ?? 0}</strong> voters</span>
              <span><strong style={{ color: '#0891b2' }}>{s.activeStreams ?? 0}</strong> active streams</span>
            </>
          )}
        </div>

        {/* Header + filters */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 24px 6px', flexWrap: 'wrap' as const, gap: 10,
          position: 'relative', zIndex: 5, background: 'rgba(10,10,15,0.6)', backdropFilter: 'blur(6px)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 900, fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase' as const, color: '#b45309' }}>
              &#x2310;&#x25E8;-&#x25E8;
            </span>
            <span style={{ fontWeight: 900, fontSize: '0.6rem', letterSpacing: '0.15em', textTransform: 'uppercase' as const, color: '#94a3b8' }}>
              NEURAL TREASURY
            </span>
            {/* Freeze toggle */}
            <button
              onClick={() => setScenePaused(p => !p)}
              title={scenePaused ? 'Unfreeze scene' : 'Freeze scene (easier to explore)'}
              style={{
                width: 24, height: 24, borderRadius: 6, border: '1px solid #334155',
                background: scenePaused ? '#1a1500' : 'transparent',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: scenePaused ? '#fbbf24' : '#475569',
              }}
            >
              {scenePaused ? <Lock size={10} /> : <Unlock size={10} />}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
            {/* Category dropdown filters */}
            {CATEGORY_GROUPS.map(group => {
              const activeCount = group.types.filter(t => activeTypes.has(t)).length;
              const totalCount = group.types.reduce((sum, t) => sum + (typeCounts[t] || 0), 0);
              const isOpen = openDropdown === group.label;
              return (
                <div key={group.label} style={{ position: 'relative' }} data-category-dropdown>
                  <button
                    onClick={() => setOpenDropdown(isOpen ? null : group.label)}
                    style={{
                      padding: '3px 10px', borderRadius: 12, cursor: 'pointer',
                      border: `1.5px solid ${activeCount > 0 ? '#475569' : '#334155'}`,
                      background: activeCount > 0 ? '#1e293b' : 'transparent',
                      color: activeCount > 0 ? '#e2e8f0' : '#64748b',
                      fontSize: '0.65rem', fontWeight: 700,
                      fontFamily: "'PT Root UI', sans-serif",
                      display: 'flex', alignItems: 'center', gap: 4,
                      transition: 'all 0.15s',
                    }}
                  >
                    {group.label} ({totalCount})
                    <ChevronDown size={10} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                  </button>
                  {isOpen && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, marginTop: 4,
                      background: '#0f172a', border: '1px solid #334155', borderRadius: 10,
                      padding: '8px 0', zIndex: 50, minWidth: 180,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    }}>
                      {/* All/None toggle */}
                      <div style={{ padding: '4px 12px 8px', borderBottom: '1px solid #1e293b', display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => { const next = new Set(activeTypes); group.types.forEach(t => next.add(t)); setActiveTypes(next); }}
                          style={{ fontSize: '0.6rem', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                        >All</button>
                        <button
                          onClick={() => { const next = new Set(activeTypes); group.types.forEach(t => next.delete(t)); setActiveTypes(next); }}
                          style={{ fontSize: '0.6rem', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                        >None</button>
                      </div>
                      {group.types.map(type => {
                        const info = ENTITY_TYPES[type];
                        if (!info) return null;
                        const isActive = activeTypes.has(type);
                        const count = typeCounts[type] || 0;
                        return (
                          <button
                            key={type}
                            onClick={() => toggleType(type)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                              padding: '6px 12px', background: 'none', border: 'none',
                              cursor: 'pointer', color: isActive ? '#e2e8f0' : '#64748b',
                              fontSize: '0.7rem', fontFamily: "'PT Root UI', sans-serif",
                              textAlign: 'left' as const,
                            }}
                          >
                            <span style={{
                              width: 14, height: 14, borderRadius: 3,
                              border: `1.5px solid ${isActive ? info.color : '#475569'}`,
                              background: isActive ? info.color : 'transparent',
                              flexShrink: 0,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '0.5rem', color: '#fff',
                            }}>
                              {isActive ? '✓' : ''}
                            </span>
                            <span style={{ color: info.color, fontSize: '0.75rem' }}>{info.shape}</span>
                            <span style={{ flex: 1 }}>{info.label}</span>
                            <span style={{ color: '#475569', fontSize: '0.6rem' }}>{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Connection count filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 4 }}>
              <span style={{ fontSize: '0.55rem', color: '#475569', marginRight: 2, fontFamily: "'PT Root UI', sans-serif" }}>
                Conn:
              </span>
              {[1, 2, 3, 4, 5, 6, 7, 10].map(n => (
                <button
                  key={n}
                  onClick={() => setMinConnections(n)}
                  style={{
                    padding: '2px 5px', borderRadius: 4, cursor: 'pointer',
                    border: `1px solid ${minConnections === n ? '#f59e0b' : '#334155'}`,
                    background: minConnections === n ? '#1a1500' : 'transparent',
                    color: minConnections === n ? '#fbbf24' : '#64748b',
                    fontSize: '0.6rem', fontWeight: 700,
                    fontFamily: "'PT Root UI', sans-serif",
                    minWidth: 20, textAlign: 'center' as const,
                  }}
                >
                  {n >= 5 ? `${n}+` : n}
                </button>
              ))}
            </div>

            {/* Dropdown search combobox */}
            <div ref={searchRef} style={{ position: 'relative' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 8, border: '1px solid #334155',
                background: '#0f172a', width: 220,
              }}>
                <Search size={12} color="#64748b" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search ENS, name, 0x..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setSearchOpen(true); setSearchHighlight(0); }}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={e => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setSearchHighlight(h => Math.min(h + 1, searchResults.length - 1)); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); setSearchHighlight(h => Math.max(h - 1, 0)); }
                    else if (e.key === 'Enter' && searchResults[searchHighlight]) {
                      e.preventDefault();
                      handleSearchSelect(searchResults[searchHighlight].node);
                    }
                    else if (e.key === 'Escape') { setSearchOpen(false); }
                  }}
                  style={{
                    flex: 1, border: 'none', outline: 'none',
                    fontSize: '0.7rem', fontFamily: "'PT Root UI', sans-serif",
                    background: 'transparent', color: '#e2e8f0',
                  }}
                />
                {search && (
                  <button
                    onClick={() => { setSearch(''); setSelectedNode(null); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
                  >
                    <X size={12} color="#64748b" />
                  </button>
                )}
              </div>
              {searchOpen && searchResults.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
                  background: '#0f172a', border: '1px solid #334155', borderRadius: 10,
                  maxHeight: 300, overflowY: 'auto', zIndex: 50,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                }}>
                  <div style={{ padding: '6px 10px', fontSize: '0.6rem', color: '#475569', borderBottom: '1px solid #1e293b' }}>
                    {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                  </div>
                  {searchResults.map((item, i) => {
                    const typeInfo = ENTITY_TYPES[item.type];
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSearchSelect(item.node)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                          padding: '8px 12px', border: 'none', cursor: 'pointer',
                          background: i === searchHighlight ? '#1e293b' : 'transparent',
                          color: '#e2e8f0', fontSize: '0.7rem',
                          fontFamily: "'PT Root UI', sans-serif",
                          textAlign: 'left' as const,
                          borderBottom: '1px solid #1e293b10',
                        }}
                        onMouseEnter={() => setSearchHighlight(i)}
                      >
                        <span style={{ color: typeInfo?.color ?? '#64748b', fontSize: '0.75rem', flexShrink: 0 }}>
                          {typeInfo?.shape ?? '●'}
                        </span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                          {item.label}
                        </span>
                        {item.volume > 0 && (
                          <span style={{ fontSize: '0.6rem', color: '#475569', flexShrink: 0 }}>
                            {item.volume.toLocaleString()} ETH
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Three.js Canvas */}
        <div style={{ position: 'absolute', inset: 0 }}>
            <Canvas
              camera={{ position: [0, 80, 300], fov: 55 }}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
              gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
              onCreated={({ gl }) => { gl.setClearColor('#0a0a0f'); }}
            >
              <TreasuryScene
                nodes={filteredData.nodes}
                links={filteredData.links}
                searchTerms={searchTerms}
                paused={scenePaused}
                onNodeClick={setSelectedNode}
                onNodeHover={setHoveredNode}
              />
            </Canvas>
        </div>

        {/* Time Slider — provenance timeline */}
        {timeline.length > 0 && (
          <div style={{
            position: 'absolute', bottom: 70, left: 24, right: 24,
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 16px', borderRadius: 12,
            background: 'rgba(15,15,25,0.85)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.1)', zIndex: 5,
            fontFamily: "'PT Root UI', sans-serif", color: '#e2e8f0',
            boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
          }}>
            {/* Play/Pause button */}
            <button
              onClick={() => {
                if (!isPlaying && timePosition >= NOW) {
                  setTimePosition(NOUNS_GENESIS);
                }
                setIsPlaying(!isPlaying);
              }}
              style={{
                width: 28, height: 28, borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)',
                background: isPlaying ? '#f3e8ff' : '#f8fafc',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: isPlaying ? '#7c3aed' : '#6b7280', flexShrink: 0,
              }}
            >
              {isPlaying ? <Pause size={12} /> : <Play size={12} />}
            </button>

            {/* Speed control */}
            <button
              onClick={() => setPlaySpeed(s => s >= 3 ? 1 : s + 1)}
              style={{
                padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.12)',
                background: 'transparent', cursor: 'pointer',
                color: '#6b7280', fontSize: '0.6rem', fontWeight: 700,
                fontFamily: "'PT Root UI', sans-serif", flexShrink: 0,
              }}
            >
              {playSpeed}x
            </button>

            {/* Date label (left) */}
            <span style={{ fontSize: '0.6rem', color: '#6b7280', flexShrink: 0, minWidth: 42 }}>
              {new Date(NOUNS_GENESIS * 1000).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
            </span>

            {/* Slider */}
            <input
              type="range"
              min={NOUNS_GENESIS}
              max={NOW}
              value={timePosition}
              onChange={e => { setTimePosition(Number(e.target.value)); setIsPlaying(false); }}
              style={{
                flex: 1, height: 4, accentColor: '#b45309',
                cursor: 'pointer',
              }}
            />

            {/* Date label (right) */}
            <span style={{ fontSize: '0.6rem', color: '#6b7280', flexShrink: 0, minWidth: 42, textAlign: 'right' }}>
              Now
            </span>

            {/* Current position date */}
            {timeEnabled && (
              <span style={{
                padding: '2px 8px', borderRadius: 4, background: '#fef3c7',
                border: '1px solid #fcd34d', fontSize: '0.65rem', fontWeight: 700,
                color: '#92400e', flexShrink: 0,
              }}>
                {new Date(timePosition * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            )}

            {/* Reset button */}
            {timeEnabled && (
              <button
                onClick={() => { setTimePosition(NOW); setIsPlaying(false); }}
                style={{
                  padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.12)',
                  background: 'transparent', cursor: 'pointer',
                  color: '#6b7280', fontSize: '0.6rem', flexShrink: 0,
                }}
              >
                Reset
              </button>
            )}
          </div>
        )}

        {/* Hover tooltip */}
        {hoveredNode && (
          <div style={{
            position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)',
            padding: '2px 8px', borderRadius: 6,
            background: 'rgba(15,15,25,0.8)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(0,0,0,0.1)',
            color: '#fbbf24', fontSize: '0.75rem', fontFamily: "'PT Root UI', sans-serif",
            whiteSpace: 'nowrap' as const, pointerEvents: 'none', zIndex: 5,
            maxWidth: '90vw',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          }}>
            <strong>{hoveredNode.name}</strong>
            <span style={{ color: ENTITY_TYPES[hoveredNode.type]?.color ?? '#64748b' }}>
              {' '}{ENTITY_TYPES[hoveredNode.type]?.shape ?? ''} {ENTITY_TYPES[hoveredNode.type]?.label ?? hoveredNode.type}
            </span>
            {hoveredNode.totalIn > 0 && <span style={{ color: '#fca5a5' }}> · {hoveredNode.totalIn.toLocaleString()} ETH received</span>}
            {hoveredNode.totalOut > 0 && <span style={{ color: '#86efac' }}> · {hoveredNode.totalOut.toLocaleString()} ETH contributed</span>}
            {hoveredNode.votesCount > 0 && <span style={{ color: '#a78bfa' }}> · {hoveredNode.votesCount} votes</span>}
            {hoveredNode.proposalsCreated > 0 && <span style={{ color: '#a78bfa' }}> · {hoveredNode.proposalsCreated} props authored</span>}
          </div>
        )}

        {/* Legend */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 12, padding: '10px 24px 14px', fontSize: '0.6rem', color: '#64748b',
          fontFamily: "'PT Root UI', sans-serif", flexWrap: 'wrap' as const,
        }}>
          {(['nounder', 'delegate', 'subdao', 'builder', 'culture', 'infra', 'education'] as const).map(type => {
            const info = ENTITY_TYPES[type];
            return (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ color: info.color, fontSize: '0.75rem' }}>{info.shape}</span>
                <span>{info.label}</span>
              </div>
            );
          })}
          <span style={{ color: '#334155' }}>|</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 4px #22c55e' }} />
            <span>Contributor</span>
          </div>
          <div style={{
            width: 30, height: 3, borderRadius: 2,
            background: 'linear-gradient(90deg, #22c55e, #f59e0b, #ef4444)',
          }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 4px #ef4444' }} />
            <span>Recipient</span>
          </div>
          <span style={{ color: '#334155' }}>|</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ color: '#8b5cf6', fontSize: '0.7rem' }}>→</span><span>Proposed</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ color: '#06b6d4', fontSize: '0.7rem' }}>→</span><span>Stream</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ color: '#22c55e', fontSize: '0.7rem' }}>→</span><span>ETH flow</span>
          </div>
        </div>
      </div>

      {selectedNode && <DetailPanel node={selectedNode} onClose={handleClose} />}
    </>
  );
};

export default TreasuryFlowSection;
