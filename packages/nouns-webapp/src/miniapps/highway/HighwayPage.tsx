import { useEffect, useRef, useState } from 'react';

import { Link } from 'react-router';
import { useAccount } from 'wagmi';

import { execute } from '@/subgraphs/execute';

interface CandidateProposal {
  id: string;
  slug: string;
  proposer: string;
  canceled: boolean;
  versionsCount: number;
  description: string;
  /** Computed from description — first markdown heading or first line */
  title: string;
}

// ASCII art border characters
const TOP_LEFT = '╔';
const TOP_RIGHT = '╗';
const BOT_LEFT = '╚';
const BOT_RIGHT = '╝';
const H_LINE = '═';
const V_LINE = '║';

const truncate = (text: string, len: number) =>
  text.length > len ? text.slice(0, len - 1) + '…' : text;

const padRight = (text: string, len: number) => text + ' '.repeat(Math.max(0, len - text.length));

/** Render a candidate as an ASCII art block */
const renderCandidateAscii = (c: CandidateProposal, width = 40): string[] => {
  const innerW = width - 4;
  const title = truncate(c.title.toUpperCase(), innerW);
  const proposer = truncate(`BY: ${c.proposer.slice(0, 6)}...${c.proposer.slice(-4)}`, innerW);
  const versions = `V${c.versionsCount}`;
  const bar = H_LINE.repeat(width - 2);

  return [
    `${TOP_LEFT}${bar}${TOP_RIGHT}`,
    `${V_LINE} ${padRight(title, innerW)} ${V_LINE}`,
    `${V_LINE} ${padRight(proposer, innerW)} ${V_LINE}`,
    `${V_LINE} ${padRight(versions, innerW)} ${V_LINE}`,
    `${BOT_LEFT}${bar}${BOT_RIGHT}`,
  ];
};

const ASCII_NOGGLES = `
    ██████████████
    ██░░░░██░░░░██
    ██░░░░██░░░░██
    ██████████████
      ████  ████
`;

