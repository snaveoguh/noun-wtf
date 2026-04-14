/**
 * EditableScene — 3D voxel editor with face-based placement.
 *
 * Voxels stored as VoxelMap. Click faces to place/erase. Supports pencil,
 * eraser, fill, and eyedropper tools. Initializes from 2D pixel grid as
 * a solid block with configurable depth (for sculpting/chiseling).
 */
import type { EditableSceneViewState, Tool, VoxelMap } from '../types';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { DEFAULT_VOXEL_DEPTH } from '../types';
import {
  flattenTo2D,
  floodFill3D,
  getAdjacentPos,
  parseKey,
  pixelsToSolidBlock,
  voxelKey,
} from '../voxelMap';

// ─── Constants ──────────────────────────────────────────────────────────────

const BOX = new THREE.BoxGeometry(1, 1, 1);

type MeshMouseEvent = {
  clientX: number;
  clientY: number;
  face?: THREE.Face | null;
  object: THREE.Object3D;
  stopPropagation: () => void;
};

type MeshPointerEvent = {
  face?: THREE.Face | null;
  object: THREE.Object3D;
  stopPropagation: () => void;
};

type BrushAxis = 'x' | 'y' | 'z';

type FaceNormal = {
  axis: BrushAxis;
  direction: -1 | 1;
  vector: [number, number, number];
};

function getBrushOffsets(size: number) {
  const start = -Math.floor((size - 1) / 2);
  return Array.from({ length: size }, (_, index) => start + index);
}

