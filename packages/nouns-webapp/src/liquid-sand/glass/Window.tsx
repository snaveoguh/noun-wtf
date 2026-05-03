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
  // HIG: traffic light dot diameter is 12pt, centers ~8pt apart. Default
  // state is dimmed/grey; symbol + saturated color reveal on hover.
  // (apple-hig platforms/macos.md, eras/mac-os-x-through-current.md)
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
    // HIG: inactive windows desaturate AND lose drop-shadow strength
    // (apple-hig eras/mac-os-x-through-current.md "Aqua window decorations").
    // We collapse to the medium drop shadow when inactive — keeps the
    // window visible but recedes it from focus.
    const inactiveShadow =
      'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass), var(--ls-shadow-md)';
    const activeShadow =
      'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass), var(--ls-shadow-lg), var(--ls-shadow-glow)';
    const shellStyle: React.CSSProperties = {
      backgroundColor: 'var(--ls-glass-light)',
      backdropFilter:
        'blur(var(--ls-blur-heavy)) saturate(var(--ls-saturate))',
      WebkitBackdropFilter:
        'blur(var(--ls-blur-heavy)) saturate(var(--ls-saturate))',
      // HIG: window corner radius — 20pt large container
      // (apple-hig SKILL.md "Key Numbers" + Big Sur+ rounded windows).
      borderRadius: 'var(--ls-r-lg)',
      boxShadow: active ? activeShadow : inactiveShadow,
      color: 'var(--ls-fg-primary)',
      // HIG: inactive windows desaturate. We tint the entire shell with
      // a saturate(0.6) filter so the content beneath the glass also
      // reads as "out of focus" when the window loses focus.
      filter: active ? undefined : 'saturate(0.65)',
      transition:
        'box-shadow var(--ls-dur-base) var(--ls-ease-soft), filter var(--ls-dur-base) var(--ls-ease-soft), transform var(--ls-dur-base) var(--ls-ease-spring)',
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
            // HIG: title bar height — 28pt for Big Sur+ chromeless windows
            // (apple-hig eras/mac-os-x-through-current.md). 8pt horizontal
            // padding (--ls-s-2). Title typography 13pt regular.
            className={cn(
              'flex items-center gap-2 px-2 h-7 select-none text-[13px] font-normal',
              titlebarClassName,
            )}
            style={titlebarStyle}
          >
            {showTrafficLights && (
              // HIG: traffic-light cluster — 12pt dots with 8pt center-to-
              // center spacing => 4pt gap between dots.
              // (apple-hig platforms/macos.md)
              <div className="flex items-center gap-1">
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
              <div className="flex-1 min-w-0 text-[13px] font-medium text-center truncate">
                {titlebar}
              </div>
            )}
            {/* Spacer matching orb cluster width (3*12 + 2*4 = 44px) so the
                centered title visually balances against the traffic lights. */}
            {showTrafficLights && titlebar && (
              <div className="w-[44px]" aria-hidden />
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
