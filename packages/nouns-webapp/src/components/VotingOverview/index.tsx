import { FC } from 'react';

interface VotingOverviewProps {
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  quorum: number;
  isActive: boolean;
}

const VotingOverview: FC<VotingOverviewProps> = ({
  forVotes,
  againstVotes,
  abstainVotes,
  quorum,
  isActive,
}) => {
  const total = forVotes + againstVotes + abstainVotes;
  const forPct = total > 0 ? (forVotes / total) * 100 : 0;
  const againstPct = total > 0 ? (againstVotes / total) * 100 : 0;
  const abstainPct = total > 0 ? (abstainVotes / total) * 100 : 0;

  // For quorum marker position - based on total possible votes needed
  const maxVotes = Math.max(total, quorum * 1.5, 1);
  const quorumPosition = Math.min((quorum / maxVotes) * 100, 95);
  const forReachedQuorum = forVotes >= quorum;

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 16,
        border: '1px solid #e2e3e8',
        padding: '20px 24px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <h3
          style={{
            fontFamily: "'Londrina Solid'",
            fontSize: '1.3rem',
            fontWeight: 400,
            margin: 0,
          }}
        >
          Voting Overview
        </h3>
        {isActive && (
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              color: '#43b369',
              padding: '3px 10px',
              borderRadius: 20,
              background: 'rgba(67, 179, 105, 0.1)',
            }}
          >
            Voting Active
          </span>
        )}
      </div>

      {/* Stacked horizontal bar. The quorum label lives in a padded wrapper
          ABOVE the bar — it used to be positioned at top:-18 inside the
          overflow:hidden bar, which clipped it, so it never actually showed. */}
      <div
        style={{
          position: 'relative',
          paddingTop: quorum > 0 ? 16 : 0,
          marginBottom: 8,
        }}
      >
        {quorum > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              // Clamp so the label can't spill past the card edges when the
              // marker sits near 0% or the 95% cap.
              left: `clamp(28px, ${quorumPosition}%, calc(100% - 28px))`,
              transform: 'translateX(-50%)',
              fontSize: '0.6rem',
              fontWeight: 700,
              color: '#8c8d92',
              whiteSpace: 'nowrap',
              lineHeight: 1,
            }}
          >
            Quorum {quorum}
          </div>
        )}
        <div
          style={{
            position: 'relative',
            height: 32,
            borderRadius: 10,
            overflow: 'hidden',
            background: '#f0f0f4',
            display: 'flex',
          }}
        >
          {forPct > 0 && (
            <div
              style={{
                width: `${forPct}%`,
                background: '#43b369',
                height: '100%',
                transition: 'width 0.3s ease',
                minWidth: 4,
              }}
            />
          )}
          {againstPct > 0 && (
            <div
              style={{
                width: `${againstPct}%`,
                background: '#e40536',
                height: '100%',
                transition: 'width 0.3s ease',
                minWidth: 4,
              }}
            />
          )}
          {abstainPct > 0 && (
            <div
              style={{
                width: `${abstainPct}%`,
                background: '#b0b0b8',
                height: '100%',
                transition: 'width 0.3s ease',
                minWidth: 4,
              }}
            />
          )}

          {/* Quorum marker line */}
          {quorum > 0 && (
            <div
              style={{
                position: 'absolute',
                left: `${quorumPosition}%`,
                top: 0,
                bottom: 0,
                width: 2,
                background: '#14141f',
                opacity: 0.6,
                zIndex: 2,
              }}
            />
          )}
        </div>
      </div>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        <VoteStat label="For" count={forVotes} color="#43b369" pct={forPct} />
        <VoteStat label="Against" count={againstVotes} color="#e40536" pct={againstPct} />
        <VoteStat label="Abstain" count={abstainVotes} color="#b0b0b8" pct={abstainPct} />
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: '0.7rem', color: '#8c8d92', fontWeight: 600 }}>Quorum</div>
          <div
            style={{
              fontSize: '0.95rem',
              fontWeight: 700,
              color: forReachedQuorum ? '#43b369' : '#14141f',
            }}
          >
            {forVotes}/{quorum}
            {forReachedQuorum && <span style={{ fontSize: '0.7rem', marginLeft: 4 }}>Reached</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

const VoteStat: FC<{ label: string; count: number; color: string; pct: number }> = ({
  label,
  count,
  color,
  pct,
}) => (
  <div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      <span style={{ fontSize: '0.7rem', color: '#8c8d92', fontWeight: 600 }}>{label}</span>
    </div>
    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#14141f' }}>
      {count}{' '}
      <span style={{ fontSize: '0.7rem', fontWeight: 500, color: '#8c8d92' }}>
        ({pct.toFixed(1)}%)
      </span>
    </div>
  </div>
);

export default VotingOverview;
