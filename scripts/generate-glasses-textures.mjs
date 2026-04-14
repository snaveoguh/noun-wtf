/**
 * Generate correct 32x32 glasses textures for ALL 24 Nouns glasses types.
 *
 * Uses 14.png (pink-purple-multi, extracted from GLB) as a template to
 * classify each opaque UV pixel's role, then paints each type's colors.
 *
 * Template pixel classification by color:
 *   Pink (#ff638d)    → LEFT FRAME (105 px)
 *   Purple (#cc0595)  → RIGHT FRAME (138 px)
 *   Bridge (#ab36be)  → BRIDGE (29 px)
 *   White (#ffffff)   → EYE WHITE HALF (32 px)
 *   Black (#000000)   → EYE BLACK HALF (32 px)
 *
 * Special cases:
 *   [2]  square-black-rgb  → use extracted 2.png directly (RGB dots, not white/black)
 *   [7]  square-fullblack  → all black
 *   [8]  green-blue-multi  → use extracted 8.png directly
 *   [14] pink-purple-multi → use extracted 14.png directly
 *
 * Usage: node scripts/generate-glasses-textures.mjs
 */

import sharp from 'sharp';
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(
  path.join(import.meta.dirname, '..', 'packages', 'nouns-webapp', 'node_modules', '.package-lock.json'),
);
const { ImageData } = require('@noundry/nouns-assets');

const palette = ImageData.palette;
const glassesTraits = ImageData.images.glasses;
const outDir = path.resolve('packages/nouns-webapp/public/models/heads/glasses-textures');
mkdirSync(outDir, { recursive: true });

// ── RLE Decoder ────────────────────────────────────────────────────

function decodeRLE(data) {
  const hex = data.replace(/^0x/, '');
  return {
    top: parseInt(hex.substring(2, 4), 16),
    right: parseInt(hex.substring(4, 6), 16),
    left: parseInt(hex.substring(8, 10), 16),
    pairs: hex.substring(10).match(/.{4}/g)?.map(r => [
      parseInt(r.substring(0, 2), 16),
      parseInt(r.substring(2, 4), 16),
    ]) ?? [],
  };
}

function decodeToPixelMap(partData) {
  const { top, right, left, pairs } = decodeRLE(partData);
  const pixels = new Map();
  let x = left, y = top;
  for (const [runLength, colorIndex] of pairs) {
    for (let i = 0; i < runLength; i++) {
      if (colorIndex !== 0 && y < 32 && x < 32) {
        const hex = palette[colorIndex] || '000000';
        pixels.set(`${x},${y}`, {
          r: parseInt(hex.substring(0, 2), 16),
          g: parseInt(hex.substring(2, 4), 16),
          b: parseInt(hex.substring(4, 6), 16),
        });
      }
      x++;
      if (x >= right) { x = left; y++; }
    }
  }
  return pixels;
}

// ── Read template ──────────────────────────────────────────────────

const templatePath = path.join(outDir, '14.png');
if (!existsSync(templatePath)) {
  console.error('ERROR: Template 14.png not found. Run extract-glasses-textures.mjs first.');
  process.exit(1);
}

const { data: tplData, info: tplInfo } = await sharp(templatePath)
  .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

console.log(`Template: ${tplInfo.width}x${tplInfo.height}`);

// ── Classify template pixels ───────────────────────────────────────

function dist(r1, g1, b1, r2, g2, b2) {
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
}

// Roles: 'frame_left' | 'frame_right' | 'bridge' | 'eye_white' | 'eye_black'
const pixelRoles = new Map();
const W = tplInfo.width, H = tplInfo.height;

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = (y * W + x) * 4;
    const r = tplData[idx], g = tplData[idx + 1], b = tplData[idx + 2], a = tplData[idx + 3];
    if (a === 0) continue;

    const key = `${x},${y}`;
    // Arm pixels (x < 7) are classified by template color like everything else.
    // The template 14.png has pink for left-arm pixels and purple for right-arm
    // pixels, so the color-matching below handles them correctly.
    if (dist(r, g, b, 255, 99, 141) < 20) {    // pink → left frame
      pixelRoles.set(key, 'frame_left');
    } else if (dist(r, g, b, 204, 5, 149) < 20) {     // purple → right frame
      pixelRoles.set(key, 'frame_right');
    } else if (dist(r, g, b, 171, 54, 190) < 30) {    // pinkish-purple → bridge
      pixelRoles.set(key, 'bridge');
    } else if (dist(r, g, b, 255, 255, 255) < 10) {   // white → eye white
      pixelRoles.set(key, 'eye_white');
    } else if (dist(r, g, b, 0, 0, 0) < 10) {         // black → eye black
      pixelRoles.set(key, 'eye_black');
    } else {
      // Unknown — classify by position
      pixelRoles.set(key, x < 15 ? 'frame_left' : 'frame_right');
    }
  }
}

const counts = {};
for (const role of pixelRoles.values()) counts[role] = (counts[role] || 0) + 1;
console.log('Pixel roles:', counts);
console.log(`Total classified: ${pixelRoles.size}\n`);

// ── Analyze RLE colors per glasses type ────────────────────────────

