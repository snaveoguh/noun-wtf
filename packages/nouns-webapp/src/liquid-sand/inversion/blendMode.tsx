/**
 * Liquid Sand UI — Approach 1: CSS-only inversion via mix-blend-mode.
 *
 * Cheapest, GPU-accelerated, zero JS. Works for icons / text rendered in
 * pure white or pure black: `difference` flips them against the background,
 * `luminosity` makes them readable over any colored surface.
 *
 * Tradeoffs:
 *  - Will visually invert ALL colors in the glyph (so multi-color icons get
 *    weird). Stick to monoline / single-color SVGs.
 *  - Requires the parent stack to allow blending. If a glass surface uses
 *    `isolation: isolate`, blend mode only affects layers inside that
 *    isolation context — which is usually what you want.
 *
 * Public surface:
 *  - `BLEND_CLASSES` — string class names you can hand to className= or
 *    pass to `clsx`.
 *  - `BlendIcon` — wrapper component. Accepts a `mode` ('difference' |
 *    'luminosity' | 'exclusion') and applies the inline style + class.
 */

import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

// ─── Blend modes we expose ──────────────────────────────────────────────────
export type BlendMode = 'difference' | 'luminosity' | 'exclusion';

// ─── Tailwind / arbitrary class strings ─────────────────────────────────────
//
// Tailwind v3+ ships `mix-blend-difference` etc. out of the box, so we just
// re-export the canonical names so consumers don't have to remember them.
// If the project uses a custom Tailwind plugin instead, swap these strings.
export const BLEND_CLASSES = {
  difference: 'mix-blend-difference',
  luminosity: 'mix-blend-luminosity',
  exclusion: 'mix-blend-exclusion',
} as const satisfies Record<BlendMode, string>;

// ─── Inline style helper (when class strings can't be used) ─────────────────
export function blendStyle(mode: BlendMode = 'difference'): CSSProperties {
  return { mixBlendMode: mode };
}

// ─── Optional Tailwind plugin (no-op since v3 already provides these) ──────
//
// Exported so a future custom build that drops Tailwind's defaults can still
// wire up the same class names. Returns the plugin definition object — wire
// it into `tailwind.config` under `plugins`. Kept tiny to avoid bringing the
// Tailwind types into the webapp's tsconfig.
export const tailwindPluginConfig = {
  name: 'liquid-sand-blend',
  utilities: {
    '.ls-blend-difference': { mixBlendMode: 'difference' },
    '.ls-blend-luminosity': { mixBlendMode: 'luminosity' },
    '.ls-blend-exclusion': { mixBlendMode: 'exclusion' },
  },
} as const;

// ─── <BlendIcon> wrapper ────────────────────────────────────────────────────

export type BlendIconProps = {
  /** Blend mode to apply. Defaults to `difference` (most aggressive flip). */
  mode?: BlendMode;
  /** Optional extra class names to merge with the blend utility. */
  className?: string;
  /** Optional inline style overrides. */
  style?: CSSProperties;
  /**
   * If `true`, applies the blend mode to the wrapper span; if `false`,
   * tries to clone the single child and apply blend mode + className
   * directly so no extra DOM node is added. Defaults to `false` (clone).
   */
  asWrapper?: boolean;
  children: ReactNode;
};

type ChildWithStyle = ReactElement<{
  className?: string;
  style?: CSSProperties;
}>;

/**
 * Wraps an icon (or any inline element) and forces a blend mode against
 * whatever sits behind it. Default behavior tries to clone the single child
 * to avoid an extra DOM node — pass `asWrapper` to force a `<span>`.
 */
export const BlendIcon = forwardRef<HTMLSpanElement, BlendIconProps>(
  function BlendIcon(
    { mode = 'difference', className, style, asWrapper = false, children },
    ref,
  ) {
    const blendCls = BLEND_CLASSES[mode];
    const mergedStyle: CSSProperties = { mixBlendMode: mode, ...style };

    if (!asWrapper) {
      // Try to clone the only child so we don't insert a wrapper element.
      const arr = Children.toArray(children).filter(isValidElement);
      if (arr.length === 1) {
        const only = arr[0] as ChildWithStyle;
        const childCls = only.props.className;
        const childStyle = only.props.style;
        return cloneElement(only, {
          className:
            [blendCls, className, childCls].filter(Boolean).join(' ') ||
            undefined,
          style: { ...childStyle, ...mergedStyle },
        });
      }
    }

    return (
      <span
        ref={ref as Ref<HTMLSpanElement>}
        className={[blendCls, className].filter(Boolean).join(' ') || undefined}
        style={mergedStyle}
      >
        {children}
      </span>
    );
  },
);
