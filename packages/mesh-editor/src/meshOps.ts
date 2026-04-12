/**
 * meshOps — Paint, erase, fill, and eyedropper operations on mesh vertex colors.
 *
 * All color values are in linear color space (0-1 range) matching Three.js internals.
 * The geometry's color attribute is mutated in-place and flagged for GPU upload.
 */
import type { FaceAdjacencyGraph, MeshEditState } from './types';
import type * as THREE from 'three';

import { expandBrush, getFaceVertices } from './meshGraph';
import { FILL_EPSILON } from './types';

// ─── Color Conversion ───────────────────────────────────────────────────────

/** sRGB hex string → linear RGB [0-1, 0-1, 0-1] */
export function hexToLinear(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

/** Linear RGB [0-1] → sRGB hex string */
export function linearToHex(r: number, g: number, b: number): string {
  const sr = Math.round(linearToSrgb(r) * 255);
  const sg = Math.round(linearToSrgb(g) * 255);
  const sb = Math.round(linearToSrgb(b) * 255);
  return `#${sr.toString(16).padStart(2, '0')}${sg.toString(16).padStart(2, '0')}${sb.toString(16).padStart(2, '0')}`;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// ─── Vertex Color Helpers ───────────────────────────────────────────────────

/** Read vertex color at index from a Float32Array */
function readColor(colors: Float32Array, vertexIndex: number): [number, number, number] {
  const i = vertexIndex * 3;
  return [colors[i], colors[i + 1], colors[i + 2]];
}

/** Write vertex color at index in a Float32Array */
function writeColor(
  colors: Float32Array,
  vertexIndex: number,
  r: number,
  g: number,
  b: number,
): void {
  const i = vertexIndex * 3;
  colors[i] = r;
  colors[i + 1] = g;
  colors[i + 2] = b;
}

/** Check if two colors match within epsilon */
function colorsMatch(a: [number, number, number], b: [number, number, number]): boolean {
  return (
    Math.abs(a[0] - b[0]) < FILL_EPSILON &&
    Math.abs(a[1] - b[1]) < FILL_EPSILON &&
    Math.abs(a[2] - b[2]) < FILL_EPSILON
  );
}

/** Get the dominant color of a face (average of its 3 vertices) */
function getFaceColor(state: MeshEditState, faceIndex: number): [number, number, number] {
  const [v0, v1, v2] = getFaceVertices(state.geometry, faceIndex);
  const c0 = readColor(state.currentColors, v0);
  const c1 = readColor(state.currentColors, v1);
  const c2 = readColor(state.currentColors, v2);
  return [(c0[0] + c1[0] + c2[0]) / 3, (c0[1] + c1[1] + c2[1]) / 3, (c0[2] + c1[2] + c2[2]) / 3];
}

// ─── Operations ─────────────────────────────────────────────────────────────

/**
 * Paint a set of faces with a color. All vertices of each face get the color.
 * Returns the set of vertex indices that were modified (for undo tracking).
 */
export function paintFaces(
  state: MeshEditState,
  faceIndices: Iterable<number>,
  color: [number, number, number],
): Set<number> {
  const modified = new Set<number>();
  const [r, g, b] = color;

  for (const fi of faceIndices) {
    const [v0, v1, v2] = getFaceVertices(state.geometry, fi);
    writeColor(state.currentColors, v0, r, g, b);
    writeColor(state.currentColors, v1, r, g, b);
    writeColor(state.currentColors, v2, r, g, b);
    modified.add(v0);
    modified.add(v1);
    modified.add(v2);
  }

  syncColorsToGeometry(state);
  return modified;
}

/**
 * Paint faces with brush expansion from a clicked face.
 */
export function paintBrush(
  state: MeshEditState,
  clickedFace: number,
  brushSize: number,
  color: [number, number, number],
): Set<number> {
  const faces = expandBrush(clickedFace, brushSize, state.adjacency);
  return paintFaces(state, faces, color);
}

/**
 * Erase faces — restore original vertex colors from the saved originalColors.
 */
export function eraseFaces(state: MeshEditState, faceIndices: Iterable<number>): Set<number> {
  const modified = new Set<number>();

  for (const fi of faceIndices) {
    const [v0, v1, v2] = getFaceVertices(state.geometry, fi);
    for (const vi of [v0, v1, v2]) {
      const orig = readColor(state.originalColors, vi);
      writeColor(state.currentColors, vi, orig[0], orig[1], orig[2]);
      modified.add(vi);
    }
  }

  syncColorsToGeometry(state);
  return modified;
}

/**
 * Erase with brush expansion.
 */
export function eraseBrush(
  state: MeshEditState,
  clickedFace: number,
  brushSize: number,
): Set<number> {
  const faces = expandBrush(clickedFace, brushSize, state.adjacency);
  return eraseFaces(state, faces);
}

/**
 * Flood fill on the mesh surface.
 *
 * Starting from `startFace`, BFS along adjacent faces whose dominant color
 * matches the start face's color (within FILL_EPSILON). Paint all visited
 * faces with the fill color.
 */
export function floodFillMesh(
  state: MeshEditState,
  startFace: number,
  fillColor: [number, number, number],
): Set<number> {
  const startColor = getFaceColor(state, startFace);

  // Don't fill if the target color matches the start color
  if (colorsMatch(startColor, fillColor)) {
    return new Set();
  }

  const visited = new Set<number>();
  const queue = [startFace];
  visited.add(startFace);

  while (queue.length > 0) {
    const face = queue.shift()!;
    const neighbors = state.adjacency.get(face);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      const nColor = getFaceColor(state, neighbor);
      if (colorsMatch(nColor, startColor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return paintFaces(state, visited, fillColor);
}

/**
 * Eyedropper — sample the color at a face and return it as a hex string.
 * Returns the average color of the face's 3 vertices converted to sRGB hex.
 */
export function eyedropFace(state: MeshEditState, faceIndex: number): string {
  const [r, g, b] = getFaceColor(state, faceIndex);
  return linearToHex(r, g, b);
}

// ─── State Management ───────────────────────────────────────────────────────

/**
 * Initialize MeshEditState from a loaded BufferGeometry.
 * Clones vertex colors for the original backup and builds adjacency graph.
 */
export function initEditState(
  geometry: THREE.BufferGeometry,
  adjacency: FaceAdjacencyGraph,
): MeshEditState {
  const colorAttr = geometry.attributes.color;
  if (!colorAttr) {
    throw new Error('meshOps: geometry must have a color attribute');
  }

  const originalColors = new Float32Array(colorAttr.array as Float32Array);
  const currentColors = new Float32Array(colorAttr.array as Float32Array);
  const index = geometry.index;
  const faceCount = index ? Math.floor(index.count / 3) : 0;
  const vertexCount = colorAttr.count;

  // Initialize visibility (all visible)
  const visibility = new Float32Array(vertexCount);
  visibility.fill(1.0);

  return {
    geometry,
    originalColors,
    currentColors,
    visibility,
    adjacency,
    faceCount,
    vertexCount,
    buildVoxels: new Map(),
  };
}

/**
 * Sync currentColors back into the geometry's color attribute for GPU upload.
 */
export function syncColorsToGeometry(state: MeshEditState): void {
  const colorAttr = state.geometry.attributes.color;
  (colorAttr.array as Float32Array).set(state.currentColors);
  colorAttr.needsUpdate = true;
}

/**
 * Sync visibility mask to the geometry's 'visible' attribute.
 */
export function syncVisibilityToGeometry(state: MeshEditState): void {
  const visAttr = state.geometry.attributes.visible;
  if (!visAttr) return;
  (visAttr.array as Float32Array).set(state.visibility);
  visAttr.needsUpdate = true;
}

/**
 * Delete faces — set their vertices' visibility to 0 (invisible).
 */
export function deleteFaces(state: MeshEditState, faceIndices: Iterable<number>): Set<number> {
  const modified = new Set<number>();
  for (const fi of faceIndices) {
    const [v0, v1, v2] = getFaceVertices(state.geometry, fi);
    state.visibility[v0] = 0;
    state.visibility[v1] = 0;
    state.visibility[v2] = 0;
    modified.add(v0);
    modified.add(v1);
    modified.add(v2);
  }
  syncVisibilityToGeometry(state);
  return modified;
}

/**
 * Delete faces with brush expansion.
 */
export function deleteBrush(
  state: MeshEditState,
  clickedFace: number,
  brushSize: number,
): Set<number> {
  const faces = expandBrush(clickedFace, brushSize, state.adjacency);
  return deleteFaces(state, faces);
}

/**
 * Restore deleted faces — set their vertices' visibility back to 1.
 */
export function restoreFaces(state: MeshEditState, faceIndices: Iterable<number>): Set<number> {
  const modified = new Set<number>();
  for (const fi of faceIndices) {
    const [v0, v1, v2] = getFaceVertices(state.geometry, fi);
    state.visibility[v0] = 1;
    state.visibility[v1] = 1;
    state.visibility[v2] = 1;
    modified.add(v0);
    modified.add(v1);
    modified.add(v2);
  }
  syncVisibilityToGeometry(state);
  return modified;
}

// ─── Build Voxels ───────────────────────────────────────────────────────────

export function voxelKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function parseVoxelKey(key: string): [number, number, number] {
  const [x, y, z] = key.split(',').map(Number);
  return [x, y, z];
}

/**
 * Compute the voxel placement position from a mesh face hit.
 * Returns the integer grid position where a voxel should be placed
 * (one unit offset along the face normal from the hit point).
 */
export function computeBuildPosition(
  _state: MeshEditState,
  _faceIndex: number,
  hitPoint: THREE.Vector3,
  faceNormal: THREE.Vector3,
): [number, number, number] {
  // Place voxel one unit along the face normal from the hit point
  const x = Math.round(hitPoint.x + faceNormal.x * 0.6);
  const y = Math.round(hitPoint.y + faceNormal.y * 0.6);
  const z = Math.round(hitPoint.z + faceNormal.z * 0.6);
  return [x, y, z];
}

/**
 * Place a voxel at a grid position with a color.
 */
export function placeVoxel(
  state: MeshEditState,
  pos: [number, number, number],
  colorHex: string,
): void {
  state.buildVoxels.set(voxelKey(pos[0], pos[1], pos[2]), colorHex);
}

/**
 * Place an NxNxN block of voxels centered on a position.
 * size=1 → 1 voxel, size=2 → 2x2x2 (8 voxels), size=3 → 3x3x3 (27 voxels), etc.
 */
export function placeVoxelBlock(
  state: MeshEditState,
  center: [number, number, number],
  size: number,
  colorHex: string,
): void {
  const half = Math.floor((size - 1) / 2);
  for (let dx = -half; dx <= half + (size % 2 === 0 ? 0 : 0); dx++) {
    for (let dy = -half; dy <= half; dy++) {
      for (let dz = -half; dz <= half; dz++) {
        const key = voxelKey(center[0] + dx, center[1] + dy, center[2] + dz);
        state.buildVoxels.set(key, colorHex);
      }
    }
  }
}

/**
 * Remove a voxel at a grid position.
 */
export function removeVoxel(state: MeshEditState, pos: [number, number, number]): boolean {
  return state.buildVoxels.delete(voxelKey(pos[0], pos[1], pos[2]));
}

/**
 * Apply deltas to the current colors (used when loading saved edits).
 */
export function applyDeltas(
  state: MeshEditState,
  deltas: Map<number, [number, number, number]>,
): void {
  for (const [vi, [r, g, b]] of deltas) {
    writeColor(state.currentColors, vi, r, g, b);
  }
  syncColorsToGeometry(state);
}
