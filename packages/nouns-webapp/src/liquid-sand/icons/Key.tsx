import { forwardRef } from 'react';
import type { IconProps } from './types';

/** Key — permissions / auth. */
export const Key = forwardRef<SVGSVGElement, IconProps>(function Key(
  { size = '1em', ...props },
  ref,
) {
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="7" cy="14" r="3.75" />
      <path d="m9.65 11.35 9.6-9.6" />
      <path d="m17.5 3.5 2 2" />
      <path d="m14.75 6.25 2 2" />
    </svg>
  );
});
