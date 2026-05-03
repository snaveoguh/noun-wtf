/**
 * Liquid Sand UI — <GlassInput>
 *
 * Text input on a glass surface. Subtle inner shadow gives the field a
 * feeling of depth as if pressed into the glass. Focus ring uses the
 * warm sand glow.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export type GlassInputSize = 'sm' | 'md' | 'lg';

export interface GlassInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'size' | 'prefix'
  > {
  inputSize?: GlassInputSize;
  invalid?: boolean;
  /** Render content inside the input pill (e.g. an icon). */
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  wrapperClassName?: string;
}

const SIZE_CLASS: Record<GlassInputSize, string> = {
  sm: 'h-8 text-xs px-2.5',
  md: 'h-9 text-sm px-3',
  lg: 'h-11 text-base px-4',
};

export const GlassInput = React.forwardRef<HTMLInputElement, GlassInputProps>(
  function GlassInput(
    {
      inputSize = 'md',
      invalid = false,
      prefix,
      suffix,
      wrapperClassName,
      className,
      style,
      type,
      disabled,
      ...rest
    },
    ref,
  ) {
    const wrapperStyle: React.CSSProperties = {
      backgroundColor: 'var(--ls-glass-light-strong)',
      backdropFilter:
        'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
      WebkitBackdropFilter:
        'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
      borderRadius: 'var(--ls-r-md)',
      // Pressed-into-glass inner shadow
      boxShadow: invalid
        ? 'inset 0 1px 2px rgba(60,45,25,0.18), 0 0 0 1px var(--ls-danger)'
        : 'inset 0 1px 2px rgba(60,45,25,0.10), 0 0 0 1px var(--ls-border-glass)',
      color: 'var(--ls-fg-primary)',
      transition: 'box-shadow var(--ls-dur-base) var(--ls-ease-soft)',
      opacity: disabled ? 0.5 : 1,
      ...style,
    };

    return (
      <div
        data-ls-input-wrapper=""
        data-invalid={invalid ? '' : undefined}
        className={cn(
          'inline-flex items-center w-full focus-within:[box-shadow:inset_0_1px_2px_rgba(60,45,25,0.10),0_0_0_2px_var(--ls-accent)]',
          wrapperClassName,
        )}
        style={wrapperStyle}
      >
        {prefix && (
          <span
            data-ls-input-prefix=""
            className="flex items-center pl-2 pr-1 text-xs"
            style={{ color: 'var(--ls-fg-muted)' }}
          >
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          type={type ?? 'text'}
          data-ls-input=""
          disabled={disabled}
          className={cn(
            'flex-1 min-w-0 bg-transparent border-0 outline-none placeholder:text-[var(--ls-fg-muted)]',
            'disabled:cursor-not-allowed',
            SIZE_CLASS[inputSize],
            prefix && 'pl-1',
            suffix && 'pr-1',
            className,
          )}
          {...rest}
        />
        {suffix && (
          <span
            data-ls-input-suffix=""
            className="flex items-center pr-2 pl-1 text-xs"
            style={{ color: 'var(--ls-fg-muted)' }}
          >
            {suffix}
          </span>
        )}
      </div>
    );
  },
);

export default GlassInput;
