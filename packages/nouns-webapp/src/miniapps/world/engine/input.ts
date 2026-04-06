// ── Input Manager ────────────────────────────────────────────────────
//
// WASD = movement
// Arrow keys = camera pan
// J = punch, K = kick, H = headbutt, U = uppercut
// Q = force push, R = spin attack
// Space = backflip (+ direction = dash)
// Shift = block/parry
// E = interact
// ESC = exit

import type { MoveType } from './types';

export interface InputState {
  keys: Set<string>;
  // Camera orbit from arrow keys
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

/** Attach listeners, return cleanup function */
export function attachInputListeners(
  canvas: HTMLCanvasElement,
  state: InputState,
): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (!state.keys.has(k)) {
      state.keys.add(k);
      state.justPressed.add(k);
      // Track space taps for jump/double-jump/backflip
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
    // Prevent scrolling
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      e.preventDefault();
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    state.keys.delete(k);
    if (k === 'shift') state.shiftHeld = false;
  };

  const onContextMenu = (e: MouseEvent) => e.preventDefault();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('contextmenu', onContextMenu);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('contextmenu', onContextMenu);
  };
}

/** WASD movement — W=forward, S=back, A=left, D=right from camera's POV */
export function getMovementVector(keys: Set<string>, _cameraAngle = 0): { dx: number; dy: number } {
  // Simple world-relative: W=up(-Y), S=down(+Y), A=left(-X), D=right(+X)
  // Camera always follows behind, so world-relative IS camera-relative
  // because camera snaps to behind the player instantly
  let dx = 0, dy = 0;
  if (keys.has('w')) dy -= 1;
  if (keys.has('s')) dy += 1;
  if (keys.has('a')) dx -= 1;
  if (keys.has('d')) dx += 1;
  if (dx !== 0 && dy !== 0) {
    const inv = 1 / Math.SQRT2;
    dx *= inv;
    dy *= inv;
  }
  return { dx, dy };
}

/** Update camera orbit from arrow keys (call each frame) */
export function updateCameraOrbit(state: InputState, delta: number) {
  const speed = 2.0; // radians per second
  if (state.keys.has('arrowleft')) state.cameraOrbitX -= speed * delta;
  if (state.keys.has('arrowright')) state.cameraOrbitX += speed * delta;
  if (state.keys.has('arrowup')) state.cameraOrbitY = Math.min(state.cameraOrbitY + speed * delta * 0.5, 1.2);
  if (state.keys.has('arrowdown')) state.cameraOrbitY = Math.max(state.cameraOrbitY - speed * delta * 0.5, -0.3);

  // Gentle spring back to default orbit when arrows released
  if (!state.keys.has('arrowleft') && !state.keys.has('arrowright')) {
    state.cameraOrbitX *= 0.97;
  }
  if (!state.keys.has('arrowup') && !state.keys.has('arrowdown')) {
    state.cameraOrbitY *= 0.97;
  }
}

/** Determine facing direction from movement delta */
export function directionFromDelta(dx: number, dy: number): 'up' | 'down' | 'left' | 'right' {
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'down' : 'up';
}

/** Resolve combat move from keyboard (no mouse) */
export function resolveIntendedMove(input: InputState): MoveType | null {
  const jp = input.justPressed;
  const keys = input.keys;

  if (jp.has('h')) return 'headbutt';
  if (jp.has('q')) return 'forcePush';
  if (jp.has('r')) return 'spinAttack';
  if (jp.has('u')) return 'uppercut';

  if (input.shiftHeld) return 'block';

  if (jp.has(' ')) {
    // Space = jump (backflip move uses Jump_Full_Long animation)
    return 'backflip';
  }

  if (jp.has('j')) return 'punch';
  if (jp.has('k')) return 'kick';

  return null;
}

/** Clear per-frame flags */
export function clearFrameFlags(input: InputState) {
  input.justPressed.clear();
}
