/**
 * Generate standardized Noun 3D assets from source pixel data.
 *
 * Outputs individual GLB files for every head trait and glasses trait,
 * with vertex colors, standardized snap points, and canonical origins.
 *
 * Usage: node scripts/generate-noun-assets.mjs
 *
 * Snap Point Spec:
 *   All layers share the same 32x32 XY grid, centered at origin (-15.5 to +15.5)
 *   Body:    z=0,    depth=2.5
 *   Bling:   z=1.75, depth=1.0
 *   Head:    z=0.78, depth=2.5
 *   Glasses: z=2.55, depth=1.0
 *
 * Every head GLB has the same origin, same bounds, same snap interface.
 * Glasses always sit at fixed XY positions, only frame color varies.
 */

import { createRequire } from 'module';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// Resolve from the webapp's node_modules where @noundry/nouns-assets lives
const require = createRequire(join(import.meta.dirname, '..', 'packages', 'nouns-webapp', 'node_modules', '.package-lock.json'));

// ─── Load Nouns data ────────────────────────────────────────────────────────

const { ImageData, getNounData } = require('@noundry/nouns-assets');

// ─── Constants (matching voxel-engine/src/types.ts) ─────────────────────────

const BODY_DEPTH = 2.5;
const BLING_DEPTH = 1.0;
const HEAD_DEPTH = 2.5;
const GLASSES_DEPTH = 1.0;

const HEAD_Z = BODY_DEPTH / 2 - BLING_DEPTH / 2 + 0.03; // 0.78
const GLASSES_Z = HEAD_Z + HEAD_DEPTH / 2 + GLASSES_DEPTH / 2 + 0.02; // 2.55

// ─── RLE Decoder (self-contained) ───────────────────────────────────────────

function decodeRLE(data) {
  const hex = data.replace(/^0x/, '');
  const bounds = {
    top: parseInt(hex.substring(2, 4), 16),
    right: parseInt(hex.substring(4, 6), 16),
    bottom: parseInt(hex.substring(6, 8), 16),
    left: parseInt(hex.substring(8, 10), 16),
  };
  const pairs = [];
  const rest = hex.substring(10);
  for (let i = 0; i < rest.length; i += 4) {
    pairs.push([
      parseInt(rest.substring(i, i + 2), 16),
      parseInt(rest.substring(i + 2, i + 4), 16),
    ]);
  }
  return { bounds, pairs };
}

function decodeToPixels(partData, palette) {
  const { bounds, pairs } = decodeRLE(partData);
  const pixels = [];
  let x = bounds.left, y = bounds.top;
  for (const [runLength, colorIndex] of pairs) {
    for (let i = 0; i < runLength; i++) {
      if (colorIndex !== 0 && y < 32 && x < 32) {
        const hex = palette[colorIndex] || '000000';
        pixels.push({
          x, y,
          r: parseInt(hex.substring(0, 2), 16),
          g: parseInt(hex.substring(2, 4), 16),
          b: parseInt(hex.substring(4, 6), 16),
        });
      }
      x++;
      if (x >= bounds.right) {
        x = bounds.left;
        y++;
      }
    }
  }
  return pixels;
}

// ─── sRGB → Linear conversion ───────────────────────────────────────────────

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// ─── Build GLB from pixel data ──────────────────────────────────────────────

