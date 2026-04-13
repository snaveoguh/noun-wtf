import {
  SATURATION_FACTOR,
  type LayerVisibility,
  type NounLayers,
  type VoxelPixel,
  type VoxelMap,
  DEFAULT_VOXEL_DEPTH,
} from './types';
import { voxelKey } from './voxelMap';

// ─── Color utilities ────────────────────────────────────────────────────────

export function saturate(r: number, g: number, b: number, factor: number) {
  if (factor === 1.0) return { r, g, b }; // no-op: true colors
  const rf = r / 255,
    gf = g / 255,
    bf = b / 255;
  const max = Math.max(rf, gf, bf),
    min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rf:
        h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6;
        break;
      case gf:
        h = ((bf - rf) / d + 2) / 6;
        break;
      case bf:
        h = ((rf - gf) / d + 4) / 6;
        break;
    }
  }
  s = Math.min(1, s * factor);
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q2 = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q2;
  return {
    r: Math.round(hue2rgb(p, q2, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q2, h) * 255),
    b: Math.round(hue2rgb(p, q2, h - 1 / 3) * 255),
  };
}

// ─── RLE decoder ────────────────────────────────────────────────────────────

export function decodeRLE(data: string) {
  const hex = data.replace(/^0x/, '');
  const bounds = {
    top: parseInt(hex.substring(2, 4), 16),
    right: parseInt(hex.substring(4, 6), 16),
    bottom: parseInt(hex.substring(6, 8), 16),
    left: parseInt(hex.substring(8, 10), 16),
  };
  const pairs: [number, number][] =
    hex
      .substring(10)
      .match(/.{1,4}/g)
      ?.map(r => [parseInt(r.substring(0, 2), 16), parseInt(r.substring(2, 4), 16)]) ?? [];
  return { bounds, pairs };
}

// ─── Decode parts into pixel layers ─────────────────────────────────────────

export function decodeParts(
  parts: { data: string }[],
  palette: string[],
  satFactor: number = SATURATION_FACTOR,
): VoxelPixel[] {
  const colorGrid: (string | null)[][] = Array.from({ length: 32 }, () => Array(32).fill(null));
  for (const part of parts) {
    const { bounds, pairs } = decodeRLE(part.data);
    let x = bounds.left,
      y = bounds.top;
    for (const [runLength, colorIndex] of pairs) {
      for (let i = 0; i < runLength; i++) {
        if (colorIndex !== 0 && y < 32 && x < 32) colorGrid[y][x] = palette[colorIndex];
        x++;
        if (x >= bounds.right) {
          x = bounds.left;
          y++;
        }
      }
    }
  }
  const pixels: VoxelPixel[] = [];
  for (let row = 0; row < 32; row++) {
    for (let col = 0; col < 32; col++) {
      const hexStr = colorGrid[row][col];
      if (!hexStr) continue;
      const r = parseInt(hexStr.substring(0, 2), 16);
      const g = parseInt(hexStr.substring(2, 4), 16);
      const b = parseInt(hexStr.substring(4, 6), 16);
      if (isNaN(r) || isNaN(g) || isNaN(b)) continue;
      const sat = saturate(r, g, b, satFactor);
      pixels.push({ x: col, y: 31 - row, r: sat.r, g: sat.g, b: sat.b });
    }
  }
  return pixels;
}

// ─── Accessory classification ───────────────────────────────────────────────

/**
 * Flat/wrap accessories — all-over prints, gradients, stripes, patterns.
 * These wrap the full body at full depth (no extrusion).
 */
const FLAT_ACCESSORY_PATTERNS = [
  'body-gradient-',
  'checker',
  'chain-logo',
  'collar-sunset',
  'sweater',
  'stripes-',
  'stripes_',
  'grid-',
  'matrix',
  'woolweave',
  'wall',
  'wave',
  'rain',
  'tie-dye',
  'decay-',
  'rainbow-steps',
  'taxi-checkers',
  'tatewaku',
  'uroko',
  'lines-45-',
];

