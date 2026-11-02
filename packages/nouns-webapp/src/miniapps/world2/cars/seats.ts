// ── Seats: where riders sit in each car, and who gets which (pure) ─────────
//
// Seat 0 is the driver's; the rest are passengers'. `at` is in model space
// (+X = the car's left, +Z forward): for a seat it's where the rider's hips
// go (the top of the cushion in models.ts), for a standing spot (the
// STOMPA's bed) it's where their feet go. Riders show in open cars and on
// standing spots, scaled down (`RIDER_SCALE`, the Noun's head is big);
// closed cars hide them, like the van, and only their name tag rides along.
//
// Riding together (netcode, see netCar.ts for the wire):
//   the driver stays authoritative for the car (pose + `cr` as before);
//   a passenger sends `rd: [driverId, seat]` and asks for that seat;
//   the driver's client decides (`assignSeats`: first asker wins, a seat
//   holder keeps it while they keep asking) and publishes `ps`, the
//   passenger list by seat; everyone (the passenger included) places a
//   rider in a car only once the driver's `ps` says so, from the driver's
//   interpolated car pose. No worker change: both keys ride in the blob.

import type { CarId, CarSpec } from './specs';

export interface SeatSpot {
  at: readonly [number, number, number];
  /** Standing (feet at `at`), not sitting (hips at `at`). */
  stand?: boolean;
  /** Shown even in a closed car (out in the open: the STOMPA's bed). */
  outside?: boolean;
}

/** Rider scale in a car (the Noun's head is ~1.15 m wide at scale 1). */
export const RIDER_SCALE = 0.62;
/** Rest hip height of the rig above its origin at scale 1 (noun_character.glb; interiors/pose.ts). */
export const HIP_HEIGHT = 0.56;
/** Sitting sinks the hips this much into the cushion (scale 1). */
const SINK = 0.05;

const L = (x: number, y: number, z: number): SeatSpot => ({ at: [x, y, z] });

/**
 * Every car's seats, driver first. Heights are the cushion tops in
 * models.ts (procedural cars) or the cabin floor + a seat (Kenney bodies,
 * which are closed, so only the name tag's spot matters there).
 */
export const SEATS: Record<CarId, readonly SeatSpot[]> = {
  // Two buckets in the open tub (cushions 0.78–0.90, backrests at z −0.68)
  roadstar: [L(0.36, 0.9, -0.36), L(-0.36, 0.9, -0.36)],
  // One leather seat: a single-seater racer
  cavallino: [L(0, 1.0, -0.55)],
  toro: [L(0.38, 0.52, -0.15), L(-0.38, 0.52, -0.15)],
  // Two white benches (tops at 0.95): driver + three
  dip: [L(0.42, 0.95, -0.4), L(-0.42, 0.95, -0.4), L(0.45, 0.95, -1.22), L(-0.45, 0.95, -1.22)],
  // The cab, plus one standing in the bed holding the roll bar
  stompa: [
    L(0.42, 2.12, 0.15),
    L(-0.42, 2.12, 0.15),
    { at: [0, 2.1, -1.45], stand: true, outside: true },
  ],
  bubble: [L(0.2, 0.5, -0.15), L(-0.2, 0.5, -0.15)],
  kaido: [L(0.35, 0.62, -0.25), L(-0.35, 0.62, -0.25)],
  bruiser: [L(0.4, 0.7, -0.2), L(-0.4, 0.7, -0.2)],
  // NOUN CAB: driver, the front seat, and the back bench (fares ride in the back)
  cab: [L(0.4, 0.62, 0.1), L(-0.4, 0.62, 0.1), L(0.4, 0.62, -0.9), L(-0.4, 0.62, -0.9)],
};

export function seatsOf(id: CarId): readonly SeatSpot[] {
  return SEATS[id];
}

/** Passenger seats (everything but the driver's). */
export function passengerSeats(id: CarId): number {
  return Math.max(0, SEATS[id].length - 1);
}

/** Does a rider in this seat show (open car, or a spot out in the open)? */
export function riderShown(spec: Pick<CarSpec, 'id' | 'open'>, seat: number): boolean {
  const s = SEATS[spec.id][seat];
  if (s === undefined) return false;
  return spec.open || s.outside === true;
}

/**
 * Model-space position of the rider's origin (their feet / root) for a seat
 * at `scale`: a sitter's hips land on the cushion, a stander's feet on `at`.
 */
export function seatRoot(
  id: CarId,
  seat: number,
  scale = RIDER_SCALE,
): [number, number, number] | null {
  const s = SEATS[id][seat];
  if (s === undefined) return null;
  const [x, y, z] = s.at;
  return s.stand === true ? [x, y, z] : [x, y - (HIP_HEIGHT - SINK) * scale, z];
}

// ── Who sits where (the driver's client decides) ──

export interface SeatAsk {
  /** The asker's net id. */
  id: string;
  /** The seat they want (1.. = passenger seats). */
  seat: number;
  /** When the driver's client first saw them ask (ms; earlier wins). */
  since: number;
}

/**
 * The passenger list after this frame's asks: `crew[i]` holds seat i+1
 * ('' = empty). A holder keeps their seat while they keep asking for it;
 * anyone who stopped asking (got out, left, changed seat) frees it; free
 * seats go to the earliest asker. Asks for a taken seat, or a seat the car
 * doesn't have, are refused (the asker sees it in `ps` and gets out).
 */
export function assignSeats(
  id: CarId,
  crew: readonly string[],
  asks: readonly SeatAsk[],
): string[] {
  const n = passengerSeats(id);
  const want = new Map<string, SeatAsk>();
  for (const a of asks) {
    if (!Number.isInteger(a.seat) || a.seat < 1 || a.seat > n || a.id === '') continue;
    const prev = want.get(a.id);
    if (prev === undefined || a.since < prev.since) want.set(a.id, a);
  }
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const holder = crew[i] ?? '';
    out.push(holder !== '' && want.get(holder)?.seat === i + 1 ? holder : '');
  }
  const seated = new Set(out.filter(x => x !== ''));
  const queue = [...want.values()]
    .filter(a => !seated.has(a.id))
    .sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1));
  for (const a of queue) {
    if (out[a.seat - 1] !== '') continue;
    out[a.seat - 1] = a.id;
    seated.add(a.id);
  }
  return out;
}

/**
 * A passenger's pick when they press E: the first passenger seat that the
 * driver's list shows empty and nobody else is asking for, or null if full.
 */
export function freeSeat(
  id: CarId,
  crew: readonly string[],
  othersAsking: ReadonlySet<number> = new Set(),
): number | null {
  const n = passengerSeats(id);
  for (let s = 1; s <= n; s++) if ((crew[s - 1] ?? '') === '' && !othersAsking.has(s)) return s;
  return null;
}

export type RideCheck = 'riding' | 'pending' | 'refused' | 'gone';

/**
 * Where a passenger stands with the driver, from the driver's latest blob:
 * `gone` the driver left / isn't in a car any more; `refused` their list
 * gives our seat to someone else (or we waited too long); `pending` not
 * listed yet; `riding` listed in our seat.
 */
export function rideCheck(
  me: string,
  seat: number,
  driver: { inCar: boolean; crew: readonly string[] | null } | null,
  waited: number,
  patience = 3,
): RideCheck {
  if (driver === null || !driver.inCar || driver.crew === null) return 'gone';
  const holder = driver.crew[seat - 1];
  if (holder === undefined) return 'refused';
  if (holder === me) return 'riding';
  if (holder !== '' || waited > patience) return 'refused';
  return 'pending';
}
