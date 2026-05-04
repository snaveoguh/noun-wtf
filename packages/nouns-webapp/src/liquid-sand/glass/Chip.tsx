/**
 * Liquid Sand UI — <GlassChip>
 *
 * Small inline glass tag for status pills, labels, counts.
 * Designed to read against any backdrop without competing.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export type GlassChipTone = 'neutral' | 'accent' | 'success' | 'danger';
export type GlassChipSize = 'xs' | 'sm' | 'md';

export interface GlassChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: GlassChipTone;
  size?: GlassChipSize;
}

const TONE_BG: Record<GlassChipTone, string> = {
  neutral: 'var(--ls-glass-light-strong)',
  accent: 'var(--ls-glass-tint)',
  success: 'rgba(122, 139, 60, 0.18)',
  danger: 'rgba(194, 73, 47, 0.18)',
};

const TONE_FG: Record<GlassChipTone, string> = {
  neutral: 'var(--ls-fg-secondary)',
  accent: 'var(--ls-accent)',
  success: 'var(--ls-success)',
  danger: 'var(--ls-danger)',
};

const SIZE_CLASS: Record<GlassChipSize, string> = {
  xs: 'px-1.5 py-0.5 text-[10px] gap-1',
  sm: 'px-2 py-0.5 text-[11px] gap-1',
  md: 'px-2.5 py-1 text-xs gap-1.5',
};

export const GlassChip = React.forwardRef<HTMLSpanElement, GlassChipProps>(
  function GlassChip(
    { tone = 'neutral', size = 'sm', className, style, children, ...rest },
    ref,
  ) {
    const chipStyle: React.CSSProperties = {
      backgroundColor: TONE_BG[tone],
      color: TONE_FG[tone],
      borderRadius: 'var(--ls-r-full)',
      backdropFilter: 'blur(var(--ls-blur-subtle)) saturate(var(--ls-saturate))',
      WebkitBackdropFilter: 'blur(var(--ls-blur-subtle)) saturate(var(--ls-saturate))',
      boxShadow:
        'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass)',
      ...style,
    };

    return (
      <span
        ref={ref}
        data-ls-chip=""
        data-ls-tone={tone}
        className={cn(
          'inline-flex items-center justify-center font-medium leading-none whitespace-nowrap',
          SIZE_CLASS[size],
          className,
        )}
        style={chipStyle}
        {...rest}
      >
        {children}
      </span>
    );
  },
);

export default GlassChip;
