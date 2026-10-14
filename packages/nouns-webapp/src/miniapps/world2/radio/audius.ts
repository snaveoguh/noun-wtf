// ── Audius: public API, ad-free streams ─────────────────────────────────
//
// A pasted audius.co track link is resolved through Audius' public API:
// discover a host from api.audius.co, `/v1/resolve` the permalink to the
// track (id, title, artist, duration), then play `/v1/tracks/{id}/stream`
// in an <audio> element. Every request carries our app_name.

export const AUDIUS_APP = 'NOUNWTF';
const DISCOVERY = 'https://api.audius.co';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

let hostP: Promise<string> | null = null;

/** For tests: forget the discovered host. */
export function resetAudiusHost() {
  hostP = null;
}

/** A discovery host (cached for the session). */
export function audiusHost(f: Fetch = fetch): Promise<string> {
  if (hostP !== null) return hostP;
  const p = (async () => {
    const r = await f(DISCOVERY);
    if (!r.ok) throw new Error('Audius is unreachable');
    const j = (await r.json()) as { data?: unknown };
    const hosts = (Array.isArray(j.data) ? j.data : []).filter(
      (h): h is string => typeof h === 'string' && /^https:\/\/[\d.a-z-]+(:\d+)?\/?$/i.test(h),
    );
    if (hosts.length === 0) throw new Error('Audius is unreachable');
    return hosts[Math.floor(Math.random() * hosts.length)]!.replace(/\/$/, '');
  })();
  hostP = p;
  p.catch(() => {
    if (hostP === p) hostP = null;
  });
  return p;
}

export interface AudiusTrack {
  id: string;
  title: string;
  artist: string;
  dur: number;
}

/** Resolve an audius.co permalink to its track. */
export async function resolveAudius(permalink: string, f: Fetch = fetch): Promise<AudiusTrack> {
  const host = await audiusHost(f);
  const r = await f(
    `${host}/v1/resolve?url=${encodeURIComponent(permalink)}&app_name=${AUDIUS_APP}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!r.ok) throw new Error("couldn't find that track on Audius");
  const j = (await r.json()) as { data?: Record<string, unknown> };
  const d = j.data;
  if (d === undefined || typeof d.id !== 'string')
    throw new Error('that Audius link is not a track');
  if (d.is_streamable === false) throw new Error("that track isn't streamable");
  const user = (d.user ?? {}) as Record<string, unknown>;
  return {
    id: d.id,
    title: typeof d.title === 'string' ? d.title : 'untitled',
    artist: typeof user.name === 'string' ? user.name : String(user.handle ?? 'unknown'),
    dur: Number(d.duration) || 0,
  };
}

export function audiusStreamUrl(host: string, id: string): string {
  return `${host}/v1/tracks/${encodeURIComponent(id)}/stream?app_name=${AUDIUS_APP}`;
}
