import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { VoxelMap, VoxelPixel } from './types';
import { BODY_DEPTH, GLASSES_DEPTH } from './types';
import { parseKey } from './voxelMap';

// ─── Build merged geometry from VoxelPixel array ────────────────────────────

/**
 * Build a single merged BufferGeometry with baked vertex colors from VoxelPixels.
 * Used for the readonly viewer (TiltScene, InteractiveScene).
 */
export function buildMergedGeometry(
  pixels: VoxelPixel[],
  depth: number,
  zOffset: number,
): THREE.BufferGeometry | null {
  if (pixels.length === 0) return null;
  const boxTemplate = new THREE.BoxGeometry(1, 1, depth);
  const geometries: THREE.BufferGeometry[] = [];
  for (const p of pixels) {
    const box = boxTemplate.clone();
    box.translate(p.x - 15.5, p.y - 15.5, zOffset);
    const count = box.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const r = p.r / 255, g = p.g / 255, b = p.b / 255;
    for (let i = 0; i < count; i++) {
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    box.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometries.push(box);
  }
  const merged = mergeGeometries(geometries, false);
  boxTemplate.dispose();
  for (const g of geometries) g.dispose();
  return merged;
}

// ─── Build merged geometry from VoxelMap ────────────────────────────────────

/**
 * Build a single merged BufferGeometry from a VoxelMap (used for viewer mode).
 */
export function buildGeometryFromVoxelMap(map: VoxelMap): THREE.BufferGeometry | null {
  if (map.size === 0) return null;
  const boxTemplate = new THREE.BoxGeometry(1, 1, 1);
  const geometries: THREE.BufferGeometry[] = [];
  for (const [key, color] of map) {
    const [x, y, z] = parseKey(key);
    const box = boxTemplate.clone();
    box.translate(x - 15.5, y - 15.5, z);
    const count = box.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    box.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometries.push(box);
  }
  const merged = mergeGeometries(geometries, false);
  boxTemplate.dispose();
  for (const g of geometries) g.dispose();
  return merged;
}

// ─── Build body + glasses geometries from NounLayers ────────────────────────

export function buildNounGeometries(layers: { body: VoxelPixel[]; glasses: VoxelPixel[] }) {
  return {
    bodyGeo: buildMergedGeometry(layers.body, BODY_DEPTH, 0),
    glassesGeo: buildMergedGeometry(layers.glasses, GLASSES_DEPTH, BODY_DEPTH / 2 + GLASSES_DEPTH / 2),
  };
}
