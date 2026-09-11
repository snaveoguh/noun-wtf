// ── StaticBatch — merge a static subtree into a handful of draw calls ──
//
// Some legacy set pieces are built brick-by-brick as thousands of tiny
// <mesh> elements (the NYC apartment block alone is ~8,400 boxes). That was
// survivable when the island was 64 tiles and the building was usually
// behind the camera; on the big island a hilltop view sees the whole core
// and every one of those meshes becomes its own draw call.
//
// Wrap a purely static subtree in <StaticBatch> and, once its children have
// mounted, every opaque untextured mesh is baked (world transform + material
// colour → vertex colour) into ONE merged geometry per material "flavour"
// and the originals are hidden. Nothing about the children's code changes;
// collision registration, Html labels, textured or transparent meshes are
// left exactly as they were.
//
// Do NOT wrap anything animated (materials mutated in useFrame, moving
// parts) — the bake is a snapshot.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface Bucket {
  material: THREE.Material;
  parts: THREE.BufferGeometry[];
}

function flavourKey(
  m: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | THREE.MeshLambertMaterial,
): string | null {
  if (m.transparent || m.opacity < 1 || m.map || m.alphaMap || m.alphaTest > 0) return null;
  if ((m as THREE.MeshStandardMaterial).emissiveMap || (m as THREE.MeshStandardMaterial).normalMap)
    return null;
  const std = m as THREE.MeshStandardMaterial;
  const emissive = std.emissive
    ? std.emissive.getHexString() + ':' + (std.emissiveIntensity ?? 1)
    : '';
  return [
    m.type,
    m.side,
    std.roughness ?? '',
    std.metalness ?? '',
    emissive,
    (std as { flatShading?: boolean }).flatShading ? 'flat' : '',
  ].join('|');
}

function cloneMaterialForBatch(m: THREE.Material): THREE.Material {
  const c = m.clone() as THREE.MeshStandardMaterial;
  c.vertexColors = true;
  if (c.color) c.color.set('#ffffff');
  return c;
}

export function batchStaticGroup(root: THREE.Object3D): () => void {
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, Bucket>();
  const hidden: THREE.Mesh[] = [];
  const color = new THREE.Color();

  root.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (
      !mesh.isMesh ||
      (mesh as THREE.InstancedMesh).isInstancedMesh ||
      (mesh as THREE.SkinnedMesh).isSkinnedMesh
    )
      return;
    if (!mesh.visible || Array.isArray(mesh.material) || !mesh.geometry) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!mat.isMaterial || !(mat as { color?: THREE.Color }).color) return;
    const key = flavourKey(mat);
    if (!key) return;
    const src = mesh.geometry;
    if (!src.attributes.position || src.attributes.position.count > 20000) return;

    const geo = src.index ? src.toNonIndexed() : src.clone();
    if (!geo.attributes.normal) geo.computeVertexNormals();
    // Keep a uniform attribute set so every part merges.
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    }
    geo.morphAttributes = {};
    // Bake world transform (relative to the batch root).
    const local = new THREE.Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld);
    geo.applyMatrix4(local);
    // Bake material colour → vertex colour.
    color.copy(mat.color);
    const n = geo.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = { material: cloneMaterialForBatch(mat), parts: [] }));
    bucket.parts.push(geo);
    hidden.push(mesh);
  });

  const merged: THREE.Mesh[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.parts.length < 2) {
      // Not worth it — leave the single mesh alone.
      for (const p of bucket.parts) p.dispose();
      continue;
    }
    const g = mergeGeometries(bucket.parts, false);
    for (const p of bucket.parts) p.dispose();
    if (!g) continue;
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const m = new THREE.Mesh(g, bucket.material);
    m.name = 'static-batch';
    m.frustumCulled = true;
    root.add(m);
    merged.push(m);
  }
  // Hide originals only for buckets that actually merged.
  const mergedMaterials = new Set(merged.map(m => m.material));
  for (const mesh of hidden) {
    const key = flavourKey(mesh.material as THREE.MeshStandardMaterial);
    const b = key ? buckets.get(key) : undefined;
    if (b && mergedMaterials.has(b.material)) mesh.visible = false;
  }

  return () => {
    for (const m of merged) {
      root.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    for (const mesh of hidden) mesh.visible = true;
  };
}

export function StaticBatch({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    const g = ref.current;
    if (!g) return;
    // Children's effects have run by now; give async loaders one tick.
    let cleanup: (() => void) | null = null;
    const id = window.setTimeout(() => {
      cleanup = batchStaticGroup(g);
    }, 0);
    return () => {
      window.clearTimeout(id);
      cleanup?.();
    };
  }, []);
  return <group ref={ref}>{children}</group>;
}
