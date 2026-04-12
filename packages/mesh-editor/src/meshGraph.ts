/**
 * meshGraph — Build face adjacency graph from indexed BufferGeometry.
 *
 * Two faces are adjacent if they share an edge (two vertex indices).
 * Used for brush expansion and flood fill on the mesh surface.
 */
import type { FaceAdjacencyGraph } from './types';
import type * as THREE from 'three';

/**
 * Create a canonical edge key from two vertex indices (order-independent).
 */
function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * Build a face adjacency graph from an indexed BufferGeometry.
 *
 * Assumes the geometry uses an index buffer with triangles (every 3 indices = 1 face).
 * Returns a map where each face index maps to the set of face indices that share an edge.
 *
 * Performance: O(F) where F = face count. For typical GLB heads (2000-5000 faces),
 * this runs in well under 1ms.
 */
export function buildAdjacencyGraph(geometry: THREE.BufferGeometry): FaceAdjacencyGraph {
  const index = geometry.index;
  if (!index) {
    throw new Error('meshGraph: geometry must have an index buffer');
  }

  const indices = index.array;
  const faceCount = Math.floor(indices.length / 3);

  // Step 1: Map each edge to the faces that contain it
  const edgeToFaces = new Map<string, number[]>();

  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f * 3];
    const i1 = indices[f * 3 + 1];
    const i2 = indices[f * 3 + 2];

    const edges = [edgeKey(i0, i1), edgeKey(i1, i2), edgeKey(i2, i0)];

    for (const ek of edges) {
      let faces = edgeToFaces.get(ek);
      if (!faces) {
        faces = [];
        edgeToFaces.set(ek, faces);
      }
      faces.push(f);
    }
  }

  // Step 2: Build adjacency — faces sharing an edge are neighbors
  const adjacency: FaceAdjacencyGraph = new Map();

  for (let f = 0; f < faceCount; f++) {
    adjacency.set(f, new Set());
  }

  for (const faces of edgeToFaces.values()) {
    // Most edges have exactly 2 faces; boundary edges have 1
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        adjacency.get(faces[i])!.add(faces[j]);
        adjacency.get(faces[j])!.add(faces[i]);
      }
    }
  }

  return adjacency;
}

/**
 * Get the 3 vertex indices for a given face.
 */
export function getFaceVertices(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
): [number, number, number] {
  const index = geometry.index!;
  return [
    index.array[faceIndex * 3],
    index.array[faceIndex * 3 + 1],
    index.array[faceIndex * 3 + 2],
  ];
}

/**
 * BFS expansion from a start face to all faces within `radius` hops.
 * radius=1 returns just the start face.
 * radius=2 returns the start face + immediate neighbors.
 */
export function expandBrush(
  startFace: number,
  radius: number,
  adjacency: FaceAdjacencyGraph,
): Set<number> {
  const visited = new Set<number>();
  visited.add(startFace);

  if (radius <= 1) return visited;

  let frontier = [startFace];
  for (let hop = 1; hop < radius; hop++) {
    const nextFrontier: number[] = [];
    for (const face of frontier) {
      const neighbors = adjacency.get(face);
      if (!neighbors) continue;
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextFrontier.push(neighbor);
        }
      }
    }
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  return visited;
}
