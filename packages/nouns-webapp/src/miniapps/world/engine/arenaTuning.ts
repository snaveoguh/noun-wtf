// ── Arena Tuning — live-mutable knobs for sea-raid pacing ────────────
//
// Same idea as movementTuning.ts: ONE mutable object the arena reads at
// spawn/wave time, so the in-browser tuning panel can dial enemy pacing
// live. Spawn-distance / interval / wave-size / break changes land on the
// next spawn or wave; the speed & hp multipliers are baked into each
// monster as it surfaces (so they take effect on the next spawn, not on
// monsters already wading in).
//
// Distances are in tiles from the island centre. The island is radius 18
// + a 2-tile beach, so anything ≥ ~21 surfaces offshore in the water.

export interface ArenaTuning {
  spawnTilesMin: number; // nearest a monster can surface (tiles from centre)
  spawnTilesMax: number; // farthest a monster can surface
  spawnInterval: number; // frames between staggered spawns within a wave
  waveBase: number; // monsters in wave 1
  waveGrowth: number; // extra monsters per wave (× wave, floored)
  speedMul: number; // global monster move-speed multiplier
  hpMul: number; // global monster hp multiplier
  waveBreak: number; // frames of calm between cleared waves
}

const DEFAULT_ARENA: ArenaTuning = {
  spawnTilesMin: 22,
  spawnTilesMax: 25,
  spawnInterval: 60,
  waveBase: 2,
  waveGrowth: 1.5,
  speedMul: 1,
  hpMul: 1,
  waveBreak: 180,
};

/** The single live config the arena reads. Mutated by the tuning panel. */
export const ARENA_TUNING: ArenaTuning = { ...DEFAULT_ARENA };

/** Patch individual knobs live (from the tuning panel sliders). */
export function setArenaTuning(patch: Partial<ArenaTuning>): void {
  Object.assign(ARENA_TUNING, patch);
}

// ── Slider metadata for the tuning panel ────────────────────────────

export interface ArenaTuningField {
  key: keyof ArenaTuning;
  label: string;
  min: number;
  max: number;
  step: number;
  group: string;
}

export const ARENA_TUNING_FIELDS: ArenaTuningField[] = [
  { key: 'spawnTilesMin', label: 'Spawn near', min: 14, max: 28, step: 1, group: 'Arena' },
  { key: 'spawnTilesMax', label: 'Spawn far', min: 16, max: 32, step: 1, group: 'Arena' },
  { key: 'spawnInterval', label: 'Spawn gap', min: 15, max: 150, step: 5, group: 'Arena' },
  { key: 'waveBase', label: 'Wave 1 count', min: 1, max: 8, step: 1, group: 'Arena' },
  { key: 'waveGrowth', label: 'Wave growth', min: 0, max: 4, step: 0.5, group: 'Arena' },
  { key: 'speedMul', label: 'Monster speed', min: 0.3, max: 3, step: 0.1, group: 'Arena' },
  { key: 'hpMul', label: 'Monster HP', min: 0.5, max: 3, step: 0.1, group: 'Arena' },
  { key: 'waveBreak', label: 'Wave break', min: 30, max: 360, step: 30, group: 'Arena' },
];
