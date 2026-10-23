// ============================================================
// Terminal — Claude AI chat for Nouns governance
// ============================================================

// Noun World's all-time stats (Netlify Blobs, via the webapp's world-stats
// function): top speed board plus every other record and play counts.
const WORLD_STATS_URL = 'https://noun.wtf/.netlify/functions/world-stats';

interface WorldStatsBody {
  riders?: number;
  sessions?: number;
  boards?: Record<string, { name: string; value: number; label?: string; at: number }[]>;
}

export async function fetchWorldStats(timeoutMs = 6000): Promise<WorldStatsBody> {
  const res = await fetch(WORLD_STATS_URL, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as WorldStatsBody;
}

/** Chat messages about the game: these get the live board up front. */
export const WORLD_QUESTION =
  /noun ?world|\bgame\b|skat|top ?speed|fastest|leaderboard|record|hang ?time|biggest air|\bjump|km\/?h|downhill|\bcomp(etition)?\b|\bbowl\b|noun jersey/i;

/**
 * The live Noun World board as a few lines of plain text. It goes at the very
 * top of the system prompt, so the answer never hinges on the model calling
 * world_fastest, or on a fallback model with a short context seeing the whole
 * prompt (the hub falls back to smaller models when a provider is out).
 */
export async function worldBrief(): Promise<string> {
  try {
    const st = await fetchWorldStats(2500);
    const line = (k: string, unit: string, digits: number) => {
      const seen = new Set<string>();
      const rows = (st.boards?.[k] ?? [])
        .filter(r => !seen.has(r.name.toLowerCase()) && seen.add(r.name.toLowerCase()))
        .slice(0, 5)
        .map((r, i) => `${i + 1}. ${r.name} ${r.value.toFixed(digits)}${unit}`);
      return rows.length > 0 ? rows.join(', ') : 'nobody yet';
    };
    return `NOUN WORLD — LIVE LEADERBOARD (fetched just now; answer game questions from this, never say you have no data):
Noun World is noun.wtf's multiplayer 3D skate game at noun.wtf/world.
- Top speed: ${line('kmh', ' km/h', 1)}
- Highest jump: ${line('airM', ' m', 1)}
- Longest hang time: ${line('airS', ' s', 2)}
- Furthest downhill: ${line('downM', ' m', 0)}
- Best combo: ${line('combo', ' pts', 0)}
- ${st.riders ?? 0} riders have played, ${st.sessions ?? 0} sessions.
Competition: fastest top speed by Sat 31 Oct (midnight UTC) wins $67; biggest air and longest hang time win $33 each; best graffiti tag is a judges' pick. Records only count with a physics-checked ride.`;
  } catch {
    return '';
  }
}
