// Core types
export type {
  EditableSceneViewState,
  VoxelMap,
  VoxelPixel,
  NounLayers,
  LayerVisibility,
  Tool,
} from './types';
export {
  DEFAULT_VISIBILITY,
  SATURATION_FACTOR,
  DEFAULT_VOXEL_DEPTH,
  BODY_DEPTH,
  BLING_DEPTH,
  HEAD_DEPTH,
  GLASSES_DEPTH,
} from './types';

// VoxelMap operations
export {
  voxelKey,
  parseKey,
  pixelsToFlat,
  pixelsToSolidBlock,
  floodFill3D,
  fillVoxelMapInterior,
  getAdjacentPos,
  serialize,
  deserialize,
  flattenTo2D,
} from './voxelMap';

// Noun decoder
export {
  saturate,
  decodeRLE,
  decodeParts,
  seedToLayers,
  seedToVoxelMap,
  isFlatAccessory,
} from './decoder';

// Geometry builders
export { buildMergedGeometry, buildGeometryFromVoxelMap, buildNounGeometries } from './geometry';

// Exporters
export { toOBJ, toSTL, downloadBlob } from './exporter';
