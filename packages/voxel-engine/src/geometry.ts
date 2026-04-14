import type { VoxelMap, VoxelPixel, NounLayers } from './types';

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { BODY_DEPTH, BLING_DEPTH, GLASSES_DEPTH, HEAD_DEPTH } from './types';
import { parseKey } from './voxelMap';

// Convert sRGB 0-1 channel to linear RGB for Three.js vertex colors.
// Three.js renderer outputs sRGB, so vertex colors must be in linear space.
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// ─── Build merged geometry from VoxelPixel array ────────────────────────────

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
    const r = srgbToLinear(p.r / 255);
    const g = srgbToLinear(p.g / 255);
    const b = srgbToLinear(p.b / 255);
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
    // THREE.Color(hex) already converts sRGB→linear internally
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

// ─── Build body + bling + glasses geometries from NounLayers ────────────────

/**
 * Build 3 separate geometries for proper depth rendering:
 * - body: full BODY_DEPTH, centered at z=0
 * - bling: BLING_DEPTH, sits on front face of body
 * - head: full HEAD_DEPTH, pushed in front of accessory
 * - glasses: GLASSES_DEPTH, always top-most
 */
export function buildNounGeometries(layers: NounLayers, headDepth?: number) {
  const hd = headDepth ?? HEAD_DEPTH;
  const bodyZ = 0.75; // shifted forward to align body front face flush with heads
  // Bling sits flush on body front face
  const blingZ = BODY_DEPTH / 2 + BLING_DEPTH / 2;
  // Head protrudes in front of accessory so it always reads above bling.
  const headZ = BODY_DEPTH / 2 - BLING_DEPTH / 2 + 0.03;
  // Glasses sit just in front of the head. Tiny offset prevents z-fighting.
  const glassesZ = headZ + hd / 2 + GLASSES_DEPTH / 2 + 0.02;

  return {
    bodyGeo: buildMergedGeometry(layers.body, BODY_DEPTH, bodyZ),
    blingGeo: buildMergedGeometry(layers.bling, BLING_DEPTH, blingZ),
    headGeo: buildMergedGeometry(layers.head, hd, headZ),
    glassesGeo: buildMergedGeometry(layers.glasses, GLASSES_DEPTH, glassesZ),
  };
}
