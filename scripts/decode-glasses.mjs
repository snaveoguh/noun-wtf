/**
 * Decode all Nouns glasses RLE data and print pixel positions + colors.
 *
 * RLE format (hex string starting with 0x):
 *   bytes 0      : padding (00)
 *   bytes 1-2    : top offset
 *   bytes 3-4    : right bound
 *   bytes 5-6    : bottom (unused)
 *   bytes 7-8    : left offset
 *   then pairs   : (runLength byte, colorIndex byte)
 *
 * Run from repo root:
 *   node scripts/decode-glasses.mjs
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load the raw JSON directly — avoids ESM/CJS resolution issues
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ImageData = require(resolve(__dirname, '..', 'packages/nouns-assets/src/image-data.json'));

const { palette, images } = ImageData;
const { glasses } = images;

/**
 * Decode an RLE-encoded Nouns part into an array of { x, y, colorIndex, color }.
 */
function decodeRLE(data, palette) {
  const hex = data.replace(/^0x/, '');

  const bounds = {
    top:   parseInt(hex.substring(2, 4), 16),
    right: parseInt(hex.substring(4, 6), 16),
    bottom: parseInt(hex.substring(6, 8), 16),
    left:  parseInt(hex.substring(8, 10), 16),
  };

  const rlePairs = [];
  const rleHex = hex.substring(10);
  const chunks = rleHex.match(/.{1,4}/g) || [];
  for (const chunk of chunks) {
    const runLength = parseInt(chunk.substring(0, 2), 16);
    const colorIndex = parseInt(chunk.substring(2, 4), 16);
    rlePairs.push([runLength, colorIndex]);
  }

  const pixels = [];
  let x = bounds.left;
  let y = bounds.top;

  for (const [runLength, colorIndex] of rlePairs) {
    for (let i = 0; i < runLength; i++) {
      if (colorIndex !== 0) {
        const color = palette[colorIndex] || '??????';
        pixels.push({ x, y, colorIndex, color });
      }
      x++;
      if (x >= bounds.right) {
        x = bounds.left;
        y++;
      }
    }
  }

  return { bounds, pixels };
}

/**
 * Classify pixels into "frame" vs "eye" groups.
 *
 * Heuristic: find the most-used color — that is almost always the frame.
 * Everything else is an "eye" or "lens" color.
 */
function classifyPixels(pixels) {
  // Count occurrences of each colorIndex
  const counts = {};
  for (const p of pixels) {
    counts[p.colorIndex] = (counts[p.colorIndex] || 0) + 1;
  }

  // Sort by frequency descending
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  // The most frequent color is the "frame"
  const frameColorIndex = sorted.length > 0 ? parseInt(sorted[0][0]) : -1;

  const frame = [];
  const eye = [];
  for (const p of pixels) {
    if (p.colorIndex === frameColorIndex) {
      frame.push(p);
    } else {
      eye.push(p);
    }
  }

  return { frame, eye, frameColorIndex, counts: sorted };
}

// ── Main ──

console.log(`Palette has ${palette.length} entries.`);
console.log(`Found ${glasses.length} glasses types.\n`);
console.log('='.repeat(80));

for (let i = 0; i < glasses.length; i++) {
  const g = glasses[i];
  const { bounds, pixels } = decodeRLE(g.data, palette);
  const { frame, eye, frameColorIndex, counts } = classifyPixels(pixels);

  console.log(`\n[${ i }] ${ g.filename }`);
  console.log(`    Bounds: top=${bounds.top} right=${bounds.right} bottom=${bounds.bottom} left=${bounds.left}`);
  console.log(`    Total non-transparent pixels: ${pixels.length}`);
  console.log(`    Color usage (colorIndex: count):`);
  for (const [ci, cnt] of counts) {
    const hex = palette[parseInt(ci)] || '??????';
    console.log(`      colorIndex ${ci.padStart(3)} -> #${hex}  (${cnt} pixels)${parseInt(ci) === frameColorIndex ? '  [FRAME]' : '  [EYE/LENS]'}`);
  }

  // Print a 32x32 ASCII grid
  console.log(`\n    32x32 grid (. = transparent, F = frame, numbers = eye color index):`);
  const grid = Array.from({ length: 32 }, () => Array(32).fill('.'));
  for (const p of frame) {
    grid[p.y][p.x] = 'F';
  }
  for (const p of eye) {
    // Use a single char to represent the eye color — hex digit of colorIndex mod 16
    grid[p.y][p.x] = p.colorIndex.toString(16).toUpperCase().slice(-1);
  }

  for (let row = bounds.top; row < Math.min(bounds.top + (bounds.right - bounds.left) + 4, 32); row++) {
    const line = grid[row].join('');
    // Only print rows that have non-dot content
    if (line.includes('F') || /[0-9A-Z]/.test(line)) {
      console.log(`    y=${row.toString().padStart(2)}: ${line}`);
    }
  }

  // Print pixel coordinate lists
  console.log(`\n    FRAME pixels (#${palette[frameColorIndex] || '???'}):`);
  const frameByRow = {};
  for (const p of frame) {
    (frameByRow[p.y] = frameByRow[p.y] || []).push(p.x);
  }
  for (const [y, xs] of Object.entries(frameByRow).sort((a,b) => a[0]-b[0])) {
    console.log(`      y=${y.padStart(2)}: x=[${xs.join(',')}]`);
  }

  if (eye.length > 0) {
    console.log(`    EYE/LENS pixels:`);
    const eyeByColor = {};
    for (const p of eye) {
      const key = `${p.colorIndex}:#${palette[p.colorIndex]}`;
      (eyeByColor[key] = eyeByColor[key] || []).push(`(${p.x},${p.y})`);
    }
    for (const [key, coords] of Object.entries(eyeByColor)) {
      console.log(`      ${key} -> ${coords.join(' ')}`);
    }
  }

  console.log('-'.repeat(80));
}
