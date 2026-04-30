import { Address } from '@/utils/types';

/**
 * The noggles namespace was rugged. Real reverse-resolution returns names
 * suffixed with the ASCII noggles glyph `.⌐◨-◨` (rare legacy entries may
 * use the literal `.noggles` token). We treat any name in this namespace as
 * if there were no ENS at all — callers should fall back to short address
 * (or noun-contract resolved name where applicable).
 */
const NOGGLES_SUFFIX = /\.(noggles|⌐◨-◨)$/i;

export const isNogglesName = (name?: string | null): boolean =>
  !!name && NOGGLES_SUFFIX.test(name);

/**
 * Returns an empty string for noggles-namespace names (so callers that already
 * coerce empty → fallback do the right thing automatically). Returns the name
 * unchanged for any other ENS / NNS result. The `.eth` namespace is unaffected.
 */
export const stripNoggles = (name: string | null | undefined): string => {
  if (!name) return '';
  if (isNogglesName(name)) return '';
  return name;
};

export const veryShortENS = (ens: string) => {
  const stripped = stripNoggles(ens);
  if (!stripped) return '';
  return [stripped.substring(0, 1), stripped.substring(stripped.length - 3)].join('...');
};

export const veryShortAddress = (address?: Address) => {
  if (!address) return '';
  return [address.substring(0, 3), address.substring(address.length - 1)].join('...');
};

export const shortENS = (ens: string) => {
  const stripped = stripNoggles(ens);
  if (!stripped) return '';
  if (stripped.length < 15 || window.innerWidth > 480) {
    return stripped;
  }
  return [stripped.substring(0, 4), stripped.substring(stripped.length - 8)].join('...');
};

export const formatShortAddress = (address?: Address) => {
  if (!address) return '';
  return [address.substring(0, 4), address.substring(38)].join('...');
};
