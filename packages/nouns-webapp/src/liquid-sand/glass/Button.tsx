/**
 * Liquid Sand UI — <GlassButton>
 *
 * A glass-surfaced button. Composes the same blur+inset-highlight idea
 * as <GlassPanel> but inline so it can ship without the dependency.
 * Springy hover lift + depressed inset on :active.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export type GlassButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
export type GlassButtonSize = 'sm' | 'md' | 'lg';

export interface GlassButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: GlassButtonVariant;
  size?: GlassButtonSize;
}

const SIZE_CLASS: Record<GlassButtonSize, string> = {
  sm: 'px-3 py-1 text-xs gap-1.5 min-h-[28px]',
  md: 'px-4 py-1.5 text-sm gap-2 min-h-[34px]',
  lg: 'px-5 py-2 text-base gap-2 min-h-[42px]',
};

const VARIANT_BG: Record<GlassButtonVariant, string> = {
  default: 'var(--ls-glass-light-strong)',
  primary: 'var(--ls-accent)',
  ghost: 'transparent',
  danger: 'var(--ls-danger)',
};

const VARIANT_FG: Record<GlassButtonVariant, string> = {
  default: 'var(--ls-fg-primary)',
  primary: 'var(--ls-fg-on-dark)',
  ghost: 'var(--ls-fg-primary)',
  danger: 'var(--ls-fg-on-dark)',
};

export const GlassButton = React.forwardRef<HTMLButtonElement, GlassButtonProps>(
  function GlassButton(
    { variant = 'default', size = 'md', className, style, children, type, ...rest },
    ref,
  ) {
    const buttonStyle: React.CSSProperties = {
      backgroundColor: VARIANT_BG[variant],
      color: VARIANT_FG[variant],
      backdropFilter:
        variant === 'ghost' || variant === 'default'
          ? 'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))'
          : undefined,
      WebkitBackdropFilter:
        variant === 'ghost' || variant === 'default'
          ? 'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))'
          : undefined,
      borderRadius: 'var(--ls-r-md)',
      boxShadow:
        variant === 'ghost'
          ? 'none'
          : 'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass), var(--ls-shadow-sm)',
      transition: 'all var(--ls-dur-base) var(--ls-ease-spring)',
      ...style,
    };

    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        data-ls-glass-button=""
        data-ls-variant={variant}
        data-ls-size={size}
        className={cn(
          'ls-glass-button relative inline-flex items-center justify-center font-medium select-none',
          'cursor-pointer outline-none',
          'hover:scale-[1.02] hover:[box-shadow:var(--ls-shadow-inset-glass),0_0_0_1px_var(--ls-border-glass),var(--ls-shadow-md),var(--ls-shadow-glow)]',
          'active:scale-[0.98] active:[box-shadow:inset_0_2px_4px_rgba(60,45,25,0.18),0_0_0_1px_var(--ls-border-glass)]',
          'focus-visible:[box-shadow:var(--ls-shadow-inset-glass),0_0_0_2px_var(--ls-accent),var(--ls-shadow-glow)]',
          'disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed',
          SIZE_CLASS[size],
          className,
        )}
        style={buttonStyle}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

export default GlassButton;
