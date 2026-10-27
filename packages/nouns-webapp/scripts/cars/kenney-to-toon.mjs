// Kenney Car Kit (CC0) → Noun World's car look: one flat colour per face.
//
//   node scripts/cars/kenney-to-toon.mjs <kenney.glb> <colormap.png> <out.glb> [scale] [recolour]
//
// Samples the kit's gradient colormap at each triangle's UV centroid, so
// every face gets one flat colour (no texture, no UVs, no tangents: the toon
// ramp + ink pass give the shading). Colours are posterised to a few steps
// per channel, which flattens the kit's soft gradients into the game's
// chunky blocks. `recolour` swaps the body paint: "from>to,from>to" as hex
// (e.g. "dd4444>ff7a00"), matched to the nearest posterised colour.
// Node names (body, wheel-front-left, …) are kept; the wheel nodes keep only
// their position (cars/kenneyModel.ts mounts the game's own wheels there).
// Output is a plain GLB (positions, normals, COLOR_0 as normalised bytes).

import { Document, NodeIO } from '@gltf-transform/core';
import fs from 'node:fs';
import { PNG } from 'pngjs';

const [src, mapFile, out, scaleArg, recolourArg] = process.argv.slice(2);
if (!src || !mapFile || !out) {
  console.error('usage: kenney-to-toon.mjs <in.glb> <colormap.png> <out.glb> [scale] [recolour]');
  process.exit(1);
}
const scale = Number(scaleArg ?? 1) || 1;
const png = PNG.sync.read(fs.readFileSync(mapFile));
const STEP = 24;
const post = v => Math.min(255, Math.round(v / STEP) * STEP);
const recolour = (recolourArg ?? '')
  .split(',')
  .filter(Boolean)
  .map(p => p.split('>').map(h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))));

function sample(u, v) {
  const x = Math.min(png.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * png.width)));
  const y = Math.min(png.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * png.height)));
  const i = (y * png.width + x) * 4;
  let c = [post(png.data[i]), post(png.data[i + 1]), post(png.data[i + 2])];
  for (const [from, to] of recolour) {
    if (Math.hypot(c[0] - from[0], c[1] - from[1], c[2] - from[2]) < 60) c = to;
  }
  return c.map(x => x / 255);
}

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const io = new NodeIO();
const inDoc = await io.read(src);
const doc = new Document();
const buf = doc.createBuffer();
const mat = doc.createMaterial('paint').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.6).setMetallicFactor(0);
const scene = doc.createScene('car');
let tris = 0;

function convertMesh(mesh, name) {
  const outMesh = doc.createMesh(name);
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const uv = prim.getAttribute('TEXCOORD_0');
    const idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    const P = new Float32Array(n * 3);
    const N = new Float32Array(n * 3);
    const C = new Uint8Array(n * 3);
    const a = [0, 0, 0];
    const t = [0, 0];
    for (let f = 0; f < n; f += 3) {
      const vs = [];
      let u = 0;
      let v = 0;
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx.getScalar(f + k) : f + k;
        pos.getElement(vi, a);
        vs.push([a[0] * scale, a[1] * scale, a[2] * scale]);
        if (uv) {
          uv.getElement(vi, t);
          u += t[0] / 3;
          v += t[1] / 3;
        }
      }
      const col = sample(u, v);
      // flat face normal
      const e1 = vs[1].map((x, i) => x - vs[0][i]);
      const e2 = vs[2].map((x, i) => x - vs[0][i]);
      const nx = e1[1] * e2[2] - e1[2] * e2[1];
      const ny = e1[2] * e2[0] - e1[0] * e2[2];
      const nz = e1[0] * e2[1] - e1[1] * e2[0];
      const nl = Math.hypot(nx, ny, nz) || 1;
      for (let k = 0; k < 3; k++) {
        P.set(vs[k], (f + k) * 3);
        N.set([nx / nl, ny / nl, nz / nl], (f + k) * 3);
        // glTF vertex colours are linear
        C.set(col.map(x => Math.round(srgbToLinear(x) * 255)), (f + k) * 3);
      }
    }
    tris += n / 3;
    const p = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buf))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(buf))
      .setAttribute(
        'COLOR_0',
        doc.createAccessor().setType('VEC3').setArray(C).setNormalized(true).setBuffer(buf),
      )
      .setMaterial(mat);
    outMesh.addPrimitive(p);
  }
  return outMesh;
}

function copyNode(node) {
  const o = doc.createNode(node.getName());
  const tr = node.getTranslation();
  o.setTranslation([tr[0] * scale, tr[1] * scale, tr[2] * scale]);
  o.setRotation(node.getRotation());
  o.setScale(node.getScale());
  const m = node.getMesh();
  // Wheels stay as empty nodes (where they go): the game puts its own chunky
  // wheels there, the same as every other car's
  if (m && !/^wheel/.test(node.getName())) o.setMesh(convertMesh(m, node.getName()));
  for (const c of node.listChildren()) o.addChild(copyNode(c));
  return o;
}

for (const root of inDoc.getRoot().getDefaultScene().listChildren()) scene.addChild(copyNode(root));
await io.write(out, doc);
console.log(`${out}: ${tris} tris, ${fs.statSync(out).size} bytes`);
