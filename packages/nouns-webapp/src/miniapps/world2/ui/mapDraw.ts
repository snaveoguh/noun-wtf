// ── World map renderer (minimap + full map) ──────────────────────────────
//
// Everything is drawn from the same deterministic data the game builds the
// world from: the city square and its alleys (config.ts), every dirt track
// grown so far (tracks.ts), the mega ramp sites, and the secret spot's
// frame (nounJersey.ts). Contours are the analytic downhill gradient, so the
// map costs a few canvas strokes per frame, never a terrain sample.
//
// Screen: +X right, +Z down (a true top-down view, -Z is "north").

import { ALLEYS, ALLEY_O0, MOUNTAIN, alleyToWorld, edgeDistance } from '../world/mountain/config';
import { bowlMapPoint, bowlOutline } from '../world/mountain/noggleBowl';
import { NJ, njFrameNow, njToWorld, type NjFrame } from '../world/mountain/nounJersey';
import { MEGA_SITE, tracks, type Track } from '../world/mountain/tracks';

export interface MapView {
  /** World point at the canvas centre. */
  cx: number;
  cz: number;
  /** Pixels per metre (CSS px). */
  s: number;
  /** Canvas rotation (rad): π + yaw puts that heading at the top. */
  rot: number;
}

export interface MapRider {
  x: number;
  z: number;
  name: string;
}

export interface MapScene {
  me: { x: number; z: number; yaw: number };
  riders: MapRider[];
  waypoint: { x: number; z: number } | null;
  /** The endless mountain exists (the fallback park has no mountain). */
  mountain: boolean;
}

const C = {
  land: '#86b86a',
  landFar: '#5f8f52',
  contour: 'rgba(20,40,10,.16)',
  contourMajor: 'rgba(20,40,10,.32)',
  roadCase: '#4a321d',
  road: '#e9c98f',
  branch: '#dcbb84',
  block: '#2d313c',
  blockEdge: '#151821',
  plaza: '#d8d0bf',
  alley: '#c9bfa9',
  mega: '#ff7a1a',
  nj: '#ff3d8b',
  bowl: '#8f6bff',
  me: '#ffd400',
  rider: '#22c7f0',
  way: '#b6ef3a',
  ink: '#111018',
};

// ── Cached geometry ─────────────────────────────────────────────────────

const trackPaths = new Map<
  Track,
  { n: number; path: Path2D; x0: number; z0: number; x1: number; z1: number }
>();

function trackPath(t: Track) {
  const n = t.xs.length;
  let c = trackPaths.get(t);
  if (c !== undefined && c.n === n) return c;
  const path = new Path2D();
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = t.xs[i];
    const z = t.zs[i];
    if (i === 0) path.moveTo(x, z);
    else path.lineTo(x, z);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  c = { n, path, x0, z0, x1, z1 };
  trackPaths.set(t, c);
  return c;
}

let nj: { frame: NjFrame; x: number; z: number; poly: [number, number][] } | null | undefined;

/** The secret spot (resolved once: grows the +Z line out to ~19 km). */
export function secretSpot() {
  if (nj !== undefined) return nj;
  try {
    const f = njFrameNow();
    if (f === null) return (nj = null);
    const o = { x: 0, z: 0 };
    const at = (a: number, b: number): [number, number] => {
      njToWorld(f, a, b, o);
      return [o.x, o.z];
    };
    const [x, z] = at(NJ.W / 2, NJ.L / 2);
    nj = { frame: f, x, z, poly: [at(0, 0), at(NJ.W, 0), at(NJ.W, NJ.L), at(0, NJ.L)] };
  } catch {
    nj = null;
  }
  return nj;
}