function buildGLB(pixels, depth, zOffset) {
  if (pixels.length === 0) return null;

  // Each pixel becomes a box: 8 vertices, 36 indices (12 triangles)
  const verticesPerBox = 24; // 4 per face × 6 faces (with separate normals)
  const indicesPerBox = 36;
  const totalVerts = pixels.length * verticesPerBox;
  const totalIndices = pixels.length * indicesPerBox;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);

  // Box template: unit cube centered at origin, then scaled to (1, 1, depth)
  const hw = 0.5, hh = 0.5, hd = depth / 2;

  // 6 faces, 4 vertices each, with normals
  const faceVerts = [
    // Front face (z+)
    { pos: [-hw, -hh, hd], norm: [0, 0, 1] },
    { pos: [hw, -hh, hd], norm: [0, 0, 1] },
    { pos: [hw, hh, hd], norm: [0, 0, 1] },
    { pos: [-hw, hh, hd], norm: [0, 0, 1] },
    // Back face (z-)
    { pos: [hw, -hh, -hd], norm: [0, 0, -1] },
    { pos: [-hw, -hh, -hd], norm: [0, 0, -1] },
    { pos: [-hw, hh, -hd], norm: [0, 0, -1] },
    { pos: [hw, hh, -hd], norm: [0, 0, -1] },
    // Top face (y+)
    { pos: [-hw, hh, -hd], norm: [0, 1, 0] },
    { pos: [-hw, hh, hd], norm: [0, 1, 0] },
    { pos: [hw, hh, hd], norm: [0, 1, 0] },
    { pos: [hw, hh, -hd], norm: [0, 1, 0] },
    // Bottom face (y-)
    { pos: [-hw, -hh, -hd], norm: [0, -1, 0] },
    { pos: [hw, -hh, -hd], norm: [0, -1, 0] },
    { pos: [hw, -hh, hd], norm: [0, -1, 0] },
    { pos: [-hw, -hh, hd], norm: [0, -1, 0] },
    // Right face (x+)
    { pos: [hw, -hh, -hd], norm: [1, 0, 0] },
    { pos: [hw, hh, -hd], norm: [1, 0, 0] },
    { pos: [hw, hh, hd], norm: [1, 0, 0] },
    { pos: [hw, -hh, hd], norm: [1, 0, 0] },
    // Left face (x-)
    { pos: [-hw, -hh, hd], norm: [-1, 0, 0] },
    { pos: [-hw, hh, hd], norm: [-1, 0, 0] },
    { pos: [-hw, hh, -hd], norm: [-1, 0, 0] },
    { pos: [-hw, -hh, -hd], norm: [-1, 0, 0] },
  ];

  // Index pattern for one face (2 triangles)
  const faceIndices = [0, 1, 2, 0, 2, 3];

  for (let pi = 0; pi < pixels.length; pi++) {
    const p = pixels[pi];
    const cx = p.x - 15.5; // center in grid
    const cy = -(p.y - 15.5); // flip Y so row 0 = top
    const cz = zOffset;
    const r = srgbToLinear(p.r / 255);
    const g = srgbToLinear(p.g / 255);
    const b = srgbToLinear(p.b / 255);
    const vBase = pi * verticesPerBox;
    const iBase = pi * indicesPerBox;

    for (let vi = 0; vi < 24; vi++) {
      const fv = faceVerts[vi];
      const idx = (vBase + vi) * 3;
      positions[idx] = fv.pos[0] + cx;
      positions[idx + 1] = fv.pos[1] + cy;
      positions[idx + 2] = fv.pos[2] + cz;
      normals[idx] = fv.norm[0];
      normals[idx + 1] = fv.norm[1];
      normals[idx + 2] = fv.norm[2];
      colors[idx] = r;
      colors[idx + 1] = g;
      colors[idx + 2] = b;
    }

    // Indices for 6 faces
    for (let fi = 0; fi < 6; fi++) {
      for (let ii = 0; ii < 6; ii++) {
        indices[iBase + fi * 6 + ii] = vBase + fi * 4 + faceIndices[ii];
      }
    }
  }

  return { positions, normals, colors, indices };
}

// ─── GLB Binary Writer ──────────────────────────────────────────────────────

function writeGLB(meshData, outputPath) {
  if (!meshData) return false;

  const { positions, normals, colors, indices } = meshData;

  // Align buffer to 4 bytes
  function align4(n) { return (n + 3) & ~3; }

  // Build binary buffer: positions + normals + colors + indices
  const posBuf = Buffer.from(positions.buffer);
  const normBuf = Buffer.from(normals.buffer);
  const colBuf = Buffer.from(colors.buffer);
  const idxBuf = Buffer.from(indices.buffer);

  const binLength = align4(posBuf.length + normBuf.length + colBuf.length + idxBuf.length);
  const binBuffer = Buffer.alloc(binLength);
  let offset = 0;
  posBuf.copy(binBuffer, offset); offset += posBuf.length;
  normBuf.copy(binBuffer, offset); offset += normBuf.length;
  colBuf.copy(binBuffer, offset); offset += colBuf.length;
  idxBuf.copy(binBuffer, offset);

  // Compute bounds
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxX = Math.max(maxX, positions[i]);
    maxY = Math.max(maxY, positions[i + 1]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }

  const vertCount = positions.length / 3;
  const idxCount = indices.length;

  // Build glTF JSON
  const gltf = {
    asset: { version: '2.0', generator: 'noun-wtf-voxel-pipeline' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
        indices: 3,
        material: 0,
      }],
    }],
    materials: [{
      pbrMetallicRoughness: {
        metallicFactor: 0,
        roughnessFactor: 0.8,
      },
      name: 'voxel',
    }],
    accessors: [
      { // POSITION
        bufferView: 0, componentType: 5126, count: vertCount, type: 'VEC3',
        min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
      },
      { // NORMAL
        bufferView: 1, componentType: 5126, count: vertCount, type: 'VEC3',
      },
      { // COLOR_0
        bufferView: 2, componentType: 5126, count: vertCount, type: 'VEC3',
      },
      { // indices
        bufferView: 3, componentType: 5125, count: idxCount, type: 'SCALAR',
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
      { buffer: 0, byteOffset: posBuf.length, byteLength: normBuf.length, target: 34962 },
      { buffer: 0, byteOffset: posBuf.length + normBuf.length, byteLength: colBuf.length, target: 34962 },
      { buffer: 0, byteOffset: posBuf.length + normBuf.length + colBuf.length, byteLength: idxBuf.length, target: 34963 },
    ],
    buffers: [{ byteLength: binLength }],
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const jsonPadded = Buffer.alloc(align4(jsonBuf.length), 0x20); // pad with spaces
  jsonBuf.copy(jsonPadded);

  // GLB header: magic + version + length
  const headerLength = 12;
  const jsonChunkLength = 8 + jsonPadded.length;
  const binChunkLength = 8 + binBuffer.length;
  const totalLength = headerLength + jsonChunkLength + binChunkLength;

  const glb = Buffer.alloc(totalLength);
  let pos = 0;
  // Header
  glb.writeUInt32LE(0x46546C67, pos); pos += 4; // magic "glTF"
  glb.writeUInt32LE(2, pos); pos += 4; // version
  glb.writeUInt32LE(totalLength, pos); pos += 4; // total length
  // JSON chunk
  glb.writeUInt32LE(jsonPadded.length, pos); pos += 4;
  glb.writeUInt32LE(0x4E4F534A, pos); pos += 4; // "JSON"
  jsonPadded.copy(glb, pos); pos += jsonPadded.length;
  // BIN chunk
  glb.writeUInt32LE(binBuffer.length, pos); pos += 4;
  glb.writeUInt32LE(0x004E4942, pos); pos += 4; // "BIN\0"
  binBuffer.copy(glb, pos);

  writeFileSync(outputPath, glb);
  return true;
}

