// ── Noun World all-time boards: fastest + best combo ────────────────────────────────────────────────────
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

// ── Best combo of all time ──────────────────────────────────────────────

export interface ComboEntry {
  name: string;
  points: number;
  /** The trick chain that scored it, e.g. "Kickflip + 50-50 + Manual". */
  label: string;
  at: number;
}

const COMBO_URL = '/.netlify/functions/world-combo';

function parseCombos(body: unknown): ComboEntry[] {
  const raw = (body as { entries?: unknown })?.entries;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(e => e as Record<string, unknown>)
    .map(e => ({
      name: String(e.name ?? 'anon').slice(0, 42),
      points: Number(e.points) || 0,
      label: String(e.label ?? ''),
      at: Number(e.at) || 0,
    }))
    .sort((a, b) => b.points - a.points);
}

export async function fetchCombos(): Promise<ComboEntry[] | null> {
  try {
    const res = await fetch(COMBO_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    return parseCombos(await res.json());
  } catch {
    return null;
  }
}

/** Post a personal-best combo; resolves to the updated board (null if it failed). */
export async function postCombo(
  name: string,
  points: number,
  label: string,
): Promise<ComboEntry[] | null> {
  try {
    const res = await fetch(COMBO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rider: riderId(),
        name,
        points: Math.round(points),
        label: label.slice(0, 200),
      }),
    });
    if (!res.ok) return null;
    return parseCombos(await res.json());
  } catch {
    return null;
  }
}
