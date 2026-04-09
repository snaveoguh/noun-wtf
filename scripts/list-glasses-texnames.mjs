/**
 * List ALL glasses texture names found across GLBs.
 */
import { NodeIO } from '@gltf-transform/core';
import { readdirSync } from 'fs';
import path from 'path';

const glbDir = path.resolve('packages/nouns-webapp/public/models/heads/3dnouns');
const glbFiles = readdirSync(glbDir).filter(f => f.endsWith('.glb'));
const io = new NodeIO();

const texNames = new Map(); // texName → [glbFiles]

for (const file of glbFiles) {
  try {
    const doc = await io.read(path.join(glbDir, file));
    for (const node of doc.getRoot().listNodes()) {
      if (!node.getName().toLowerCase().includes('glass')) continue;
      const mesh = node.getMesh();
      if (!mesh) continue;
      for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial();
        if (!mat) continue;
        const tex = mat.getBaseColorTexture();
        if (!tex) continue;
        const name = tex.getName() || '(unnamed)';
        if (!texNames.has(name)) texNames.set(name, []);
        texNames.get(name).push(file);
      }
    }
  } catch {}
}

console.log(`\nUnique glasses texture names (${texNames.size}):\n`);
for (const [name, files] of [...texNames.entries()].sort()) {
  console.log(`  "${name}" — ${files.length} GLBs (e.g. ${files[0]})`);
}
