// ── What other riders learn about your car (pure) ──────────────────────────
//
// While you drive, the pose blob carries `vh: 'car'` (pos / quat are the
// car's model origin and orientation, like the van's) plus `cr`, a short
// string: the car's id and a few flag bits, e.g. "toro.2" (doors up) or
// "roadstar.1" (flying). Older clients don't know 'car': they read it as no
// vehicle and ignore `cr` (they just see the rider). Anything malformed
// decodes to null and the rider shows as on foot.

import { isCarId, type CarId } from './specs';

export interface NetCar {
  id: CarId;
  /** Paint index (the car's `paints`). */
  paint: number;
  flying: boolean;
  doorsOpen: boolean;
  boosting: boolean;
}

const FLY = 1;
const DOORS = 2;
const BOOST = 4;
const RE = /^([a-z]{2,12})\.(\d{1,2})(?:\.(\d))?$/;

export function encodeCar(c: NetCar): string {
  const f = (c.flying ? FLY : 0) | (c.doorsOpen ? DOORS : 0) | (c.boosting ? BOOST : 0);
  return `${c.id}.${f}.${Math.max(0, Math.min(9, Math.round(c.paint)))}`;
}

export function decodeCar(v: unknown): NetCar | null {
  if (typeof v !== 'string' || v.length > 20) return null;
  const m = RE.exec(v);
  if (m === null || !isCarId(m[1])) return null;
  const f = Number(m[2]);
  if (f > 7) return null;
  return {
    id: m[1],
    paint: m[3] !== undefined ? Number(m[3]) : 0,
    flying: (f & FLY) !== 0,
    doorsOpen: (f & DOORS) !== 0,
    boosting: (f & BOOST) !== 0,
  };
}

// ── Riding together (see seats.ts) ──
//
// A passenger's blob carries `rd: [driverId, seat]`; the driver's carries
// `ps`, their passenger list by seat (`ps[i]` holds seat i+1, '' = empty),
// whenever they drive a car with passenger seats, so a client knows the
// driver can take passengers at all (older drivers never send it).

/** Net ids are the relay's connection ids. */
const NET_ID_RE = /^[\w-]{1,64}$/;
/** Passenger seats a blob may list (more than any car has: the DIP takes three). */
const MAX_CREW = 7;

export interface NetRide {
  driver: string;
  seat: number;
}

export function encodeRide(r: NetRide): [string, number] {
  return [r.driver, r.seat];
}

export function decodeRide(v: unknown): NetRide | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [driver, seat] = v as unknown[];
  if (typeof driver !== 'string' || !NET_ID_RE.test(driver)) return null;
  if (typeof seat !== 'number' || !Number.isInteger(seat) || seat < 1 || seat > MAX_CREW)
    return null;
  return { driver, seat };
}

export function encodeCrew(crew: readonly string[]): string[] {
  return crew.slice(0, MAX_CREW).map(x => (NET_ID_RE.test(x) ? x : ''));
}

/** A blob's `ps` → the passenger list (null when absent or malformed). */
export function decodeCrew(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_CREW) return null;
  const out: string[] = [];
  for (const x of v as unknown[]) {
    if (x === '' || x === 0 || x === null) out.push('');
    else if (typeof x === 'string' && NET_ID_RE.test(x)) out.push(x);
    else return null;
  }
  return out;
}

// ── The car you got out of (`lc`) ──
//
// Once you climb out, your blob carries `lc: ["toro.2", x, y, z, yaw]` (the
// car's id + paint, where it's parked, its heading) for as long as it stays
// parked where you left it, so other riders keep seeing it instead of it
// vanishing with your `cr`. Getting into any car drops it. Older clients
// ignore `lc`.

export interface NetParked {
  id: CarId;
  paint: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const PARKED_RE = /^([a-z]{2,12})\.(\d)$/;
/** Further out than any world coordinate (the Big Drop doesn't park cars). */
const MAX_COORD = 50_000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function encodeParked(p: NetParked): [string, number, number, number, number] {
  return [
    `${p.id}.${Math.max(0, Math.min(9, Math.round(p.paint)))}`,
    r2(p.x),
    r2(p.y),
    r2(p.z),
    r2(Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw))),
  ];
}

export function decodeParked(v: unknown): NetParked | null {
  if (!Array.isArray(v) || v.length !== 5) return null;
  const [k, x, y, z, yaw] = v as unknown[];
  if (typeof k !== 'string' || k.length > 15) return null;
  const m = PARKED_RE.exec(k);
  if (m === null || !isCarId(m[1])) return null;
  for (const n of [x, y, z, yaw])
    if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > MAX_COORD) return null;
  return {
    id: m[1],
    paint: Number(m[2]),
    x: x as number,
    y: y as number,
    z: z as number,
    yaw: yaw as number,
  };
}
