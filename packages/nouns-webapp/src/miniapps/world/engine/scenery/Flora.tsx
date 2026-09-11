// ── Flora — instanced trees / bushes / rocks / grass / flowers ───────
//
// One InstancedMesh per category per 64-tile chunk (≈ 6 draws per chunk),
// distance-culled per category in a single useFrame so grass only draws
// near the camera while trees carry to the fog line. Everything sways in
// the shared wind (see wind.ts). None of it is raycastable — the camera's
// collision ray skips it entirely (InstancedMesh.raycast would otherwise
// test every blade of grass every frame).

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getFloraData, type ChunkFlora, type InstanceRec, CHUNK_UNITS } from './floraData';
import { applyWindSway, tickWind } from './wind';

// ── Draw distances (units from camera to chunk centre, minus half-diag) ──
const HALF_DIAG = CHUNK_UNITS * 0.71;
const RANGE = {
  grass: 120,
  flowers: 140,
  bushes: 220,
  rocks: 300,
  trees: 380,
};

// ── Geometry / material singletons (built lazily, once) ──────────────

function colorGeometry(src: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  // mergeGeometries needs every part indexed or none; polyhedra are
  // non-indexed, cylinders/cones are indexed — normalise to non-indexed.
  const geo = src.index ? src.toNonIndexed() : src;
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function makeConifer(): THREE.BufferGeometry {
  const trunk = colorGeometry(new THREE.CylinderGeometry(0.07, 0.13, 1.0, 4), '#5a3a22').translate(
    0,
    0.5,
    0,
  );
  const c1 = colorGeometry(new THREE.ConeGeometry(0.62, 1.0, 5), '#2b5f2a').translate(0, 1.15, 0);
  const c2 = colorGeometry(new THREE.ConeGeometry(0.47, 0.85, 5), '#2f6b2c').translate(0, 1.7, 0);
  const c3 = colorGeometry(new THREE.ConeGeometry(0.3, 0.7, 5), '#377a31').translate(0, 2.2, 0);
  return mergeGeometries([trunk, c1, c2, c3], false)!;
}

function makeBroadleaf(): THREE.BufferGeometry {
  const trunk = colorGeometry(new THREE.CylinderGeometry(0.09, 0.15, 1.2, 4), '#6b4226').translate(
    0,
    0.6,
    0,
  );
  const c1 = colorGeometry(new THREE.IcosahedronGeometry(0.62, 0), '#2d6b1e').translate(0, 1.55, 0);
  const c2 = colorGeometry(new THREE.IcosahedronGeometry(0.44, 0), '#1e5214').translate(
    0.24,
    1.86,
    0.14,
  );
  const c3 = colorGeometry(new THREE.IcosahedronGeometry(0.38, 0), '#3a7a28').translate(
    -0.26,
    1.7,
    -0.18,
  );
  return mergeGeometries([trunk, c1, c2, c3], false)!;
}

function makeBush(): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(0.42, 0).scale(1, 0.72, 1).translate(0, 0.28, 0);
}

function makeRock(): THREE.BufferGeometry {
  return new THREE.DodecahedronGeometry(0.34, 0).scale(1.1, 0.8, 1).translate(0, 0.16, 0);
}

function makeGrassTexture(): THREE.CanvasTexture {
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);
  const greens = ['#4f8a2f', '#5f9a38', '#3f7a26', '#6aa63f', '#4a8532'];
  for (let i = 0; i < 9; i++) {
    const bx = 6 + Math.random() * (S - 12);
    const tipX = bx + (Math.random() - 0.5) * 18;
    const h = 30 + Math.random() * 32;
    const w = 4 + Math.random() * 4;
    ctx.fillStyle = greens[i % greens.length];
    ctx.beginPath();
    ctx.moveTo(bx - w / 2, S);
    ctx.quadraticCurveTo(bx + (tipX - bx) * 0.4, S - h * 0.6, tipX, S - h);
    ctx.quadraticCurveTo(bx + (tipX - bx) * 0.6, S - h * 0.5, bx + w / 2, S);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function makeGrassGeometry(): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(1.0, 0.78).translate(0, 0.39, 0).toNonIndexed();
  const b = a.clone().rotateY(Math.PI / 2);
  return mergeGeometries([a, b], false)!;
}

function makeFlowerStem(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(0.03, 0.36, 0.03).translate(0, 0.18, 0);
}

function makeFlowerHead(): THREE.BufferGeometry {
  return new THREE.CircleGeometry(0.1, 6).rotateX(-Math.PI / 2).translate(0, 0.36, 0);
}

interface Assets {
  conifer: THREE.BufferGeometry;
  broadleaf: THREE.BufferGeometry;
  bush: THREE.BufferGeometry;
  rock: THREE.BufferGeometry;
  grass: THREE.BufferGeometry;
  stem: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  treeMat: THREE.MeshLambertMaterial;
  bushMat: THREE.MeshLambertMaterial;
  rockMat: THREE.MeshLambertMaterial;
  grassMat: THREE.MeshLambertMaterial;
  stemMat: THREE.MeshLambertMaterial;
  headMat: THREE.MeshLambertMaterial;
}

let assets: Assets | null = null;

