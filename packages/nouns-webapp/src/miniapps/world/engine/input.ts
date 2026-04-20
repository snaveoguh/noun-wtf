// ── Input Manager ────────────────────────────────────────────────────
//
// WASD = movement
// Arrow keys = camera pan
// J = punch, K = kick, H = headbutt, U = uppercut
// Q = force push (tap) / focus-slomo "bullet-time" (hold)
// R = sprint (held)
// F = fire weapon (when gun equipped)
// Space = backflip (+ direction = dash)
// Shift = block/parry
// E = interact
// ESC = exit
//
// Q is double-purpose: `resolveIntendedMove` fires force-push on
// justPressed, while `useFocusTrigger` observes `keys.has('q')` on each
// frame to toggle manual bullet-time. Tap = quick push; hold = slomo.

import type { Direction, MoveType } from './types';

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
export function attachInputListeners(canvas: HTMLCanvasElement, state: InputState): () => void {
  const isTyping = (e: KeyboardEvent): boolean => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if ((e.target as HTMLElement)?.isContentEditable) return true;
    return false;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Don't capture keys when user is typing in an input/textarea/chat
    if (isTyping(e)) return;

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
    // Don't capture keys when user is typing
    if (isTyping(e)) return;

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

/** WASD movement — camera-relative. W=forward (into screen), A/D=strafe.
 *  Camera angle rotates the raw input so W always means "forward from camera." */
export function getMovementVector(keys: Set<string>, cameraAngle = 0): { dx: number; dy: number } {
  let fx = 0,
    fy = 0;
  // Arrow keys are reserved for camera pan (Spyro-style). WASD only for
  // movement. Gamepad still contributes via input.keys in poll.
  if (keys.has('w')) fy -= 1;
  if (keys.has('s')) fy += 1;
  if (keys.has('a')) fx -= 1;
  if (keys.has('d')) fx += 1;
  if (fx === 0 && fy === 0) return { dx: 0, dy: 0 };
  if (fx !== 0 && fy !== 0) {
    const inv = 1 / Math.SQRT2;
    fx *= inv;
    fy *= inv;
  }
  // Rotate raw input by camera orbit angle
  // cam at angle a sits at (sin(a), cos(a)), looks toward origin
  // "forward" (W, fy<0) = toward player from cam = (-sin(a), -cos(a)) in 2D
  const cos = Math.cos(cameraAngle);
  const sin = Math.sin(cameraAngle);
  const dx = fy * sin + fx * cos;
  const dy = fy * cos - fx * sin;
  return { dx, dy };
}

/** Update camera orbit from arrow keys (call each frame) */
export function updateCameraOrbit(state: InputState, delta: number) {
  const speed = 2.0; // radians per second
  if (state.keys.has('arrowleft')) state.cameraOrbitX -= speed * delta;
  if (state.keys.has('arrowright')) state.cameraOrbitX += speed * delta;
  if (state.keys.has('arrowup'))
    state.cameraOrbitY = Math.min(state.cameraOrbitY + speed * delta * 0.5, 1.2);
  if (state.keys.has('arrowdown'))
    state.cameraOrbitY = Math.max(state.cameraOrbitY - speed * delta * 0.5, -0.3);

  // Gentle spring back to default orbit when arrows released
  if (!state.keys.has('arrowleft') && !state.keys.has('arrowright')) {
    state.cameraOrbitX *= 0.97;
  }
  if (!state.keys.has('arrowup') && !state.keys.has('arrowdown')) {
    state.cameraOrbitY *= 0.97;
  }
}

/** Determine facing direction from movement delta (8-way) */
export function directionFromDelta(dx: number, dy: number): Direction {
  if (dx === 0 && dy === 0) return 'down'; // fallback
  // Both axes active -> diagonal
  if (dx !== 0 && dy !== 0) {
    if (dy < 0) return dx < 0 ? 'up-left' : 'up-right';
    return dx < 0 ? 'down-left' : 'down-right';
  }
  // Single axis -> cardinal
  if (dx !== 0) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** Resolve combat move from keyboard (no mouse) */
export function resolveIntendedMove(input: InputState): MoveType | null {
  const jp = input.justPressed;

  if (jp.has('f')) return 'gunshot';
  if (jp.has('h')) return 'headbutt';
  if (jp.has('q')) return 'forcePush';
  // R is now sprint (held) — no longer spin attack
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

/** Poll gamepad and map to input state each frame */
export function pollGamepad(input: InputState) {
  const gamepads = navigator.getGamepads?.();
  if (!gamepads) return;
  const gp = gamepads[0];
  if (!gp) return;

  const DEADZONE = 0.2;

  // ── Left stick → WASD movement ──
  const lx = gp.axes[0] ?? 0;
  const ly = gp.axes[1] ?? 0;
  if (ly < -DEADZONE) input.keys.add('w');
  else input.keys.delete('w');
  if (ly > DEADZONE) input.keys.add('s');
  else input.keys.delete('s');
  if (lx < -DEADZONE) input.keys.add('a');
  else input.keys.delete('a');
  if (lx > DEADZONE) input.keys.add('d');
  else input.keys.delete('d');

  // ── Right stick X → camera orbit ──
  const rx = gp.axes[2] ?? 0;
  if (Math.abs(rx) > DEADZONE) {
    input.cameraAngle += rx * 0.05;
  }

  // ── Face buttons ──
  // X (index 0) → jump (space)
  if (gp.buttons[0]?.pressed) {
    if (!input.keys.has(' ')) {
      input.keys.add(' ');
      input.justPressed.add(' ');
      const now = Date.now();
      if (now - input.lastSpaceTime < 400) input.spaceTaps++;
      else input.spaceTaps = 1;
      input.lastSpaceTime = now;
    }
  } else {
    input.keys.delete(' ');
  }

  // Circle (index 1) → headbutt (h)
  if (gp.buttons[1]?.pressed) {
    if (!input.keys.has('h')) {
      input.keys.add('h');
      input.justPressed.add('h');
    }
  } else {
    input.keys.delete('h');
  }

  // Square (index 2) → punch (j)
  if (gp.buttons[2]?.pressed) {
    if (!input.keys.has('j')) {
      input.keys.add('j');
      input.justPressed.add('j');
    }
  } else {
    input.keys.delete('j');
  }

  // Triangle (index 3) → kick (k)
  if (gp.buttons[3]?.pressed) {
    if (!input.keys.has('k')) {
      input.keys.add('k');
      input.justPressed.add('k');
    }
  } else {
    input.keys.delete('k');
  }

  // L1 (index 4) → block (shift)
  if (gp.buttons[4]?.pressed) {
    input.shiftHeld = true;
    input.keys.add('shift');
  } else {
    // Only release if keyboard shift isn't physically held
    // (gamepad releases shift when button released)
    if (input.keys.has('shift') && !gp.buttons[4]?.pressed) {
      // Let keyboard handler manage its own shift state
    }
  }

  // R1 (index 5) → fire/gun (f)
  if (gp.buttons[5]?.pressed) {
    if (!input.keys.has('f')) {
      input.keys.add('f');
      input.justPressed.add('f');
    }
  } else {
    input.keys.delete('f');
  }

  // D-pad up (index 12) → interact (e)
  if (gp.buttons[12]?.pressed) {
    if (!input.keys.has('e')) {
      input.keys.add('e');
      input.justPressed.add('e');
    }
  } else {
    input.keys.delete('e');
  }
}

/** Clear per-frame flags */
export function clearFrameFlags(input: InputState) {
  input.justPressed.clear();
}
