import type * as THREE from 'three';

// ─── Core Types ─────────────────────────────────────────────────────────────

/** Sparse map of vertex index → [r, g, b] in linear color space (0-1 range) */
export type MeshColorDelta = Map<number, [number, number, number]>;

/** Face adjacency: faceIndex → set of adjacent faceIndices (share an edge) */
export type FaceAdjacencyGraph = Map<number, Set<number>>;

/** "x,y,z" → hex color string — placed voxel cubes on the mesh surface */
export type VoxelMap = Map<string, string>;

/** Full editing state for a loaded mesh */
export interface MeshEditState {
  /** The live BufferGeometry being edited */
  geometry: THREE.BufferGeometry;
  /** Original vertex colors (cloned at load time, never mutated) */
  originalColors: Float32Array;
  /** Current vertex colors (mutated by paint ops, synced to geometry) */
  currentColors: Float32Array;
  /** Per-vertex visibility (1.0 = visible, 0.0 = deleted). Synced to geometry 'visible' attribute. */
  visibility: Float32Array;
  /** Precomputed face adjacency */
  adjacency: FaceAdjacencyGraph;
  /** Number of faces in the mesh */
  faceCount: number;
  /** Number of vertices in the mesh */
  vertexCount: number;
  /** Voxel cubes placed on the mesh surface */
  buildVoxels: VoxelMap;
  /**
   * Solid-fill interior voxel grid sampled at GLB import time.
   *
   * Each entry is a "x,y,z" voxel key → "#rrggbb" sampled from the closest
   * surface point. These voxels are NOT rendered until a face is deleted
   * nearby — at which point the corresponding voxels are revealed via
   * `revealedVoxels`, producing the appearance of carving through a solid.
   *
   * `null` means voxelization wasn't run (small grids or insufficient mesh
   * data) — eraser falls back to the old behavior in that case.
   */
  interiorVoxels: VoxelMap | null;
  /**
   * Subset of `interiorVoxels` that has been exposed by face deletions.
   * Rendered as instanced cubes alongside `buildVoxels`.
   */
  revealedVoxels: VoxelMap;
}

export type Tool = 'pencil' | 'eraser' | 'fill' | 'eyedropper' | 'build';

export interface EditableSceneViewState {
  cameraPosition: [number, number, number];
  target: [number, number, number];
  zoom: number;
}

// ─── Persistence ────────────────────────────────────────────────────────────

export interface MeshEditSaveData {
  glbPath: string;
  /** Sparse map: vertex index (as string key) → [r, g, b] linear */
  deltas: Record<string, [number, number, number]>;
  /** Vertex indices that have been deleted (visibility = 0) */
  deletedVertices?: number[];
  /** Placed voxel cubes: "x,y,z" → "#rrggbb" */
  buildVoxels?: Record<string, string>;
  savedAt: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Head offset applied to GLB models to align with voxel body (same as CuratedHead) */
export const HEAD_OFFSET: [number, number, number] = [0, -27, -0.25];

/** Max undo history depth */
export const MAX_HISTORY = 50;

/** Default brush size (in face-hops) */
export const DEFAULT_BRUSH_SIZE = 3;

/** Color match epsilon for flood fill (linear color space) */
export const FILL_EPSILON = 0.02;
