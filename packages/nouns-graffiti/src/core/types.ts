// Core types for the graffiti engine.
// PURE TypeScript — no DOM, no Three.js, no React references.
// Swift/visionOS mirrors these shapes one-for-one.

export type BrushKind = 'spray' | 'marker' | 'skinny';

export type HexColor = string; // '#rrggbb' or '#rrggbbaa'

export interface StrokePoint {
  /** 0..1 UV-U on the target surface */
  u: number;
  /** 0..1 UV-V on the target surface */
  v: number;
  /** 0..1; defaults to 1 when no pressure source */
  pressure: number;
  /** ms since the stroke started; used by drip/timing brushes */
  t: number;
}

export interface Stroke {
  id: string;
  surfaceId: string;
  brush: BrushKind;
  color: HexColor;
  /** logical brush radius in surface pixels at pressure=1 */
  size: number;
  points: StrokePoint[];
  authorId?: string;
  /** epoch ms */
  startedAt: number;
}

/** Knobs for the spray brush. Kept separate so Swift can mirror. */
export interface SprayOptions {
  /** 0..1, how concentrated the center is (higher = tighter) */
  hardness: number;
  /** droplets per emit tick at pressure=1 */
  densityPerTick: number;
  /** ms between emit ticks */
  tickMs: number;
  /** max droplet radius in surface pixels */
  dropletMax: number;
  /** ms of continuous hold before drip streaks spawn */
  dripAfterMs: number;
  /** px/tick a drip advances vertically */
  dripSpeed: number;
  /** number of active drip streaks at max hold */
  dripStreaks: number;
}

export const DEFAULT_SPRAY_OPTIONS: SprayOptions = {
  hardness: 0.55,
  densityPerTick: 24,
  tickMs: 16,
  dropletMax: 2.2,
  dripAfterMs: 220,
  dripSpeed: 3.2,
  dripStreaks: 3,
};

export interface MarkerOptions {
  /** alpha of the marker stroke 0..1 */
  opacity: number;
  /** soft edge width in px */
  feather: number;
}

export const DEFAULT_MARKER_OPTIONS: MarkerOptions = {
  opacity: 1,
  feather: 1.5,
};

export interface SkinnyOptions {
  opacity: number;
}

export const DEFAULT_SKINNY_OPTIONS: SkinnyOptions = {
  opacity: 1,
};

export interface BrushOptions {
  spray?: Partial<SprayOptions>;
  marker?: Partial<MarkerOptions>;
  skinny?: Partial<SkinnyOptions>;
}

export interface SurfaceDescriptor {
  id: string;
  width: number;
  height: number;
  /** hint; renderer picks the exact format */
  aspect: number;
}

export interface SurfaceSnapshot {
  surfaceId: string;
  /** data URL or base64 PNG payload; implementation specific */
  png: string;
  /** monotonic id the server is up-to-date with; clients should not replay strokes up to and including this */
  watermark?: string;
}

/** A palette of recent + preset colors; pure data, used by UI. */
export interface ColorPalette {
  presets: readonly HexColor[];
  recent: readonly HexColor[];
}

export interface PaintSessionState {
  brush: BrushKind;
  color: HexColor;
  /** logical brush radius in surface px */
  size: number;
  activeSurfaceId: string | null;
}
