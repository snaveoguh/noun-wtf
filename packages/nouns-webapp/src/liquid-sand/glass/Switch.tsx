/**
 * Liquid Sand UI — <GlassSwitch>
 *
 * Toggle switch with a glass thumb that slides between off and on
 * positions. Controlled or uncontrolled. Always renders an underlying
 * checkbox so it works with native form submission and assistive tech.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export type GlassSwitchSize = 'sm' | 'md' | 'lg';

export interface GlassSwitchProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'size' | 'type' | 'onChange' | 'checked' | 'defaultChecked'
  > {
  size?: GlassSwitchSize;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (next: boolean) => void;
  /** Standard React change handler — also fires on toggle. */
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  label?: React.ReactNode;
}

interface SizeSpec {
  trackW: number;
  trackH: number;
  thumb: number;
  pad: number;
}

const SIZE_SPEC: Record<GlassSwitchSize, SizeSpec> = {
  sm: { trackW: 30, trackH: 18, thumb: 14, pad: 2 },
  md: { trackW: 38, trackH: 22, thumb: 18, pad: 2 },
  lg: { trackW: 48, trackH: 28, thumb: 22, pad: 3 },
};

export const GlassSwitch = React.forwardRef<HTMLInputElement, GlassSwitchProps>(
  function GlassSwitch(
    {
      size = 'md',
      checked: controlledChecked,
      defaultChecked,
      onCheckedChange,
      onChange,
      disabled,
      label,
      className,
      style,
      ...rest
    },
    ref,
  ) {
    const isControlled = controlledChecked !== undefined;
    const [internal, setInternal] = React.useState(defaultChecked ?? false);
    const checked = isControlled ? controlledChecked : internal;
    const spec = SIZE_SPEC[size];

    const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.checked;
      if (!isControlled) setInternal(next);
      onCheckedChange?.(next);
      onChange?.(e);
    };

    const trackStyle: React.CSSProperties = {
      width: spec.trackW,
      height: spec.trackH,
      backgroundColor: checked
        ? 'var(--ls-accent)'
        : 'var(--ls-glass-light-strong)',
      backdropFilter: 'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
      WebkitBackdropFilter:
        'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
      borderRadius: 'var(--ls-r-full)',
      boxShadow: checked
        ? 'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass), var(--ls-shadow-glow)'
        : 'inset 0 1px 2px rgba(60,45,25,0.12), 0 0 0 1px var(--ls-border-glass)',
      transition:
        'background-color var(--ls-dur-base) var(--ls-ease-soft), box-shadow var(--ls-dur-base) var(--ls-ease-soft)',
    };

    const thumbStyle: React.CSSProperties = {
      width: spec.thumb,
      height: spec.thumb,
      top: '50%',
      left: spec.pad,
      transform: `translateY(-50%) translateX(${
        checked ? spec.trackW - spec.thumb - spec.pad * 2 : 0
      }px)`,
      backgroundColor: 'var(--ls-glass-light-strong)',
      borderRadius: 'var(--ls-r-full)',
      boxShadow:
        'inset 0 1px 0 rgba(255,250,240,0.65), inset 0 -1px 0 rgba(60,45,25,0.10), 0 1px 3px rgba(60,45,25,0.18)',
      transition: 'transform var(--ls-dur-base) var(--ls-ease-spring)',
    };

    const control = (
      <span
        data-ls-switch=""
        data-checked={checked ? '' : undefined}
        className={cn('relative inline-block flex-shrink-0', className)}
        style={{ ...trackStyle, ...style }}
      >
        <input
          ref={ref}
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          disabled={disabled}
          onChange={handle}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          {...rest}
        />
        <span
          data-ls-switch-thumb=""
          aria-hidden
          className="absolute"
          style={thumbStyle}
        />
      </span>
    );

    if (!label) return control;

    return (
      <label
        className={cn(
          'inline-flex items-center gap-2 cursor-pointer select-none',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
        style={{ color: 'var(--ls-fg-primary)' }}
      >
        {control}
        <span className="text-sm">{label}</span>
      </label>
    );
  },
);

export default GlassSwitch;
