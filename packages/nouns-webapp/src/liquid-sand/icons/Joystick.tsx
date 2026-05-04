import { forwardRef } from 'react';
import type { IconProps } from './types';

/** Game controller / joystick. */
export const Joystick = forwardRef<SVGSVGElement, IconProps>(function Joystick(
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
      <path d="M7 9.5h10a4.5 4.5 0 0 1 4.5 4.5v.5A3.5 3.5 0 0 1 18 18l-1.6-2.1a2 2 0 0 0-1.6-.8H9.2a2 2 0 0 0-1.6.8L6 18a3.5 3.5 0 0 1-3.5-3.5V14A4.5 4.5 0 0 1 7 9.5Z" />
      <path d="M8.5 13h2M9.5 12v2" />
      <circle cx="15" cy="13" r="0.6" />
      <circle cx="16.75" cy="13" r="0.6" />
    </svg>
  );
});
