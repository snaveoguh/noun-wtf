import { forwardRef } from 'react';
import type { IconProps } from './types';

/** Clipboard — paste history / system clipboard app. */
export const Clipboard = forwardRef<SVGSVGElement, IconProps>(function Clipboard(
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
      <rect x="5" y="5" width="14" height="16" rx="2" />
      <path d="M9 5V4.25A1.25 1.25 0 0 1 10.25 3h3.5A1.25 1.25 0 0 1 15 4.25V5" />
      <path d="M8.5 11h7M8.5 14.5h7M8.5 18h4.5" />
    </svg>
  );
});
