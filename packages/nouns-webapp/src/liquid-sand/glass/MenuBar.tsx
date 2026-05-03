/**
 * Liquid Sand UI — <GlassMenuBar>
 *
 * Top OS-style menu bar. Sticky at the top of its containing block,
 * heavy blur so content scrolls cleanly underneath.
 *
 * Slots: start (logo), center (menu items), end (status icons).
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export interface GlassMenuBarProps
  extends React.HTMLAttributes<HTMLDivElement> {
  start?: React.ReactNode;
  center?: React.ReactNode;
  end?: React.ReactNode;
  sticky?: boolean;
  height?: number | string;
}

export const GlassMenuBar = React.forwardRef<HTMLDivElement, GlassMenuBarProps>(
  function GlassMenuBar(
    {
      start,
      center,
      end,
      sticky = true,
      height = 28,
      className,
      style,
      children,
      ...rest
    },
    ref,
  ) {
    const barStyle: React.CSSProperties = {
      backgroundColor: 'var(--ls-glass-light-strong)',
      backdropFilter:
        'blur(var(--ls-blur-heavy)) saturate(var(--ls-saturate))',
      WebkitBackdropFilter:
        'blur(var(--ls-blur-heavy)) saturate(var(--ls-saturate))',
      borderBottom: '1px solid var(--ls-border-glass)',
      boxShadow:
        'var(--ls-shadow-inset-glass), 0 1px 4px rgba(60, 45, 25, 0.06)',
      color: 'var(--ls-fg-primary)',
      height,
      zIndex: 'var(--ls-z-menu)' as unknown as number,
      ...style,
    };

    return (
      <div
        ref={ref}
        role="menubar"
        data-ls-menubar=""
        className={cn(
          'flex items-center px-3 text-xs font-medium select-none w-full',
          sticky && 'sticky top-0',
          className,
        )}
        style={barStyle}
        {...rest}
      >
        {/* If structured slots were provided, render the 3-region layout. */}
        {(start || center || end) && (
          <>
            <div
              data-ls-menubar-start=""
              className="flex items-center gap-3 flex-1 min-w-0"
            >
              {start}
            </div>
            <div
              data-ls-menubar-center=""
              className="flex items-center gap-3 justify-center"
            >
              {center}
            </div>
            <div
              data-ls-menubar-end=""
              className="flex items-center gap-3 flex-1 min-w-0 justify-end"
            >
              {end}
            </div>
          </>
        )}
        {/* Otherwise just render whatever the consumer passes. */}
        {!start && !center && !end && children}
      </div>
    );
  },
);

export default GlassMenuBar;
