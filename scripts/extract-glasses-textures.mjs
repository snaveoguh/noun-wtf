/**
 * Extract the correct glasses texture from each 3DNouns GLB.
 *
 * Each GLB has a glasses mesh with a 32x32 texture whose name matches
 * the Nouns trait (e.g. "glasses-square-black-rgb"). We extract one
 * representative texture per glasses type and save as {index}.png.
 *
 * Usage: node scripts/extract-glasses-textures.mjs
 */

import { NodeIO } from '@gltf-transform/core';
import { readdirSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(
  path.join(import.meta.dirname, '..', 'packages', 'nouns-webapp', 'node_modules', '.package-lock.json'),
);
const { ImageData } = require('@noundry/nouns-assets');

// ── Map glasses trait filenames to indices ──────────────────────────
const glassesTraits = ImageData.images.glasses;
const nameToIndex = new Map();
for (let i = 0; i < glassesTraits.length; i++) {
  // e.g. "glasses-hip-rose" → normalize to "hiprose" for fuzzy matching
  const raw = glassesTraits[i].filename;
  nameToIndex.set(raw, i);
  // Also store normalized version
  const norm = raw.replace(/^glasses-?/, '').replace(/[-_\s]/g, '').toLowerCase();
  nameToIndex.set(norm, i);
}

function matchGlassesIndex(texName) {
  // Direct match
  if (nameToIndex.has(texName)) return nameToIndex.get(texName);
  // Normalized match
  const norm = texName.replace(/^glasses-?/, '').replace(/[-_\s]/g, '').toLowerCase();
  if (nameToIndex.has(norm)) return nameToIndex.get(norm);
  return null;
}

// ── Scan all GLBs ──────────────────────────────────────────────────
const glbDir = path.resolve('packages/nouns-webapp/public/models/heads/3dnouns');
const outDir = path.resolve('packages/nouns-webapp/public/models/heads/glasses-textures');
mkdirSync(outDir, { recursive: true });

const glbFiles = readdirSync(glbDir).filter(f => f.endsWith('.glb'));
console.log(`Found ${glbFiles.length} GLB files\n`);

const io = new NodeIO();
const found = new Map(); // index → { texName, pngBuffer, glbSource }
const unmatched = [];

for (const file of glbFiles) {
  const glbPath = path.join(glbDir, file);
  try {
    const doc = await io.read(glbPath);
    const root = doc.getRoot();

    // Find glasses texture by searching node/mesh names
    let glassesTex = null;
    let texName = '';

    // Search nodes for "Glasses" or "glasses"
    for (const node of root.listNodes()) {
      const name = node.getName() || '';
      if (!name.toLowerCase().includes('glass')) continue;
      const mesh = node.getMesh();
      if (!mesh) continue;
      for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial();
        if (!mat) continue;
        const tex = mat.getBaseColorTexture();
        if (tex) {
          glassesTex = tex;
          texName = tex.getName() || mat.getName() || name;
          break;
        }
      }
      if (glassesTex) break;
    }

    if (!glassesTex) continue;

    const idx = matchGlassesIndex(texName);
    if (idx === null) {
      unmatched.push({ file, texName });
      continue;
    }

    // Skip if we already have this type
    if (found.has(idx)) continue;

    const imageData = glassesTex.getImage();
    if (!imageData) continue;

    found.set(idx, {
      texName,
      pngBuffer: Buffer.from(imageData),
      glbSource: file,
    });
    console.log(`  [${idx}] ${glassesTraits[idx].filename} ← ${file} (tex: "${texName}")`);
  } catch (e) {
    // Skip broken GLBs silently
  }
}

// ── Save extracted textures ────────────────────────────────────────
console.log(`\nExtracted ${found.size}/${glassesTraits.length} glasses types\n`);

for (const [idx, { pngBuffer, glbSource }] of found) {
  const outPath = path.join(outDir, `${idx}.png`);
  writeFileSync(outPath, pngBuffer);
  console.log(`  Saved ${outPath} (from ${glbSource})`);
}

// ── Report missing types ───────────────────────────────────────────
const missing = [];
for (let i = 0; i < glassesTraits.length; i++) {
  if (!found.has(i)) missing.push({ index: i, name: glassesTraits[i].filename });
}

if (missing.length > 0) {
  console.log(`\nMissing types (${missing.length}):`);
  for (const m of missing) {
    console.log(`  [${m.index}] ${m.name}`);
  }
}

if (unmatched.length > 0) {
  console.log(`\nUnmatched texture names (${unmatched.length}):`);
  for (const u of unmatched) {
    console.log(`  ${u.file} → "${u.texName}"`);
  }
}

console.log('\nDone.');
