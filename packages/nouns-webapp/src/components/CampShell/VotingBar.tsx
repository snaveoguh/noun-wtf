/**
 * Vote progress bar — ported from `apps/nouns-camp/src/components/voting-bar.js`.
 * Camp's bar shows individual vote bricks (one per delegate vote, sized by
 * voting power). Our subgraph data only gives us aggregate for/against/abstain
 * counts plus a quorum number, so we render three uniform fills + a quorum
 * marker on top of the for-fill. Looks visually identical for proposals where
 * one voter doesn't dominate; close enough for digest-level summaries.
 */

interface VotingBarProps {
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  quorumVotes?: number;
  height?: number;
}

export default function VotingBar({
  forVotes,
  againstVotes,
  abstainVotes,
  quorumVotes = 0,
  height = 6,
}: VotingBarProps) {
  const total = Math.max(
    Math.max(forVotes, quorumVotes) + againstVotes + abstainVotes,
    1,
  );
  const undeterminedForQuorum = Math.max(0, quorumVotes - forVotes);

  const forFlex = forVotes;
  const undeterminedFlex = undeterminedForQuorum;
  const abstainFlex = abstainVotes;
  const againstFlex = againstVotes;

  const quorumPct = quorumVotes > 0 ? Math.min(100, (quorumVotes / total) * 100) : 0;

  return (
    <div
      style={{
        display: 'flex',
        gap: 2,
        height,
        borderRadius: 2,
        overflow: 'hidden',
        background: 'transparent',
        position: 'relative',
      }}
      title={
        quorumVotes > 0
          ? `For ${forVotes} / Against ${againstVotes} / Abstain ${abstainVotes} · Quorum ${quorumVotes}`
          : `For ${forVotes} / Against ${againstVotes} / Abstain ${abstainVotes}`
      }
    >
      {forFlex > 0 && (
        <div
          style={{
            flex: forFlex,
            background: 'var(--theme-positive, #0d924d)',
          }}
        />
      )}
      {undeterminedFlex > 0 && (
        <div
          style={{
            flex: undeterminedFlex,
            background: 'var(--theme-bg-tertiary, hsla(0,0%,0%,0.08))',
          }}
        />
      )}
      {abstainFlex > 0 && (
        <div
          style={{
            flex: abstainFlex,
            background: 'var(--theme-text-muted, hsl(45 1% 54%))',
            opacity: 0.5,
          }}
        />
      )}
      {againstFlex > 0 && (
        <div
          style={{
            flex: againstFlex,
            background: 'var(--theme-negative, #d32335)',
          }}
        />
      )}
      {quorumPct > 0 && quorumPct < 100 && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: -2,
            bottom: -2,
            left: `${quorumPct}%`,
            width: 2,
            background: 'var(--theme-text-primary)',
            opacity: 0.6,
          }}
        />
      )}
    </div>
  );
}
