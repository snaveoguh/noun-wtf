import { describe, expect, it } from 'vitest';

import {
  clampView,
  FIT_VIEW,
  fitHeight,
  gridLines,
  lerpView,
  MAX_ZOOM,
  MIN_ZOOM,
  MURAL_FOV,
  panBy,
  screenOf,
  seatCentre,
  toNdc,
  viewPose,
  wallAt,
  type WallFrame,
  zoomAbout,
} from './framing';

// A wall facing +Z (the cell basis for n = +Z: u = +X, v = +Y)
const frame: WallFrame = {
  centre: { x: 2, y: 1.6, z: -5 },
  u: { x: 1, y: 0, z: 0 },
  v: { x: 0, y: 1, z: 0 },
  n: { x: 0, y: 0, z: 1 },
};
const W = 1180;
const H = 820;
const A = W / H;

describe('mural framing', () => {
  it('fits a 5 × 3 m patch landscape and portrait', () => {
    const land = fitHeight(1180 / 820);
    expect(land).toBeGreaterThanOrEqual(3.2);
    expect(land * (1180 / 820)).toBeGreaterThanOrEqual(5 - 1e-9);
    const port = fitHeight(820 / 1180);
    expect(port * (820 / 1180)).toBeGreaterThanOrEqual(5 - 1e-9);
    expect(port).toBeLessThanOrEqual(8);
  });

  it('the camera sits on the wall normal, looking flat-on, at the distance that fits', () => {
    const fitH = fitHeight(A);
    const p = viewPose(frame, FIT_VIEW, A, fitH);
    expect(p.look).toEqual(frame.centre);
    expect(p.pos.x).toBeCloseTo(2);
    expect(p.pos.y).toBeCloseTo(1.6);
    expect(p.pos.z).toBeGreaterThan(-5);
    // Vertical FOV spans exactly fitH at that distance
    expect(2 * p.dist * Math.tan((MURAL_FOV * Math.PI) / 360)).toBeCloseTo(fitH);
    // Zoom 2 halves the distance
    expect(viewPose(frame, { ...FIT_VIEW, zoom: 2 }, A, fitH).dist).toBeCloseTo(p.dist / 2);
  });

  it('screenOf and wallAt are inverses', () => {
    const fitH = 3.4;
    const v = { panU: 0.7, panV: -0.3, zoom: 1.7 };
    for (const [px, py] of [
      [0, 0],
      [W / 2, H / 2],
      [100, 700],
      [W, H],
    ]) {
      const n = toNdc(px, py, W, H);
      const w = wallAt(v, n.x, n.y, A, fitH);
      const s = screenOf(v, w.u, w.v, W, H, fitH);
      expect(s.x).toBeCloseTo(px);
      expect(s.y).toBeCloseTo(py);
    }
  });

  it('panning moves the wall with the finger, 1:1', () => {
    const fitH = 3.4;
    const v = { panU: 0, panV: 0, zoom: 1 };
    const before = wallAt(v, toNdc(300, 300, W, H).x, toNdc(300, 300, W, H).y, A, fitH);
    const p = panBy(v, 120, -60, W, H, fitH);
    const n = toNdc(420, 240, W, H);
    const after = wallAt(p, n.x, n.y, A, fitH);
    expect(after.u).toBeCloseTo(before.u);
    expect(after.v).toBeCloseTo(before.v);
  });

  it('pinch keeps the wall point under the fingers still', () => {
    const fitH = 3.4;
    const v = { panU: 0.4, panV: 0.2, zoom: 1.3 };
    const px = 900;
    const py = 200;
    const n = toNdc(px, py, W, H);
    const before = wallAt(v, n.x, n.y, A, fitH);
    const z = zoomAbout(v, 2.5, px, py, W, H, fitH);
    expect(z.zoom).toBeCloseTo(3.25);
    const after = wallAt(z, n.x, n.y, A, fitH);
    expect(after.u).toBeCloseTo(before.u);
    expect(after.v).toBeCloseTo(before.v);
  });

  it('zoom and pan are clamped', () => {
    expect(zoomAbout(FIT_VIEW, 1000, 0, 0, W, H, 3).zoom).toBe(MAX_ZOOM);
    expect(zoomAbout(FIT_VIEW, 0.0001, 0, 0, W, H, 3).zoom).toBe(MIN_ZOOM);
    const c = clampView({ panU: 1e6, panV: -1e6, zoom: 1 });
    expect(Math.abs(c.panU)).toBeLessThan(100);
    expect(Math.abs(c.panV)).toBeLessThan(100);
  });

  it('lerpView eases ends exactly, zoom in log space', () => {
    const a = { panU: 0, panV: 0, zoom: 1 };
    const b = { panU: 2, panV: -1, zoom: 4 };
    expect(lerpView(a, b, 0)).toEqual(a);
    expect(lerpView(a, b, 1)).toEqual(b);
    expect(lerpView(a, b, 0.5).zoom).toBeCloseTo(2);
  });

  it('seats a ground wall so the view starts near your feet', () => {
    expect(seatCentre(0.4, 0, 3.2, true)).toBeCloseTo(1.35);
    expect(seatCentre(4, 0, 3.2, true)).toBe(4);
    expect(seatCentre(0.4, 0, 3.2, false)).toBe(0.4);
  });

  it('grid lines on round metres inside the range', () => {
    expect(gridLines(-1.2, 1.1, 0.5)).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(gridLines(0, 1, 0)).toEqual([]);
  });
});
