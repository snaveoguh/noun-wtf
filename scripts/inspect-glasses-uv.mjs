/**
 * Inspect the UV layout and texture of the glasses mesh in a 3DNouns GLB file.
 *
 * Usage: node scripts/inspect-glasses-uv.mjs [path-to-glb]
 *
 * Defaults to FoxHead.glb if no argument is given.
 */

import { NodeIO } from '@gltf-transform/core';
import { readFileSync } from 'fs';
import path from 'path';

const DEFAULT_GLB = path.resolve(
  'packages/nouns-webapp/public/models/heads/3dnouns/FoxHead.glb',
);

const glbPath = process.argv[2] || DEFAULT_GLB;
console.log(`\n=== Inspecting GLB: ${glbPath} ===\n`);

// ── 1. Load the GLB ────────────────────────────────────────────────
const io = new NodeIO();
const document = await io.read(glbPath);
const root = document.getRoot();

// ── 2. Enumerate all meshes and find the glasses mesh ──────────────
const allMeshes = root.listMeshes();
console.log(`Total meshes in file: ${allMeshes.length}`);
for (const m of allMeshes) {
  console.log(`  - "${m.getName()}"`);
}
console.log();

// Also list all nodes, since meshes might be named on the node, not the mesh
const allNodes = root.listNodes();
console.log(`Total nodes in file: ${allNodes.length}`);
for (const n of allNodes) {
  const meshRef = n.getMesh();
  console.log(
    `  - node "${n.getName()}"${meshRef ? ` -> mesh "${meshRef.getName()}"` : ''}`,
  );
}
console.log();

// Find the glasses mesh by checking both mesh and node names
let glassesMesh = null;
let glassesMeshName = '';

// Strategy 1: search mesh names
for (const m of allMeshes) {
  const name = (m.getName() || '').toLowerCase();
  if (name.includes('glass')) {
    glassesMesh = m;
    glassesMeshName = m.getName();
    break;
  }
}

// Strategy 2: search node names
if (!glassesMesh) {
  for (const n of allNodes) {
    const name = (n.getName() || '').toLowerCase();
    if (name.includes('glass')) {
      glassesMesh = n.getMesh();
      glassesMeshName = n.getName() + ' (from node)';
      break;
    }
  }
}

// Strategy 3: search for 'uv' in names
if (!glassesMesh) {
  for (const m of allMeshes) {
    const name = (m.getName() || '').toLowerCase();
    if (name.includes('uv')) {
      glassesMesh = m;
      glassesMeshName = m.getName();
      break;
    }
  }
}

if (!glassesMesh) {
  console.log(
    'ERROR: Could not find a glasses mesh. Dumping all primitives instead.\n',
  );
  // Fall back: inspect every mesh
  for (const m of allMeshes) {
    await dumpMesh(m, m.getName());
  }
  process.exit(0);
}

console.log(`\n=== Found glasses mesh: "${glassesMeshName}" ===\n`);
await dumpMesh(glassesMesh, glassesMeshName);

// ── Helper: dump mesh details ──────────────────────────────────────
async function dumpMesh(mesh, label) {
  const primitives = mesh.listPrimitives();
  console.log(`Mesh "${label}" has ${primitives.length} primitive(s)\n`);

  for (let pi = 0; pi < primitives.length; pi++) {
    const prim = primitives[pi];
    console.log(`--- Primitive ${pi} ---`);

    // List all attributes
    const semantics = prim.listSemantics();
    console.log(`  Attributes: ${semantics.join(', ')}`);

    // Vertex count
    const posAccessor = prim.getAttribute('POSITION');
    if (posAccessor) {
      console.log(`  Vertex count: ${posAccessor.getCount()}`);
    }

    // Index count
    const indices = prim.getIndices();
    if (indices) {
      console.log(`  Index count: ${indices.getCount()}`);
    }

    // ── 3. UV coordinates ──────────────────────────────────────────
    const uvAccessor = prim.getAttribute('TEXCOORD_0');
    if (uvAccessor) {
      const uvCount = uvAccessor.getCount();
      let uMin = Infinity,
        uMax = -Infinity,
        vMin = Infinity,
        vMax = -Infinity;
      const uvPairs = [];

      for (let i = 0; i < uvCount; i++) {
        const uv = uvAccessor.getElement(i, [0, 0]);
        uvPairs.push(uv);
        if (uv[0] < uMin) uMin = uv[0];
        if (uv[0] > uMax) uMax = uv[0];
        if (uv[1] < vMin) vMin = uv[1];
        if (uv[1] > vMax) vMax = uv[1];
      }

      console.log(`  UV count: ${uvCount}`);
      console.log(
        `  UV U range: [${uMin.toFixed(6)}, ${uMax.toFixed(6)}]`,
      );
      console.log(
        `  UV V range: [${vMin.toFixed(6)}, ${vMax.toFixed(6)}]`,
      );

      // Print first 20 UV pairs for inspection
      const showCount = Math.min(uvCount, 30);
      console.log(`  First ${showCount} UV pairs:`);
      for (let i = 0; i < showCount; i++) {
        console.log(
          `    [${i}] u=${uvPairs[i][0].toFixed(6)}, v=${uvPairs[i][1].toFixed(6)}`,
        );
      }
      if (uvCount > showCount) {
        console.log(`    ... (${uvCount - showCount} more)`);
      }

      // Print unique UV values to understand the grid
      const uniqueU = [...new Set(uvPairs.map((p) => p[0].toFixed(6)))].sort();
      const uniqueV = [...new Set(uvPairs.map((p) => p[1].toFixed(6)))].sort();
      console.log(`  Unique U values (${uniqueU.length}): ${uniqueU.join(', ')}`);
      console.log(`  Unique V values (${uniqueV.length}): ${uniqueV.join(', ')}`);
    } else {
      console.log('  No TEXCOORD_0 attribute found');
    }

    // ── 4. Material + Texture ──────────────────────────────────────
    const material = prim.getMaterial();
    if (material) {
      console.log(`  Material: "${material.getName()}"`);
      console.log(`  Alpha mode: ${material.getAlphaMode()}`);
      console.log(`  Double sided: ${material.getDoubleSided()}`);

      const baseColorFactor = material.getBaseColorFactor();
      console.log(
        `  Base color factor: [${baseColorFactor.map((v) => v.toFixed(3)).join(', ')}]`,
      );

      const baseColorTex = material.getBaseColorTexture();
      if (baseColorTex) {
        console.log(`  Base color texture: "${baseColorTex.getName()}"`);
        console.log(`  Texture MIME: ${baseColorTex.getMimeType()}`);
        console.log(`  Texture URI: ${baseColorTex.getURI() || '(embedded)'}`);

        const imageData = baseColorTex.getImage();
        if (imageData) {
          console.log(`  Texture data size: ${imageData.byteLength} bytes`);
          const texSize = baseColorTex.getSize();
          if (texSize) {
            console.log(
              `  Texture dimensions: ${texSize[0]} x ${texSize[1]}`,
            );
          }

          // ── 5. Analyze non-transparent pixels ────────────────────
          // The texture is likely PNG. We'll decode it to inspect alpha.
          await analyzeTextureAlpha(imageData, baseColorTex.getMimeType());
        }
      } else {
        console.log('  No base color texture');
      }

      // Check other texture slots
      const mrTex = material.getMetallicRoughnessTexture();
      if (mrTex)
        console.log(`  Metallic-roughness texture: "${mrTex.getName()}"`);
      const normalTex = material.getNormalTexture();
      if (normalTex) console.log(`  Normal texture: "${normalTex.getName()}"`);
      const emissiveTex = material.getEmissiveTexture();
      if (emissiveTex)
        console.log(`  Emissive texture: "${emissiveTex.getName()}"`);
    } else {
      console.log('  No material');
    }

    console.log();
  }
}

