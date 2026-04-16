import { useAccount } from 'wagmi';

import { formatEth } from '@/lib/marketplace/market-utils';

interface PositionData {
  dao: string;
  proposalId: string;
  title: string;
  side: 'for' | 'against';
  stakeWei: bigint;
  outcome: number; // 0=unresolved, 1=for, 2=against
  claimed: boolean;
}

interface PositionTrackerProps {
  positions: PositionData[];
}

export function PositionTracker({ positions }: PositionTrackerProps) {
  const { isConnected } = useAccount();

  if (!isConnected || positions.length === 0) return null;

  const open = positions.filter(p => p.outcome === 0);
  const resolved = positions.filter(p => p.outcome !== 0);

  return (
    <div className="border-2 border-[var(--rule)] bg-[var(--paper)] p-4">
      <h3 className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-[var(--ink)]">
        Your Positions
      </h3>

      {open.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 font-mono text-[8px] uppercase tracking-wider text-[var(--ink-faint)]">
            Open ({open.length})
          </p>
          <div className="space-y-1">
            {open.map(p => (
              <div
                key={`${p.dao}-${p.proposalId}`}
                className="flex items-center justify-between border-b border-[var(--rule-light)] pb-1 font-mono text-[9px]"
              >
                <span className="text-[var(--ink-light)]">
                  {p.title.slice(0, 40)}
                  {p.title.length > 40 ? '...' : ''}
                </span>
                <span
                  className={
                    p.side === 'for'
                      ? 'font-bold text-[var(--ink)]'
                      : 'font-bold text-[var(--accent-red)]'
                  }
                >
                  {p.side.toUpperCase()} {formatEth(p.stakeWei)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {resolved.length > 0 && (
        <div>
          <p className="mb-1 font-mono text-[8px] uppercase tracking-wider text-[var(--ink-faint)]">
            Resolved ({resolved.length})
          </p>
          <div className="space-y-1">
            {resolved.map(p => {
              const won =
                (p.side === 'for' && p.outcome === 1) || (p.side === 'against' && p.outcome === 2);
              return (
                <div
                  key={`${p.dao}-${p.proposalId}`}
                  className="flex items-center justify-between border-b border-[var(--rule-light)] pb-1 font-mono text-[9px]"
                >
                  <span className="text-[var(--ink-light)]">
                    {p.title.slice(0, 40)}
                    {p.title.length > 40 ? '...' : ''}
                  </span>
                  <span
                    className={won ? 'font-bold text-[var(--ink)]' : 'text-[var(--accent-red)]'}
                  >
                    {won ? 'WON' : 'LOST'} {formatEth(p.stakeWei)}
                    {p.claimed ? ' (claimed)' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
