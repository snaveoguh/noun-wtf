/**
 * Liquid Sand UI — <GlassWindow>
 *
 * Pure visual window chrome. Drag/resize logic stays with the consumer
 * (BerryShell etc.). Slots: titlebar, content, footer.
 *
 * Traffic-light orbs are rendered as small glass dots in muted sepia
 * — close (sepia red), min (sepia yellow), max (sepia green). They
 * fire onClose / onMinimize / onMaximize when supplied.
 *
 * Active state adds the warm sand glow ring.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export interface GlassWindowProps extends React.HTMLAttributes<HTMLDivElement> {
  titlebar?: React.ReactNode;
  footer?: React.ReactNode;
  active?: boolean;
  showTrafficLights?: boolean;
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  contentClassName?: string;
  titlebarClassName?: string;
  footerClassName?: string;
}

interface OrbProps {
  color: string;
  label: string;
  onClick?: () => void;
}

function TrafficOrb({ color, label, onClick }: OrbProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="ls-orb h-3 w-3 rounded-full outline-none transition-transform hover:scale-110 active:scale-95"
      style={{
        backgroundColor: color,
        boxShadow:
          'inset 0 1px 0 rgba(255, 250, 240, 0.45), inset 0 -1px 0 rgba(0,0,0,0.18), 0 0 0 1px var(--ls-border-glass)',
      }}
    />
  );
}

export const GlassWindow = React.forwardRef<HTMLDivElement, GlassWindowProps>(
  function GlassWindow(
    {
      titlebar,
      footer,
      active = true,
      showTrafficLights = true,
      onClose,
      onMinimize,
      onMaximize,
      className,
      style,
      children,
      contentClassName,
      titlebarClassName,
      footerClassName,
      ...rest
    },
    ref,
  ) {
    const baseShadow =
      'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass), var(--ls-shadow-lg)';
    const shellStyle: React.CSSProperties = {
      backgroundColor: 'var(--ls-glass-light)',
      backdropFilter:
        'blur(var(--ls-blur-heavy)) saturate(var(--ls-saturate))',
      WebkitBackdropFilter:
        'blur(var(--ls-blur-heavy)) saturate(var(--ls-saturate))',
      borderRadius: 'var(--ls-r-lg)',
      boxShadow: active
        ? `${baseShadow}, var(--ls-shadow-glow)`
        : baseShadow,
      color: 'var(--ls-fg-primary)',
      transition:
        'box-shadow var(--ls-dur-base) var(--ls-ease-soft), transform var(--ls-dur-base) var(--ls-ease-spring)',
      overflow: 'hidden',
      ...style,
    };

    const titlebarStyle: React.CSSProperties = {
      // Subtle gradient shimmer along the bar
      background:
        'linear-gradient(180deg, rgba(255,250,240,0.55) 0%, rgba(255,250,240,0.18) 100%)',
      borderBottom: '1px solid var(--ls-border-glass)',
    };

    const footerStyle: React.CSSProperties = {
      background:
        'linear-gradient(0deg, rgba(255,250,240,0.45) 0%, rgba(255,250,240,0.12) 100%)',
      borderTop: '1px solid var(--ls-border-glass)',
    };

    return (
      <div
        ref={ref}
        data-ls-window=""
        data-ls-active={active ? '' : undefined}
        className={cn('flex flex-col', className)}
        style={shellStyle}
        {...rest}
      >
        {(titlebar || showTrafficLights) && (
          <div
            data-ls-window-titlebar=""
            className={cn(
              'flex items-center gap-2 px-3 h-9 select-none',
              titlebarClassName,
            )}
            style={titlebarStyle}
          >
            {showTrafficLights && (
              <div className="flex items-center gap-1.5">
                <TrafficOrb color="#c2492f" label="Close" onClick={onClose} />
                <TrafficOrb
                  color="#d4b67a"
                  label="Minimize"
                  onClick={onMinimize}
                />
                <TrafficOrb
                  color="#7a8b3c"
                  label="Maximize"
                  onClick={onMaximize}
                />
              </div>
            )}
            {titlebar && (
              <div className="flex-1 min-w-0 text-xs font-medium text-center truncate">
                {titlebar}
              </div>
            )}
            {/* Spacer matching orb cluster width to keep title centered */}
            {showTrafficLights && titlebar && (
              <div className="w-[54px]" aria-hidden />
            )}
          </div>
        )}

        <div
          data-ls-window-content=""
          className={cn('flex-1 min-h-0 overflow-auto', contentClassName)}
        >
          {children}
        </div>

        {footer && (
          <div
            data-ls-window-footer=""
            className={cn(
              'flex items-center gap-2 px-3 h-7 text-xs',
              footerClassName,
            )}
            style={footerStyle}
          >
            {footer}
          </div>
        )}
      </div>
    );
  },
);

export default GlassWindow;
