// ── Mural camera: square up to a wall, pan and pinch-zoom across it ─────
//
// Pure (plain {x, y, z}, no three.js). The wall's frame is the graffiti
// cell basis: u across (screen right), v up (screen up), n out of the wall
// toward the viewer. The camera sits on the wall's normal looking straight
// at it, so the wall is flat-on and screen ↔ wall is a plain scale + offset:
//
//   visible height = fitH / zoom, width = height × aspect
//   wall point (relative to the frame centre) = pan + ndc × half-size
//
// Pinch keeps the wall point under the fingers where it is; zoom is clamped
// to MIN_ZOOM..MAX_ZOOM and the pan to a box round the starting centre.

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface WallFrame {
  centre: V3;
  u: V3;
  v: V3;
  n: V3;
}

export interface MuralView {
  /** Metres along u / v from the frame centre to the view centre. */
  panU: number;
  panV: number;
  /** 1 = fit; 2 = twice as close. */
  zoom: number;
}

export const MIN_ZOOM = 0.45;
export const MAX_ZOOM = 14;
/** How far the view may wander from where mural mode opened (m). */
export const PAN_U = 14;
export const PAN_V = 8;
/** Mural camera's vertical field of view (degrees): narrow, so little perspective. */
export const MURAL_FOV = 40;

export const FIT_VIEW: MuralView = { panU: 0, panV: 0, zoom: 1 };

/**
 * Visible wall height at zoom 1: a 5 m × 3 m patch fits either way round
 * (landscape shows ~3 m tall, portrait as much as it needs for 5 m across).
 */
export function fitHeight(aspect: number): number {
  const a = aspect > 0 ? aspect : 1;
  return Math.min(8, Math.max(3.2, 5 / a));
}

export function halfSize(view: MuralView, aspect: number, fitH: number) {
  const hh = fitH / 2 / view.zoom;
  return { hw: hh * aspect, hh };
}

export function clampView(v: MuralView): MuralView {
  return {
    panU: Math.max(-PAN_U, Math.min(PAN_U, v.panU)),
    panV: Math.max(-PAN_V, Math.min(PAN_V, v.panV)),
    zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom)),
  };
}

/** Camera position + look point (and distance) for a view of the wall. */
export function viewPose(
  frame: WallFrame,
  view: MuralView,
  aspect: number,
  fitH: number,
  fovDeg = MURAL_FOV,
): { pos: V3; look: V3; dist: number } {
  const { hh } = halfSize(view, aspect, fitH);
  const dist = hh / Math.tan((fovDeg * Math.PI) / 360);
  const { centre: c, u, v, n } = frame;
  const look = {
    x: c.x + u.x * view.panU + v.x * view.panV,
    y: c.y + u.y * view.panU + v.y * view.panV,
    z: c.z + u.z * view.panU + v.z * view.panV,
  };
  return {
    pos: { x: look.x + n.x * dist, y: look.y + n.y * dist, z: look.z + n.z * dist },
    look,
    dist,
  };
}

/** Normalised device coords (-1..1, y up) of a screen pixel. */
export function toNdc(px: number, py: number, w: number, h: number) {
  return { x: (px / w) * 2 - 1, y: 1 - (py / h) * 2 };
}

/** Wall offset (m along u, v from the frame centre) under an NDC point. */
export function wallAt(view: MuralView, ndcX: number, ndcY: number, aspect: number, fitH: number) {
  const { hw, hh } = halfSize(view, aspect, fitH);
  return { u: view.panU + ndcX * hw, v: view.panV + ndcY * hh };
}

/** Screen pixel of a wall offset (inverse of wallAt). */
export function screenOf(
  view: MuralView,
  u: number,
  v: number,
  w: number,
  h: number,
  fitH: number,
) {
  const { hw, hh } = halfSize(view, w / h, fitH);
  const nx = (u - view.panU) / hw;
  const ny = (v - view.panV) / hh;
  return { x: ((nx + 1) / 2) * w, y: ((1 - ny) / 2) * h };
}

/** Drag the wall with the fingers: it moves with them, 1:1. */
export function panBy(view: MuralView, dx: number, dy: number, w: number, h: number, fitH: number) {
  const { hw, hh } = halfSize(view, w / h, fitH);
  return clampView({
    ...view,
    panU: view.panU - (dx / w) * 2 * hw,
    panV: view.panV + (dy / h) * 2 * hh,
  });
}

/** Zoom by `factor` about a screen point, keeping the wall under it put. */
export function zoomAbout(
  view: MuralView,
  factor: number,
  px: number,
  py: number,
  w: number,
  h: number,
  fitH: number,
): MuralView {
  const aspect = w / h;
  const ndc = toNdc(px, py, w, h);
  const before = wallAt(view, ndc.x, ndc.y, aspect, fitH);
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * factor));
  const { hw, hh } = halfSize({ ...view, zoom }, aspect, fitH);
  return clampView({ zoom, panU: before.u - ndc.x * hw, panV: before.v - ndc.y * hh });
}

/** Ease between two views (entering / FIT), t 0..1. */
export function lerpView(a: MuralView, b: MuralView, t: number): MuralView {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  return {
    panU: a.panU + (b.panU - a.panU) * k,
    panV: a.panV + (b.panV - a.panV) * k,
    // Zoom eases in log space so it feels even
    zoom: Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * k),
  };
}

/**
 * Where the frame centres on a wall: the point you faced, raised so the
 * view's bottom edge isn't far below your feet on a wall you stand at.
 */
export function seatCentre(hitY: number, feetY: number, fitH: number, vertical: boolean): number {
  if (!vertical) return hitY;
  return Math.max(hitY, feetY + fitH / 2 - 0.25);
}

/** Wall grid lines (m, along u or v) visible in a view: every `step` metres. */
export function gridLines(lo: number, hi: number, step: number, max = 200): number[] {
  const out: number[] = [];
  if (!(step > 0) || !(hi > lo)) return out;
  for (let x = Math.ceil(lo / step) * step; x <= hi && out.length < max; x += step)
    out.push(Math.round(x * 1000) / 1000);
  return out;
}
