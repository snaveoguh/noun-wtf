/**
 * Liquid Sand UI — <GlassModal>
 *
 * Overlay modal: semi-opaque sepia scrim behind, glass body in front.
 * Pure visual primitive — no portal, focus trap, or scroll lock built
 * in (consumer wraps in their own dialog if they need that).
 *
 * If `open` is false, renders nothing. Click on the scrim fires
 * `onScrimClick` (also fires on Escape if `closeOnEscape`).
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export type GlassModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface GlassModalProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onScrimClick?: () => void;
  closeOnEscape?: boolean;
  size?: GlassModalSize;
  /** Skip the built-in scrim (consumer is providing one). */
  noScrim?: boolean;
}

const SIZE_CLASS: Record<GlassModalSize, string> = {
  sm: 'max-w-sm w-full',
  md: 'max-w-md w-full',
  lg: 'max-w-2xl w-full',
  xl: 'max-w-4xl w-full',
  full: 'w-full h-full',
};

export const GlassModal = React.forwardRef<HTMLDivElement, GlassModalProps>(
  function GlassModal(
    {
      open,
      onScrimClick,
      closeOnEscape = true,
      size = 'md',
      noScrim = false,
      className,
      style,
      children,
      ...rest
    },
    ref,
  ) {
    React.useEffect(() => {
      if (!open || !closeOnEscape || !onScrimClick) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onScrimClick();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [open, closeOnEscape, onScrimClick]);

    if (!open) return null;

    const scrimStyle: React.CSSProperties = {
      position: 'fixed',
      inset: 0,
      // Warm sepia veil rather than neutral black for the Liquid Sand feel.
      backgroundColor: 'rgba(60, 45, 25, 0.32)',
      backdropFilter: 'blur(var(--ls-blur-subtle))',
      WebkitBackdropFilter: 'blur(var(--ls-blur-subtle))',
      zIndex: 'var(--ls-z-modal)' as unknown as number,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
    };

    const bodyStyle: React.CSSProperties = {
      backgroundColor: 'var(--ls-glass-light-strong)',
      backdropFilter:
        'blur(var(--ls-blur-extreme)) saturate(var(--ls-saturate))',
      WebkitBackdropFilter:
        'blur(var(--ls-blur-extreme)) saturate(var(--ls-saturate))',
      borderRadius: 'var(--ls-r-lg)',
      boxShadow:
        'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass), var(--ls-shadow-lg)',
      color: 'var(--ls-fg-primary)',
      ...style,
    };

    const body = (
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        data-ls-modal=""
        className={cn(SIZE_CLASS[size], 'p-5 outline-none', className)}
        style={bodyStyle}
        // Stop click propagation so clicking inside doesn't dismiss.
        onClick={(e) => e.stopPropagation()}
        {...rest}
      >
        {children}
      </div>
    );

    if (noScrim) return body;

    return (
      <div
        data-ls-modal-scrim=""
        style={scrimStyle}
        onClick={onScrimClick}
      >
        {body}
      </div>
    );
  },
);

export default GlassModal;
