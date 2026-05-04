/**
 * Liquid Sand UI — <GlassToolbar>
 *
 * Horizontal glass strip used for app toolbars, segmented controls, or
 * any cluster of controls that needs a unified glass surround.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export type GlassToolbarSize = 'sm' | 'md' | 'lg';
export type GlassToolbarAlign = 'start' | 'center' | 'end' | 'between';

export interface GlassToolbarProps
  extends React.HTMLAttributes<HTMLDivElement> {
  size?: GlassToolbarSize;
  align?: GlassToolbarAlign;
  segmented?: boolean;
  role?: string;
}

const SIZE_CLASS: Record<GlassToolbarSize, string> = {
  sm: 'h-8 px-1.5 gap-1',
  md: 'h-10 px-2 gap-1.5',
  lg: 'h-12 px-2.5 gap-2',
};

const ALIGN_CLASS: Record<GlassToolbarAlign, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
};

export const GlassToolbar = React.forwardRef<HTMLDivElement, GlassToolbarProps>(
  function GlassToolbar(
    {
      size = 'md',
      align = 'start',
      segmented = false,
      role = 'toolbar',
      className,
      style,
      children,
      ...rest
    },
    ref,
  ) {
    const toolbarStyle: React.CSSProperties = {
      backgroundColor: 'var(--ls-glass-light)',
      backdropFilter:
        'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
      WebkitBackdropFilter:
        'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
      borderRadius: 'var(--ls-r-md)',
      boxShadow:
        'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass), var(--ls-shadow-sm)',
      color: 'var(--ls-fg-primary)',
      ...style,
    };

    return (
      <div
        ref={ref}
        role={role}
        data-ls-toolbar=""
        data-ls-segmented={segmented ? '' : undefined}
        className={cn(
          'inline-flex items-center',
          SIZE_CLASS[size],
          ALIGN_CLASS[align],
          segmented && '[&>*]:flex-1',
          className,
        )}
        style={toolbarStyle}
        {...rest}
      >
        {children}
      </div>
    );
  },
);

export default GlassToolbar;
