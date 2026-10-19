// Small display helpers shared by the NOUN FM panels.

import type { FmSrc } from '../../../../../nouns-party/src/fmStation';

export function fmtDur(s: number): string {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export const KIND: Record<FmSrc['kind'], string> = {
  youtube: 'YouTube',
  audius: 'Audius',
  direct: 'file',
};

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