function getAssets(): Assets {
  if (assets) return assets;
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  applyWindSway(treeMat, { height: 2.3, amount: 0.1, freq: 1.05 });
  const bushMat = new THREE.MeshLambertMaterial({ color: '#2f6a25' });
  applyWindSway(bushMat, { height: 0.75, amount: 0.05, freq: 1.7 });
  const rockMat = new THREE.MeshLambertMaterial({ color: '#8a8a86', flatShading: true });
  const grassMat = new THREE.MeshLambertMaterial({
    map: makeGrassTexture(),
    alphaTest: 0.45,
    side: THREE.DoubleSide,
  });
  applyWindSway(grassMat, { height: 0.78, amount: 0.17, freq: 2.1 });
  const stemMat = new THREE.MeshLambertMaterial({ color: '#3e7a2a' });
  applyWindSway(stemMat, { height: 0.36, amount: 0.07, freq: 2.4 });
  const headMat = new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide });
  applyWindSway(headMat, { height: 0.36, amount: 0.07, freq: 2.4 });
  assets = {
    conifer: makeConifer(),
    broadleaf: makeBroadleaf(),
    bush: makeBush(),
    rock: makeRock(),
    grass: makeGrassGeometry(),
    stem: makeFlowerStem(),
    head: makeFlowerHead(),
    treeMat,
    bushMat,
    rockMat,
    grassMat,
    stemMat,
    headMat,
  };
  return assets;
}

// ── Instance building ────────────────────────────────────────────────

const FLOWER_COLORS = ['#ff5fa8', '#ffd84a', '#ffffff', '#ff5d6c', '#a98cff', '#ff9a3c'];
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

type Category = 'grass' | 'flowers' | 'bushes' | 'rocks' | 'trees';

interface ChunkMeshes {
  centerX: number;
  centerZ: number;
  byCat: Record<Category, THREE.InstancedMesh[]>;
  all: THREE.InstancedMesh[];
}

function noRaycast(): void {}

function makeInstanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  recs: InstanceRec[],
  opts: {
    yScale?: number;
    tint?: (rec: InstanceRec, out: THREE.Color) => void;
  } = {},
): THREE.InstancedMesh | null {
  if (recs.length === 0) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, recs.length);
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    dummy.position.set(r.x, r.y, r.z);
    dummy.rotation.set(0, r.rot, 0);
    dummy.scale.set(r.s, r.s * (opts.yScale ?? 1), r.s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (opts.tint) {
      opts.tint(r, tmpColor);
      mesh.setColorAt(i, tmpColor);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.raycast = noRaycast;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

function buildChunkMeshes(chunk: ChunkFlora, a: Assets): ChunkMeshes | null {
  const byCat: Record<Category, THREE.InstancedMesh[]> = {
    grass: [],
    flowers: [],
    bushes: [],
    rocks: [],
    trees: [],
  };
  const push = (cat: Category, m: THREE.InstancedMesh | null) => {
    if (m) byCat[cat].push(m);
  };
  const treeTint = (r: InstanceRec, out: THREE.Color) => {
    const k = 0.82 + r.v * 0.28;
    out.setRGB(k, k * (0.97 + r.v * 0.06), k);
  };
  push('trees', makeInstanced(a.conifer, a.treeMat, chunk.conifers, { tint: treeTint }));
  push('trees', makeInstanced(a.broadleaf, a.treeMat, chunk.broadleaf, { tint: treeTint }));
  push('bushes', makeInstanced(a.bush, a.bushMat, chunk.bushes));
  push('rocks', makeInstanced(a.rock, a.rockMat, chunk.rocks));
  push(
    'grass',
    makeInstanced(a.grass, a.grassMat, chunk.grass, {
      tint: (r, out) => {
        const k = 0.8 + r.v * 0.3;
        out.setRGB(k, k, k);
      },
    }),
  );
  push('flowers', makeInstanced(a.stem, a.stemMat, chunk.flowers));
  push(
    'flowers',
    makeInstanced(a.head, a.headMat, chunk.flowers, {
      tint: (r, out) =>
        out.set(FLOWER_COLORS[Math.floor(r.v * FLOWER_COLORS.length) % FLOWER_COLORS.length]),
    }),
  );
  const all = [...byCat.trees, ...byCat.bushes, ...byCat.rocks, ...byCat.grass, ...byCat.flowers];
  if (all.length === 0) return null;
  return { centerX: chunk.centerX, centerZ: chunk.centerZ, byCat, all };
}

// ── Component ────────────────────────────────────────────────────────

export function Flora() {
  const groupRef = useRef<THREE.Group>(null);
  const chunks = useMemo(() => {
    const a = getAssets();
    const { chunks } = getFloraData();
    const out: ChunkMeshes[] = [];
    for (const c of chunks) {
      const m = buildChunkMeshes(c, a);
      if (m) out.push(m);
    }
    return out;
  }, []);

  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    for (const c of chunks) for (const m of c.all) g.add(m);
    return () => {
      for (const c of chunks) {
        for (const m of c.all) {
          g.remove(m);
          m.dispose();
        }
      }
    };
  }, [chunks]);

  // Distance culling per category + the global wind tick.
  useFrame(({ camera }, delta) => {
    tickWind(Math.min(delta, 0.1));
    const cx = camera.position.x;
    const cz = camera.position.z;
    for (const c of chunks) {
      const d = Math.hypot(c.centerX - cx, c.centerZ - cz) - HALF_DIAG;
      const vis = (cat: Category, range: number) => {
        const v = d < range;
        const list = c.byCat[cat];
        for (let i = 0; i < list.length; i++) if (list[i].visible !== v) list[i].visible = v;
      };
      vis('grass', RANGE.grass);
      vis('flowers', RANGE.flowers);
      vis('bushes', RANGE.bushes);
      vis('rocks', RANGE.rocks);
      vis('trees', RANGE.trees);
    }
  });

  return <group ref={groupRef} name="flora" />;
}