// ── Texture alpha analysis ─────────────────────────────────────────
async function analyzeTextureAlpha(imageBuffer, mimeType) {
  // We need to decode the PNG. Use sharp if available, otherwise
  // use a minimal PNG decoder approach.
  try {
    // Try using sharp (commonly available)
    const sharp = (await import('sharp')).default;
    const { data, info } = await sharp(Buffer.from(imageBuffer))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    console.log(
      `  Decoded texture: ${width}x${height}, ${channels} channels`,
    );

    // Scan for non-transparent pixels
    let nonTransparentCount = 0;
    let totalPixels = width * height;
    let minX = width,
      maxX = 0,
      minY = height,
      maxY = 0;

    // Build a grid map for small textures
    const alphaGrid = [];
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * channels;
        const a = data[idx + 3]; // alpha channel
        if (a > 0) {
          nonTransparentCount++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          row.push(a);
        } else {
          row.push(0);
        }
      }
      alphaGrid.push(row);
    }

    console.log(
      `  Non-transparent pixels: ${nonTransparentCount} / ${totalPixels}`,
    );

    if (nonTransparentCount > 0) {
      console.log(
        `  Non-transparent bounding box: x=[${minX}, ${maxX}], y=[${minY}, ${maxY}]`,
      );
      console.log(
        `  Bounding box size: ${maxX - minX + 1} x ${maxY - minY + 1}`,
      );

      // For small textures, print the full alpha map as ASCII art
      if (width <= 64 && height <= 64) {
        console.log(`\n  Texture alpha map (# = opaque, . = transparent):`);
        for (let y = 0; y < height; y++) {
          let line = '  ';
          for (let x = 0; x < width; x++) {
            line += alphaGrid[y][x] > 0 ? '#' : '.';
          }
          console.log(line);
        }
      }

      // For small textures, also dump RGBA of non-transparent pixels
      if (width <= 64 && height <= 64 && nonTransparentCount <= 200) {
        console.log(`\n  Non-transparent pixel RGBA values:`);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * channels;
            const a = data[idx + 3];
            if (a > 0) {
              const r = data[idx + 0];
              const g = data[idx + 1];
              const b = data[idx + 2];
              console.log(
                `    (${x},${y}): rgba(${r}, ${g}, ${b}, ${a})`,
              );
            }
          }
        }
      }

      // For larger textures, sample rows
      if (width > 64 || height > 64) {
        console.log(
          `\n  Sampling non-transparent pixel rows (texture too large for full dump):`,
        );
        const sampleStep = Math.max(1, Math.floor(height / 32));
        for (let y = minY; y <= maxY; y += sampleStep) {
          let line = `  row ${String(y).padStart(4)}: `;
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * channels;
            const a = data[idx + 3];
            line += a > 0 ? '#' : '.';
          }
          console.log(line);
        }
      }
    }
  } catch (e) {
    console.log(`  Could not decode texture: ${e.message}`);
    console.log(`  (Install 'sharp' for full texture analysis)`);
  }
}
