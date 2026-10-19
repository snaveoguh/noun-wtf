// ── NOUN FM: the shared set library (client) ─────────────────────────────
//
// Every DJ set a rider shares lands in a public library (the
// `world-fm-library` Netlify function, Netlify Blobs) that anyone in Noun
// World can browse and put on air: PLAY NOW books the set on the station
// (the ordinary `fm:set` booking, under the player's own key) at the next
// free slot, crediting the DJ who made it. The station rules still apply:
// one set per rider, no overlaps.

import {
  cleanName,
  FM_SET_AHEAD_MS,
  setEnd,
  srcKey,
  validTrack,
  type FmSet,
  type FmTrack,
} from '../../../../../nouns-party/src/fmStation';

export const LIBRARY_URL = '/.netlify/functions/world-fm-library';

export interface LibSet {
  id: string;
  dj: string;
  name: string;
  tracks: FmTrack[];
  /** Publisher's public tag (compare with NounFm.myTag). */
  by: string;
  /** Published (ms). */
  at: number;
  /** Last published / re-shared / played (ms, hour resolution). */
  lastAt: number;
  plays: number;
}

/** What makes two sets "the same set" (the server hashes this into the id). */
export function libSetKey(dj: string, name: string, tracks: FmTrack[]): string {
  return JSON.stringify([
    cleanName(dj, 20, 'DJ NOUN').toLowerCase(),
    cleanName(name, 32, 'untitled set').toLowerCase(),
    tracks.map(t => srcKey(t.src)),
  ]);
}

/** A library page from the wire, every set re-checked (bad ones dropped). */
export function parseLibrary(v: unknown): LibSet[] {
  const raw = (v as { sets?: unknown } | null)?.sets;
  if (!Array.isArray(raw)) return [];
  const out: LibSet[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const d = r as Record<string, unknown>;
    if (typeof d.id !== 'string' || typeof d.by !== 'string') continue;
    const tracks: FmTrack[] = [];
    for (const t of Array.isArray(d.tracks) ? d.tracks : []) {
      const x = validTrack(t);
      if (typeof x !== 'string') tracks.push(x);
    }
    if (tracks.length === 0) continue;
    out.push({
      id: d.id.slice(0, 40),
      dj: cleanName(d.dj, 20, 'DJ NOUN'),
      name: cleanName(d.name, 32, 'untitled set'),
      tracks,
      by: d.by.slice(0, 40),
      at: Number(d.at) || 0,
      lastAt: Number(d.lastAt) || Number(d.at) || 0,
      plays: Math.max(0, Math.floor(Number(d.plays) || 0)),
    });
  }
  return out;
}

/**
 * When a set of `len` ms can start: now if the station's free, else the
 * first gap after the booked sets it would overlap. `skip` is a set that
 * this booking replaces (your own upcoming one). Null past today's window.
 */
export function nextFreeSlot(
  sets: FmSet[],
  len: number,
  now: number,
  skip: string | null = null,
): number | null {
  const others = sets.filter(x => x.id !== skip);
  let t = Math.round(now);
  for (let guard = 0; guard <= others.length; guard++) {
    const clash = others.find(x => x.startAt < t + len && setEnd(x) > t);
    if (clash === undefined) return t <= now + FM_SET_AHEAD_MS ? t : null;
    t = setEnd(clash);
  }
  return null;
}

/**
 * The booking's DJ + set name when `player` puts someone else's set on: the
 * player's name is on the booking (it's their slot), the set's name carries
 * the original DJ's credit.
 */
export function creditFor(set: LibSet, player: string, own: boolean): { dj: string; name: string } {
  if (own) return { dj: set.dj, name: set.name };
  const credit = ` - ${set.dj}`;
  const name = `${set.name.slice(0, Math.max(4, 32 - credit.length)).trim()}${credit}`;
  return { dj: cleanName(player, 20, 'NOUN'), name: cleanName(name, 32, set.name) };
}

export type LibResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; reason: string };

async function call<T>(init: RequestInit & { query?: string }): Promise<LibResult<T>> {
  try {
    const res = await fetch(`${LIBRARY_URL}${init.query ?? ''}`, {
      ...init,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const b = (body ?? {}) as Record<string, unknown>;
    if (!res.ok || body === null)
      return {
        ok: false,
        reason:
          typeof b.error === 'string' ? b.error : `the library is unavailable (${res.status})`,
      };
    return { ok: true, ...(b as T) };
  } catch {
    return { ok: false, reason: "can't reach the library" };
  }
}

export async function fetchLibrary(): Promise<LibResult<{ sets: LibSet[]; total: number }>> {
  const r = await call<{ sets: unknown; total: number }>({ method: 'GET' });
  if (!r.ok) return r;
  const sets = parseLibrary(r);
  return { ok: true, sets, total: Math.max(sets.length, Number(r.total) || 0) };
}

export function publishSet(
  key: string,
  set: { dj: string; name: string; tracks: FmTrack[] },
): Promise<LibResult<{ id: string; dup: boolean }>> {
  return call({
    method: 'POST',
    body: JSON.stringify({ t: 'publish', key, dj: set.dj, name: set.name, tracks: set.tracks }),
  });
}

export function markPlayed(key: string, id: string): Promise<LibResult> {
  return call({ method: 'POST', body: JSON.stringify({ t: 'played', key, id }) });
}

export function deleteLibSet(key: string, id: string): Promise<LibResult> {
  return call({ method: 'POST', body: JSON.stringify({ t: 'delete', key, id }) });
}