function analyzeType(index) {
  const pixels = decodeToPixelMap(glassesTraits[index].data);
  const leftFrame = [], rightFrame = [], eyeWhite = [], eyeBlack = [];

  for (const [key, px] of pixels) {
    const [xs, ys] = key.split(',').map(Number);
    // Top/bottom frame rows
    if (ys === 11 || ys === 16) {
      (xs <= 15 ? leftFrame : rightFrame).push(px);
    }
    // Arms (x=7-9)
    else if (xs <= 9) { leftFrame.push(px); }
    // Bridge (x=16)
    else if (xs === 16) { leftFrame.push(px); }
    // Frame borders
    else if (xs === 10 || xs === 15) { leftFrame.push(px); }
    else if (xs === 17 || xs === 22) { rightFrame.push(px); }
    // Eyes: left eye x=11-12 white half, x=13-14 black half
    else if (xs >= 11 && xs <= 12) { eyeWhite.push(px); }
    else if (xs >= 13 && xs <= 14) { eyeBlack.push(px); }
    // Right eye x=18-19 white half, x=20-21 black half
    else if (xs >= 18 && xs <= 19) { eyeWhite.push(px); }
    else if (xs >= 20 && xs <= 21) { eyeBlack.push(px); }
  }

  return {
    frameLeft: majority(leftFrame) || { r: 0, g: 0, b: 0 },
    frameRight: majority(rightFrame) || majority(leftFrame) || { r: 0, g: 0, b: 0 },
    eyeWhite: majority(eyeWhite) || { r: 255, g: 255, b: 255 },
    eyeBlack: majority(eyeBlack) || { r: 0, g: 0, b: 0 },
  };
}

function majority(arr) {
  if (!arr.length) return null;
  const counts = new Map();
  for (const c of arr) {
    const k = `${c.r},${c.g},${c.b}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null, max = 0;
  for (const [k, n] of counts) {
    if (n > max) { max = n; const [r, g, b] = k.split(',').map(Number); best = { r, g, b }; }
  }
  return best;
}

// ── Generate textures ──────────────────────────────────────────────

// Generate ALL from RLE — the old GLB-extracted textures had legacy multi-color designs
// that were updated by DAO proposal to single-color frames
const skipIndices = new Set();

console.log(`Generating ${glassesTraits.length} glasses textures...\n`);

for (let i = 0; i < glassesTraits.length; i++) {
  const name = glassesTraits[i].filename;

  if (skipIndices.has(i)) {
    console.log(`  [${i}] ${name}: KEPT (extracted from GLB)`);
    continue;
  }

  const colors = analyzeType(i);

  // Create 32x32 RGBA buffer (transparent)
  const buf = Buffer.alloc(32 * 32 * 4, 0);

  // For types with non-standard eye patterns (RGB dots), map each RLE eye
  // pixel to correct UV positions. RLE and UV use different coordinate systems:
  //   RLE left eye:  x=11-14  y=12-15  (white=11-12, black=13-14)
  //   UV front left: x=8-11   y=9-12   (black=8-9,   white=10-11)
  //   UV back left:  x=8-11   y=17-20  (white=8-9,   black=10-11)
  // Fullblack (7) has white glint pixels that need correct UV mapping too.
  const rlePixels = decodeToPixelMap(glassesTraits[i].data);
  const eyeOverrides = new Map();
  if (i === 2 || i === 7) {
    // UV x-axis is flipped relative to RLE within each eye, so the mapping
    // is a simple reversal: left front = 22 - rx, right front = 40 - rx
    for (const [rleKey, px] of rlePixels) {
      const [rx, ry] = rleKey.split(',').map(Number);
      if (ry < 12 || ry > 15) continue;

      let frontX, backX;
      if (rx >= 11 && rx <= 14) {        // left eye
        frontX = 22 - rx;               // 11→11, 12→10, 13→9, 14→8
        backX  = rx - 3;                // 11→8,  12→9,  13→10, 14→11
      } else if (rx >= 18 && rx <= 21) { // right eye
        frontX = 40 - rx;               // 18→22, 19→21, 20→20, 21→19
        backX  = rx + 1;                // 18→19, 19→20, 20→21, 21→22
      } else { continue; }

      eyeOverrides.set(`${frontX},${ry - 3}`, px);   // front: y offset -3
      eyeOverrides.set(`${backX},${ry + 5}`, px);     // back:  y offset +5
    }
  }

  for (const [key, role] of pixelRoles) {
    const [x, y] = key.split(',').map(Number);
    if (x >= 32 || y >= 32) continue;
    const idx = (y * 32 + x) * 4;

    let color;
    // Check for per-pixel eye override
    const overrideColor = eyeOverrides.get(key);
    if ((role === 'eye_white' || role === 'eye_black') && overrideColor) {
      color = overrideColor;
    } else {
      switch (role) {
        case 'frame_left':  color = colors.frameLeft; break;
        case 'frame_right': color = colors.frameRight; break;
        case 'bridge':      color = colors.frameLeft; break;
        case 'eye_white':   color = colors.eyeWhite; break;
        case 'eye_black':   color = colors.eyeBlack; break;
      }
    }

    buf[idx] = color.r;
    buf[idx + 1] = color.g;
    buf[idx + 2] = color.b;
    buf[idx + 3] = 255;
  }


  const outPath = path.join(outDir, `${i}.png`);
  await sharp(buf, { raw: { width: 32, height: 32, channels: 4 } }).png().toFile(outPath);

  const mc = dist(colors.frameLeft.r, colors.frameLeft.g, colors.frameLeft.b,
                   colors.frameRight.r, colors.frameRight.g, colors.frameRight.b) > 30
    ? ' (multi-color)' : '';
  console.log(`  [${i}] ${name}: frame=#${hex(colors.frameLeft)}/${hex(colors.frameRight)} eye=#${hex(colors.eyeWhite)}/#${hex(colors.eyeBlack)}${mc}`);
}

function hex(c) {
  return [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
}

console.log('\nDone!');
