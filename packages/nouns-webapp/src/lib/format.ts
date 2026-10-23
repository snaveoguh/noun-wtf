/**
 * Small display formatters shared across the webapp. Several call sites had
 * slightly different copies of these; the options below exist so each one
 * keeps its exact output — check them before changing a default.
 */
import { formatEther } from 'viem';

export interface ShortAddrOptions {
  /** Separator between the head and tail. Default `'...'`. */
  sep?: string;
  /**
   * Strings shorter than this are returned unchanged (empty/falsy input too).
   * Default 0: always shorten.
   */
  minLength?: number;
}

/** `0x1234...abcd` — first 6 chars, separator, last 4. */
export function shortAddr(
  addr: string,
  { sep = '...', minLength = 0 }: ShortAddrOptions = {},
): string {
  if (minLength > 0 && (!addr || addr.length < minLength)) return addr;
  return `${addr.slice(0, 6)}${sep}${addr.slice(-4)}`;
}

/** Wei → ETH string with a fixed number of decimals (`1.2345`), no unit. */
export function formatEth(wei: bigint, decimals = 4): string {
  return parseFloat(formatEther(wei)).toFixed(decimals);
}

export interface TimeAgoOptions {
  /** Show `Ns` under a minute (otherwise `0m`). Default true. */
  seconds?: boolean;
  /** Roll 30+ days over into `Nmo`. Default false (`45d`). */
  months?: boolean;
  /** Clamp future timestamps to `0s`/`0m`. Default true. */
  clamp?: boolean;
}

/**
 * Compact relative age: `12s` / `5m` / `3h` / `2d` (/ `4mo`).
 * A number is unix **seconds**; a string is anything `new Date()` parses.
 * Unparseable input returns `'?'`.
 */
export function timeAgo(
  timestamp: number | string,
  { seconds = true, months = false, clamp = true }: TimeAgoOptions = {},
): string {
  const then = typeof timestamp === 'number' ? timestamp * 1000 : new Date(timestamp).getTime();
  if (!Number.isFinite(then)) return '?';
  const diffMs = clamp ? Math.max(0, Date.now() - then) : Date.now() - then;

  const s = Math.floor(diffMs / 1000);
  if (seconds && s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (!months || d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}
