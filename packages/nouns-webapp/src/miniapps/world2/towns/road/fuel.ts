// ── Fuel for cars (optional, off by default): the pure model ─────────────
//
// Off unless the player turns it on (`?fuel=1`, or localStorage
// `noun-world-fuel` = '1'): nothing about the cars changes otherwise. On,
// every car has a tank that drains with distance driven (faster boosting or
// flying) and refills at any gas station / truck stop pump, or Diesel
// Flats', while you sit still beside it holding E. Empty, a car limps along
// at a fraction of its throttle so you can still crawl to a pump.

export const FUEL = {
  /** Tank (litres) and burn (litres per km). ~30 km on a tank: the longest gap between pumps is ~10 km. */
  tank: 30,
  perKm: 1,
  /** Burn multiplier while boosting / flying. */
  boostMul: 2.2,
  /** Litres per second at the pump. */
  rate: 6,
  /** Throttle left on an empty tank. */
  limp: 0.2,
  /** Pump reach (m) and the speed under which you can fill (m/s). */
  reach: 7,
  stillSpeed: 2,
  /** Under this fraction the gauge goes red. */
  low: 0.15,
} as const;

export const FUEL_KEY = 'noun-world-fuel';

/** Is fuel on? `?fuel=1` / `?fuel=0` win; else the saved choice; default off. */
export function fuelEnabled(search: string, saved: string | null): boolean {
  const q = new URLSearchParams(search).get('fuel');
  if (q === '1' || q === 'on') return true;
  if (q === '0' || q === 'off') return false;
  return saved === '1';
}

/** Litres left after driving `metres` (boosting / flying burn more). */
export function burn(litres: number, metres: number, boosting: boolean): number {
  const use = (Math.max(0, metres) / 1000) * FUEL.perKm * (boosting ? FUEL.boostMul : 1);
  return Math.max(0, litres - use);
}

/** Throttle multiplier for the tank's state. */
export function throttleScale(litres: number): number {
  return litres > 0 ? 1 : FUEL.limp;
}

/** Litres after `dt` s at the pump. */
export function refuel(litres: number, dt: number): number {
  return Math.min(FUEL.tank, litres + FUEL.rate * Math.max(0, dt));
}

/** The nearest pump within reach of (x, z), or null. */
export function pumpNear(
  pumps: readonly { x: number; z: number }[],
  x: number,
  z: number,
): { x: number; z: number; d: number } | null {
  let best: { x: number; z: number; d: number } | null = null;
  for (const p of pumps) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d <= FUEL.reach && (best === null || d < best.d)) best = { x: p.x, z: p.z, d };
  }
  return best;
}
