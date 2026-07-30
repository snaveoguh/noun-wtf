import { FC } from 'react';

import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { type PropdateEntry, usePropdates } from '@/hooks/usePropdates';

// ─── Single Propdate Card ─────────────────────────────────────────────────────

const PropdateCard: FC<{ entry: PropdateEntry }> = ({ entry }) => {
  const date = new Date(entry.timestamp * 1000);
  const dateStr = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 12,
        border: '1px solid #e2e3e8',
        padding: '16px',
        overflow: 'hidden',
      }}
    >
      {/* Header: date + completion badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: '0.7rem',
            color: '#8c8d92',
            fontFamily: "'PT Root UI'",
            fontWeight: 500,
          }}
        >
          {dateStr}
        </span>
        {entry.isCompleted && (
          <span
            style={{
              fontSize: '0.6rem',
              fontWeight: 700,
              background: 'rgba(34, 197, 94, 0.12)',
              color: '#16a34a',
              padding: '2px 8px',
              borderRadius: 4,
            }}
          >
            Completed
          </span>
        )}
      </div>

      {/* Markdown content */}
      <div
        style={{
          fontFamily: "'PT Root UI'",
          fontSize: '0.8rem',
          lineHeight: 1.6,
          color: '#14141f',
          overflowWrap: 'break-word',
          wordBreak: 'break-word' as const,
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          rehypePlugins={[rehypeRaw]}
          components={{
            img: ({ src, alt, ...props }) => {
              if (src != null && src.startsWith('data:')) {
                return (
                  <span
                    style={{
                      display: 'block',
                      padding: '8px 12px',
                      background: '#f4f4f8',
                      borderRadius: 6,
                      color: '#8c8d92',
                      fontSize: '0.7rem',
                      margin: '6px 0',
                    }}
                  >
                    Embedded image
                  </span>
                );
              }
              return (
                <img
                  {...props}
                  src={src}
                  alt={alt}
                  style={{
                    maxWidth: '100%',
                    height: 'auto',
                    borderRadius: 6,
                    margin: '6px 0',
                  }}
                  loading="lazy"
                  onError={e => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              );
            },
            p: ({ ...props }) => <p {...props} style={{ margin: '0 0 8px' }} />,
            a: ({ ...props }) => (
              <a
                {...props}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#2563eb', textDecoration: 'underline' }}
              />
            ),
          }}
        >
          {entry.update}
        </ReactMarkdown>
      </div>
    </div>
  );
};

// ─── Propdates Section ────────────────────────────────────────────────────────

const ProposalPropdates: FC<{ proposalId: number }> = ({ proposalId }) => {
  const { data: propdates, isLoading } = usePropdates({
    propId: proposalId,
    dedupeByProp: false,
    limit: 50,
  });

  // Nothing to show and done loading
  if (!isLoading && (propdates == null || propdates.length === 0)) return null;

  return (
    <div style={{ marginTop: 16 }}>
      {/* Section header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontFamily: "'Londrina Solid'",
            fontSize: '1.1rem',
            fontWeight: 400,
            color: '#14141f',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          Propdates
          {propdates != null && propdates.length > 0 && (
            <span
              style={{
                fontSize: '0.65rem',
                fontFamily: "'PT Root UI'",
                fontWeight: 600,
                background: '#f0f0f4',
                padding: '1px 6px',
                borderRadius: 4,
                color: '#8c8d92',
              }}
            >
              {propdates.length}
            </span>
          )}
        </div>
        <a
          href={`https://propdates.nouns.wtf/prop/${proposalId}`}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: '0.65rem',
            fontFamily: "'PT Root UI'",
            fontWeight: 600,
            color: '#8c8d92',
            textDecoration: 'none',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#14141f')}
          onMouseLeave={e => (e.currentTarget.style.color = '#8c8d92')}
        >
          View all →
        </a>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div
          style={{
            background: '#fff',
            borderRadius: 12,
            border: '1px solid #e2e3e8',
            padding: '20px 16px',
            textAlign: 'center',
            color: '#8c8d92',
            fontSize: '0.75rem',
            fontFamily: "'PT Root UI'",
          }}
        >
          Loading proposal updates...
        </div>
      )}

      {/* Stacked propdates */}
      {propdates != null && propdates.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {propdates.map((entry, i) => (
            <PropdateCard key={`${entry.blockNumber}-${i}`} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
};

export default ProposalPropdates;
