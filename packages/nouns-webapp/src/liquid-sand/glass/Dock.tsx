/**
 * Liquid Sand UI — <GlassDock>
 *
 * Floating bottom dock — a glass pill, centered horizontally, padded.
 * Children are dock items (the consumer renders apps / buttons).
 *
 * `reflection` toggles a subtle gradient swatch underneath that reads
 * as a soft glass reflection on whatever surface sits below the dock.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export interface GlassDockProps extends React.HTMLAttributes<HTMLDivElement> {
  reflection?: boolean;
  position?: 'fixed' | 'absolute' | 'relative';
  bottom?: number | string;
}

export const GlassDock = React.forwardRef<HTMLDivElement, GlassDockProps>(
  function GlassDock(
    {
      reflection = true,
      position = 'fixed',
      bottom = 16,
      className,
      style,
      children,
      ...rest
    },
    ref,
  ) {
    const wrapperStyle: React.CSSProperties = {
      position,
      bottom,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 'var(--ls-z-window-active)' as unknown as number,
      ...style,
    };

    const dockStyle: React.CSSProperties = {
      backgroundColor: 'var(--ls-glass-light)',
      backdropFilter:
        'blur(var(--ls-blur-heavy)) saturate(var(--ls-saturate))',
      WebkitBackdropFilter:
        'blur(var(--ls-blur-heavy)) saturate(var(--ls-saturate))',
      borderRadius: 'var(--ls-r-full)',
      boxShadow:
        'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass), var(--ls-shadow-lg)',
      color: 'var(--ls-fg-primary)',
    };

    return (
      <div
        ref={ref}
        data-ls-dock-wrapper=""
        className={cn('flex flex-col items-center', className)}
        style={wrapperStyle}
        {...rest}
      >
        <div
          data-ls-dock=""
          role="toolbar"
          aria-label="Application dock"
          className="flex items-center gap-2 px-3 py-2"
          style={dockStyle}
        >
          {children}
        </div>
        {reflection && (
          <div
            data-ls-dock-reflection=""
            aria-hidden
            className="mt-1 h-2 w-3/4 rounded-full opacity-40 blur-md"
            style={{
              background:
                'linear-gradient(180deg, rgba(184,147,82,0.35) 0%, rgba(184,147,82,0) 100%)',
            }}
          />
        )}
      </div>
    );
  },
);

export default GlassDock;
