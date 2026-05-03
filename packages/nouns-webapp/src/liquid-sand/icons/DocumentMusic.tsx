import { forwardRef } from 'react';
import type { IconProps } from './types';

export const DocumentMusic = forwardRef<SVGSVGElement, IconProps>(function DocumentMusic(
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
      <path d="M6 3.5h7.5L19 9v10.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-14a2 2 0 0 1 2-2Z" />
      <path d="M13.25 3.5V8a1 1 0 0 0 1 1h4.5" />
      <path d="M9 18V12.5l5.5-1V17" />
      <ellipse cx="8" cy="18" rx="1.5" ry="1.25" />
      <ellipse cx="13.5" cy="17" rx="1.5" ry="1.25" />
    </svg>
  );
});
