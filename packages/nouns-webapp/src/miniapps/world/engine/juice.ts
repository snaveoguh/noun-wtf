// ── Juice — event bus for locomotion feedback ────────────────────────
//
// Central place for locomotion substates to emit "cool thing just
// happened" events that camera/sfx/UI layers subscribe to. Keeps the
// physics code ignorant of the render layer.
//
// Separate from timeControl.ts (which handles bullet-time cues) —
// juice is for more granular effects (landing puff, dash echo, camera
// shake intensity).

export interface LandingEvent {
  x: number;
  y: number;
  z: number;
  impactVz: number; // how fast we hit the ground (positive magnitude)
  material: string;
}

export interface DashEvent {
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirY: number;
}

export interface MantleEvent {
  x: number;
  y: number;
  fromZ: number;
  toZ: number;
}

type LandingListener = (e: LandingEvent) => void;
type DashListener = (e: DashEvent) => void;
type MantleListener = (e: MantleEvent) => void;

const landingListeners = new Set<LandingListener>();
const dashListeners = new Set<DashListener>();
const mantleListeners = new Set<MantleListener>();

export const onLanding = (fn: LandingListener): (() => void) => {
  landingListeners.add(fn);
  return () => landingListeners.delete(fn);
};

export const onDash = (fn: DashListener): (() => void) => {
  dashListeners.add(fn);
  return () => dashListeners.delete(fn);
};

export const onMantle = (fn: MantleListener): (() => void) => {
  mantleListeners.add(fn);
  return () => mantleListeners.delete(fn);
};

export const emitLanding = (e: LandingEvent): void => {
  for (const l of landingListeners) l(e);
};

export const emitDash = (e: DashEvent): void => {
  for (const l of dashListeners) l(e);
};

export const emitMantle = (e: MantleEvent): void => {
  for (const l of mantleListeners) l(e);
};

// ── Camera shake shared state ─────────────────────────────────────────
//
// Writer (locomotion/combat) calls triggerCameraShake. Reader (camera
// agent) reads cameraShakeRef and applies it to the camera each frame.
// Not a ref in the React sense — just a mutable singleton so we don't
// need to plumb it through props.

export interface CameraShakeState {
  intensity: number; // current shake amplitude
  timer: number; // frames remaining
  duration: number; // original duration for falloff curve
}

export const cameraShakeRef: CameraShakeState = {
  intensity: 0,
  timer: 0,
  duration: 0,
};

/** Kick the camera. Larger values stomp smaller in-flight shakes. */
export const triggerCameraShake = (intensity: number, durationFrames: number): void => {
  if (intensity > cameraShakeRef.intensity || cameraShakeRef.timer <= 0) {
    cameraShakeRef.intensity = intensity;
    cameraShakeRef.timer = durationFrames;
    cameraShakeRef.duration = durationFrames;
  }
};

/** Decay shake each frame. Camera agent calls this from its render loop. */
export const tickCameraShake = (): void => {
  if (cameraShakeRef.timer > 0) {
    cameraShakeRef.timer--;
    if (cameraShakeRef.timer <= 0) {
      cameraShakeRef.intensity = 0;
    }
  }
};

/** Sample a per-axis shake offset (call from camera each frame). */
export const sampleShakeOffset = (): { x: number; y: number; z: number } => {
  if (cameraShakeRef.timer <= 0 || cameraShakeRef.intensity <= 0) {
    return { x: 0, y: 0, z: 0 };
  }
  // Falloff across the duration, plus random per-axis jitter.
  const t = cameraShakeRef.timer / Math.max(1, cameraShakeRef.duration);
  const amp = cameraShakeRef.intensity * t;
  return {
    x: (Math.random() * 2 - 1) * amp,
    y: (Math.random() * 2 - 1) * amp,
    z: (Math.random() * 2 - 1) * amp * 0.4,
  };
};
