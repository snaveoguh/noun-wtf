// ── Noun World fastest-of-all-time board ────────────────────────────────
//
// Stored by the world-fastest Netlify function (Netlify Blobs), one best
// per name. It used to ride the PartyKit room's leaderboard, which the
// deployed party server forgets whenever the room goes idle.

import type { SpeedEntry } from './Net';

const URL_ = '/.netlify/functions/world-fastest';
const RIDER_KEY = 'noun-world-rider-id';

/** Random id per browser: one board row per rider, whatever their name. */
function riderId(): string {
  try {
    let id = localStorage.getItem(RIDER_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(RIDER_KEY, id);
    }
    return id;
  } catch {
    return 'anon';
  }
}

function parse(body: unknown): SpeedEntry[] {
  const raw = (body as { entries?: unknown })?.entries;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(e => e as Record<string, unknown>)
    .map(e => ({
      name: String(e.name ?? 'anon').slice(0, 42),
      kmh: Number(e.kmh) || 0,
      downM: Number(e.downM) || 0,
      at: Number(e.at) || 0,
    }))
    .sort((a, b) => b.kmh - a.kmh);
}

export async function fetchFastest(): Promise<SpeedEntry[] | null> {
  try {
    const res = await fetch(URL_, { cache: 'no-store' });
    if (!res.ok) return null;
    return parse(await res.json());
  } catch {
    return null;
  }
}

/** Post a personal best; resolves to the updated board (null if it failed). */
export async function postFastest(
  name: string,
  kmh: number,
  downM: number,
): Promise<SpeedEntry[] | null> {
  try {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rider: riderId(),
        name,
        kmh: Math.round(kmh * 10) / 10,
        downM: Math.round(downM),
      }),
    });
    if (!res.ok) return null;
    return parse(await res.json());
  } catch {
    return null;
  }
}
