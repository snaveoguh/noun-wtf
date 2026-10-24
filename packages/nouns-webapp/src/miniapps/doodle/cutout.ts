/**
 * Turn a phone photo of a crayon drawing into a game sticker, in the browser:
 * white-balance against the paper, keep the coloured marks, fill the paper
 * texture specks and enclosed shapes, drop stray dots, then add a white
 * sticker outline. Returns a data URL (webp where supported).
 */

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const WORK_MAX = 900;
const OUT_MAX_H = 560;

export const loadImage = (file: Blob): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not open that picture'));
    };
    img.src = url;
  });

/** Separable square max (dilate) or min (erode) filter on a 0/1 mask. */
const morph = (m: Uint8Array, w: number, h: number, r: number, dilate: boolean): Uint8Array => {
  const want = dilate ? 1 : 0;
  const tmp = new Uint8Array(m.length);
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1 - want;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) {
        if (m[y * w + k] === want) {
          v = want;
          break;
        }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = 1 - want;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
        if (tmp[k * w + x] === want) {
          v = want;
          break;
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
};

/** Label 4-connected components of value 1; returns labels and sizes. */
const components = (m: Uint8Array, w: number, h: number) => {
  const labels = new Int32Array(m.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || labels[i] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(i);
    labels[i] = id;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % w;
      const y = (p - x) / w;
      const n = [
        x > 0 ? p - 1 : -1,
        x < w - 1 ? p + 1 : -1,
        y > 0 ? p - w : -1,
        y < h - 1 ? p + w : -1,
      ];
      for (const q of n) {
        if (q >= 0 && m[q] && labels[q] < 0) {
          labels[q] = id;
          stack.push(q);
        }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
};

export const cutOutDrawing = (img: HTMLImageElement, crop: CropRect): string => {
  const scale = Math.min(1, WORK_MAX / Math.max(crop.w, crop.h));
  const w = Math.max(1, Math.round(crop.w * scale));
  const h = Math.max(1, Math.round(crop.h * scale));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  const data = c.getImageData(0, 0, w, h);
  const px = data.data;
  const n = w * h;

  // Paper colour: median of the brightest 40% of pixels, per channel.
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2];
  const sorted = Float32Array.from(lum).sort();
  const cut = sorted[Math.floor(n * 0.6)];
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let i = 0; i < n; i += 3) {
    if (lum[i] >= cut) {
      rs.push(px[i * 4]);
      gs.push(px[i * 4 + 1]);
      bs.push(px[i * 4 + 2]);
    }
  }
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1] || 255;
  const pr = 245 / med(rs);
  const pg = 245 / med(gs);
  const pb = 245 / med(bs);

  // White-balance, then mark ink: coloured or clearly darker than paper.
  const ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.min(255, px[i * 4] * pr);
    const g = Math.min(255, px[i * 4 + 1] * pg);
    const b = Math.min(255, px[i * 4 + 2] * pb);
    px[i * 4] = r;
    px[i * 4 + 1] = g;
    px[i * 4 + 2] = b;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    ink[i] = sat > 0.2 || mx < 165 ? 1 : 0;
  }

  // Close the paper-texture speckles inside crayon fill.
  const mask = morph(morph(ink, w, h, 5, true), w, h, 4, false);

  // Drop small stray marks (keep anything at least 4% of the biggest shape).
  const { labels, sizes } = components(mask, w, h);
  const biggest = Math.max(0, ...sizes);
  for (let i = 0; i < n; i++) if (mask[i] && sizes[labels[i]] < biggest * 0.04) mask[i] = 0;

  // Fill enclosed holes: paper not reachable from the border becomes body.
  const outside = new Uint8Array(n);
  const stack: number[] = [];
  const seed = (p: number) => {
    if (!mask[p] && !outside[p]) {
      outside[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < n - w) seed(p + w);
  }
  for (let i = 0; i < n; i++) if (!outside[i]) mask[i] = 1;

  // Repaint paper specks inside crayon areas with a nearby ink colour so
  // fills look solid, and boost colour a little.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (!ink[i]) {
        for (let d = 1; d <= 4; d++) {
          const j = x + d < w && ink[i + d] ? i + d : x - d >= 0 && ink[i - d] ? i - d : -1;
          if (j >= 0) {
            px[i * 4] = px[j * 4];
            px[i * 4 + 1] = px[j * 4 + 1];
            px[i * 4 + 2] = px[j * 4 + 2];
            break;
          }
        }
      }
      const r = px[i * 4];
      const g = px[i * 4 + 1];
      const b = px[i * 4 + 2];
      const l = (r + g + b) / 3;
      px[i * 4] = Math.max(0, Math.min(255, l + (r - l) * 1.4));
      px[i * 4 + 1] = Math.max(0, Math.min(255, l + (g - l) * 1.4));
      px[i * 4 + 2] = Math.max(0, Math.min(255, l + (b - l) * 1.4));
    }
  }

  // Sticker border: white ring, then a thin dark rim outside it.
  const border = Math.max(4, Math.round(Math.max(w, h) / 90));
  const ring = morph(mask, w, h, border, true);
  const rim = morph(ring, w, h, 2, true);

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i < n; i++) {
    const x = i % w;
    const y = (i - x) / w;
    if (rim[i]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (mask[i]) {
      px[i * 4 + 3] = 255;
    } else if (ring[i]) {
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 255;
      px[i * 4 + 3] = 255;
    } else if (rim[i]) {
      px[i * 4] = 50;
      px[i * 4 + 1] = 40;
      px[i * 4 + 2] = 55;
      px[i * 4 + 3] = 255;
    } else {
      px[i * 4 + 3] = 0;
    }
  }
  if (maxX < minX) throw new Error('No drawing found in that picture');
  c.putImageData(data, 0, 0);

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const s = Math.min(1, OUT_MAX_H / Math.max(bw, bh));
  const out = document.createElement('canvas');
  out.width = Math.round(bw * s);
  out.height = Math.round(bh * s);
  const oc = out.getContext('2d')!;
  oc.imageSmoothingQuality = 'high';
  oc.drawImage(cv, minX, minY, bw, bh, 0, 0, out.width, out.height);
  const webp = out.toDataURL('image/webp', 0.85);
  return webp.startsWith('data:image/webp') ? webp : out.toDataURL('image/png');
};
