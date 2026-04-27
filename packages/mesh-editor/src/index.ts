// Core types
export type {
  EditableSceneViewState,
  FaceAdjacencyGraph,
  MeshColorDelta,
  MeshEditSaveData,
  MeshEditState,
  Tool,
  VoxelMap,
} from './types';
export { DEFAULT_BRUSH_SIZE, FILL_EPSILON, HEAD_OFFSET, MAX_HISTORY } from './types';

// Mesh graph
export { buildAdjacencyGraph, expandBrush, getFaceVertices } from './meshGraph';

// Mesh operations
export {
  applyDeltas,
  computeBuildPosition,
  deleteBrush,
  deleteFaces,
  eraseBrush,
  eraseFaces,
  eyedropFace,
  floodFillMesh,
  hexToLinear,
  initEditState,
  linearToHex,
  paintBrush,
  paintFaces,
  parseVoxelKey,
  placeVoxel,
  placeVoxelBlock,
  removeVoxel,
  restoreFaces,
  syncColorsToGeometry,
  syncVisibilityToGeometry,
  voxelizeMeshInterior,
  voxelKey,
} from './meshOps';

// History
export type { MeshHistoryAction, MeshHistoryState } from './meshHistory';
export { createHistory, pushSnapshot, redo, resetHistory, undo } from './meshHistory';

// Persistence
export {
  computeDeltas,
  deltasToRecord,
  hasSavedEdits,
  loadFromLocalStorage,
  recordToDeltas,
  removeSavedEdits,
  saveToLocalStorage,
} from './meshPersistence';

// Exporter
export {
  downloadAsGLB,
  downloadAsOBJ,
  downloadAsSTL,
  downloadBlob,
  exportToGLB,
  exportToOBJ,
  exportToSTL,
} from './meshExporter';
