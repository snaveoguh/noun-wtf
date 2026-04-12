/**
 * meshPersistence — Save/load mesh edits to localStorage as sparse vertex color deltas.
 *
 * Only stores vertices that differ from the original GLB, keeping storage compact.
 */
import type { MeshColorDelta, MeshEditSaveData, MeshEditState } from './types';

import { FILL_EPSILON } from './types';

const STORAGE_PREFIX = 'mesh-edit:';

/**
 * Compute the sparse delta between original and current vertex colors.
 * Only includes vertices whose color has actually changed.
 */
export function computeDeltas(state: MeshEditState): MeshColorDelta {
  const deltas: MeshColorDelta = new Map();

  for (let vi = 0; vi < state.vertexCount; vi++) {
    const i = vi * 3;
    const or = state.originalColors[i];
    const og = state.originalColors[i + 1];
    const ob = state.originalColors[i + 2];
    const cr = state.currentColors[i];
    const cg = state.currentColors[i + 1];
    const cb = state.currentColors[i + 2];

    if (
      Math.abs(or - cr) > FILL_EPSILON ||
      Math.abs(og - cg) > FILL_EPSILON ||
      Math.abs(ob - cb) > FILL_EPSILON
    ) {
      deltas.set(vi, [cr, cg, cb]);
    }
  }

  return deltas;
}

/**
 * Save mesh edits to localStorage.
 */
export function saveToLocalStorage(key: string, glbPath: string, state: MeshEditState): void {
  const deltas = computeDeltas(state);
  if (deltas.size === 0) {
    // No changes — remove any existing save
    localStorage.removeItem(STORAGE_PREFIX + key);
    return;
  }

  const data: MeshEditSaveData = {
    glbPath,
    deltas: Object.fromEntries(
      Array.from(deltas.entries()).map(([vi, color]) => [String(vi), color]),
    ),
    savedAt: new Date().toISOString(),
  };

  localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data));
}

/**
 * Load mesh edits from localStorage.
 * Returns null if no saved data exists.
 */
export function loadFromLocalStorage(key: string): MeshColorDelta | null {
  const raw = localStorage.getItem(STORAGE_PREFIX + key);
  if (!raw) return null;

  try {
    const data: MeshEditSaveData = JSON.parse(raw);
    const deltas: MeshColorDelta = new Map();

    for (const [viStr, color] of Object.entries(data.deltas)) {
      deltas.set(Number(viStr), color);
    }

    return deltas;
  } catch {
    return null;
  }
}

/**
 * Check if saved edits exist for a key.
 */
export function hasSavedEdits(key: string): boolean {
  return localStorage.getItem(STORAGE_PREFIX + key) !== null;
}

/**
 * Remove saved edits for a key.
 */
export function removeSavedEdits(key: string): void {
  localStorage.removeItem(STORAGE_PREFIX + key);
}

/**
 * Convert a MeshColorDelta to the serializable format used in MeshEditSaveData.
 */
export function deltasToRecord(deltas: MeshColorDelta): Record<string, [number, number, number]> {
  return Object.fromEntries(Array.from(deltas.entries()).map(([vi, color]) => [String(vi), color]));
}

/**
 * Convert the serializable format back to a MeshColorDelta.
 */
export function recordToDeltas(record: Record<string, [number, number, number]>): MeshColorDelta {
  const deltas: MeshColorDelta = new Map();
  for (const [viStr, color] of Object.entries(record)) {
    deltas.set(Number(viStr), color);
  }
  return deltas;
}
