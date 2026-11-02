// ── NOUN TAXI: who's waiting, and where they want to go (pure) ────────────
//
// Fares wait at the kerb near the cab (city: on the ring road's outer kerb;
// a town: main street's edge) and wave. Each wants one destination from
// the registry, picked by where they are:
//   in the city   mostly a city hop (another door / spot 90–600 m away),
//                 sometimes a long haul down a line to a town or landmark;
//   in a town     back to the city, on to another town, or a local hop;
//   out wild      the nearest town either way.
// Everything is a pure function of a seeded random, so it's testable.

import type { Destination } from './destinations';

import { lanePoint, laneLength, type Lane } from '../../cars/lanes';

export interface FareSpec {
  id: string;
  /** Where they stand, and the yaw they face (the road). */
  x: number;
  z: number;
  yaw: number;
  dest: Destination;
  /** NounSeed parts for the character (background, body, accessory, head, glasses). */
  seed: [number, number, number, number, number];
  name: string;
}

export const FARES = {
  /** Fares waiting at once, and how near the cab a new one stands (m). */
  waiting: 3,
  nearMin: 40,
  nearMax: 170,
  /** City hops: shortest / longest straight-line distance (m). */
  hopMin: 90,
  hopMax: 600,
  /** Share of city fares that want a long haul. */
  longHaul: 0.3,
  /** A fare nobody picks up leaves after this (s), or past this from the cab (m). */
  patience: 120,
  goneDist: 320,
} as const;

/** The ring road's outer kerb (fares stand here, facing the road). */
export const KERB: Lane = { R: 68.6, r: 5, dir: 1 };

export type Rand = () => number;

export function mulberry(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  'DEE',
  'MO',
  'LIL',
  'BIG',
  'NOUN',
  'ZED',
  'KIKI',
  'TOAD',
  'BEANS',
  'GUS',
  'PIP',
  'ROX',
  'SKIP',
  'VEE',
  'OTTO',
  'NAN',
];

export function seedFrom(rand: Rand): [number, number, number, number, number] {
  return [
    Math.floor(rand() * 2),
    Math.floor(rand() * 30),
    Math.floor(rand() * 140),
    Math.floor(rand() * 240),
    Math.floor(rand() * 20),
  ];
}

export function nameFrom(rand: Rand): string {
  return FIRST[Math.floor(rand() * FIRST.length)]!;
}

const dist = (ax: number, az: number, b: { x: number; z: number }) =>
  Math.hypot(b.x - ax, b.z - az);

/** Weighted pick (weights ≥ 0); null on an empty / all-zero list. */
function pickW<T>(xs: readonly T[], w: (x: T) => number, rand: Rand): T | null {
  let sum = 0;
  for (const x of xs) sum += Math.max(0, w(x));
  if (sum <= 0) return null;
  let r = rand() * sum;
  for (const x of xs) {
    r -= Math.max(0, w(x));
    if (r <= 0) return x;
  }
  return xs[xs.length - 1] ?? null;
}

/**
 * Where a fare standing at (x, z) in `area` wants to go. `along` is their
 * along-track s when they're on a line (towns / wild), else null.
 */
export function pickDestination(
  x: number,
  z: number,
  area: string,
  along: { track: number; s: number } | null,
  all: readonly Destination[],
  rand: Rand,
): Destination | null {
  const city = all.filter(d => d.area === 'city');
  const far = all.filter(d => d.track !== null && d.s !== null);
  if (area === 'city') {
    const hops = city.filter(d => {
      const m = dist(x, z, d);
      return m >= FARES.hopMin && m <= FARES.hopMax;
    });
    if (hops.length > 0 && (rand() >= FARES.longHaul || far.length === 0))
      return hops[Math.floor(rand() * hops.length)]!;
    // A long haul: nearer towns more often (1 / km)
    return pickW(far, d => (d.kind === 'town' ? 1.5 : 1) / Math.max(1, (d.s ?? 0) / 1000), rand);
  }
  // In a town or out on a line: another place, the city often
  const others = far.filter(
    d => d.area !== area && Math.abs((d.s ?? 0) - (along?.s ?? -1e9)) > 300,
  );
  const r = rand();
  if ((r < 0.45 || others.length === 0) && city.length > 0)
    return city[Math.floor(rand() * city.length)]!;
  const same = along === null ? [] : others.filter(d => d.track === along.track);
  const pool = same.length > 0 && r < 0.85 ? same : others;
  return pickW(pool, d => 1 / Math.max(1, Math.hypot(d.x - x, d.z - z) / 1000), rand);
}

/** A kerbside spot on the ring road `ahead` m from the ring point nearest (x, z). */
export function kerbSpot(s: number): { x: number; z: number; yaw: number } {
  const p = { x: 0, z: 0, yaw: 0 };
  lanePoint(KERB, s, p);
  // Face the road: the kerb lane runs with the outer traffic (buildings on its right),
  // so the road is on its left
  return { x: p.x, z: p.z, yaw: p.yaw + Math.PI / 2 };
}

export function kerbLength(): number {
  return laneLength(KERB);
}
