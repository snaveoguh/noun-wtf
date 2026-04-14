#!/usr/bin/env node
/**
 * Analyze 2D vs 3D head alignment for all Noun heads.
 *
 * For each head:
 * - Decodes the 2D RLE pixel data to find the bottom-most pixel row (how far the head sinks into the body)
 * - Loads the 3DNouns GLB (if available) and computes the bounding box Y range
 * - Reports the expected vs actual Y offset so we can correct positioning
 *
 * Usage: node scripts/analyze-head-offsets.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { Document, NodeIO } from '@gltf-transform/core';

const ROOT = resolve(import.meta.dirname, '..');
const WEBAPP = join(ROOT, 'packages/nouns-webapp');
const ASSETS = join(ROOT, 'packages/nouns-assets');

// ─── 1. Load 2D head pixel data from image-data.json ───────────────────────

const imageData = JSON.parse(readFileSync(join(ASSETS, 'src/image-data.json'), 'utf8'));
const palette = imageData.palette;
const heads2d = imageData.images.heads; // [{filename, data}, ...]

/** Decode RLE bounds for a single part — returns { top, right, bottom, left } */
function decodeRLEBounds(data) {
  const hex = data.replace(/^0x/, '');
  return {
    top: parseInt(hex.substring(2, 4), 16),
    right: parseInt(hex.substring(4, 6), 16),
    bottom: parseInt(hex.substring(6, 8), 16),
    left: parseInt(hex.substring(8, 10), 16),
  };
}

/** Decode RLE to a 32x32 grid, return bottom-most row with a pixel */
function decodeRLEToBottomRow(data) {
  const hex = data.replace(/^0x/, '');
  const bounds = {
    top: parseInt(hex.substring(2, 4), 16),
    right: parseInt(hex.substring(4, 6), 16),
    bottom: parseInt(hex.substring(6, 8), 16),
    left: parseInt(hex.substring(8, 10), 16),
  };
  const pairs = hex.substring(10).match(/.{1,4}/g)?.map(r => [
    parseInt(r.substring(0, 2), 16),
    parseInt(r.substring(2, 4), 16),
  ]) ?? [];

  let maxRow = -1;
  let x = bounds.left;
  let y = bounds.top;
  for (const [runLength, colorIndex] of pairs) {
    for (let i = 0; i < runLength; i++) {
      if (colorIndex !== 0 && y < 32 && x < 32) {
        if (y > maxRow) maxRow = y;
      }
      x++;
      if (x >= bounds.right) {
        x = bounds.left;
        y++;
      }
    }
  }
  return { bounds, bottomRow: maxRow };
}

// ─── 2. Load manifest and 3D GLB bounding boxes ────────────────────────────

