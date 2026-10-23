import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatEth, shortAddr, timeAgo } from './format';

const ADDR = '0x1234567890abcdef1234567890abcdef1234abcd';

describe('shortAddr', () => {
  it('default: 6 + "..." + 4, always shortens (DreamsBanner, Settlers, GasLeaderboard, BorgDetailPopover, Hackathon)', () => {
    expect(shortAddr(ADDR)).toBe('0x1234...abcd');
    // the old helpers had no length guard, so junk input is still sliced
    expect(shortAddr('0xabc')).toBe('0xabc...xabc');
    expect(shortAddr('')).toBe('...');
  });

  it('minLength 10 leaves short input alone (V2ExploreTab, BitnounsTab, YellowCollectiveVotePage)', () => {
    expect(shortAddr(ADDR, { minLength: 10 })).toBe('0x1234...abcd');
    expect(shortAddr('0x12345', { minLength: 10 })).toBe('0x12345');
    expect(shortAddr('', { minLength: 10 })).toBe('');
  });

  it('ellipsis separator (DerivativeAuction)', () => {
    expect(shortAddr(ADDR, { sep: '…' })).toBe('0x1234…abcd');
  });

  it('ellipsis + minLength 13 matches the old `length <= 12` guard (OnchainFeed AddressTag, WalletProfile)', () => {
    expect(shortAddr(ADDR, { sep: '…', minLength: 13 })).toBe('0x1234…abcd');
    expect(shortAddr('0x1234567890', { sep: '…', minLength: 13 })).toBe('0x1234567890');
    expect(shortAddr('0x12345678901', { sep: '…', minLength: 13 })).toBe('0x1234…8901');
  });

  it('two-dot separator + minLength 10 (TerminalFeed eventRegistry)', () => {
    expect(shortAddr(ADDR, { sep: '..', minLength: 10 })).toBe('0x1234..abcd');
    expect(shortAddr('vitalik', { sep: '..', minLength: 10 })).toBe('vitalik');
  });
});

describe('formatEth', () => {
  it('defaults to 4 decimals', () => {
    expect(formatEth(1_234_567_890_000_000_000n)).toBe('1.2346');
    expect(formatEth(0n)).toBe('0.0000');
  });

  it('takes a decimals argument', () => {
    expect(formatEth(1_234_567_890_000_000_000n, 2)).toBe('1.23');
    expect(formatEth(1_234_567_890_000_000_000n, 5)).toBe('1.23457');
    expect(formatEth(10n ** 18n * 42n, 0)).toBe('42');
  });

  it('matches parseFloat(formatEther(x)).toFixed(n)', () => {
    expect(formatEth(123_456_789_012_345_678n, 6)).toBe('0.123457');
  });
});

describe('timeAgo', () => {
  const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
  const nowSec = NOW / 1000;
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('unix seconds input, default options (OnchainFeed)', () => {
    expect(timeAgo(nowSec - 5)).toBe('5s');
    expect(timeAgo(nowSec - 59)).toBe('59s');
    expect(timeAgo(nowSec - 60)).toBe('1m');
    expect(timeAgo(nowSec - 3599)).toBe('59m');
    expect(timeAgo(nowSec - 3600)).toBe('1h');
    expect(timeAgo(nowSec - 86_399)).toBe('23h');
    expect(timeAgo(nowSec - 86_400)).toBe('1d');
    expect(timeAgo(nowSec - 86_400 * 45)).toBe('45d');
    // future timestamps clamp to 0
    expect(timeAgo(nowSec + 30)).toBe('0s');
  });

  it('ISO string input with months (TerminalFeed ActivityEvent)', () => {
    expect(timeAgo(iso(42_000), { months: true })).toBe('42s');
    expect(timeAgo(iso(86_400_000 * 29), { months: true })).toBe('29d');
    expect(timeAgo(iso(86_400_000 * 30), { months: true })).toBe('1mo');
    expect(timeAgo(iso(86_400_000 * 95), { months: true })).toBe('3mo');
    expect(timeAgo(iso(-60_000), { months: true })).toBe('0s');
    expect(timeAgo('not a date', { months: true })).toBe('?');
  });

  it('minutes-first, unclamped (NocTicker, FeedPage)', () => {
    const opts = { seconds: false, clamp: false };
    expect(timeAgo(iso(30_000), opts)).toBe('0m');
    expect(timeAgo(iso(5 * 60_000), opts)).toBe('5m');
    expect(timeAgo(iso(3 * 3_600_000), opts)).toBe('3h');
    expect(timeAgo(iso(40 * 86_400_000), opts)).toBe('40d');
    // clock skew: a cast 30s in the future read "-1m" before and still does
    expect(timeAgo(iso(-30_000), opts)).toBe('-1m');
  });
});
