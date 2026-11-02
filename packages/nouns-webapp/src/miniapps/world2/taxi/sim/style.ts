// ── NOUN TAXI: style tips (near misses, airs, drifts, combos; pure) ───────
//
// The passenger tips for a wild ride. Each stunt scores points; stunts
// within COMBO_S of the last one chain, and the chain multiplies them (×1
// … ×5). A crash breaks the chain and costs a slice of the tips so far.
// TaxiSystem feeds it from the car sim: airTime on landing, drift spells
// as they end, near misses from the traffic around, impacts.

export const STYLE = {
  /** Stunts closer than this (s) chain into a combo. */
  comboS: 3.5,
  maxMult: 5,
  /** Shortest air / drift that counts (s). */
  minAir: 0.6,
  minDrift: 0.8,
  /** Points: near miss, air (flat + per second), drift per second. */
  nearMiss: 2,
  airFlat: 2,
  airPerS: 3,
  driftPerS: 1.5,
  /** Impact (m/s into a wall) that counts as a crash, and what it costs. */
  crashImpact: 9,
  crashCost: 0.15,
  /** Near miss: closest pass (m, centre to centre), relative speed (m/s), per-thing cooldown (s). */
  missDist: 4.2,
  missSpeed: 12,
  missCool: 2.5,
} as const;

export type Stunt = 'near-miss' | 'air' | 'drift' | 'crash';

export interface StuntEvent {
  stunt: Stunt;
  /** Points added (negative for a crash). */
  points: number;
  mult: number;
  /** The label for the pop-up ("BIG AIR 2.1s ×3"). */
  label: string;
}

export class StyleMeter {
  tips = 0;
  chain = 0;
  bestChain = 0;
  longestAir = 0;
  private lastAt = -Infinity;

  constructor(private cap = Infinity) {}

  get mult(): number {
    return Math.max(1, Math.min(STYLE.maxMult, this.chain));
  }

  private score(stunt: Stunt, pts: number, now: number, label: string): StuntEvent {
    this.chain = now - this.lastAt <= STYLE.comboS ? this.chain + 1 : 1;
    this.lastAt = now;
    this.bestChain = Math.max(this.bestChain, this.chain);
    const mult = this.mult;
    const got = Math.min(Math.max(0, this.cap - this.tips), pts * mult);
    this.tips += got;
    return { stunt, points: got, mult, label: mult > 1 ? `${label} ×${mult}` : label };
  }

  nearMiss(now: number): StuntEvent {
    return this.score('near-miss', STYLE.nearMiss, now, 'NEAR MISS');
  }

  /** A landing after `s` seconds in the air (null if it was too short to count). */
  air(s: number, now: number): StuntEvent | null {
    if (s < STYLE.minAir) return null;
    this.longestAir = Math.max(this.longestAir, s);
    const pts = Math.round(STYLE.airFlat + STYLE.airPerS * s);
    return this.score(
      'air',
      pts,
      now,
      `${s >= 2 ? 'HUGE AIR' : s >= 1.2 ? 'BIG AIR' : 'AIR'} ${s.toFixed(1)}s`,
    );
  }

  /** A drift that lasted `s` seconds (null if too short). */
  drift(s: number, now: number): StuntEvent | null {
    if (s < STYLE.minDrift) return null;
    const pts = Math.max(1, Math.round(STYLE.driftPerS * s));
    return this.score('drift', pts, now, `${s >= 3 ? 'MEGA DRIFT' : 'DRIFT'} ${s.toFixed(1)}s`);
  }

  /** A hit at `impact` m/s (null under a crash). */
  crash(impact: number, now: number): StuntEvent | null {
    if (impact < STYLE.crashImpact) return null;
    this.chain = 0;
    this.lastAt = -Infinity;
    const lost = Math.floor(this.tips * STYLE.crashCost);
    this.tips -= lost;
    void now;
    return { stunt: 'crash', points: -lost, mult: 1, label: 'CRASH!' };
  }
}

export interface MissTarget {
  id: string;
  x: number;
  z: number;
  /** Their velocity (m/s), 0 for parked things and people standing. */
  vx: number;
  vz: number;
}

/**
 * Near misses this frame: things passing within STYLE.missDist of the car
 * at a relative speed over STYLE.missSpeed, with no crash this frame, each
 * thing at most once per STYLE.missCool. `cool` maps id → when it last
 * counted (s); it's updated in place.
 */
export function nearMisses(
  car: { x: number; z: number; vx: number; vz: number },
  things: readonly MissTarget[],
  crashed: boolean,
  now: number,
  cool: Map<string, number>,
): string[] {
  if (crashed) return [];
  const out: string[] = [];
  const r2 = STYLE.missDist * STYLE.missDist;
  for (const t of things) {
    const dx = t.x - car.x;
    const dz = t.z - car.z;
    if (dx * dx + dz * dz > r2) continue;
    const rv = Math.hypot(car.vx - t.vx, car.vz - t.vz);
    if (rv < STYLE.missSpeed) continue;
    const last = cool.get(t.id);
    if (last !== undefined && now - last < STYLE.missCool) continue;
    cool.set(t.id, now);
    out.push(t.id);
  }
  return out;
}
