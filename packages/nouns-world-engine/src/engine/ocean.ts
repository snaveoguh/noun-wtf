// ── Ocean Death Sequence — Gran Maja ─────────────────────────────────

export type OceanState = 'normal' | 'sinking' | 'blackout' | 'granmaja' | 'respawning';

export interface OceanDeathState {
  phase: OceanState;
  timer: number;
  waterFrames: number; // consecutive frames in water
}

const SINK_THRESHOLD = 30; // frames in water before sinking starts
const SINK_DURATION = 120;
const BLACKOUT_DURATION = 60;
const GRANMAJA_DURATION = 120;
const RESPAWN_FADE_DURATION = 60;

export function createOceanDeathState(): OceanDeathState {
  return { phase: 'normal', timer: 0, waterFrames: 0 };
}

export function tickOceanDeath(
  state: OceanDeathState,
  inWater: boolean,
): OceanDeathState {
  if (state.phase === 'normal') {
    if (inWater) {
      state.waterFrames++;
      if (state.waterFrames > SINK_THRESHOLD) {
        state.phase = 'sinking';
        state.timer = SINK_DURATION;
      }
    } else {
      state.waterFrames = Math.max(0, state.waterFrames - 2);
    }
    return state;
  }

  if (state.phase === 'sinking') {
    if (!inWater) {
      // Escaped! Cancel sinking
      state.phase = 'normal';
      state.timer = 0;
      state.waterFrames = 0;
      return state;
    }
    state.timer--;
    if (state.timer <= 0) {
      state.phase = 'blackout';
      state.timer = BLACKOUT_DURATION;
    }
    return state;
  }

  if (state.phase === 'blackout') {
    state.timer--;
    if (state.timer <= 0) {
      state.phase = 'granmaja';
      state.timer = GRANMAJA_DURATION;
    }
    return state;
  }

  if (state.phase === 'granmaja') {
    state.timer--;
    if (state.timer <= 0) {
      state.phase = 'respawning';
      state.timer = RESPAWN_FADE_DURATION;
    }
    return state;
  }

  if (state.phase === 'respawning') {
    state.timer--;
    if (state.timer <= 0) {
      state.phase = 'normal';
      state.waterFrames = 0;
    }
    return state;
  }

  return state;
}

/** Get overlay alpha for rendering */
export function getOceanOverlayAlpha(state: OceanDeathState): number {
  switch (state.phase) {
    case 'normal':
      return 0;
    case 'sinking':
      return (1 - state.timer / SINK_DURATION) * 0.9;
    case 'blackout':
      return 0.95;
    case 'granmaja':
      return 0.95;
    case 'respawning':
      return (state.timer / RESPAWN_FADE_DURATION) * 0.95;
    default:
      return 0;
  }
}

/** Get Gran Maja text alpha */
export function getGranMajaTextAlpha(state: OceanDeathState): number {
  if (state.phase !== 'granmaja') return 0;
  const progress = 1 - state.timer / GRANMAJA_DURATION;
  // Fade in first half, fade out second half
  if (progress < 0.3) return progress / 0.3;
  if (progress > 0.7) return (1 - progress) / 0.3;
  return 1;
}