/** Mega ramp anchors on the lines grown so far. */
function megaSpots(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const p = { x: 0, z: 0, h: 0, k: 0 };
  for (const t of tracks.tracks) {
    if (t.depth !== 0) continue;
    const grown = t.s0 + (t.xs.length - 1) * 12;
    for (const m of t.megas) {
      if (Number.isNaN(m.ax)) {
        if (m.s + 80 > grown) continue;
        tracks.pointAt(t, m.s + 60, p);
        m.ax = p.x + Math.cos(p.h) * m.side * MEGA_SITE.off;
        m.az = p.z - Math.sin(p.h) * m.side * MEGA_SITE.off;
      }
      out.push({ x: m.ax, z: m.az });
    }
  }
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Round-cornered square centred on the city, `de` out from its wall. */
function ring(ctx: CanvasRenderingContext2D, de: number) {
  const w = MOUNTAIN.wallZ;
  const r = de;
  const e = w + de;
  ctx.moveTo(-w, -e);
  ctx.lineTo(w, -e);
  ctx.arc(w, -w, r, -Math.PI / 2, 0);
  ctx.lineTo(e, w);
  ctx.arc(w, w, r, 0, Math.PI / 2);
  ctx.lineTo(-w, e);
  ctx.arc(-w, w, r, Math.PI / 2, Math.PI);
  ctx.lineTo(-e, -w);
  ctx.arc(-w, -w, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

const NICE = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
function niceStep(min: number) {
  return NICE.find(n => n >= min) ?? 10_000;
}

/** World → canvas (CSS px) for this view. */
export function toScreen(v: MapView, w: number, h: number, x: number, z: number) {
  const dx = (x - v.cx) * v.s;
  const dz = (z - v.cz) * v.s;
  const c = Math.cos(v.rot);
  const s = Math.sin(v.rot);
  return { x: w / 2 + dx * c - dz * s, y: h / 2 + dx * s + dz * c };
}

/** Canvas (CSS px) → world. */
export function toWorld(v: MapView, w: number, h: number, sx: number, sy: number) {
  const dx = sx - w / 2;
  const dy = sy - h / 2;
  const c = Math.cos(-v.rot);
  const s = Math.sin(-v.rot);
  return { x: v.cx + (dx * c - dy * s) / v.s, z: v.cz + (dx * s + dy * c) / v.s };
}

let labelW = Infinity;

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  o: { color?: string; size?: number; bg?: string } = {},
) {
  ctx.font = `800 ${o.size ?? 11}px ui-sans-serif, system-ui, sans-serif`;
  const tw = ctx.measureText(text).width;
  // Keep labels inside the canvas (edge-pinned markers sit at the border)
  x = Math.min(Math.max(x, tw / 2 + 6), labelW - tw / 2 - 6);
  ctx.fillStyle = o.bg ?? 'rgba(17,16,24,.82)';
  ctx.fillRect(x - tw / 2 - 5, y - (o.size ?? 11) - 3, tw + 10, (o.size ?? 11) + 7);
  ctx.fillStyle = o.color ?? '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

// ── Draw ────────────────────────────────────────────────────────────────

export interface DrawOpts {
  /** Full map: labels, distance rings, the secret spot always on. */
  full: boolean;
  /** Clamp the waypoint and the secret spot to the edge (minimap). */
  edgeMarkers: boolean;
}

export function drawMap(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dpr: number,
  v: MapView,
  scene: MapScene,
  o: DrawOpts,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  labelW = w;
  const R = Math.hypot(w, h) / 2 / v.s; // visible radius, m
  const deC = edgeDistance(v.cx, v.cz);

  // Land: darker the further down the mountain the view sits
  const far = Math.min(1, deC / 12000);
  ctx.fillStyle = far > 0.5 ? C.landFar : C.land;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(v.rot);
  ctx.scale(v.s, v.s);
  ctx.translate(-v.cx, -v.cz);
  const px = 1 / v.s; // one CSS pixel in metres

  if (scene.mountain) {
    // Contours: the downhill gradient, a ring every `step` metres out
    const step = niceStep(16 * px);
    const major = step * (step >= 1000 ? 5 : step >= 100 ? 10 : 4);
    const d0 = Math.max(step, Math.floor((deC - R) / step) * step);
    const d1 = deC + R;
    let n = 0;
    for (let de = d0; de <= d1 && n < 240; de += step, n++) {
      ctx.beginPath();
      ring(ctx, de);
      const isMajor = de % major === 0;
      ctx.strokeStyle = isMajor ? C.contourMajor : C.contour;
      ctx.lineWidth = (isMajor ? 1.6 : 1) * px;
      ctx.stroke();
    }

    // Dirt tracks: casing then fill, branches a touch thinner
    const vx0 = v.cx - R;
    const vx1 = v.cx + R;
    const vz0 = v.cz - R;
    const vz1 = v.cz + R;
    const visible: { path: Path2D; main: boolean }[] = [];
    for (const t of tracks.tracks) {
      if (t.xs.length < 2) continue;
      const p = trackPath(t);
      if (p.x1 < vx0 || p.x0 > vx1 || p.z1 < vz0 || p.z0 > vz1) continue;
      visible.push({ path: p.path, main: t.depth === 0 });
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const roadW = Math.max(3 * px, MOUNTAIN.trackHalf * 2);
    for (const t of visible) {
      ctx.strokeStyle = C.roadCase;
      ctx.lineWidth = (t.main ? roadW : roadW * 0.75) + 2.5 * px;
      ctx.stroke(t.path);
    }
    for (const t of visible) {
      ctx.strokeStyle = t.main ? C.road : C.branch;
      ctx.lineWidth = t.main ? roadW : roadW * 0.75;
      ctx.stroke(t.path);
    }
  }

  // The city: ring of blocks around the plaza, alleys cut through it
  const W = MOUNTAIN.wallZ;
  ctx.fillStyle = C.block;
  ctx.fillRect(-W, -W, W * 2, W * 2);
  ctx.strokeStyle = C.blockEdge;
  ctx.lineWidth = 2 * px;
  ctx.strokeRect(-W, -W, W * 2, W * 2);
  ctx.fillStyle = C.plaza;
  ctx.fillRect(-ALLEY_O0, -ALLEY_O0, ALLEY_O0 * 2, ALLEY_O0 * 2);
  const q = { x: 0, z: 0 };
  ctx.fillStyle = C.alley;
  for (const al of ALLEYS) {
    ctx.beginPath();
    const pts: [number, number][] = [
      [al.a - al.width / 2, ALLEY_O0 - 1],
      [al.a + al.width / 2, ALLEY_O0 - 1],
      [al.a + al.width / 2, W + 1],
      [al.a - al.width / 2, W + 1],
    ];
    pts.forEach(([a, oo], i) => {
      alleyToWorld(al, a, oo, q);
      if (i === 0) ctx.moveTo(q.x, q.z);
      else ctx.lineTo(q.x, q.z);
    });
    ctx.closePath();
    ctx.fill();
  }
  // Street cross + fountain
  ctx.strokeStyle = 'rgba(17,16,24,.18)';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(-ALLEY_O0, 0);
  ctx.lineTo(ALLEY_O0, 0);
  ctx.moveTo(0, -ALLEY_O0);
  ctx.lineTo(0, ALLEY_O0);
  ctx.stroke();

  // Secret spot footprint
  const spot = scene.mountain && (o.full || v.s > 0.05) ? secretSpot() : null;
  if (spot !== null) {
    ctx.beginPath();
    spot.poly.forEach(([x, z], i) => (i === 0 ? ctx.moveTo(x, z) : ctx.lineTo(x, z)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,61,139,.35)';
    ctx.fill();
    ctx.strokeStyle = C.nj;
    ctx.lineWidth = 3 * px;
    ctx.stroke();
  }
  // The Noggle Bowl's rim + deck (once someone's been near enough to fix it)
  const rim = scene.mountain ? bowlOutline() : null;
  if (rim !== null) {
    ctx.beginPath();
    rim.forEach(([x, z], i) => (i === 0 ? ctx.moveTo(x, z) : ctx.lineTo(x, z)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(143,107,255,.35)';
    ctx.fill();
    ctx.strokeStyle = C.bowl;
    ctx.lineWidth = 3 * px;
    ctx.stroke();
  }
  ctx.restore();

  // ── Screen-space markers (never rotated) ──
  const S = (x: number, z: number) => toScreen(v, w, h, x, z);
  const inside = (p: { x: number; y: number }, m = 0) =>
    p.x >= m && p.y >= m && p.x <= w - m && p.y <= h - m;
  // Edge pins: the full map keeps them clear of its header and legend bar
  const padY = o.full ? 72 : 0;
  const edge = (p: { x: number; y: number }, m: number) => {
    const dx = p.x - w / 2;
    const dy = p.y - h / 2;
    const k = Math.min(
      (w / 2 - m) / Math.abs(dx || 1e-6),
      (h / 2 - m - padY) / Math.abs(dy || 1e-6),
      1,
    );
    return { x: w / 2 + dx * k, y: h / 2 + dy * k };
  };

  if (o.full) {
    if (v.s > 0.6) {
      const c = S(0, 0);
      label(ctx, 'THE PLAZA', c.x, c.y + 4, { size: 12 });
      for (const al of ALLEYS) {
        alleyToWorld(al, al.a, W + 14, q);
        const p = S(q.x, q.z);
        label(ctx, al.label, p.x, p.y, { size: 10, bg: 'rgba(17,16,24,.7)' });
      }
    } else {
      const c = S(0, 0);
      label(ctx, 'NOUN CITY', c.x, c.y - 10, { size: 12 });
    }
    // Distance markers down the DOWNHILL line
    if (scene.mountain) {
      const step = niceStep(110 / v.s);
      const km = step >= 1000 ? step : Math.max(1000, step);
      for (let d = km; d <= 25_000; d += km) {
        const p = S(0, W + d);
        if (inside(p, 10))
          label(ctx, `${d / 1000} km`, p.x + 26, p.y + 4, { size: 10, bg: 'rgba(17,16,24,.55)' });
      }
    }
  }

  // Mega ramps
  if (scene.mountain) {
    for (const m of megaSpots()) {
      const p = S(m.x, m.z);
      if (!inside(p, -10)) continue;
      ctx.fillStyle = C.mega;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x - 8, p.y + 6);
      ctx.lineTo(p.x + 8, p.y + 6);
      ctx.lineTo(p.x + 8, p.y - 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (o.full && v.s > 0.08) label(ctx, 'MEGA RAMP', p.x, p.y - 12, { size: 10, color: C.mega });
    }
  }

  // Secret spot pin
  if (spot !== null) {
    let p = S(spot.x, spot.z);
    const off = !inside(p, 14);
    if (!off || o.full || o.edgeMarkers) {
      if (off) p = edge(p, 14);
      pin(ctx, p.x, p.y, C.nj, '★');
      if (o.full)
        label(ctx, off ? 'NOUN JERSEY HIGH ★ 19 km' : 'NOUN JERSEY HIGH', p.x, p.y - 22, {
          size: 11,
          color: C.nj,
        });
    }
  }

  // The Noggle Bowl (the second secret spot, ~42 km down the −X line)
  const bowl = scene.mountain && (o.full || v.s > 0.05) ? bowlMapPoint() : null;
  if (bowl !== null) {
    let p = S(bowl.x, bowl.z);
    const off = !inside(p, 14);
    if (!off || o.full || o.edgeMarkers) {
      if (off) p = edge(p, 14);
      pin(ctx, p.x, p.y, C.bowl, '◎');
      if (o.full)
        label(ctx, off ? 'NOGGLE BOWL ◎ 42 km' : 'NOGGLE BOWL', p.x, p.y - 22, {
          size: 11,
          color: C.bowl,
        });
    }
  }

  // Waypoint
  if (scene.waypoint !== null) {
    let p = S(scene.waypoint.x, scene.waypoint.z);
    const off = !inside(p, 12);
    if (o.full) {
      const me = S(scene.me.x, scene.me.z);
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = C.way;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(me.x, me.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (!off || o.edgeMarkers) {
      if (off) p = edge(p, 12);
      pin(ctx, p.x, p.y, C.way, '✚');
      const d = Math.hypot(scene.waypoint.x - scene.me.x, scene.waypoint.z - scene.me.z);
      if (o.full || off)
        label(
          ctx,
          d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`,
          p.x,
          p.y + 22,
          {
            size: 10,
            color: C.way,
          },
        );
    }
  }

  // Other riders
  for (const r of scene.riders) {
    let p = S(r.x, r.z);
    const off = !inside(p, 8);
    if (off && !o.full && !o.edgeMarkers) continue;
    if (off) p = edge(p, 8);
    ctx.fillStyle = C.rider;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (o.full) label(ctx, r.name, p.x, p.y - 9, { size: 10, color: C.rider });
  }

  // You: an arrow along your heading
  {
    const p = S(scene.me.x, scene.me.z);
    const a = scene.me.yaw;
    const fx = Math.sin(a);
    const fz = Math.cos(a);
    const tip = S(scene.me.x + fx, scene.me.z + fz);
    const ang = Math.atan2(tip.y - p.y, tip.x - p.x);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang);
    ctx.fillStyle = C.me;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-8, 8);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-8, -8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function pin(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, glyph: string) {
  ctx.fillStyle = color;
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.ink;
  ctx.font = '900 12px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, x, y + 1);
}
