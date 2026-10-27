// Test fixture: the real plaza (plaza.glb's walls + collision.glb's roofs,
// seated the way Level.ts seats them), without a browser.

import type { SourceTri } from './faces';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { plazaDoors, plazaFootprints } from '../../interiors/plazaDoors';
import { seatRoofs } from '../roofs';

const LEVEL = resolve(__dirname, '../../../../../public/world2/level');

interface Gltf {
  accessors: {
    bufferView: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
  }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  meshes: {
    name: string;
    primitives: { attributes: Record<string, number>; indices?: number; material?: number }[];
  }[];
  materials: { name: string }[];
}

/** Every primitive of plaza.glb's `Buildings` mesh: material name + world triangles (+uv1). */
export function buildingPrimitives(
  meshName = 'Buildings',
): { material: string; tris: SourceTri[] }[] {
  const buf = readFileSync(resolve(LEVEL, 'plaza.glb'));
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Gltf;
  const bin = 20 + jsonLen + 8;
  const read = (i: number): number[][] => {
    const a = json.accessors[i]!;
    const bv = json.bufferViews[a.bufferView]!;
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type]!;
    const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType]!;
    const stride = bv.byteStride ?? n * size;
    const off = bin + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out: number[][] = [];
    for (let k = 0; k < a.count; k++) {
      const row: number[] = [];
      for (let c = 0; c < n; c++) {
        const at = off + k * stride + c * size;
        row.push(
          a.componentType === 5126
            ? buf.readFloatLE(at)
            : a.componentType === 5125
              ? buf.readUInt32LE(at)
              : a.componentType === 5123
                ? buf.readUInt16LE(at)
                : buf.readUInt8(at),
        );
      }
      out.push(row);
    }
    return out;
  };
  const mesh = json.meshes.find(m => m.name === meshName)!;
  return mesh.primitives.map(p => {
    const pos = read(p.attributes.POSITION!);
    const uv1 = p.attributes.TEXCOORD_1 !== undefined ? read(p.attributes.TEXCOORD_1) : null;
    const idx = p.indices !== undefined ? read(p.indices).map(r => r[0]!) : pos.map((_, i) => i);
    const tris: SourceTri[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      const ids = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
      tris.push({
        p: ids.map(i => pos[i] as [number, number, number]),
        uv1: uv1 !== null ? ids.map(i => uv1[i] as [number, number]) : undefined,
      });
    }
    return { material: json.materials[p.material ?? 0]!.name, tris };
  });
}

function loadCollision(): Promise<THREE.Mesh[]> {
  const b = readFileSync(resolve(LEVEL, 'collision.glb'));
  const ab = new ArrayBuffer(b.byteLength);
  new Uint8Array(ab).set(b);
  return new Promise((ok, fail) =>
    new GLTFLoader().parse(
      ab,
      '',
      g => {
        g.scene.updateMatrixWorld(true);
        const out: THREE.Mesh[] = [];
        g.scene.traverse(o => {
          if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
        });
        ok(out);
      },
      fail,
    ),
  );
}

/** The plaza as the game sees it: seated roofs, footprints, doors, facade triangles. */
export async function loadPlaza() {
  const prims = buildingPrimitives();
  const meshes = await loadCollision();
  const roofs = meshes.find(m => m.name === 'COL_Buildings')!;
  // The render mesh (positions only) the roofs get seated on
  const all = prims.flatMap(p => p.tris);
  const pos = new Float32Array(all.length * 9);
  all.forEach((t, i) => t.p.forEach((v, k) => pos.set(v, i * 9 + k * 3)));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const render = new THREE.Mesh(g);
  render.name = 'Buildings';
  render.updateMatrixWorld(true);
  const parapets = seatRoofs(roofs, [render]);
  const col = parapets !== null ? [...meshes, parapets] : meshes;
  const fps = plazaFootprints(col).filter(f => !f.key.startsWith('alley:'));
  const doors = plazaDoors(col, {});
  const facadeTris = prims.filter(p => /^(facade|plaster)/.test(p.material)).flatMap(p => p.tris);
  const decalTris = buildingPrimitives('Decals').flatMap(p => p.tris);
  return { prims, fps, doors, facadeTris, decalTris, collision: col };
}
