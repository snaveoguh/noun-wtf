import { forwardRef } from 'react';
import type { IconProps } from './types';

/** Paintbrush — wallpaper / theme picker. */
export const Brush = forwardRef<SVGSVGElement, IconProps>(function Brush(
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
      <path d="M14 3.75 20.25 10 12 18.25H7.5L4 14.75Z" />
      <path d="M9.25 13 11 14.75" />
      <path d="M4.5 18.5c-.5 1.5-2 2-2 2s.5-1.5 2-2Z" />
    </svg>
  );
});
