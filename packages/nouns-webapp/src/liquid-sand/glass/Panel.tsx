/**
 * Liquid Sand UI — <GlassPanel>
 *
 * The base frosted-glass primitive. Every other glass component composes
 * around this idea: a backdrop-filter blur over a translucent surface,
 * with a subtle inner highlight that gives glass its 3D pop, plus a
 * hairline border tint.
 *
 * Tone behavior:
 *  - 'light' / 'dark' force the surface tint
 *  - 'auto' uses prefers-color-scheme via a CSS-variable fallback chain
 *    (defaults to LIGHT glass; switches to DARK glass on dark color
 *    scheme via a media query rule emitted in tokens.css). Until that
 *    rule lands, 'auto' resolves identically to 'light'.
 */

import * as React from 'react';

import { cn } from '@/lib/utils';

export type GlassBlur = 'subtle' | 'medium' | 'heavy' | 'extreme';
export type GlassTone = 'light' | 'dark' | 'auto';
export type GlassRadius = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface GlassPanelProps extends React.HTMLAttributes<HTMLElement> {
  blur?: GlassBlur;
  tone?: GlassTone;
  padded?: boolean;
  radius?: GlassRadius;
  bordered?: boolean;
  glow?: boolean;
  as?: React.ElementType;
  className?: string;
  children?: React.ReactNode;
}

const BLUR_VAR: Record<GlassBlur, string> = {
  subtle: 'var(--ls-blur-subtle)',
  medium: 'var(--ls-blur-medium)',
  heavy: 'var(--ls-blur-heavy)',
  extreme: 'var(--ls-blur-extreme)',
};

const RADIUS_VAR: Record<GlassRadius, string> = {
  sm: 'var(--ls-r-sm)',
  md: 'var(--ls-r-md)',
  lg: 'var(--ls-r-lg)',
  xl: 'var(--ls-r-xl)',
  full: 'var(--ls-r-full)',
};

const TONE_BG: Record<GlassTone, string> = {
  light: 'var(--ls-glass-light)',
  dark: 'var(--ls-glass-dark)',
  // Auto resolves through the cascading CSS var; tokens.css can swap
  // --ls-glass-auto under @media (prefers-color-scheme: dark).
  auto: 'var(--ls-glass-auto, var(--ls-glass-light))',
};

const TONE_FG: Record<GlassTone, string> = {
  light: 'var(--ls-fg-primary)',
  dark: 'var(--ls-fg-on-dark)',
  auto: 'var(--ls-fg-auto, var(--ls-fg-primary))',
};

/**
 * Build the layered box-shadow string. The inset glass highlight is
 * always present (it's what makes "glass" read as glass); soft drop
 * shadow + optional warm sand glow stack on top.
 */
function buildShadow(opts: { glow: boolean; bordered: boolean }): string {
  const layers: string[] = ['var(--ls-shadow-inset-glass)'];
  if (opts.bordered) {
    // Outline ring keeps the hairline visible even when bg is fully blurred.
    layers.push('0 0 0 1px var(--ls-border-glass)');
  }
  layers.push('var(--ls-shadow-md)');
  if (opts.glow) layers.push('var(--ls-shadow-glow)');
  return layers.join(', ');
}

export const GlassPanel = React.forwardRef<HTMLElement, GlassPanelProps>(
  function GlassPanel(
    {
      blur = 'medium',
      tone = 'auto',
      padded = false,
      radius = 'md',
      bordered = true,
      glow = false,
      as,
      className,
      style,
      children,
      ...rest
    },
    ref,
  ) {
    // Cast through `any` for JSX compatibility — `React.ElementType` is
    // a union that contains void-children intrinsics (img, hr, etc.) so
    // TS narrows children to `never` without this. Consumers picking a
    // void element with children gets handled at runtime by React.
    const Comp = (as ?? 'div') as React.ElementType;
    const Rendered = Comp as React.ComponentType<
      React.HTMLAttributes<HTMLElement> & {
        ref?: React.Ref<HTMLElement>;
        style?: React.CSSProperties;
      }
    >;
    const filter = `blur(${BLUR_VAR[blur]}) saturate(var(--ls-saturate))`;

    const glassStyle: React.CSSProperties = {
      backgroundColor: TONE_BG[tone],
      color: TONE_FG[tone],
      backdropFilter: filter,
      WebkitBackdropFilter: filter,
      borderRadius: RADIUS_VAR[radius],
      boxShadow: buildShadow({ glow, bordered }),
      ...style,
    };

    return (
      <Rendered
        ref={ref}
        data-ls-glass=""
        data-ls-tone={tone}
        data-ls-blur={blur}
        className={cn('relative', padded && 'p-4', className)}
        style={glassStyle}
        {...rest}
      >
        {children}
      </Rendered>
    );
  },
);

export default GlassPanel;