function clampBrushPositions(positions: [number, number, number][]): [number, number, number][] {
  const seen = new Set<string>();
  return positions.filter(([x, y, z]) => {
    if (x < 0 || x >= 32 || y < 0 || y >= 32 || z < 0) return false;
    const key = voxelKey(x, y, z);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getDominantFaceNormal(faceNormal: { x: number; y: number; z: number } | null): FaceNormal {
  if (!faceNormal) {
    return { axis: 'z', direction: 1, vector: [0, 0, 1] };
  }

  const ax = Math.abs(faceNormal.x);
  const ay = Math.abs(faceNormal.y);
  const az = Math.abs(faceNormal.z);

  if (ax >= ay && ax >= az) {
    const direction = faceNormal.x >= 0 ? 1 : -1;
    return { axis: 'x', direction, vector: [direction, 0, 0] };
  }

  if (ay >= ax && ay >= az) {
    const direction = faceNormal.y >= 0 ? 1 : -1;
    return { axis: 'y', direction, vector: [0, direction, 0] };
  }

  const direction = faceNormal.z >= 0 ? 1 : -1;
  return { axis: 'z', direction, vector: [0, 0, direction] };
}

function getSurfaceBrushPositions(
  [cx, cy, cz]: [number, number, number],
  size: number,
  axis: BrushAxis,
): [number, number, number][] {
  const offsets = getBrushOffsets(Math.max(1, size));
  const positions: [number, number, number][] = [];

  if (axis === 'x') {
    for (const yOffset of offsets) {
      for (const zOffset of offsets) {
        positions.push([cx, cy + yOffset, cz + zOffset]);
      }
    }
    return clampBrushPositions(positions);
  }

  if (axis === 'y') {
    for (const xOffset of offsets) {
      for (const zOffset of offsets) {
        positions.push([cx + xOffset, cy, cz + zOffset]);
      }
    }
    return clampBrushPositions(positions);
  }

  for (const xOffset of offsets) {
    for (const yOffset of offsets) {
      positions.push([cx + xOffset, cy + yOffset, cz]);
    }
  }

  return clampBrushPositions(positions);
}

function getWorldFaceNormal(
  normal: THREE.Face['normal'] | null | undefined,
  object: THREE.Object3D,
): { x: number; y: number; z: number } | null {
  if (!normal) return null;
  const worldNormal = normal.clone();
  worldNormal.transformDirection(object.matrixWorld);
  return { x: worldNormal.x, y: worldNormal.y, z: worldNormal.z };
}

// ─── Orbit controls (grab/twist) ────────────────────────────────────────────

function EditOrbitControls({
  interactionMode,
  viewStateRef,
}: {
  interactionMode: 'sculpt' | 'grab' | 'twist';
  viewStateRef: { current: EditableSceneViewState | null };
}) {
  const controlsRef = useRef<{
    target: THREE.Vector3;
    update: () => void;
  } | null>(null);
  const { camera } = useThree();
  const setControlsRef = useCallback(
    (
      controls: {
        target: THREE.Vector3;
        update: () => void;
      } | null,
    ) => {
      controlsRef.current = controls;
    },
    [],
  );

  const syncViewState = useCallback(() => {
    const controls = controlsRef.current;
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    if (!controls) return;

    viewStateRef.current = {
      cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
      zoom: perspectiveCamera.zoom,
    };
  }, [camera, viewStateRef]);

  useEffect(() => {
    const controls = controlsRef.current;
    const savedView = viewStateRef.current;
    if (!controls || !savedView) return;

    camera.position.set(...savedView.cameraPosition);
    controls.target.set(...savedView.target);
    (camera as THREE.PerspectiveCamera).zoom = savedView.zoom;
    camera.updateProjectionMatrix();
    controls.update();
  }, [camera, interactionMode, viewStateRef]);

  const leftMouseButton = (() => {
    if (interactionMode === 'grab') return THREE.MOUSE.PAN;
    if (interactionMode === 'twist') return THREE.MOUSE.ROTATE;
    return undefined as unknown as THREE.MOUSE;
  })();

  const rightMouseButton = (() => {
    if (interactionMode === 'grab') return THREE.MOUSE.PAN;
    if (interactionMode === 'twist') return THREE.MOUSE.ROTATE;
    return undefined as unknown as THREE.MOUSE;
  })();

  const singleTouchMode = (() => {
    if (interactionMode === 'grab') return THREE.TOUCH.PAN;
    if (interactionMode === 'twist') return THREE.TOUCH.ROTATE;
    return undefined as unknown as THREE.TOUCH;
  })();

  const doubleTouchMode =
    interactionMode === 'twist' ? THREE.TOUCH.DOLLY_ROTATE : THREE.TOUCH.DOLLY_PAN;

  return (
    <OrbitControls
      ref={setControlsRef}
      enablePan={interactionMode === 'grab'}
      enableRotate={interactionMode === 'twist'}
      enableDamping
      dampingFactor={0.12}
      minDistance={10}
      maxDistance={80}
      minPolarAngle={Math.PI * 0.05}
      maxPolarAngle={Math.PI * 0.95}
      mouseButtons={{
        LEFT: leftMouseButton,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: rightMouseButton,
      }}
      touches={{
        ONE: singleTouchMode,
        TWO: doubleTouchMode,
      }}
      onChange={syncViewState}
    />
  );
}

// ─── Single voxel mesh ──────────────────────────────────────────────────────

function Voxel({
  position,
  color,
  isHovered,
  onPointerDown,
  onPointerOver,
}: {
  position: [number, number, number];
  color: string;
  isHovered: boolean;
  onPointerDown?: (e: MeshMouseEvent) => void;
  onPointerOver?: (e: MeshPointerEvent) => void;
}) {
  const col = useMemo(() => new THREE.Color(color), [color]);
  const highlightCol = useMemo(() => {
    const c = new THREE.Color(color);
    c.offsetHSL(0, 0, 0.15); // brighten on hover
    return c;
  }, [color]);
  return (
    <mesh
      position={position}
      geometry={BOX}
      onPointerDown={onPointerDown}
      onPointerOver={onPointerOver}
    >
      {}
      <meshBasicMaterial color={isHovered ? highlightCol : col} />
    </mesh>
  );
}

// ─── Ghost voxel (placement preview) ────────────────────────────────────────

function GhostVoxel({ position, color }: { position: [number, number, number]; color: string }) {
  const col = useMemo(() => new THREE.Color(color || '#ffffff'), [color]);
  return (
    <mesh position={position} geometry={BOX}>
      {}
      <meshBasicMaterial color={col} transparent opacity={0.35} />
    </mesh>
  );
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface EditableSceneProps {
  /** 32x32 pixel grid — converted to solid block on init */
  pixels: string[][];
  /** Optional existing voxel sculpture to resume editing from */
  initialVoxelMap?: VoxelMap;
  activeTool: Tool;
  activeColor: string;
  onPixelChange: (x: number, y: number, color: string) => void;
  onPixelsFill: (changes: [number, number, string][]) => void;
  onColorPick: (color: string) => void;
  /** Brush size for 3D build/erase actions */
  voxelDepth?: number;
  interactionMode?: 'sculpt' | 'grab' | 'twist';
  visibilityMask?: boolean[][];
  displayPixels?: string[][];
  viewStateRef?: { current: EditableSceneViewState | null };
  /** Called when voxel map changes — parent can capture for save */
  onVoxelMapChange?: (map: VoxelMap) => void;
}

// ─── Main scene ─────────────────────────────────────────────────────────────

export default function EditableScene({
  pixels,
  initialVoxelMap,
  activeTool,
  activeColor,
  onPixelsFill,
  onColorPick,
  voxelDepth = DEFAULT_VOXEL_DEPTH,
  interactionMode = 'sculpt',
  visibilityMask,
  displayPixels,
  viewStateRef,
  onVoxelMapChange,
}: EditableSceneProps) {
  const brushSize = Math.max(1, Math.round(voxelDepth));
  const localViewStateRef = useRef<EditableSceneViewState | null>(null);
  const orbitViewStateRef = viewStateRef ?? localViewStateRef;

  // Tool/color refs for use in pointer handlers (avoid stale closures in R3F events)
  const toolRef = useRef(activeTool);
  const colorRef = useRef(activeColor);
  toolRef.current = activeTool;
  colorRef.current = activeColor;

  // Flag to break the circular 3D→2D→3D rebuild loop:
  // When the 3D editor syncs changes to the 2D pixel grid, the parent
  // re-renders with new `pixels`. Without this guard the useEffect below
  // would rebuild the voxel map from the 2D grid, reverting the edit.
  const selfSyncRef = useRef(false);

  // Initialize as solid block with depth
  const [voxels, setVoxels] = useState<VoxelMap>(() =>
    initialVoxelMap ? new Map(initialVoxelMap) : pixelsToSolidBlock(pixels, DEFAULT_VOXEL_DEPTH),
  );

  // Re-init when resuming an existing sculpture
  useEffect(() => {
    if (!initialVoxelMap) return;
    setVoxels(new Map(initialVoxelMap));
  }, [initialVoxelMap]);

  // Re-init from the flat pixel grid when there is no saved voxel map
  // (e.g. undo/redo from parent, layer toggle). Skip if we caused the change.
  useEffect(() => {
    if (initialVoxelMap) return;
    if (selfSyncRef.current) {
      selfSyncRef.current = false;
      return;
    }
    setVoxels(pixelsToSolidBlock(pixels, DEFAULT_VOXEL_DEPTH));
  }, [initialVoxelMap, pixels]);

  // Notify parent of changes
  useEffect(() => {
    onVoxelMapChange?.(voxels);
  }, [voxels, onVoxelMapChange]);

  useEffect(() => {
    if (interactionMode !== 'sculpt') {
      setHoveredKey(null);
      setGhostPositions([]);
    }
  }, [interactionMode]);

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [ghostPositions, setGhostPositions] = useState<[number, number, number][]>([]);
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const { gl } = useThree();

  const getDisplayColor = useCallback(
    (key: string) => {
      const [x, y] = parseKey(key);
      return displayPixels?.[31 - y]?.[x] ?? voxels.get(key) ?? '';
    },
    [displayPixels, voxels],
  );

  const syncPixelsFromVoxelMap = useCallback(
    (nextMap: VoxelMap) => {
      const nextGrid = flattenTo2D(nextMap);
      const changes: [number, number, string][] = [];

      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          if ((pixels[y]?.[x] ?? '') !== (nextGrid[y]?.[x] ?? '')) {
            changes.push([x, y, nextGrid[y]?.[x] ?? '']);
          }
        }
      }

      if (changes.length > 0) {
        selfSyncRef.current = true;
        onPixelsFill(changes);
      }
    },
    [onPixelsFill, pixels],
  );

  // Track pointer for drag detection
  useEffect(() => {
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => {
      pointerDownPos.current = { x: e.clientX, y: e.clientY };
    };
    const onLeave = () => {
      setHoveredKey(null);
      setGhostPositions([]);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [gl]);

  const isDrag = useCallback((e: { clientX: number; clientY: number }) => {
    if (!pointerDownPos.current) return false;
    return (
      Math.abs(e.clientX - pointerDownPos.current.x) > 4 ||
      Math.abs(e.clientY - pointerDownPos.current.y) > 4
    );
  }, []);

  // ── Handle voxel click ──
  const handleVoxelClick = useCallback(
    (key: string, e: MeshMouseEvent) => {
      if (interactionMode !== 'sculpt') return;
      e.stopPropagation();
      if (isDrag(e)) return;

      // Read from refs to avoid stale closures in R3F event callbacks
      const tool = toolRef.current;
      const color = colorRef.current;

      const pos = parseKey(key);
      const faceNormal = getDominantFaceNormal(getWorldFaceNormal(e.face?.normal, e.object));

      switch (tool) {
        case 'pencil': {
          const adjacent = getAdjacentPos(
            { x: faceNormal.vector[0], y: faceNormal.vector[1], z: faceNormal.vector[2] },
            pos,
          );
          const brushPositions = getSurfaceBrushPositions(adjacent, brushSize, faceNormal.axis);
          if (brushPositions.length === 0) break;

          const next = new Map(voxels);
          for (const position of brushPositions) {
            next.set(voxelKey(...position), color);
          }
          setVoxels(next);
          syncPixelsFromVoxelMap(next);
          break;
        }
        case 'eraser': {
          const brushPositions = getSurfaceBrushPositions(pos, brushSize, faceNormal.axis);
          if (brushPositions.length === 0) break;

          const next = new Map(voxels);
          for (const position of brushPositions) {
            next.delete(voxelKey(...position));
          }
          setVoxels(next);
          syncPixelsFromVoxelMap(next);
          break;
        }
        case 'fill': {
          const changes = floodFill3D(voxels, key, color);
          if (changes.size > 0) {
            const next = new Map(voxels);
            for (const [k, v] of changes) next.set(k, v);
            setVoxels(next);
            syncPixelsFromVoxelMap(next);
          }
          break;
        }
        case 'eyedropper': {
          const c = getDisplayColor(key);
          if (c) onColorPick(c);
          break;
        }
      }
    },
    [
      brushSize,
      getDisplayColor,
      interactionMode,
      voxels,
      isDrag,
      onColorPick,
      syncPixelsFromVoxelMap,
    ],
  );

  // ── Handle voxel hover ──
  const handleVoxelHover = useCallback(
    (key: string, e: MeshPointerEvent) => {
      if (interactionMode !== 'sculpt') return;
      e.stopPropagation();
      setHoveredKey(key);
      if (toolRef.current === 'pencil' && colorRef.current) {
        const pos = parseKey(key);
        const faceNormal = getDominantFaceNormal(getWorldFaceNormal(e.face?.normal, e.object));
        const adjacent = getAdjacentPos(
          { x: faceNormal.vector[0], y: faceNormal.vector[1], z: faceNormal.vector[2] },
          pos,
        );
        setGhostPositions(getSurfaceBrushPositions(adjacent, brushSize, faceNormal.axis));
      } else {
        setGhostPositions([]);
      }
    },
    [brushSize, interactionMode],
  );

  const voxelEntries = useMemo(() => {
    return Array.from(voxels.entries()).filter(([key]) => {
      if (!visibilityMask) return true;
      const [x, y] = parseKey(key);
      return Boolean(visibilityMask[31 - y]?.[x]);
    });
  }, [visibilityMask, voxels]);

  return (
    <>
      {}
      {/* No lights needed — meshBasicMaterial renders true hex colors */}

      {voxelEntries.map(([key]) => {
        const [x, y, z] = parseKey(key);
        const color = getDisplayColor(key);
        if (!color) return null;
        return (
          <Voxel
            key={key}
            position={[x - 15.5, y - 15.5, z]}
            color={color}
            isHovered={hoveredKey === key}
            onPointerDown={interactionMode === 'sculpt' ? e => handleVoxelClick(key, e) : undefined}
            onPointerOver={interactionMode === 'sculpt' ? e => handleVoxelHover(key, e) : undefined}
          />
        );
      })}

      {activeTool === 'pencil' &&
        activeColor &&
        ghostPositions.map(position => (
          <GhostVoxel
            key={`ghost-${voxelKey(...position)}`}
            position={[position[0] - 15.5, position[1] - 15.5, position[2]]}
            color={activeColor}
          />
        ))}

      <EditOrbitControls interactionMode={interactionMode} viewStateRef={orbitViewStateRef} />

      <mesh
        visible={false}
        position={[0, 0, -10]}
        onPointerOver={() => {
          setHoveredKey(null);
          setGhostPositions([]);
        }}
      >
        <planeGeometry args={[200, 200]} />
      </mesh>
    </>
  );
}