const manifestPath = join(WEBAPP, 'public/models/heads/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const glbDir = join(WEBAPP, 'public/models/heads/3dnouns');
const io = new NodeIO();

async function getGlbBounds(glbPath) {
  try {
    const fullPath = join(WEBAPP, 'public', glbPath);
    const doc = await io.read(fullPath);
    const root = doc.getRoot();

    let minY = Infinity, maxY = -Infinity;
    let minX = Infinity, maxX = -Infinity;

    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const posAccessor = prim.getAttribute('POSITION');
        if (!posAccessor) continue;
        const posArray = posAccessor.getArray();
        if (!posArray) continue;
        for (let i = 0; i < posArray.length; i += 3) {
          const x = posArray[i];
          const y = posArray[i + 1];
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    return { minX, maxX, minY, maxY };
  } catch (e) {
    return null;
  }
}

// ─── 3. Run analysis ────────────────────────────────────────────────────────

async function main() {
  console.log('Analyzing 2D vs 3D head alignment...\n');

  // Collect unique Y bounds from GLBs
  const yBoundsMap = new Map(); // minY → count
  const results = [];

  for (let i = 0; i < heads2d.length; i++) {
    const head2d = heads2d[i];
    const entry = manifest[i];
    const { bounds, bottomRow } = decodeRLEToBottomRow(head2d.data);

    // In voxel coords: pixel row R → voxel Y = 31-R
    // In world coords: voxel Y → world Y = voxelY - 15.5
    const voxelBottomY = 31 - bottomRow;
    const worldBottom2d = voxelBottomY - 15.5;

    let glbBounds = null;
    let glbWorldMinY = null;
    if (entry?.threeDNounsGlb) {
      glbBounds = await getGlbBounds(entry.threeDNounsGlb);
      if (glbBounds) {
        // After GLB translation: world Y = native Y + (-15.5 - 2.5) = native Y - 18
        glbWorldMinY = glbBounds.minY - 18;

        const key = `${glbBounds.minY.toFixed(1)}-${glbBounds.maxY.toFixed(1)}`;
        yBoundsMap.set(key, (yBoundsMap.get(key) || 0) + 1);
      }
    }

    const diff = glbWorldMinY !== null ? (glbWorldMinY - worldBottom2d).toFixed(2) : 'N/A';

    results.push({
      index: i,
      name: entry?.traitName || head2d.filename.replace('head-', ''),
      rleTop: bounds.top,
      rleBottom: bottomRow,
      worldBottom2d: worldBottom2d.toFixed(1),
      glbNativeMinY: glbBounds?.minY?.toFixed(1) ?? 'N/A',
      glbNativeMaxY: glbBounds?.maxY?.toFixed(1) ?? 'N/A',
      glbWorldMinY: glbWorldMinY?.toFixed(1) ?? 'N/A',
      diff,
      hasGlb: !!entry?.threeDNounsGlb,
    });
  }

  // ─── Summary ────────────────────────────────────────────────────────────────

  console.log('=== GLB Y-bounds distribution ===');
  for (const [bounds, count] of [...yBoundsMap.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  Y range ${bounds}: ${count} heads`);
  }

  // Group by diff value
  const diffGroups = new Map();
  for (const r of results) {
    if (r.diff === 'N/A') continue;
    const d = parseFloat(r.diff).toFixed(1);
    if (!diffGroups.has(d)) diffGroups.set(d, []);
    diffGroups.get(d).push(r.name);
  }

  console.log('\n=== 3D-vs-2D offset distribution (GLB world bottom - 2D world bottom) ===');
  console.log('  Negative = 3D head sits LOWER than 2D, Positive = sits HIGHER');
  for (const [diff, names] of [...diffGroups.entries()].sort((a, b) => parseFloat(a) - parseFloat(b))) {
    console.log(`  diff=${diff}: ${names.length} heads`);
    if (names.length <= 10) {
      console.log(`    ${names.join(', ')}`);
    } else {
      console.log(`    ${names.slice(0, 5).join(', ')}... and ${names.length - 5} more`);
    }
  }

  // Show heads with non-zero diff (misaligned)
  const misaligned = results.filter(r => r.diff !== 'N/A' && Math.abs(parseFloat(r.diff)) > 0.01);
  const noGlb = results.filter(r => !r.hasGlb);

  console.log(`\n=== Summary ===`);
  console.log(`Total heads: ${results.length}`);
  console.log(`Heads with GLB: ${results.length - noGlb.length}`);
  console.log(`Heads without GLB (voxel fallback): ${noGlb.length}`);
  console.log(`Misaligned heads (diff != 0): ${misaligned.length}`);

  if (misaligned.length > 0 && misaligned.length <= 30) {
    console.log('\n=== Misaligned heads detail ===');
    console.log('Index | Name                | 2D bottom row | GLB native minY | Diff (3D-2D)');
    console.log('------|---------------------|---------------|-----------------|-------------');
    for (const r of misaligned) {
      console.log(
        `${String(r.index).padStart(5)} | ${r.name.padEnd(19)} | ${String(r.rleBottom).padStart(13)} | ${r.glbNativeMinY.padStart(15)} | ${r.diff}`
      );
    }
  }

  // Check if it's a uniform offset
  if (diffGroups.size === 1) {
    const [uniformDiff] = diffGroups.keys();
    console.log(`\n>>> UNIFORM OFFSET: All GLB heads are off by ${uniformDiff} units.`);
    console.log(`>>> Fix: adjust GLB_TO_VOXEL_OFFSET_Y - 2.5 to GLB_TO_VOXEL_OFFSET_Y - ${(2.5 + parseFloat(uniformDiff)).toFixed(1)}`);
  } else if (diffGroups.size <= 3) {
    console.log('\n>>> FEW DISTINCT OFFSETS — may need per-head adjustments or a grouped fix.');
  } else {
    console.log('\n>>> MANY DISTINCT OFFSETS — per-head offset data needed.');
  }
}

main().catch(console.error);
