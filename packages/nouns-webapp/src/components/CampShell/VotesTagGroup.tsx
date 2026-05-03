import { ArrowDown, ArrowUp } from 'lucide-react';

/**
 * Inline for/abstain/against pill cluster — ported from
 * `apps/nouns-camp/src/components/votes-tag-group.js`.
 */
interface VotesTagGroupProps {
  for_: number;
  against: number;
  abstain: number;
  quorum?: number;
  highlight?: 'for' | 'against' | 'abstain';
}

export default function VotesTagGroup({
  for_,
  against,
  abstain,
  quorum,
  highlight,
}: VotesTagGroupProps) {
  const cellBase = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 6px',
    background: 'var(--theme-bg-tertiary, var(--theme-bg-card))',
    color: 'var(--theme-text-secondary, var(--theme-text-primary))',
    fontSize: 11,
    lineHeight: 1.2,
    minWidth: 24,
    justifyContent: 'center',
    fontVariantNumeric: 'tabular-nums' as const,
  };
  const highlighted = (key: VotesTagGroupProps['highlight']) =>
    highlight === key
      ? {
          color: 'var(--theme-text-primary)',
          fontWeight: 600,
          background: 'var(--theme-bg-secondary, var(--theme-bg-tertiary))',
        }
      : null;

  return (
    <span
      style={{
        display: 'inline-flex',
        gap: 1,
        whiteSpace: 'nowrap',
        borderRadius: 3,
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          ...cellBase,
          ...highlighted('for'),
          borderTopLeftRadius: 3,
          borderBottomLeftRadius: 3,
        }}
      >
        {for_}
        <ArrowUp size={10} aria-hidden style={{ marginLeft: 2 }} />
        {quorum != null && (
          <span
            style={{ marginLeft: 4, opacity: 0.7, fontWeight: 'normal' }}
          >{` / ${quorum}`}</span>
        )}
      </span>
      <span style={{ ...cellBase, ...highlighted('abstain') }}>{abstain}</span>
      <span
        style={{
          ...cellBase,
          ...highlighted('against'),
          borderTopRightRadius: 3,
          borderBottomRightRadius: 3,
        }}
      >
        {against}
        <ArrowDown size={10} aria-hidden style={{ marginLeft: 2 }} />
      </span>
    </span>
  );
}
