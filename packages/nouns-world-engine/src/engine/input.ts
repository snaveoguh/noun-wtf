// ── Input Manager (Platform-agnostic) ────────────────────────────────
//
// Pure input state management and resolution logic.
// Platform-specific listeners (keyboard, gamepad, hand tracking)
// are implemented in the host app and feed into this state.

import type { Direction, MoveType } from './types';

export interface InputState {
  keys: Set<string>;
  // Camera orbit from arrow keys / right stick
  cameraOrbitX: number;
  cameraOrbitY: number;
  cameraAngle: number;
  // Per-frame flags
  justPressed: Set<string>;
  shiftHeld: boolean;
  // Space tap tracking for jump/double-jump/backflip
  spaceTaps: number;
  lastSpaceTime: number;
}

export function createInputState(): InputState {
  return {
    keys: new Set(),
    cameraOrbitX: 0,
    cameraOrbitY: 0,
    cameraAngle: 0,
    justPressed: new Set(),
    shiftHeld: false,
    spaceTaps: 0,
    lastSpaceTime: 0,
  };
}

/** Register a key press into the input state (call from platform input handler) */
export function pressKey(state: InputState, key: string) {
  const k = key.toLowerCase();
  if (!state.keys.has(k)) {
    state.keys.add(k);
    state.justPressed.add(k);
    if (k === ' ') {
      const now = Date.now();
      if (now - state.lastSpaceTime < 400) {
        state.spaceTaps++;
      } else {
        state.spaceTaps = 1;
      }
      state.lastSpaceTime = now;
    }
  }
  if (k === 'shift') state.shiftHeld = true;
}

/** Register a key release (call from platform input handler) */
export function releaseKey(state: InputState, key: string) {
  const k = key.toLowerCase();
  state.keys.delete(k);
  if (k === 'shift') state.shiftHeld = false;
}

/** WASD movement — camera-relative. W=forward (into screen), A/D=strafe.
 *  Camera angle rotates the raw input so W always means "forward from camera." */
export function getMovementVector(keys: Set<string>, cameraAngle = 0): { dx: number; dy: number } {
  let fx = 0,
    fy = 0;
  if (keys.has('w') || keys.has('arrowup')) fy -= 1;
  if (keys.has('s') || keys.has('arrowdown')) fy += 1;
  if (keys.has('a') || keys.has('arrowleft')) fx -= 1;
  if (keys.has('d') || keys.has('arrowright')) fx += 1;
  if (fx === 0 && fy === 0) return { dx: 0, dy: 0 };
  if (fx !== 0 && fy !== 0) {
    const inv = 1 / Math.SQRT2;
    fx *= inv;
    fy *= inv;
  }
  const cos = Math.cos(cameraAngle);
  const sin = Math.sin(cameraAngle);
  const dx = fy * sin + fx * cos;
  const dy = fy * cos - fx * sin;
  return { dx, dy };
}

/** Update camera orbit from arrow keys (call each frame) */
export function updateCameraOrbit(state: InputState, delta: number) {
  const speed = 2.0;
  if (state.keys.has('arrowleft')) state.cameraOrbitX -= speed * delta;
  if (state.keys.has('arrowright')) state.cameraOrbitX += speed * delta;
  if (state.keys.has('arrowup'))
    state.cameraOrbitY = Math.min(state.cameraOrbitY + speed * delta * 0.5, 1.2);
  if (state.keys.has('arrowdown'))
    state.cameraOrbitY = Math.max(state.cameraOrbitY - speed * delta * 0.5, -0.3);

  if (!state.keys.has('arrowleft') && !state.keys.has('arrowright')) {
    state.cameraOrbitX *= 0.97;
  }
  if (!state.keys.has('arrowup') && !state.keys.has('arrowdown')) {
    state.cameraOrbitY *= 0.97;
  }
}

/** Determine facing direction from movement delta (8-way) */
export function directionFromDelta(dx: number, dy: number): Direction {
  if (dx === 0 && dy === 0) return 'down';
  if (dx !== 0 && dy !== 0) {
    if (dy < 0) return dx < 0 ? 'up-left' : 'up-right';
    return dx < 0 ? 'down-left' : 'down-right';
  }
  if (dx !== 0) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** Resolve combat move from input state */
export function resolveIntendedMove(input: InputState): MoveType | null {
  const jp = input.justPressed;

  if (jp.has('f')) return 'gunshot';
  if (jp.has('h')) return 'headbutt';
  if (jp.has('q')) return 'forcePush';
  if (jp.has('u')) return 'uppercut';

  if (input.shiftHeld) return 'block';

  if (jp.has(' ')) return 'backflip';

  if (jp.has('j')) return 'punch';
  if (jp.has('k')) return 'kick';

  return null;
}

/** Clear per-frame flags */
export function clearFrameFlags(input: InputState) {
  input.justPressed.clear();
}
