// ── The pond at the bottom of the desk ──────────────────────────────────
//
// A 2D canvas that mirrors every open window into rippling water: each frame
// we read the windows' on-screen rects, paint stylised silhouettes (body,
// title bar, a few lines of "text") flipped about the waterline into an
// offscreen buffer, then copy it back row by row with sine + ripple
// displacement. Reeds, cattails, ferns, lily pads and fireflies sit on top,
// swaying, with a little parallax from the pointer.

import { useEffect, useImperativeHandle, useRef } from 'react';

export interface WaterHandle {
  ripple(x: number, y: number, strength?: number): void;
  /** Screen-space y of the waterline */
  horizon(): number;
}

interface Ripple {
  x: number;
  y: number;
  t0: number;
  s: number;
}

interface Reed {
  x: number;
  h: number;
  lean: number;
  phase: number;
  w: number;
  cattail: boolean;
  depth: number; // 0 = far (smaller, darker) … 1 = near
}

interface Pad {
  x: number;
  y: number;
  r: number;
  rot: number;
  flower: boolean;
  phase: number;
}

const WATER_FRACTION = 0.22;

export const waterHeight = () => Math.max(120, Math.round(window.innerHeight * WATER_FRACTION));

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const WaterGarden = function WaterGarden({
  ref,
  active,
}: { active: boolean } & { ref?: React.RefObject<WaterHandle | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ripples = useRef<Ripple[]>([]);
  const pointer = useRef({ x: 0.5, y: 0.5 });
  const activeRef = useRef(active);
  activeRef.current = active;

  useImperativeHandle(ref, () => ({
    ripple(x, y, s = 1) {
      ripples.current.push({
        x,
        y: y - (window.innerHeight - waterHeight()),
        t0: performance.now(),
        s,
      });
      if (ripples.current.length > 12) ripples.current.shift();
    },
    horizon: () => window.innerHeight - waterHeight(),
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const buf = document.createElement('canvas');
    const bctx = buf.getContext('2d')!;
    const SCALE = 0.75; // render below native res; water hides it
    let W = 0;
    let H = 0;
    let reeds: Reed[] = [];
    let pads: Pad[] = [];
    let flies: { x: number; y: number; p: number; s: number }[] = [];

    const layout = () => {
      W = Math.round(window.innerWidth * SCALE);
      H = Math.round(waterHeight() * SCALE);
      canvas.width = W;
      canvas.height = Math.round(H * 1.9); // extra headroom above the waterline for plants
      canvas.style.height = `${Math.round(canvas.height / SCALE)}px`;
      buf.width = W;
      buf.height = H;
      const r = rand(0x0991e5);
      reeds = [];
      const clump = (cx: number, n: number, spread: number, tall: number) => {
        for (let i = 0; i < n; i++) {
          const depth = r();
          reeds.push({
            x: cx + (r() - 0.5) * spread,
            h: tall * (0.45 + r() * 0.75) * (0.7 + depth * 0.5),
            lean: (r() - 0.5) * 0.35,
            phase: r() * Math.PI * 2,
            w: 1.2 + depth * 2.2,
            cattail: r() < 0.28,
            depth,
          });
        }
      };
      const tall = H * 1.25;
      clump(W * 0.03, 26, W * 0.09, tall);
      clump(W * 0.97, 24, W * 0.08, tall * 0.95);
      clump(W * 0.27, 9, W * 0.05, tall * 0.6);
      clump(W * 0.71, 11, W * 0.06, tall * 0.7);
      reeds.sort((a, b) => a.depth - b.depth);
      pads = [];
      for (let i = 0; i < Math.round(W / 70); i++) {
        pads.push({
          x: r() * W,
          y: H * (0.25 + r() * 0.7),
          r: 7 + r() * 14,
          rot: r() * Math.PI * 2,
          flower: r() < 0.3,
          phase: r() * 6,
        });
      }
      pads.sort((a, b) => a.y - b.y);
      flies = Array.from({ length: 16 }, () => ({
        x: r() * W,
        y: r() * H * 0.8,
        p: r() * 9,
        s: 0.4 + r(),
      }));
    };
    layout();
    window.addEventListener('resize', layout);
    const onPointer = (e: PointerEvent) => {
      pointer.current.x = e.clientX / window.innerWidth;
      pointer.current.y = e.clientY / window.innerHeight;
    };
    window.addEventListener('pointermove', onPointer);

    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (!activeRef.current || now - last < 33) return; // ~30 fps, idle when hidden
      last = now;
      const t = now / 1000;
      const top = canvas.height - H; // waterline inside the canvas
      const horizonScreen = window.innerHeight - waterHeight();
      const px = (pointer.current.x - 0.5) * 2;

      // ── 1. reflections into the buffer (water-local coords, y down from the line)
      bctx.clearRect(0, 0, W, H);
      const wins = [...document.querySelectorAll<HTMLElement>('[data-nos-win]')]
        .filter(el => !el.classList.contains('is-sunk'))
        .sort((a, b) => Number(b.dataset.nosRank) - Number(a.dataset.nosRank));
      const k = 0.62; // perspective squash of the mirror image
      for (const el of wins) {
        const r = el.getBoundingClientRect();
        if (r.top >= horizonScreen) continue;
        const bottom = Math.min(r.bottom, horizonScreen);
        const y0 = (horizonScreen - bottom) * k * SCALE;
        const y1 = (horizonScreen - r.top) * k * SCALE;
        const x0 = r.left * SCALE;
        const w = r.width * SCALE;
        const rank = Number(el.dataset.nosRank);
        const dark = el.classList.contains('is-dark');
        const focused = el.classList.contains('is-focused');
        const fade = Math.max(0.25, 1 - rank * 0.25);
        bctx.globalAlpha = fade;
        bctx.fillStyle = dark ? '#05070a' : '#d9d7cc';
        bctx.fillRect(x0, y0, w, y1 - y0);
        // "text" lines
        bctx.fillStyle = dark ? 'rgba(120,255,140,.35)' : 'rgba(20,20,24,.28)';
        for (let ly = y0 + 10; ly < y1 - 18; ly += 9) {
          const lw = w * (0.35 + 0.5 * Math.abs(Math.sin(ly * 12.9898 + x0)));
          bctx.fillRect(x0 + 10, ly, lw, 2.5);
        }
        // title bar (top of the window = far end of the reflection)
        bctx.fillStyle = focused ? '#d4ff3a' : '#16161a';
        bctx.fillRect(x0, y1 - 16 * SCALE * k * 1.6, w, 16 * SCALE * k * 1.6);
        bctx.strokeStyle = focused ? 'rgba(212,255,58,.8)' : 'rgba(236,235,228,.5)';
        bctx.lineWidth = 1.5;
        bctx.strokeRect(x0, y0, w, y1 - y0);
      }
      bctx.globalAlpha = 1;

      // ── 2. water body
      ctx.clearRect(0, 0, W, canvas.height);
      const g = ctx.createLinearGradient(0, top, 0, canvas.height);
      g.addColorStop(0, '#0d2a33');
      g.addColorStop(0.35, '#08181f');
      g.addColorStop(1, '#020607');
      ctx.fillStyle = g;
      ctx.fillRect(0, top, W, H);

      // ── 3. reflection, copied row by row with wave + ripple displacement
      const rip = ripples.current.filter(rp => now - rp.t0 < 4000);
      ripples.current = rip;
      for (let y = 0; y < H; y += 2) {
        const depth = y / H;
        let dx =
          Math.sin(y * 0.33 + t * 2.1) * (1 + depth * 5) +
          Math.sin(y * 0.071 - t * 0.9) * 3 * depth;
        let dy = 0;
        for (const rp of rip) {
          const age = (now - rp.t0) / 1000;
          const ry = rp.y * SCALE;
          const d = Math.abs(y - ry);
          const radius = age * 70 * SCALE;
          const band = Math.abs(d * 2.4 - radius);
          if (band < 14) {
            const amp = (1 - band / 14) * 7 * rp.s * Math.max(0, 1 - age / 4);
            dx += Math.sin(band) * amp;
            dy += Math.cos(band) * amp * 0.4;
          }
        }
        ctx.globalAlpha = 0.62 * (1 - depth * 0.75);
        ctx.drawImage(buf, 0, Math.max(0, Math.min(H - 2, y + dy)), W, 2, dx, top + y, W, 2);
      }
      ctx.globalAlpha = 1;

      // teal wash + glints
      ctx.fillStyle = 'rgba(16,70,82,.28)';
      ctx.fillRect(0, top, W, H);
      ctx.fillStyle = 'rgba(200,240,255,.16)';
      for (let i = 0; i < 46; i++) {
        const gy = (i * 37.7) % H | 0;
        const gx = ((i * 211.3 + t * (8 + (i % 5) * 4)) % (W + 80)) - 40;
        const gw = 6 + (i % 7) * 5 * (1 - gy / H);
        ctx.fillRect(gx, top + gy, gw, 1);
      }
      // ripple rings
      for (const rp of rip) {
        const age = (now - rp.t0) / 1000;
        const a = Math.max(0, 1 - age / 3.2);
        ctx.strokeStyle = `rgba(212,255,58,${0.35 * a * rp.s})`;
        ctx.lineWidth = 1;
        for (let j = 0; j < 3; j++) {
          const rr = Math.max(0, age * 70 - j * 16) * SCALE;
          ctx.beginPath();
          ctx.ellipse(rp.x * SCALE, top + rp.y * SCALE, rr, rr * 0.28, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // waterline glow
      const lg = ctx.createLinearGradient(0, top - 2, 0, top + 6);
      lg.addColorStop(0, 'rgba(212,255,58,0)');
      lg.addColorStop(0.4, 'rgba(180,240,255,.22)');
      lg.addColorStop(1, 'rgba(180,240,255,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(0, top - 2, W, 8);

      // ── 4. lily pads
      for (const p of pads) {
        const bob = Math.sin(t * 0.9 + p.phase) * 1.2;
        const sx = p.x + px * 6 * (p.y / H);
        const sy = top + p.y + bob;
        const scale = 0.6 + (p.y / H) * 0.7;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.scale(1, 0.38);
        ctx.rotate(p.rot + Math.sin(t * 0.3 + p.phase) * 0.05);
        ctx.fillStyle = '#163d22';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, p.r * scale, 0.35, Math.PI * 2 - 0.05);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#3f8a43';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
        if (p.flower) {
          ctx.fillStyle = '#ff7ab8';
          for (let k2 = 0; k2 < 5; k2++) {
            const a = (k2 / 5) * Math.PI * 2 + t * 0.1;
            ctx.beginPath();
            ctx.ellipse(
              sx + Math.cos(a) * 3 * scale,
              sy - 3 * scale + Math.sin(a) * 1.4 * scale,
              2.6 * scale,
              1.5 * scale,
              a,
              0,
              Math.PI * 2,
            );
            ctx.fill();
          }
          ctx.fillStyle = '#ffe14a';
          ctx.fillRect(sx - 1, sy - 4 * scale, 2, 2);
        }
      }

      // ── 5. reeds + cattails (near ones sway more and parallax harder)
      for (const rd of reeds) {
        const baseX = rd.x + px * (4 + rd.depth * 18);
        const baseY = canvas.height - (1 - rd.depth) * H * 0.55;
        const sway =
          Math.sin(t * (0.7 + rd.depth * 0.5) + rd.phase) * (0.05 + rd.depth * 0.07) + rd.lean;
        const tipX = baseX + Math.sin(sway) * rd.h;
        const tipY = baseY - Math.cos(sway) * rd.h;
        const cx = baseX + Math.sin(sway * 0.4) * rd.h * 0.5;
        const cy = baseY - rd.h * 0.55;
        const shade = 18 + rd.depth * 40;
        ctx.strokeStyle = `rgb(${shade * 0.5},${shade + 22},${shade * 0.6})`;
        ctx.lineWidth = rd.w;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.quadraticCurveTo(cx, cy, tipX, tipY);
        ctx.stroke();
        if (rd.cattail) {
          const hx = baseX + (tipX - baseX) * 0.78;
          const hy = baseY + (tipY - baseY) * 0.78;
          ctx.strokeStyle = `rgb(${70 + rd.depth * 40},${40 + rd.depth * 20},20)`;
          ctx.lineWidth = rd.w * 2.6;
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.lineTo(hx + (tipX - baseX) * 0.12, hy + (tipY - baseY) * 0.12);
          ctx.stroke();
        }
      }

      // ── 6. fireflies
      for (const f of flies) {
        const fx = (f.x + Math.sin(t * 0.4 * f.s + f.p) * 30 + px * 10) % W;
        const fy = top - 10 - f.y * 0.6 + Math.cos(t * 0.6 * f.s + f.p) * 12;
        const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * 1.7 * f.s + f.p));
        ctx.fillStyle = `rgba(212,255,58,${a * 0.18})`;
        ctx.beginPath();
        ctx.arc(fx, fy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(236,255,170,${a})`;
        ctx.fillRect(fx - 1, fy - 1, 2, 2);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', layout);
      window.removeEventListener('pointermove', onPointer);
    };
  }, []);

  return <canvas ref={canvasRef} className="nos-water" aria-hidden />;
};

export default WaterGarden;
