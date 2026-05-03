import type { CSSProperties } from 'react';

import { ProposalState } from '@/wrappers/nounsDao';

import {
  getStateLabel,
  getStateTone,
  toCampState,
  type CampProposalState,
} from './imported/proposals';

interface StatusTagProps {
  status: ProposalState;
  size?: 'sm' | 'md';
  style?: CSSProperties;
}

/**
 * Camp-style status tag. Mirrors `proposal-state-tag.js` from nouns.camp,
 * but reads from our numeric `ProposalState` enum. Tones map to the same four
 * color clusters Camp uses (active/warning/success/error + neutral fallback).
 */
export default function StatusTag({ status, size = 'md', style }: StatusTagProps) {
  const camp: CampProposalState | null = toCampState(status);
  if (camp == null) return null;

  const tone = getStateTone(camp);
  const label = getStateLabel(camp);

  const palette: Record<
    ReturnType<typeof getStateTone>,
    { bg: string; fg: string; border: string }
  > = {
    active: {
      bg: 'var(--brand-color-blue-translucent, rgba(59,130,246,0.1))',
      fg: 'var(--theme-accent, #2563eb)',
      border: 'transparent',
    },
    warning: {
      bg: 'rgba(234, 168, 0, 0.12)',
      fg: 'hsl(35 90% 35%)',
      border: 'transparent',
    },
    success: {
      bg: 'var(--brand-color-green-translucent, rgba(13,146,77,0.1))',
      fg: 'var(--theme-positive, #0d924d)',
      border: 'transparent',
    },
    error: {
      bg: 'var(--brand-color-red-translucent, rgba(211,35,53,0.1))',
      fg: 'var(--theme-negative, #d32335)',
      border: 'transparent',
    },
    neutral: {
      bg: 'var(--theme-bg-tertiary, var(--theme-bg-card))',
      fg: 'var(--theme-text-secondary, var(--theme-text-primary))',
      border: 'var(--theme-border)',
    },
  };

  const colors = palette[tone];
  const isSm = size === 'sm';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: isSm ? '1px 6px' : '3px 8px',
        fontSize: isSm ? 10 : 11,
        fontWeight: 600,
        letterSpacing: '0.01em',
        borderRadius: 'var(--theme-radius-sm, 4px)',
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {label}
    </span>
  );
}
