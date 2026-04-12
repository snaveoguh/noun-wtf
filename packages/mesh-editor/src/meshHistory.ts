/**
 * meshHistory — Undo/redo for mesh vertex color edits.
 *
 * Stores full Float32Array snapshots of vertex colors.
 * ~36KB per snapshot at 3000 vertices, max 50 = ~1.8MB.
 */
import type { MeshEditState } from './types';

import { syncColorsToGeometry } from './meshOps';
import { MAX_HISTORY } from './types';

// ─── Types ──────────────────────────────────────────────────────────────────

export type MeshHistoryAction =
  | { type: 'SNAPSHOT' }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'RESET' };

export interface MeshHistoryState {
  past: Float32Array[];
  future: Float32Array[];
}

// ─── History Manager ────────────────────────────────────────────────────────

/**
 * Create initial history state (empty past/future).
 */
export function createHistory(): MeshHistoryState {
  return { past: [], future: [] };
}

/**
 * Take a snapshot of current colors before a mutation.
 * Call this BEFORE applying a paint/erase/fill operation.
 */
export function pushSnapshot(history: MeshHistoryState, state: MeshEditState): MeshHistoryState {
  const snapshot = new Float32Array(state.currentColors);
  return {
    past: [...history.past.slice(-(MAX_HISTORY - 1)), snapshot],
    future: [], // clear redo stack on new action
  };
}

/**
 * Undo: restore previous snapshot, push current to future.
 * Returns updated history or null if nothing to undo.
 */
export function undo(history: MeshHistoryState, state: MeshEditState): MeshHistoryState | null {
  if (history.past.length === 0) return null;

  const currentSnapshot = new Float32Array(state.currentColors);
  const previous = history.past[history.past.length - 1];

  // Restore previous colors
  state.currentColors.set(previous);
  syncColorsToGeometry(state);

  return {
    past: history.past.slice(0, -1),
    future: [...history.future, currentSnapshot],
  };
}

/**
 * Redo: restore next snapshot from future, push current to past.
 * Returns updated history or null if nothing to redo.
 */
export function redo(history: MeshHistoryState, state: MeshEditState): MeshHistoryState | null {
  if (history.future.length === 0) return null;

  const currentSnapshot = new Float32Array(state.currentColors);
  const next = history.future[history.future.length - 1];

  // Restore next colors
  state.currentColors.set(next);
  syncColorsToGeometry(state);

  return {
    past: [...history.past, currentSnapshot],
    future: history.future.slice(0, -1),
  };
}

/**
 * Reset history (e.g., when loading a new model).
 */
export function resetHistory(): MeshHistoryState {
  return createHistory();
}
