/** Formatting helpers for the wallet profile — all tolerant of junk input. */
import type { Timestampish } from './types';

export function toDate(v: Timestampish): Date | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null;
    return new Date(v < 1e12 ? v * 1000 : v);
  }
  const n = Number(v);
  if (Number.isFinite(n) && /^\d+$/.test(v)) return new Date(n < 1e12 ? n * 1000 : n);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function relTime(v: Timestampish): string {
  const d = toDate(v);
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const s = Math.floor(abs / 1000);
  let out: string;
  if (s < 60) out = `${s}s`;
  else if (s < 3600) out = `${Math.floor(s / 60)}m`;
  else if (s < 86_400) out = `${Math.floor(s / 3600)}h`;
  else if (s < 86_400 * 30) out = `${Math.floor(s / 86_400)}d`;
  else if (s < 86_400 * 365) out = `${Math.floor(s / (86_400 * 30))}mo`;
  else out = `${(s / (86_400 * 365)).toFixed(1)}y`;
  return future ? `in ${out}` : `${out} ago`;
}

export function fmtDate(v: Timestampish): string {
  const d = toDate(v);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  if (typeof v === 'bigint') return Number(v);
  return fallback;
}

export function fmtInt(v: unknown): string {
  return num(v).toLocaleString();
}

export function fmtEth(v: unknown, digits = 2): string {
  const n = num(v);
  if (n === 0) return 'Ξ0';
  if (n < 0.01) return `Ξ${n.toFixed(4)}`;
  return `Ξ${n.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

export function fmtUsd(v: unknown): string {
  const n = num(v);
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function fmtPct(v: unknown): string {
  if (v == null) return '—';
  const n = num(v, Number.NaN);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(n >= 10 ? 0 : 1)}%`;
}

export function shortAddr(addr: string | null | undefined): string {
  if (!addr) return '???';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export const SUPPORT_LABEL: Record<number, string> = { 0: 'AGAINST', 1: 'FOR', 2: 'ABSTAIN' };

export function supportLabel(support: number | null | undefined): string {
  if (support == null) return '—';
  return SUPPORT_LABEL[support] ?? `#${support}`;
}

export function isAddr(v: string): boolean {
  return /^0x[\da-f]{40}$/i.test(v);
}

export function statusTone(status: string | null | undefined): 'pos' | 'neg' | 'mid' | 'muted' {
  const s = (status ?? '').toUpperCase();
  if (s === 'EXECUTED' || s === 'SUCCEEDED' || s === 'QUEUED' || s === 'PASSED') return 'pos';
  if (
    s === 'DEFEATED' ||
    s === 'VETOED' ||
    s === 'CANCELED' ||
    s === 'CANCELLED' ||
    s === 'EXPIRED'
  )
    return 'neg';
  if (s === 'ACTIVE' || s === 'PENDING' || s === 'UPDATABLE' || s === 'OBJECTION_PERIOD')
    return 'mid';
  return 'muted';
}
