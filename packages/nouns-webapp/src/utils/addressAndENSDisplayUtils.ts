import { Address } from '@/utils/types';

/**
 * Strip the `.noggles` suffix from an ENS-style name. The user does not want
 * the `.noggles` namespace surfaced anywhere in the UI — `vitalik.noggles`
 * should render as `vitalik`. Real `.eth` (and any other) names are returned
 * unchanged. Case-insensitive on the suffix in case anything ever comes
 * through capitalized.
 */
export const stripNoggles = (name: string | null | undefined): string => {
  if (!name) return '';
  return name.replace(/\.noggles$/i, '');
};

export const veryShortENS = (ens: string) => {
  const stripped = stripNoggles(ens);
  return [stripped.substring(0, 1), stripped.substring(stripped.length - 3)].join('...');
};

export const veryShortAddress = (address?: Address) => {
  if (!address) return '';
  return [address.substring(0, 3), address.substring(address.length - 1)].join('...');
};

export const shortENS = (ens: string) => {
  const stripped = stripNoggles(ens);
  if (stripped.length < 15 || window.innerWidth > 480) {
    return stripped;
  }
  return [stripped.substring(0, 4), stripped.substring(stripped.length - 8)].join('...');
};

export const formatShortAddress = (address?: Address) => {
  if (!address) return '';
  return [address.substring(0, 4), address.substring(38)].join('...');
};
