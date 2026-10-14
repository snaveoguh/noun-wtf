// ── NOUN FM sync maths (pure) ───────────────────────────────────────────
//
// Everyone tuned in hears the same track at the same position: the server
// anchors each track to a start time on its clock, every client estimates
// its offset to that clock (NTP-style ping/pong, best round trip wins), and
// the players are nudged back onto the shared position as they drift.

export interface ClockSample {
  /** Client clock when the ping left / the pong came back (ms). */
  sent: number;
  received: number;
  /** Server clock in the pong (ms). */
  server: number;
}

/** Offset to add to the client clock to get server time, from one ping. */
export function sampleOffset(s: ClockSample): { offset: number; rtt: number } {
  const rtt = Math.max(0, s.received - s.sent);
  return { offset: s.server - (s.sent + rtt / 2), rtt };
}

/**
 * Keeps the last few pings and trusts the one with the shortest round trip
 * (least room for asymmetric delay). Before any ping, a server broadcast's
 * own timestamp gives a rough first guess.
 */
export class ClockSync {
  private samples: { offset: number; rtt: number }[] = [];
  private rough: number | null = null;

  add(s: ClockSample) {
    this.samples.push(sampleOffset(s));
    if (this.samples.length > 8) this.samples.shift();
  }

  /** A server timestamp seen on a broadcast (latency unknown). */
  hint(server: number, received: number) {
    if (this.rough === null) this.rough = server - received;
  }

  get synced(): boolean {
    return this.samples.length > 0;
  }

  get offset(): number {
    if (this.samples.length === 0) return this.rough ?? 0;
    let best = this.samples[0]!;
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    return best.offset;
  }

  /** Server time now, from a client clock reading. */
  serverNow(clientNow: number): number {
    return clientNow + this.offset;
  }
}

/** Where the track should be (seconds), at server time `now`. */
export function expectedPosition(startAt: number, now: number): number {
  return (now - startAt) / 1000;
}

export interface DriftFix {
  /** Jump straight to this position (s). */
  seek: number | null;
  /** Playback rate to settle on (1 = in sync). */
  rate: number;
}

/**
 * Audio element drift correction: small drift is pulled in by playing a few
 * percent fast or slow (inaudible), big drift (a stall, a late join) seeks.
 * `actual - expected` > 0 means we're ahead.
 */
export function audioDriftFix(expected: number, actual: number): DriftFix {
  const d = actual - expected;
  if (Math.abs(d) > 1.2) return { seek: Math.max(0, expected), rate: 1 };
  if (Math.abs(d) < 0.06) return { seek: null, rate: 1 };
  const r = 1 - Math.max(-0.05, Math.min(0.05, d * 0.25));
  return { seek: null, rate: r };
}

/**
 * The YouTube player only has coarse playback rates, so it seeks, and only
 * for a big drift, at most every few seconds, and only while the video
 * itself is playing (never during an ad or a buffer: YouTube owns those).
 */
export function youTubeDriftFix(
  expected: number,
  actual: number,
  sinceLastSeek: number,
  playing: boolean,
): number | null {
  if (!playing || sinceLastSeek < 8) return null;
  return Math.abs(actual - expected) > 3 ? Math.max(0, expected) : null;
}
