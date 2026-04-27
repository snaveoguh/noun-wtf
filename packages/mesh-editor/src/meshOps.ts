/**
 * meshOps — Paint, erase, fill, and eyedropper operations on mesh vertex colors.
 *
 * All color values are in linear color space (0-1 range) matching Three.js internals.
 * The geometry's color attribute is mutated in-place and flagged for GPU upload.
 */
import type { FaceAdjacencyGraph, MeshEditState, VoxelMap } from './types';

import * as THREE from 'three';

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
function colorsMatch(
  a: [number, number, number],
  b: [number, number, number],
  epsilon: number = FILL_EPSILON,
): boolean {
  return (
    Math.abs(a[0] - b[0]) < epsilon &&
    Math.abs(a[1] - b[1]) < epsilon &&
    Math.abs(a[2] - b[2]) < epsilon
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
 * matches the start face's color (within `epsilon`). Paint all visited
 * faces with the fill color.
 *
 * The default tolerance is intentionally generous (0.12 in linear space,
 * roughly 30 sRGB levels) — GLB textures bake per-vertex colors that vary
 * subtly across what looks like a single flat region, and the previous
 * tight 0.02 epsilon caused the bucket to halt at the start face on most
 * GLB-rendered heads.
 */
const DEFAULT_FLOOD_EPSILON = 0.12;

export function floodFillMesh(
  state: MeshEditState,
  startFace: number,
  fillColor: [number, number, number],
  epsilon: number = DEFAULT_FLOOD_EPSILON,
): Set<number> {
  const startColor = getFaceColor(state, startFace);

  // Don't fill if the target color matches the start color
  if (colorsMatch(startColor, fillColor, epsilon)) {
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
      if (colorsMatch(nColor, startColor, epsilon)) {
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
    interiorVoxels: null,
    revealedVoxels: new Map(),
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
 *
 * If the mesh has been voxelized (state.interiorVoxels), also reveal any
 * interior voxels lying behind the deleted face so erasing exposes the
 * solid-filled volume rather than a hollow gap.
 */
export function deleteFaces(state: MeshEditState, faceIndices: Iterable<number>): Set<number> {
  const modified = new Set<number>();
  const positions = state.geometry.attributes.position;

  for (const fi of faceIndices) {
    const [v0, v1, v2] = getFaceVertices(state.geometry, fi);
    state.visibility[v0] = 0;
    state.visibility[v1] = 0;
    state.visibility[v2] = 0;
    modified.add(v0);
    modified.add(v1);
    modified.add(v2);

    // Reveal interior voxel(s) sitting directly behind this face.
    if (state.interiorVoxels && positions) {
      const cx = (positions.getX(v0) + positions.getX(v1) + positions.getX(v2)) / 3;
      const cy = (positions.getY(v0) + positions.getY(v1) + positions.getY(v2)) / 3;
      const cz = (positions.getZ(v0) + positions.getZ(v1) + positions.getZ(v2)) / 3;
      // Search the 27-cell neighborhood around the face centroid for any
      // interior voxels (the centroid may not align exactly to the grid).
      const bx = Math.round(cx);
      const by = Math.round(cy);
      const bz = Math.round(cz);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const key = `${bx + dx},${by + dy},${bz + dz}`;
            const color = state.interiorVoxels.get(key);
            if (color && !state.revealedVoxels.has(key)) {
              state.revealedVoxels.set(key, color);
            }
          }
        }
      }
    }
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

// ─── Mesh Voxelization ──────────────────────────────────────────────────────

/**
 * Voxelize a mesh into a solid-filled grid.
 *
 * For every integer cell inside the mesh's bounding box, casts a ray along
 * +X and counts triangle intersections. Odd count → cell is inside the
 * surface and gets a voxel; sampled color is taken from the nearest
 * vertex's current color (linear → sRGB hex).
 *
 * Returns null if the mesh is too small or lacks geometry data.
 *
 * Performance budget: keeps the grid under MAX_GRID_VOXELS by adapting cell
 * size when bounding boxes are large. For typical Noun head GLBs (~30³
 * units) this lands at a few thousand cells with sub-100ms cost.
 */
const MAX_GRID_VOXELS = 60_000;

export function voxelizeMeshInterior(
  geometry: THREE.BufferGeometry,
  currentColors: Float32Array,
): VoxelMap | null {
  const posAttr = geometry.attributes.position;
  const index = geometry.index;
  if (!posAttr || !index) return null;

  // Build a Mesh wrapping the geometry — Raycaster needs an Object3D.
  // The material is irrelevant (raycaster reads geometry, not material).
  const tmpMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const tmpMesh = new THREE.Mesh(geometry, tmpMat);

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) {
    tmpMat.dispose();
    return null;
  }

  // Adaptive grid step: aim for ~MAX_GRID_VOXELS interior cells.
  const sx = Math.ceil(bb.max.x - bb.min.x);
  const sy = Math.ceil(bb.max.y - bb.min.y);
  const sz = Math.ceil(bb.max.z - bb.min.z);
  if (sx < 2 || sy < 2 || sz < 2) {
    tmpMat.dispose();
    return null;
  }

  let step = 1;
  while ((sx / step) * (sy / step) * (sz / step) > MAX_GRID_VOXELS) {
    step++;
  }

  const ix0 = Math.floor(bb.min.x);
  const iy0 = Math.floor(bb.min.y);
  const iz0 = Math.floor(bb.min.z);
  const ix1 = Math.ceil(bb.max.x);
  const iy1 = Math.ceil(bb.max.y);
  const iz1 = Math.ceil(bb.max.z);

  const raycaster = new THREE.Raycaster();
  const rayDir = new THREE.Vector3(1, 0, 0);
  const origin = new THREE.Vector3();

  const out: VoxelMap = new Map();

  // Push the ray origin slightly outside the bounding box so we don't
  // start inside a triangle (which can cause flickery parity counts).
  const rayStartX = bb.min.x - 1;

  for (let z = iz0; z <= iz1; z += step) {
    for (let y = iy0; y <= iy1; y += step) {
      origin.set(rayStartX, y, z);
      raycaster.set(origin, rayDir);

      const hits = raycaster.intersectObject(tmpMesh, false);
      if (hits.length === 0) continue;

      // Sort hits by X (they should already be, but be defensive).
      hits.sort((a, b) => a.point.x - b.point.x);

      // Walk through cells along X — toggle inside/outside at each hit.
      // Color sampling: each interior segment lies between two hits; we
      // color the cell using whichever hit (entry/exit) is closer.
      let inside = false;
      let hitIdx = 0;
      let lastEntryHit: THREE.Intersection | null = null;
      for (let x = ix0; x <= ix1; x += step) {
        while (hitIdx < hits.length && hits[hitIdx].point.x <= x) {
          inside = !inside;
          if (inside) lastEntryHit = hits[hitIdx];
          hitIdx++;
        }
        if (!inside) continue;

        // Choose closer hit (the entry we're past, or the next exit ahead).
        const entry = lastEntryHit;
        const exit = hits[hitIdx]; // next hit, must be exit since we're inside
        let chosen: THREE.Intersection | null = entry;
        if (exit && entry) {
          const dEntry = Math.abs(x - entry.point.x);
          const dExit = Math.abs(exit.point.x - x);
          if (dExit < dEntry) chosen = exit;
        } else if (exit && !entry) {
          chosen = exit;
        }

        if (!chosen || chosen.face == null) continue;
        const f = chosen.face;
        // Average the 3 vertex colors of the hit triangle (linear → hex).
        const r = (currentColors[f.a * 3] + currentColors[f.b * 3] + currentColors[f.c * 3]) / 3;
        const g =
          (currentColors[f.a * 3 + 1] + currentColors[f.b * 3 + 1] + currentColors[f.c * 3 + 1]) /
          3;
        const b =
          (currentColors[f.a * 3 + 2] + currentColors[f.b * 3 + 2] + currentColors[f.c * 3 + 2]) /
          3;
        const hex = linearToHex(r, g, b);
        out.set(`${x},${y},${z}`, hex);
      }
    }
  }

  tmpMat.dispose();
  return out.size > 0 ? out : null;
}
