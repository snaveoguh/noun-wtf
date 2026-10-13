// ── Procedural canvas textures: paint splats, glows, neon signs ────────

import * as THREE from 'three';

let splatAtlas: THREE.CanvasTexture | null = null;

/** Seeded LCG so the atlas looks the same every load. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 2×2 atlas of white paint splat shapes (alpha): a fat central blob,
 * satellite droplets and a couple of streaks. Tinted per instance.
 */
export function getSplatAtlas(): THREE.CanvasTexture {
  if (splatAtlas !== null) return splatAtlas;
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, S, S);
  const cell = S / 2;
  for (let k = 0; k < 4; k++) {
    const rnd = lcg(91 + k * 17);
    const ox = (k % 2) * cell + cell / 2;
    const oy = Math.floor(k / 2) * cell + cell / 2;
    g.fillStyle = '#fff';
    // Core: lumpy blob from overlapping circles
    const core = cell * (0.2 + rnd() * 0.05);
    g.beginPath();
    g.arc(ox, oy, core, 0, Math.PI * 2);
    g.fill();
    const lumps = 7 + Math.floor(rnd() * 5);
    for (let i = 0; i < lumps; i++) {
      const a = rnd() * Math.PI * 2;
      const d = core * (0.55 + rnd() * 0.45);
      const r = core * (0.35 + rnd() * 0.35);
      g.beginPath();
      g.arc(ox + Math.cos(a) * d, oy + Math.sin(a) * d, r, 0, Math.PI * 2);
      g.fill();
    }
    // Streaks: tapered spikes from the core
    const spikes = 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < spikes; i++) {
      const a = rnd() * Math.PI * 2;
      const len = core * (1.3 + rnd() * 0.8);
      const w = core * (0.12 + rnd() * 0.12);
      const ex = ox + Math.cos(a) * len;
      const ey = oy + Math.sin(a) * len;
      g.beginPath();
      g.moveTo(ox + Math.cos(a + Math.PI / 2) * w, oy + Math.sin(a + Math.PI / 2) * w);
      g.lineTo(ex, ey);
      g.lineTo(ox + Math.cos(a - Math.PI / 2) * w, oy + Math.sin(a - Math.PI / 2) * w);
      g.closePath();
      g.fill();
      g.beginPath();
      g.arc(ex, ey, w * 0.9, 0, Math.PI * 2);
      g.fill();
    }
    // Droplets
    const drops = 10 + Math.floor(rnd() * 10);
    for (let i = 0; i < drops; i++) {
      const a = rnd() * Math.PI * 2;
      const d = core * (1.4 + rnd() * 1.1);
      const r = core * (0.04 + rnd() * 0.12);
      const x = ox + Math.cos(a) * d;
      const y = oy + Math.sin(a) * d;
      if (Math.abs(x - ox) > cell * 0.48 || Math.abs(y - oy) > cell * 0.48) continue;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  splatAtlas = new THREE.CanvasTexture(c);
  splatAtlas.colorSpace = THREE.SRGBColorSpace;
  splatAtlas.generateMipmaps = true;
  splatAtlas.anisotropy = 4;
  return splatAtlas;
}

let glow: THREE.CanvasTexture | null = null;

/** Soft radial glow (white → transparent). */
export function getGlow(): THREE.CanvasTexture {
  if (glow !== null) return glow;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  glow = new THREE.CanvasTexture(c);
  glow.colorSpace = THREE.SRGBColorSpace;
  return glow;
}

/** A neon sign: glowing text on a transparent canvas. */
export function neonSign(
  text: string,
  color: string,
  opts: { w?: number; h?: number; font?: string; frame?: boolean } = {},
): THREE.CanvasTexture {
  const W = opts.w ?? 512;
  const H = opts.h ?? 160;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  if (opts.frame === true) {
    g.fillStyle = 'rgba(8,6,20,0.85)';
    g.fillRect(6, 6, W - 12, H - 12);
    g.strokeStyle = color;
    g.lineWidth = 6;
    g.shadowColor = color;
    g.shadowBlur = 18;
    g.strokeRect(10, 10, W - 20, H - 20);
  }
  g.font = opts.font ?? `900 ${Math.round(H * 0.52)}px "Londrina Solid", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  for (const blur of [32, 16, 6]) {
    g.shadowBlur = blur;
    g.fillStyle = color;
    g.fillText(text, W / 2, H / 2 + 2);
  }
  g.shadowBlur = 0;
  g.fillStyle = '#ffffff';
  g.globalAlpha = 0.85;
  g.fillText(text, W / 2, H / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Big letter badge for Turf zones (A / B / C). */
export function letterBadge(letter: string): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#111';
  g.font = `900 ${S * 0.6}px "Londrina Solid", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, S / 2, S / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Corrugated metal stripes (for walls / containers), tinted by vertex colour. */
let corrugated: THREE.CanvasTexture | null = null;
export function getCorrugated(): THREE.CanvasTexture {
  if (corrugated !== null) return corrugated;
  const W = 256;
  const c = document.createElement('canvas');
  c.width = c.height = W;
  const g = c.getContext('2d')!;
  for (let x = 0; x < W; x++) {
    const k = 0.78 + 0.22 * Math.sin((x / W) * Math.PI * 2 * 16);
    const v = Math.round(255 * k);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x, 0, 1, W);
  }
  // grime
  const rnd = lcg(7);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.05})`;
    g.fillRect(rnd() * W, rnd() * W, 2 + rnd() * 10, 2 + rnd() * 30);
  }
  corrugated = new THREE.CanvasTexture(c);
  corrugated.wrapS = corrugated.wrapT = THREE.RepeatWrapping;
  corrugated.colorSpace = THREE.SRGBColorSpace;
  return corrugated;
}
