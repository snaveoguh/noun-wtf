/**
 * Liquid Sand UI — <GlassToast>
 *
 * Notification toast. Slides in from the right of its anchor (default
 * top-right of viewport when `floating`). Dismissable via close button
 * if `onDismiss` is supplied. Accepts icon / title / body / action slots.
 *
 * The animation is implemented as a one-shot CSS keyframe injected
 * inline so the component remains zero-dependency.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export type GlassToastTone = 'neutral' | 'success' | 'danger' | 'accent';

export interface GlassToastProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: GlassToastTone;
  icon?: React.ReactNode;
  title?: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  onDismiss?: () => void;
  floating?: boolean;
  /** Auto-dismiss after N ms. Pass `null` or omit to disable. */
  autoDismissMs?: number | null;
}

const TONE_RING: Record<GlassToastTone, string> = {
  neutral: 'var(--ls-border-glass)',
  success: 'rgba(122,139,60,0.55)',
  danger: 'rgba(194,73,47,0.55)',
  accent: 'rgba(184,147,82,0.55)',
};

const KEYFRAMES_ID = 'ls-toast-keyframes';

function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = `
    @keyframes ls-toast-in {
      from { transform: translateX(120%); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

export const GlassToast = React.forwardRef<HTMLDivElement, GlassToastProps>(
  function GlassToast(
    {
      tone = 'neutral',
      icon,
      title,
      body,
      action,
      onDismiss,
      floating = false,
      autoDismissMs = null,
      className,
      style,
      children,
      ...rest
    },
    ref,
  ) {
    React.useEffect(() => {
      ensureKeyframes();
    }, []);

    React.useEffect(() => {
      if (!autoDismissMs || !onDismiss) return;
      const id = window.setTimeout(onDismiss, autoDismissMs);
      return () => window.clearTimeout(id);
    }, [autoDismissMs, onDismiss]);

    const toastStyle: React.CSSProperties = {
      backgroundColor: 'var(--ls-glass-light-strong)',
      backdropFilter:
        'blur(var(--ls-blur-heavy)) saturate(var(--ls-saturate))',
      WebkitBackdropFilter:
        'blur(var(--ls-blur-heavy)) saturate(var(--ls-saturate))',
      borderRadius: 'var(--ls-r-md)',
      boxShadow: `var(--ls-shadow-inset-glass), 0 0 0 1px ${TONE_RING[tone]}, var(--ls-shadow-lg)`,
      color: 'var(--ls-fg-primary)',
      animation: 'ls-toast-in var(--ls-dur-base) var(--ls-ease-spring) both',
      ...(floating && {
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 'var(--ls-z-toast)' as unknown as number,
      }),
      ...style,
    };

    return (
      <div
        ref={ref}
        role="status"
        aria-live="polite"
        data-ls-toast=""
        data-ls-tone={tone}
        className={cn(
          'flex items-start gap-3 px-3 py-2 min-w-[260px] max-w-[420px]',
          className,
        )}
        style={toastStyle}
        {...rest}
      >
        {icon && (
          <div
            className="flex-shrink-0 flex items-center justify-center w-7 h-7"
            data-ls-toast-icon=""
          >
            {icon}
          </div>
        )}
        <div className="flex-1 min-w-0" data-ls-toast-text="">
          {title && (
            <div className="text-sm font-medium leading-snug">{title}</div>
          )}
          {body && (
            <div className="text-xs leading-snug" style={{ color: 'var(--ls-fg-secondary)' }}>
              {body}
            </div>
          )}
          {children}
        </div>
        {action && (
          <div className="flex-shrink-0" data-ls-toast-action="">
            {action}
          </div>
        )}
        {onDismiss && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDismiss}
            className="flex-shrink-0 h-5 w-5 rounded-full text-xs leading-none opacity-60 hover:opacity-100 transition-opacity"
            style={{ color: 'var(--ls-fg-muted)' }}
          >
            x
          </button>
        )}
      </div>
    );
  },
);

export default GlassToast;
