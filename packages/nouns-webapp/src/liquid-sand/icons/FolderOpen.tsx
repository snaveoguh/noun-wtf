import { forwardRef } from 'react';
import type { IconProps } from './types';

export const FolderOpen = forwardRef<SVGSVGElement, IconProps>(function FolderOpen(
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
      <path d="M3 7.25c0-1.1.9-2 2-2h3.5l2 2H19c1.1 0 2 .9 2 2v.5" />
      <path d="M3 9.75h17.25a1 1 0 0 1 .98 1.2l-1.3 6.5a2 2 0 0 1-1.96 1.6H4.96a2 2 0 0 1-1.96-1.6l-.96-4.8" />
    </svg>
  );
});
