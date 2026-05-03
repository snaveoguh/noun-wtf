/**
 * Liquid Sand UI — `<AdaptiveColor>` wrapper for Approach 2.
 *
 * Wraps any subtree, samples the background luminance under itself, and
 * sets `data-bg-luminance="dark|light|mid"` on the wrapper element. Style
 * the inner content with attribute selectors:
 *
 *   [data-bg-luminance="dark"] .my-icon { color: var(--ls-fg-on-dark); }
 *   [data-bg-luminance="light"] .my-icon { color: var(--ls-fg-primary); }
 *
 * Optional `applyClassName` lets you pick a class to merge in instead.
 */

import { useRef, type CSSProperties, type ReactNode } from 'react';
import {
  useBackgroundLuminance,
  type LuminanceBucket,
  type UseBackgroundLuminanceOptions,
} from './sampleLuminance';

export type AdaptiveColorProps = {
  /**
   * The element type rendered around the children. Defaults to `<span>`
   * so `<AdaptiveColor>` is safe inside inline contexts. Pass `'div'` for
   * block layout.
   */
  as?: 'span' | 'div';
  className?: string;
  style?: CSSProperties;
  /** Forwarded to the underlying `useBackgroundLuminance` hook. */
  sampleOptions?: UseBackgroundLuminanceOptions;
  /**
   * Optional map of bucket → class name. The matching class is merged into
   * `className` so consumers can keep all styling in Tailwind/CSS files
   * rather than relying on the `[data-bg-luminance]` attribute selector.
   */
  classByBucket?: Partial<Record<LuminanceBucket, string>>;
  /**
   * Optional callback fired with the latest sample. Useful for animations
   * (e.g. lerp opacity based on numeric luminance).
   */
  onSample?: (bucket: LuminanceBucket, value: number) => void;
  children: ReactNode;
};

export function AdaptiveColor({
  as = 'span',
  className,
  style,
  sampleOptions,
  classByBucket,
  onSample,
  children,
}: AdaptiveColorProps) {
  const ref = useRef<HTMLElement | null>(null);
  const sample = useBackgroundLuminance(ref, sampleOptions ?? {});

  if (onSample) {
    // Don't put this in an effect — it runs every render but the value
    // is memoized by the hook so it only changes when bucket/value flip.
    onSample(sample.bucket, sample.value);
  }

  const bucketClass = classByBucket?.[sample.bucket];
  const merged = [className, bucketClass].filter(Boolean).join(' ') || undefined;

  const sharedProps = {
    ref: ref as React.Ref<HTMLElement>,
    className: merged,
    style,
    'data-bg-luminance': sample.bucket,
    'data-bg-luminance-value': sample.value.toFixed(3),
  } as const;

  if (as === 'div') {
    return (
      <div
        {...(sharedProps as unknown as React.HTMLAttributes<HTMLDivElement> & {
          ref: React.Ref<HTMLDivElement>;
        })}
      >
        {children}
      </div>
    );
  }
  return (
    <span
      {...(sharedProps as unknown as React.HTMLAttributes<HTMLSpanElement> & {
        ref: React.Ref<HTMLSpanElement>;
      })}
    >
      {children}
    </span>
  );
}
