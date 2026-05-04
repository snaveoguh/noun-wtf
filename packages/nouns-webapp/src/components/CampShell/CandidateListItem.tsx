import type { PartialProposalCandidate, ProposalCandidate } from '@/wrappers/nounsData';

interface CandidateListItemProps {
  candidate: ProposalCandidate | PartialProposalCandidate;
}

const truncateAddress = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

/** Get the display title from either ProposalCandidate or PartialProposalCandidate shape. */
const getCandidateTitle = (c: ProposalCandidate | PartialProposalCandidate): string => {
  if ('latestVersion' in c && c.latestVersion?.content?.title) {
    return c.latestVersion.content.title;
  }
  if ('version' in c && c.version?.content?.title) {
    return c.version.content.title;
  }
  return c.slug;
};

/**
 * Camp-style candidate row. Notable visual: a sponsor-progress chip
 * (`signers / threshold`) using `requiredVotes` and `voteCount` from our
 * Ponder-indexed candidate.
 */
export default function CandidateListItem({ candidate }: CandidateListItemProps) {
  const title = getCandidateTitle(candidate);
  const required = candidate.requiredVotes ?? 0;
  const have = candidate.voteCount ?? 0;
  const reachedThreshold = required > 0 && have >= required;

  return (
    <li
      style={{
        listStyle: 'none',
        borderBottom: '1px solid var(--theme-border-light, var(--theme-border))',
      }}
    >
      <div
        style={{
          display: 'block',
          padding: '12px 16px',
          color: 'var(--theme-text-primary)',
          textDecoration: 'none',
          cursor: 'default',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--theme-text-muted, var(--theme-text-secondary))',
              minWidth: 64,
            }}
          >
            Candidate
          </span>
          <span
            style={{
              flex: 1,
              fontSize: 14,
              lineHeight: 1.35,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {title}
          </span>
          {required > 0 && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: 'var(--theme-radius-sm, 4px)',
                background: reachedThreshold
                  ? 'var(--brand-color-green-translucent, rgba(13,146,77,0.1))'
                  : 'var(--theme-bg-tertiary, var(--theme-bg-card))',
                color: reachedThreshold
                  ? 'var(--theme-positive, #0d924d)'
                  : 'var(--theme-text-secondary, var(--theme-text-primary))',
                border: '1px solid transparent',
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
              }}
              title={`${have} of ${required} required signers`}
            >
              {have}/{required} sponsors
            </span>
          )}
        </div>

        <div style={{ marginTop: 4, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span
            style={{
              fontSize: 11,
              color: 'var(--theme-text-muted, var(--theme-text-secondary))',
            }}
          >
            by {truncateAddress(candidate.proposer)}
          </span>
          {candidate.canceled && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--theme-negative, #d32335)',
              }}
            >
              Canceled
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