/**
 * Classify an accessory by its filename.
 * Returns true if it's a flat/wrap pattern (full depth on body).
 * Returns false if it's a discrete object/bling (front only, extruded).
 */
export function isFlatAccessory(filename: string): boolean {
  const name = filename.toLowerCase();
  return FLAT_ACCESSORY_PATTERNS.some(p => name.includes(p));
}

// ─── Seed → layers (requires @noundry/nouns-assets) ─────────────────────────

/**
 * Decode a noun seed into separated layers with smart accessory routing.
 * Parts: [0]=body, [1]=accessory, [2]=head, [3]=glasses
 *
 * Flat accessories (prints, stripes) merge into body at full depth.
 * Bling accessories (chains, objects, text) render in front of the body,
 * while the head remains above them and glasses stay top-most.
 * Glasses always front-only, extruded.
 */
export function seedToLayers(
  seed: { background: number; body: number; accessory: number; head: number; glasses: number },
  getNounData: (seed: {
    background: number;
    body: number;
    accessory: number;
    head: number;
    glasses: number;
  }) => { parts: { data: string; filename: string }[] },
  palette: string[],
  visibility?: LayerVisibility,
): NounLayers {
  const { parts } = getNounData(seed);
  const vis = visibility ?? { body: true, accessory: true, head: true, glasses: true };

  // Build body layer: body shape + flat accessories
  const bodyParts: { data: string }[] = [];
  if (vis.body) bodyParts.push(parts[0]);

  // Classify accessory
  let blingParts: { data: string }[] = [];
  if (vis.accessory && parts[1]) {
    const accFilename = parts[1].filename || '';
    if (isFlatAccessory(accFilename)) {
      // Flat wrap → merge into body at full depth
      bodyParts.push(parts[1]);
    } else {
      // Bling → separate layer, front-only + extruded
      blingParts = [parts[1]];
    }
  }

  return {
    body: bodyParts.length > 0 ? decodeParts(bodyParts, palette) : [],
    bling: blingParts.length > 0 ? decodeParts(blingParts, palette) : [],
    head: vis.head ? decodeParts([parts[2]], palette) : [],
    glasses: vis.glasses ? decodeParts([parts[3]], palette) : [],
  };
}

// ─── Seed → VoxelMap (with depth) ───────────────────────────────────────────

/**
 * Convert a noun seed directly into a VoxelMap with configurable depth.
 * Body pixels → solid columns. Bling + glasses → front-only, extruded.
 */
export function seedToVoxelMap(
  seed: { background: number; body: number; accessory: number; head: number; glasses: number },
  getNounData: (seed: {
    background: number;
    body: number;
    accessory: number;
    head: number;
    glasses: number;
  }) => { parts: { data: string; filename: string }[] },
  palette: string[],
  depth: number = DEFAULT_VOXEL_DEPTH,
  visibility?: LayerVisibility,
): VoxelMap {
  const layers = seedToLayers(seed, getNounData, palette, visibility);
  const map: VoxelMap = new Map();

  const toHex = (p: VoxelPixel) =>
    `#${p.r.toString(16).padStart(2, '0')}${p.g.toString(16).padStart(2, '0')}${p.b.toString(16).padStart(2, '0')}`;

  // Body pixels → solid columns
  for (const p of layers.body) {
    const hex = toHex(p);
    for (let z = 0; z < depth; z++) {
      map.set(voxelKey(p.x, p.y, z), hex);
    }
  }

  // Bling → front-only, 1px extruded from body front face
  for (const p of layers.bling) {
    const hex = toHex(p);
    map.set(voxelKey(p.x, p.y, depth), hex);
  }

  // Head sits above the accessory so facial features are never hidden by bling.
  for (const p of layers.head) {
    const hex = toHex(p);
    map.set(voxelKey(p.x, p.y, depth + 1), hex);
  }

  // Glasses → front-only, 1px extruded (on top of head if overlap)
  for (const p of layers.glasses) {
    const hex = toHex(p);
    map.set(voxelKey(p.x, p.y, depth + 2), hex);
  }

  return map;
}
