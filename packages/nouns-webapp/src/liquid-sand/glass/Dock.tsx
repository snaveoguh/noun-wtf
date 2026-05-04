/**
 * Liquid Sand UI — <GlassDock>
 *
 * Floating bottom dock — a glass pill, centered horizontally, padded.
 * Children are dock items (the consumer renders apps / buttons).
 *
 * HIG (apple-hig platforms/macos.md):
 *  - Icons sit on a 44pt minimum touch target (accessibility rule
 *    applies even on desktop; SKILL.md "Key Numbers").
 *  - 4pt gap between icons (icons can sit close on a dock).
 *  - Pill padding 8pt around icons.
 *  - Modern Apple removed the dock reflection in Mojave — `reflection`
 *    defaults to `false`. A subtle drop shadow underneath is fine, and
 *    is provided by the inset-glass + lg drop in the box-shadow stack.
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
      // HIG: modern dock has no reflection (Mojave+). Default off.
      reflection = false,
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
      // HIG: dock corner radius — 20pt large container.
      // (apple-hig SKILL.md "Key Numbers")
      borderRadius: 'var(--ls-r-lg)',
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
          // HIG: 4pt gap between dock icons, 8pt pill padding around.
          className="flex items-center gap-1 px-2 py-2"
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
