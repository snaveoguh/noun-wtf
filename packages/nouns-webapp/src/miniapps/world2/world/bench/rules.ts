// ── Sitting on the mural bench: who can, where, when they stand (pure) ──
//
// Seat 0 is the pipe head's; riders take seat 1 (the middle) or 2 (the
// far end), whichever free one is nearest. On the wire a sat rider's pose
// blob carries `bn: [seat]` (optional; older clients ignore it and draw the
// rider standing where they sat down, in front of the bench). The bench
// is placed from the level's static collision, so it's in the same place
// on every client; a remote's seat is only honoured when their reported
// position is at that seat's stand spot (a client with an older level
// draws them standing instead of somewhere odd).

import { BENCH, type BenchSite, toWorld } from './place';

/** The pipe head's seat. */
export const PIPE_SEAT = 0;
/** Seats a rider can take. */
export const FREE_SEATS = [1, 2] as const;
/** Reach to sit (m, flat, from the seat's front edge). */
export const SIT_REACH = 1.6;
/** Too fast to sit (m/s). */
const SIT_SPEED = 2.5;
/** A remote's reported position must be this close to the seat's stand spot (m). */
const REMOTE_NEAR = 1.2;

export type BenchWire = [number];

export interface Spot {
  x: number;
  z: number;
  yaw: number;
}

/** Where a sitter's character root goes (on the seat, a touch back), facing the mural. */
export function seatSpot(site: BenchSite, seat: number): Spot {
  const w = toWorld(site, BENCH.seats[seat] ?? 0, -0.06);
  return { x: w.x, z: w.z, yaw: site.yaw };
}

/** Where a sitter stands, in front of their seat (sat: the player's own position). */
export function standSpot(site: BenchSite, seat: number): Spot {
  const w = toWorld(site, BENCH.seats[seat] ?? 0, BENCH.standZ);
  return { x: w.x, z: w.z, yaw: site.yaw };
}

export interface SitAsk {
  /** On foot, on the ground, nearly still, and nothing else owns the frame. */
  free: boolean;
  speed: number;
  x: number;
  z: number;
  /** Seats someone else is on. */
  taken: ReadonlySet<number>;
}

/** The seat to offer (nearest free one in reach), or null. */
export function offerSeat(site: BenchSite, a: SitAsk): number | null {
  if (!a.free || a.speed > SIT_SPEED) return null;
  let best: number | null = null;
  let bestD = SIT_REACH;
  for (const s of FREE_SEATS) {
    if (a.taken.has(s)) continue;
    // From the seat's front edge, so walking up from behind or the side works too
    const w = toWorld(site, BENCH.seats[s], 0.1);
    const d = Math.hypot(a.x - w.x, a.z - w.z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Inputs that stand you back up (a move, jump; E / Esc / the STAND button are the UI's). */
export function wantsStand(f: { moveX: number; moveY: number; jumpPressed: boolean }): boolean {
  return Math.hypot(f.moveX, f.moveY) > 0.35 || f.jumpPressed;
}

export function encodeBench(seat: number): BenchWire {
  return [seat];
}

/** A blob's `bn` → the seat (null: not sat, or malformed). */
export function decodeBench(v: unknown): number | null {
  if (!Array.isArray(v) || v.length < 1) return null;
  const s = v[0];
  return typeof s === 'number' && (FREE_SEATS as readonly number[]).includes(s) ? s : null;
}

/** A remote's seat, if their reported position backs it up. */
export function remoteSeat(
  site: BenchSite,
  seat: number | null | undefined,
  x: number,
  z: number,
): number | null {
  if (seat === null || seat === undefined) return null;
  const st = standSpot(site, seat);
  return Math.hypot(x - st.x, z - st.z) < REMOTE_NEAR ? seat : null;
}