const HighwayPage: React.FC = () => {
  const [candidates, setCandidates] = useState<CandidateProposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateProposal | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const speedRef = useRef(1);
  const { address: account } = useAccount();

  // Fetch candidates
  useEffect(() => {
    (async () => {
      try {
        const result = await execute<{
          candidates: {
            items: Array<Omit<CandidateProposal, 'title'>>;
          };
        }>(`{
          candidates(
            orderBy: "lastUpdatedAtBlock"
            orderDirection: "desc"
            limit: 50
            where: { canceled: false }
          ) {
            items {
              id
              slug
              proposer
              canceled
              versionsCount
              description
            }
          }
        }`);
        const items = (result?.candidates?.items ?? []).map(c => {
          // Extract title from description (first # heading or first line)
          const headingMatch = c.description?.match(/^#\s+(.+)/m);
          const title = headingMatch
            ? headingMatch[1].trim()
            : c.description?.split('\n')[0]?.trim() || 'Untitled';
          return { ...c, title };
        });
        setCandidates(items);
      } catch {
        // No candidates available — that's fine
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Animation loop
  useEffect(() => {
    const tick = () => {
      setScrollOffset(prev => prev + speedRef.current);
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  // Scroll wheel controls speed
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      speedRef.current = Math.max(0.2, Math.min(5, speedRef.current + e.deltaY * 0.002));
    };
    const el = containerRef.current;
    el?.addEventListener('wheel', handler, { passive: false });
    return () => el?.removeEventListener('wheel', handler);
  }, []);

  // Build the marquee content
  const blocks = candidates.map(c => renderCandidateAscii(c));
  const blockWidth = 44; // chars wide per block including spacing

  return (
    <div
      ref={containerRef}
      className="flex min-h-[calc(100vh-80px)] flex-col bg-black font-mono text-green-400"
      style={{ cursor: 'crosshair' }}
    >
      {/* Header */}
      <div className="border-b border-green-800 px-4 py-3">
        <pre className="text-center text-xs text-green-600">{ASCII_NOGGLES}</pre>
        <h1 className="text-center text-lg text-green-400">═══ PROPOSAL HIGHWAY ═══</h1>
        <p className="text-center text-xs text-green-700">
          SCROLL TO CHANGE SPEED | CLICK A PROPOSAL TO VIEW
        </p>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-1 items-center justify-center">
          <pre className="animate-pulse text-green-600">
            {`
  ████████████████████████████████
  █ LOADING PROPOSAL HIGHWAY... █
  ████████████████████████████████
            `}
          </pre>
        </div>
      )}

      {/* No candidates */}
      {!isLoading && candidates.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <pre className="text-green-700">
            {`
  ╔══════════════════════════════╗
  ║  NO CANDIDATES FOUND.       ║
  ║  THE HIGHWAY IS EMPTY.      ║
  ║  SUBMIT A CANDIDATE!        ║
  ╚══════════════════════════════╝
            `}
          </pre>
        </div>
      )}

      {/* Marquee */}
      {!isLoading && candidates.length > 0 && (
        <div className="flex-1 overflow-hidden px-4 py-6">
          {/* Row 1: Scrolling proposals */}
          <div className="mb-4 overflow-hidden whitespace-nowrap">
            <div
              style={{
                transform: `translateX(-${scrollOffset % (blockWidth * candidates.length * 10)}px)`,
                display: 'inline-block',
              }}
            >
              {/* Repeat candidates enough times for continuous scroll */}
              {Array.from({ length: 3 }).map((_, rep) =>
                candidates.map((c, ci) => (
                  <button
                    key={`${rep}-${ci}`}
                    onClick={e => {
                      e.stopPropagation();
                      setSelectedCandidate(c);
                    }}
                    className="mr-4 inline-block align-top text-green-400 no-underline transition-colors hover:text-green-200"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      padding: 0,
                    }}
                  >
                    <pre className="text-xs leading-tight">{blocks[ci]?.join('\n')}</pre>
                  </button>
                )),
              )}
            </div>
          </div>

          {/* Road line */}
          <div className="overflow-hidden text-green-800">
            <pre className="text-xs">{'═'.repeat(200)}</pre>
          </div>

          {/* Row 2: Reverse direction */}
          <div className="mt-4 overflow-hidden whitespace-nowrap">
            <div
              style={{
                transform: `translateX(${(scrollOffset * 0.7) % (blockWidth * candidates.length * 10)}px)`,
                display: 'inline-block',
              }}
            >
              {Array.from({ length: 3 }).map((_, rep) =>
                [...candidates].reverse().map((c, ci) => (
                  <button
                    key={`r${rep}-${ci}`}
                    onClick={e => {
                      e.stopPropagation();
                      setSelectedCandidate(c);
                    }}
                    className="mr-4 inline-block align-top text-green-600 no-underline transition-colors hover:text-green-300"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      padding: 0,
                    }}
                  >
                    <pre className="text-xs leading-tight">
                      {renderCandidateAscii(c).join('\n')}
                    </pre>
                  </button>
                )),
              )}
            </div>
          </div>

          {/* Another road line */}
          <div className="mt-4 overflow-hidden text-green-800">
            <pre className="text-xs">{'─'.repeat(200)}</pre>
          </div>
        </div>
      )}

      {/* Candidate Detail Panel */}
      {selectedCandidate && (
        <div
          className="border-t border-green-800 px-4 py-3"
          style={{ background: 'rgba(0,40,0,0.5)' }}
        >
          <div className="mx-auto max-w-2xl">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-green-300">
                {selectedCandidate.title.toUpperCase()}
              </h3>
              <button
                onClick={() => setSelectedCandidate(null)}
                className="text-xs text-green-700 hover:text-green-400"
              >
                [CLOSE]
              </button>
            </div>
            <p className="mb-2 text-xs text-green-600" style={{ textTransform: 'none' }}>
              {selectedCandidate.description.slice(0, 200)}
              {selectedCandidate.description.length > 200 ? '...' : ''}
            </p>
            <div className="flex gap-2">
              <Link
                to={`/candidates/${selectedCandidate.id}`}
                className="rounded border border-green-600 px-3 py-1 text-xs font-bold text-green-400 no-underline hover:bg-green-900"
              >
                VIEW FULL
              </Link>
              <button
                onClick={() => {
                  // Share on Warpcast — promote this candidate
                  const url = `https://noun.wtf/candidates/${selectedCandidate.id}`;
                  const text = `Check out this Nouns DAO proposal candidate: "${selectedCandidate.title}" ⌐◨-◨\n\n${url}`;
                  window.open(
                    `https://warpcast.com/~/compose?text=${encodeURIComponent(text)}`,
                    '_blank',
                  );
                }}
                className="rounded border border-yellow-600 px-3 py-1 text-xs font-bold text-yellow-400 hover:bg-yellow-900"
              >
                📣 PROMOTE
              </button>
              <button
                onClick={() => {
                  if (!account) {
                    alert('Connect your wallet first to sponsor a candidate');
                    return;
                  }
                  // Open the candidate page to sponsor
                  window.open(`/candidates/${selectedCandidate.slug}`, '_blank');
                }}
                className="rounded border border-purple-600 px-3 py-1 text-xs font-bold text-purple-400 hover:bg-purple-900"
              >
                🤝 SPONSOR
              </button>
            </div>
            <div className="mt-2 text-xs text-green-800">
              BY: {selectedCandidate.proposer.slice(0, 6)}...{selectedCandidate.proposer.slice(-4)}{' '}
              | V{selectedCandidate.versionsCount}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-green-800 px-4 py-2 text-center text-xs text-green-700">
        SPEED: {speedRef.current.toFixed(1)}x | {candidates.length} CANDIDATES ON THE HIGHWAY |
        CLICK A BOX TO PROMOTE/SPONSOR
      </div>
    </div>
  );
};

export default HighwayPage;
