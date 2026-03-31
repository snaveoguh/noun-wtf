/**
 * Shared pixel history reducer for undo/redo.
 * Used by both StudioPage and InlineEditor.
 */

export const GRID_SIZE = 32;

export function createEmptyGrid(): string[][] {
  return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(''));
}

export type HistoryAction =
  | { type: 'SET_PIXEL'; x: number; y: number; color: string }
  | { type: 'SET_PIXELS'; changes: [number, number, string][] }
  | { type: 'CLEAR' }
  | { type: 'LOAD'; pixels: string[][] }
  | { type: 'UNDO' }
  | { type: 'REDO' };

export interface HistoryState {
  past: string[][][];
  present: string[][];
  future: string[][][];
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'SET_PIXEL': {
      const newGrid = state.present.map(row => [...row]);
      newGrid[action.y][action.x] = action.color;
      return { past: [...state.past.slice(-50), state.present], present: newGrid, future: [] };
    }
    case 'SET_PIXELS': {
      const newGrid = state.present.map(row => [...row]);
      for (const [x, y, color] of action.changes) newGrid[y][x] = color;
      return { past: [...state.past.slice(-50), state.present], present: newGrid, future: [] };
    }
    case 'CLEAR':
      return {
        past: [...state.past.slice(-50), state.present],
        present: createEmptyGrid(),
        future: [],
      };
    case 'LOAD':
      return {
        past: [...state.past.slice(-50), state.present],
        present: action.pixels.map(row => [...row]),
        future: [],
      };
    case 'UNDO':
      if (state.past.length === 0) return state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
      };
    case 'REDO':
      if (state.future.length === 0) return state;
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
      };
    default:
      return state;
  }
}

export function createInitialHistory(): HistoryState {
  return { past: [], present: createEmptyGrid(), future: [] };
}
