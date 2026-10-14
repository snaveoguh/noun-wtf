// ── Record appeals (client) ──
//
// A refused record can be appealed: the server checks the claim again with
// its ride (a claim that only lacked its proof goes straight on the board),
// otherwise files it for an admin to replay and decide. Riders see their
// appeals' status; the admin (WORLD_ADMIN_TOKEN) lists, replays, approves
// or rejects them. See netlify/lib/appeals.ts.

import { decodeTrace } from '../../../../netlify/lib/runProof';

import { riderId, type ProvedKey } from './Stats';

const URL_ = '/.netlify/functions/world-stats';

export type AppealStatus = 'pending' | 'approved' | 'rejected';

export interface AppealInfo {
  id: string;
  rider: string;
  name: string;
  key: ProvedKey;
  value: number;
  reason: string;
  at: number;
  status: AppealStatus;
  decidedAt?: number;
  note?: string;
  chars: number;
}

async function post<T>(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ ok: true; out: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const out = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, error: out.error ?? `Error ${res.status}` };
    return { ok: true, out };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

/** File an appeal: `d` is the ride (a trimmed proof), `reason` why it was refused. */
export async function fileAppeal(a: {
  name: string;
  key: ProvedKey;
  value: number;
  d: string;
  reason: string;
}): Promise<
  | { ok: true; saved: true }
  | { ok: true; saved: false; appeal: AppealInfo }
  | { ok: false; error: string }
> {
  const r = await post<{ saved?: boolean; appeal?: AppealInfo }>({
    action: 'appeal',
    rider: riderId(),
    ...a,
  });
  if (!r.ok) return r;
  if (r.out.saved === true) return { ok: true, saved: true };
  if (!r.out.appeal) return { ok: false, error: 'No answer' };
  return { ok: true, saved: false, appeal: r.out.appeal };
}

/** This rider's appeals, newest first. */
export async function myAppeals(): Promise<AppealInfo[]> {
  const r = await post<{ appeals?: AppealInfo[] }>({ action: 'appeals', rider: riderId() });
  return r.ok ? (r.out.appeals ?? []) : [];
}

/** Admin review (the token goes in a header, never in a URL). */
export const appealsAdmin = {
  async list(token: string) {
    const r = await post<{ appeals: AppealInfo[] }>(
      { action: 'admin-appeals' },
      { 'X-World-Admin': token },
    );
    return r.ok ? { ok: true as const, appeals: r.out.appeals } : r;
  },
  async trace(token: string, id: string) {
    const r = await post<{ d: string }>({ action: 'admin-appeal', id }, { 'X-World-Admin': token });
    if (!r.ok) return r;
    const s = decodeTrace(r.out.d);
    return s === null
      ? { ok: false as const, error: 'Unreadable trace' }
      : { ok: true as const, samples: s };
  },
  async decide(token: string, id: string, decision: 'approve' | 'reject', note: string) {
    const r = await post<{ appeal: AppealInfo }>(
      { action: 'admin-decide', id, decision, note },
      { 'X-World-Admin': token },
    );
    return r.ok ? { ok: true as const, appeal: r.out.appeal } : r;
  },
};
