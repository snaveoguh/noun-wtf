// The intro's timeline, drawn on one canvas (Intro.tsx). Pure apart from the
// draw call, so tests can check what any moment looks like.
//
// It used to be 66 CSS-animated divs, one per pixel. On real machines the
// later pixels froze half way (compositor / main-thread timing we couldn't
// reproduce headless), so now one canvas draws everything from a single
// clock: whatever the browser does, a frame either shows the whole state for
// that moment or isn't drawn at all.

/** Pixel-for-pixel the real noggles (nouns-assets glasses-square-red, 16x5). */
export const NOGGLES = [
  '...RRRRRR.RRRRRR',
  '...RWWBBR.RWWBBR',
  'RRRRWWBBRRRWWBBR',
  'R..RWWBBR.RWWBBR',
  'R..RWWBBR.RWWBBR',
];
export const NOG_RED = '#f3322c';

export interface Px {
  x: number;
  y: number;
  k: 'R' | 'W' | 'B';
}
export const PIXELS: Px[] = NOGGLES.flatMap((row, y) =>
  [...row].flatMap((k, x) => (k === '.' ? [] : [{ x, y, k: k as Px['k'] }])),
);

/** Timeline, ms. */
export const T = {
  frameStart: 230,
  frameStepX: 55,
  frameStepY: 18,
  frameDur: 360,
  eyes: 1320,
  eyeStepY: 14,
  eyeDur: 220,
  hitDur: 500,
  glint: 1900,
  glintStepX: 34,
  glintDur: 450,
  streaks: 2650,
  streakStep: 20,
  streakDur: 1150,
  dive: 2860,
  total: 4200,
} as const;
export const STREAK_COUNT = 24;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Overshoot ease (like cubic-bezier(.2,1.7,.45,1)): passes 1, settles at 1. */
const backOut = (p: number) => {
  const c = 2.2;
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
};

export interface PxState {
  /** 0..1 */
  alpha: number;
  scale: number;
  /** vertical offset in pixel units */
  dy: number;
  /** white glint over a frame pixel, 0..1 */
  glint: number;
}

/** One pixel at time t (ms). */
export function pixelAt(p: Px, t: number): PxState {
  if (p.k === 'R') {
    const start = T.frameStart + p.x * T.frameStepX + p.y * T.frameStepY;
    const q = clamp01((t - start) / T.frameDur);
    const g = clamp01((t - (T.glint + p.x * T.glintStepX)) / T.glintDur);
    return {
      alpha: clamp01(q * 1.7),
      scale: q === 0 ? 0 : backOut(q),
      dy: (1 - clamp01(q / 0.6)) * -1.4,
      glint: g > 0 && g < 1 ? Math.sin(g * Math.PI) * 0.5 : 0,
    };
  }
  const q = clamp01((t - (T.eyes + p.y * T.eyeStepY)) / T.eyeDur);
  return { alpha: q, scale: q === 0 ? 2.6 : 2.6 - 1.6 * (1 - Math.pow(1 - q, 3)), dy: 0, glint: 0 };
}

/** The whole noggles: the "hit" on the DUM, then the dive into the right pupil. */
export function stageAt(t: number): { scale: number; rot: number } {
  let scale = 1;
  let rot = 0;
  const h = (t - T.eyes) / T.hitDur;
  if (h > 0 && h < 1) {
    const k = h < 0.3 ? h / 0.3 : 1 - (h - 0.3) / 0.7;
    scale += 0.09 * k;
    rot = -1.2 * k;
  }
  const d = clamp01((t - T.dive) / (T.total - T.dive));
  if (d > 0) scale *= 1 + 33 * Math.pow(d, 3);
  return { scale, rot };
}

/** Streak i at time t: 0..1 height and opacity, plus its horizontal stretch. */
export function streakAt(i: number, t: number): { h: number; a: number; sx: number } {
  const q = clamp01((t - (T.streaks + i * T.streakStep)) / T.streakDur);
  if (q === 0) return { h: 0, a: 0, sx: 1 };
  if (q < 0.35) return { h: q / 0.35, a: q / 0.35, sx: 1 };
  const r = (q - 0.35) / 0.65;
  return { h: 1 + 0.4 * r, a: 1 - r, sx: 1 + 4 * r };
}

/** Draw the moment t (ms) on a canvas of css size w x h (ctx already scaled for DPR). */
export function drawIntro(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  c.clearRect(0, 0, w, h);
  // streaks behind
  const sw = w * 0.024;
  const gap = w * 0.006;
  const span = STREAK_COUNT * sw + (STREAK_COUNT - 1) * gap;
  for (let i = 0; i < STREAK_COUNT; i++) {
    const s = streakAt(i, t);
    if (s.a <= 0) continue;
    const bw = (i % 4 === 3 ? sw * 0.25 : sw) * s.sx;
    const cx = (w - span) / 2 + i * (sw + gap) + sw / 2;
    const bh = h * 1.2 * s.h;
    const g = c.createLinearGradient(0, h / 2 - bh / 2, 0, h / 2 + bh / 2);
    const hue = 346 + i * 1.2;
    g.addColorStop(0, 'hsla(0,0%,0%,0)');
    g.addColorStop(0.28, `hsla(${hue},95%,${48 + i * 0.8}%,${s.a})`);
    g.addColorStop(0.72, `hsla(${2 + i * 0.6},98%,60%,${s.a})`);
    g.addColorStop(1, 'hsla(0,0%,0%,0)');
    c.fillStyle = g;
    c.fillRect(cx - bw / 2, h / 2 - bh / 2, bw, bh);
  }

  const px = Math.min(w * 0.046, 36);
  const nw = 16 * px;
  const nh = 5 * px;
  const ox = (w - nw) / 2;
  const oy = (h - nh) / 2;
  const st = stageAt(t);
  // the dive lands in the right pupil (columns 13-14, rows 1-4)
  const fx = ox + nw * 0.875;
  const fy = oy + nh * 0.6;
  c.save();
  c.translate(fx, fy);
  c.rotate((st.rot * Math.PI) / 180);
  c.scale(st.scale, st.scale);
  c.translate(-fx, -fy);
  c.shadowColor = 'rgba(243,50,44,0.45)';
  for (const p of PIXELS) {
    const s = pixelAt(p, t);
    if (s.alpha <= 0) continue;
    const cx = ox + (p.x + 0.5) * px;
    const cy = oy + (p.y + 0.5 + s.dy) * px;
    const size = px * s.scale + 0.6; // +0.6: no seams between neighbours
    c.globalAlpha = s.alpha;
    c.shadowBlur = p.k === 'R' ? px * 0.6 : 0;
    c.fillStyle = p.k === 'R' ? NOG_RED : p.k === 'W' ? '#fff' : '#000';
    c.fillRect(cx - size / 2, cy - size / 2, size, size);
    if (s.glint > 0) {
      c.shadowBlur = 0;
      c.globalAlpha = s.glint;
      c.fillStyle = '#fff';
      c.fillRect(cx - size / 2, cy - size / 2, size, size);
    }
  }
  c.restore();
  c.globalAlpha = 1;
  c.shadowBlur = 0;
}
