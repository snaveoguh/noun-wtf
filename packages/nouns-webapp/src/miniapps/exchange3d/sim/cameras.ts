// ── 3D Grand Exchange: camera modes (pure) ───────────────────────────────
//
// The camera is an orbit: a target point, a distance, an azimuth and an
// elevation. Each mode is a preset for those; switching modes eases the
// current orbit toward the new one (distance in log space, so a pull-out
// from 10 m to 900 m feels even, azimuth the short way round).
//
//   floor  — walk-level orbit round one pit (press again for the next pit)
//   wide   — the whole hall from a high corner
//   vast   — a high aerial: the floor tiles off to the horizon
//   follow — locked onto one trader
//   free   — wherever you drag / pinch / scroll it, close-up to VAST

export type CamMode = 'floor' | 'wide' | 'vast' | 'follow' | 'free';
export const CAM_MODES: readonly CamMode[] = ['floor', 'wide', 'vast', 'follow', 'free'];

export interface Orbit {
  tx: number;
  ty: number;
  tz: number;
  /** Distance from target (m). */
  r: number;
  /** Azimuth (rad, 0 = camera on +z of the target). */
  az: number;
  /** Elevation above the horizon (rad). */
  el: number;
}

export const R_MIN = 3;
export const R_MAX = 1400;
export const EL_MIN = 0.04;
export const EL_MAX = 1.52;

export function clampOrbit(o: Orbit): Orbit {
  return {
    ...o,
    r: Math.min(R_MAX, Math.max(R_MIN, o.r)),
    el: Math.min(EL_MAX, Math.max(EL_MIN, o.el)),
  };
}

export interface PresetCtx {
  /** The pit the floor camera circles. */
  pit: { x: number; z: number };
  /** The followed trader (null: none). */
  follow: { x: number; y: number; z: number } | null;
  /** Viewport width / height: tall phones pull wide shots back further. */
  aspect: number;
  /** Keep this azimuth (rad) where the preset doesn't care. */
  az: number;
}

export function preset(mode: CamMode, c: PresetCtx): Orbit {
  // Portrait screens see less width: back off so the hall still fits
  const fit = c.aspect < 1 ? Math.min(2.2, 1 / c.aspect) : 1;
  switch (mode) {
    case 'floor':
      return { tx: c.pit.x, ty: 1.6, tz: c.pit.z, r: 15 * Math.sqrt(fit), az: c.az, el: 0.3 };
    case 'wide':
      return { tx: 0, ty: 0, tz: 0, r: 120 * fit, az: Math.PI * 0.82, el: 0.62 };
    case 'vast':
      return { tx: 0, ty: 0, tz: 0, r: 720 * Math.sqrt(fit), az: Math.PI * 0.78, el: 0.36 };
    case 'follow': {
      const f = c.follow ?? { x: c.pit.x, y: 0, z: c.pit.z };
      return { tx: f.x, ty: f.y + 1.7, tz: f.z, r: 11 * Math.sqrt(fit), az: c.az, el: 0.42 };
    }
    case 'free':
    default:
      return { tx: 0, ty: 0, tz: 0, r: 60 * fit, az: c.az, el: 0.5 };
  }
}

/** Shortest signed angle from a to b. */
export function angleTo(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/**
 * Ease `cur` toward `want` (frame-rate independent). `rate` is 1/s: about
 * 95% of the way in 3 / rate seconds.
 */
export function stepOrbit(cur: Orbit, want: Orbit, dt: number, rate = 2.6): Orbit {
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  const lr = Math.log(cur.r) + (Math.log(want.r) - Math.log(cur.r)) * k;
  return {
    tx: cur.tx + (want.tx - cur.tx) * k,
    ty: cur.ty + (want.ty - cur.ty) * k,
    tz: cur.tz + (want.tz - cur.tz) * k,
    r: Math.exp(lr),
    az: cur.az + angleTo(cur.az, want.az) * k,
    el: cur.el + (want.el - cur.el) * k,
  };
}

/** Camera world position for an orbit. */
export function orbitEye(o: Orbit): { x: number; y: number; z: number } {
  const h = Math.cos(o.el) * o.r;
  return {
    x: o.tx + Math.sin(o.az) * h,
    y: o.ty + Math.sin(o.el) * o.r,
    z: o.tz + Math.cos(o.az) * h,
  };
}

/** Close enough to call the transition finished. */
export function settled(a: Orbit, b: Orbit): boolean {
  return (
    Math.abs(Math.log(a.r / b.r)) < 0.01 &&
    Math.abs(angleTo(a.az, b.az)) < 0.005 &&
    Math.abs(a.el - b.el) < 0.005 &&
    Math.hypot(a.tx - b.tx, a.ty - b.ty, a.tz - b.tz) < 0.05
  );
}

/** Zoom by a factor (wheel / pinch), clamped. */
export function zoom(o: Orbit, factor: number): Orbit {
  return clampOrbit({ ...o, r: o.r * factor });
}

/** Drag-orbit by screen pixels (`px` across, `py` down). */
export function rotate(o: Orbit, px: number, py: number, speed = 0.005): Orbit {
  return clampOrbit({ ...o, az: o.az - px * speed, el: o.el + py * speed });
}

/**
 * Pan the target across the ground by screen pixels, scaled by distance so
 * it tracks the finger at any zoom. `fov` is the vertical field of view
 * (rad), `h` the viewport height (px).
 */
export function pan(o: Orbit, px: number, py: number, fov: number, h: number): Orbit {
  const m = (2 * o.r * Math.tan(fov / 2)) / Math.max(1, h);
  const sx = Math.cos(o.az);
  const sz = -Math.sin(o.az);
  // Toward the camera on the ground plane. Dragging down pulls the far
  // ground toward you, so the target moves away from the camera
  const fx = Math.sin(o.az);
  const fz = Math.cos(o.az);
  const k = 1 / Math.max(0.25, Math.sin(o.el) + 0.25);
  return {
    ...o,
    tx: o.tx - (sx * px + fx * py * k) * m,
    tz: o.tz - (sz * px + fz * py * k) * m,
  };
}

/** Which mode a key picks (1–5, F/W/V/T/O), null for others. */
export function modeForKey(key: string): CamMode | null {
  const k = key.toLowerCase();
  const map: Record<string, CamMode> = {
    '1': 'floor',
    '2': 'wide',
    '3': 'vast',
    '4': 'follow',
    '5': 'free',
    f: 'floor',
    w: 'wide',
    v: 'vast',
    t: 'follow',
    o: 'free',
  };
  return map[k] ?? null;
}