// ─── Main ───────────────────────────────────────────────────────────────────

const palette = ImageData.palette;
const outDir = join(import.meta.dirname, '..', 'packages', 'nouns-webapp', 'public', 'models', 'heads', 'generated');
const glassesDir = join(outDir, 'glasses');

mkdirSync(outDir, { recursive: true });
mkdirSync(glassesDir, { recursive: true });

// ─── Generate all 258 heads ────────────────────────────────────────────────

console.log('Generating head assets...');
const heads = ImageData.images.heads;
let headCount = 0;
const headManifest = [];

for (let i = 0; i < heads.length; i++) {
  const h = heads[i];
  const traitName = h.filename.replace(/^head-/, '');
  const pixels = decodeToPixels(h.data, palette);

  if (pixels.length === 0) {
    console.log(`  [${i}] ${traitName}: empty, skipping`);
    headManifest.push({ index: i, name: traitName, file: null, pixels: 0 });
    continue;
  }

  const meshData = buildGLB(pixels, HEAD_DEPTH, HEAD_Z);
  const filename = `${i}-${traitName}.glb`;
  const outPath = join(outDir, filename);

  if (writeGLB(meshData, outPath)) {
    headCount++;
    headManifest.push({ index: i, name: traitName, file: `generated/${filename}`, pixels: pixels.length });
  }
}
console.log(`  Generated ${headCount}/${heads.length} head GLBs`);

// ─── Generate all 24 glasses ───────────────────────────────────────────────

console.log('Generating glasses assets...');
const glasses = ImageData.images.glasses;
let glassesCount = 0;

for (let i = 0; i < glasses.length; i++) {
  const g = glasses[i];
  const traitName = g.filename.replace(/^glasses-/, '');
  const pixels = decodeToPixels(g.data, palette);

  if (pixels.length === 0) continue;

  const meshData = buildGLB(pixels, GLASSES_DEPTH, GLASSES_Z);
  const filename = `${i}-${traitName}.glb`;
  const outPath = join(glassesDir, filename);

  if (writeGLB(meshData, outPath)) {
    glassesCount++;
  }
}
console.log(`  Generated ${glassesCount}/${glasses.length} glasses GLBs`);

// ─── Write manifest ────────────────────────────────────────────────────────

const manifest = {
  version: 1,
  snapSpec: {
    grid: 32,
    origin: [-15.5, -15.5],
    layers: {
      body:    { z: 0,     depth: BODY_DEPTH },
      bling:   { z: BODY_DEPTH / 2 + BLING_DEPTH / 2, depth: BLING_DEPTH },
      head:    { z: HEAD_Z, depth: HEAD_DEPTH },
      glasses: { z: GLASSES_Z, depth: GLASSES_DEPTH },
    },
  },
  heads: headManifest,
  glasses: glasses.map((g, i) => ({
    index: i,
    name: g.filename.replace(/^glasses-/, ''),
    file: `generated/glasses/${i}-${g.filename.replace(/^glasses-/, '')}.glb`,
  })),
};

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\nManifest written to ${join(outDir, 'manifest.json')}`);
console.log(`\nSnap spec:`);
console.log(`  Head Z:    ${HEAD_Z.toFixed(2)}`);
console.log(`  Glasses Z: ${GLASSES_Z.toFixed(2)}`);
console.log(`  All assets share origin (-15.5, -15.5) on 32x32 grid`);
console.log(`  Head + Glasses drop-in replace — same XY, same snap point`);
