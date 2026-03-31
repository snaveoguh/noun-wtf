/** "x,y,z" → hex color string */
export type VoxelMap = Map<string, string>;

export interface VoxelPixel {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
}

export interface NounLayers {
  body: VoxelPixel[];
  glasses: VoxelPixel[];
}

export interface LayerVisibility {
  body: boolean;
  accessory: boolean;
  head: boolean;
  glasses: boolean;
}

export type Tool = 'pencil' | 'eraser' | 'fill' | 'eyedropper';

export const DEFAULT_VISIBILITY: LayerVisibility = {
  body: true,
  accessory: true,
  head: true,
  glasses: true,
};

export const SATURATION_FACTOR = 1.0; // true to source colors, no boost
export const DEFAULT_VOXEL_DEPTH = 3;
export const BODY_DEPTH = 2.5;
export const GLASSES_DEPTH = 1.2;
