import type { SVGProps } from 'react';

/**
 * Uniform props for every Liquid Sand monoline icon.
 *
 * - `size` sets both width + height. Defaults to "1em" so icons inherit the
 *   surrounding text size (`font-size`). Pass a number for px or a CSS length string.
 * - All other SVGProps pass through (className, style, onClick, aria-*, etc.).
 * - Color is controlled with CSS `color` because every stroke uses `currentColor`.
 *   This is what enables the parallel background-aware inversion work.
 */
export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
};
