import { useTopVoters } from './useTopVoters';

interface VoterListProps {
  search?: string;
  limit?: number;
}

const truncateAddress = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

/**
 * Voter ranking tab — counterpart of `apps/nouns-camp/src/components/voter-screen.jsx`'s
 * landing list. Rows link to `/voters/:address` (which doesn't exist yet on
 * noun-wtf — see "still-gap" in the report). Falls back to Etherscan for now
 * via target="_blank" so we don't dead-end the user.
 */
export default function VoterList({ search = '', limit = 50 }: VoterListProps) {
  const { voters, loading } = useTopVoters(2000);

  const filtered = (() => {
    if (!search) return voters;
    const needle = search.toLowerCase();
    return voters.filter(v => v.address.toLowerCase().includes(needle));
  })().slice(0, limit);

  if (loading && voters.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          color: 'var(--theme-text-secondary, var(--theme-text-primary))',
          fontSize: 13,
        }}
      >
        Loading top voters…
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          color: 'var(--theme-text-secondary, var(--theme-text-primary))',
          fontSize: 13,
        }}
      >
        No voters match.
      </div>
    );
  }

  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {filtered.map((voter, i) => (
        <li
          key={voter.address}
          style={{
            borderBottom: '1px solid var(--theme-border-light, var(--theme-border))',
          }}
        >
          {/* Camp links to /voters/:address. We don't have that route yet —
              fall back to Etherscan so the row isn't a dead end. Building a
              real voter-detail page is in the still-gap list. */}
          <a
            href={`https://etherscan.io/address/${voter.address}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              color: 'var(--theme-text-primary)',
              textDecoration: 'none',
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--theme-text-secondary, var(--theme-text-primary))',
                minWidth: 28,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              #{i + 1}
            </span>
            <span style={{ flex: 1, fontSize: 13, fontFamily: 'var(--theme-font-mono, ui-monospace, monospace)' }}>
              {truncateAddress(voter.address)}
            </span>
            <span
              style={{
                fontSize: 11,
                color: 'var(--theme-text-secondary, var(--theme-text-primary))',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {voter.voteCount} {voter.voteCount === 1 ? 'vote' : 'votes'}
              {voter.withReasonCount > 0 && (
                <span style={{ opacity: 0.7 }}>
                  {' '}
                  ({voter.withReasonCount} w/ reason)
                </span>
              )}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
