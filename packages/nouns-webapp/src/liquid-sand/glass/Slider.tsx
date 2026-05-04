/**
 * Liquid Sand UI — <GlassSlider>
 *
 * Range slider with a glass thumb. Wraps a native <input type="range">
 * for accessibility and form compatibility, and overlays a glass track,
 * fill, and thumb on top via absolutely-positioned spans.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export interface GlassSliderProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'type' | 'onChange' | 'value' | 'defaultValue'
  > {
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  onValueChange?: (next: number) => void;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const GlassSlider = React.forwardRef<HTMLInputElement, GlassSliderProps>(
  function GlassSlider(
    {
      value: controlled,
      defaultValue,
      min = 0,
      max = 100,
      step = 1,
      onValueChange,
      onChange,
      disabled,
      className,
      style,
      ...rest
    },
    ref,
  ) {
    const isControlled = controlled !== undefined;
    const [internal, setInternal] = React.useState(
      defaultValue ?? min,
    );
    const value = isControlled ? controlled : internal;
    const pct =
      max === min ? 0 : ((value - min) / (max - min)) * 100;

    const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number(e.target.value);
      if (!isControlled) setInternal(next);
      onValueChange?.(next);
      onChange?.(e);
    };

    const trackStyle: React.CSSProperties = {
      backgroundColor: 'var(--ls-glass-light-strong)',
      backdropFilter: 'blur(var(--ls-blur-subtle)) saturate(var(--ls-saturate))',
      WebkitBackdropFilter:
        'blur(var(--ls-blur-subtle)) saturate(var(--ls-saturate))',
      borderRadius: 'var(--ls-r-full)',
      boxShadow:
        'inset 0 1px 2px rgba(60,45,25,0.12), 0 0 0 1px var(--ls-border-glass)',
    };

    const fillStyle: React.CSSProperties = {
      width: `${pct}%`,
      backgroundColor: 'var(--ls-accent)',
      borderRadius: 'var(--ls-r-full)',
      boxShadow: 'var(--ls-shadow-glow)',
      transition: 'width var(--ls-dur-fast) var(--ls-ease-soft)',
    };

    const thumbStyle: React.CSSProperties = {
      left: `calc(${pct}% - 9px)`,
      backgroundColor: 'var(--ls-glass-light-strong)',
      borderRadius: 'var(--ls-r-full)',
      boxShadow:
        'inset 0 1px 0 rgba(255,250,240,0.65), inset 0 -1px 0 rgba(60,45,25,0.10), 0 1px 3px rgba(60,45,25,0.20), 0 0 0 1px var(--ls-border-glass)',
      transition: 'left var(--ls-dur-fast) var(--ls-ease-soft)',
    };

    return (
      <div
        data-ls-slider=""
        data-disabled={disabled ? '' : undefined}
        className={cn(
          'relative w-full h-5 flex items-center',
          disabled && 'opacity-50',
          className,
        )}
        style={style}
      >
        {/* Track */}
        <div
          aria-hidden
          className="absolute left-0 right-0 h-1.5"
          style={trackStyle}
        />
        {/* Fill */}
        <div
          aria-hidden
          className="absolute left-0 h-1.5"
          style={fillStyle}
        />
        {/* Thumb (visual only) */}
        <div
          aria-hidden
          className="absolute h-[18px] w-[18px]"
          style={thumbStyle}
        />
        {/* Native input on top, transparent, drives interaction */}
        <input
          ref={ref}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={handle}
          className={cn(
            'relative w-full h-5 appearance-none bg-transparent cursor-pointer outline-none',
            'disabled:cursor-not-allowed',
            // Hide native thumb; the visual one above tracks the value.
            '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:opacity-0',
            '[&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:opacity-0 [&::-moz-range-thumb]:border-0',
          )}
          {...rest}
        />
      </div>
    );
  },
);

export default GlassSlider;
