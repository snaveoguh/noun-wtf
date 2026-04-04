/**
 * EditableScene — 3D voxel editor with face-based placement.
 *
 * Voxels stored as VoxelMap. Click faces to place/erase. Supports pencil,
 * eraser, fill, and eyedropper tools. Initializes from 2D pixel grid as
 * a solid block with configurable depth (for sculpting/chiseling).
 */
import type { Tool, VoxelMap } from '../types';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { DEFAULT_VOXEL_DEPTH } from '../types';
import { floodFill3D, getAdjacentPos, parseKey, pixelsToSolidBlock, voxelKey } from '../voxelMap';

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

// ─── Orbit controls (right-click to rotate) ─────────────────────────────────

function EditOrbitControls({ interactionMode }: { interactionMode: 'sculpt' | 'orbit' }) {
  return (
    <OrbitControls
      enablePan={false}
      enableDamping
      dampingFactor={0.12}
      minDistance={10}
      maxDistance={80}
      minPolarAngle={Math.PI * 0.05}
      maxPolarAngle={Math.PI * 0.95}
      mouseButtons={{
        LEFT:
          interactionMode === 'orbit' ? THREE.MOUSE.ROTATE : (undefined as unknown as THREE.MOUSE),
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      }}
      touches={{
        ONE:
          interactionMode === 'orbit' ? THREE.TOUCH.ROTATE : (undefined as unknown as THREE.TOUCH),
        TWO: THREE.TOUCH.DOLLY_PAN,
      }}
    />
  );
}

// ─── Single voxel mesh ──────────────────────────────────────────────────────

function Voxel({
  position,
  color,
  isHovered,
  onClick,
  onPointerOver,
}: {
  position: [number, number, number];
  color: string;
  isHovered: boolean;
  onClick?: (e: MeshMouseEvent) => void;
  onPointerOver?: (e: MeshPointerEvent) => void;
}) {
  const col = useMemo(() => new THREE.Color(color), [color]);
  const highlightCol = useMemo(() => {
    const c = new THREE.Color(color);
    c.offsetHSL(0, 0, 0.15); // brighten on hover
    return c;
  }, [color]);
  return (
    <mesh position={position} geometry={BOX} onClick={onClick} onPointerOver={onPointerOver}>
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
  /** How deep the initial solid block is (default 3) */
  voxelDepth?: number;
  interactionMode?: 'sculpt' | 'orbit';
  visibilityMask?: boolean[][];
  /** Called when voxel map changes — parent can capture for save */
  onVoxelMapChange?: (map: VoxelMap) => void;
}

// ─── Main scene ─────────────────────────────────────────────────────────────

export default function EditableScene({
  pixels,
  initialVoxelMap,
  activeTool,
  activeColor,
  onPixelChange,
  onPixelsFill,
  onColorPick,
  voxelDepth = DEFAULT_VOXEL_DEPTH,
  interactionMode = 'sculpt',
  visibilityMask,
  onVoxelMapChange,
}: EditableSceneProps) {
  // Initialize as solid block with depth
  const [voxels, setVoxels] = useState<VoxelMap>(() =>
    initialVoxelMap ? new Map(initialVoxelMap) : pixelsToSolidBlock(pixels, voxelDepth),
  );

  // Re-init when resuming an existing sculpture
  useEffect(() => {
    if (!initialVoxelMap) return;
    setVoxels(new Map(initialVoxelMap));
  }, [initialVoxelMap]);

  // Re-init from the flat pixel grid when there is no saved voxel map
  useEffect(() => {
    if (initialVoxelMap) return;
    setVoxels(pixelsToSolidBlock(pixels, voxelDepth));
  }, [initialVoxelMap, pixels, voxelDepth]);

  // Notify parent of changes
  useEffect(() => {
    onVoxelMapChange?.(voxels);
  }, [voxels, onVoxelMapChange]);

  useEffect(() => {
    if (interactionMode === 'orbit') {
      setHoveredKey(null);
      setGhostPos(null);
    }
  }, [interactionMode]);

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [ghostPos, setGhostPos] = useState<[number, number, number] | null>(null);
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const { gl } = useThree();

  // Track pointer for drag detection
  useEffect(() => {
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => {
      pointerDownPos.current = { x: e.clientX, y: e.clientY };
    };
    const onLeave = () => {
      setHoveredKey(null);
      setGhostPos(null);
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
      if (interactionMode === 'orbit') return;
      e.stopPropagation();
      if (isDrag(e)) return;

      const pos = parseKey(key);

      switch (activeTool) {
        case 'pencil': {
          const normal = e.face?.normal;
          const worldNormal = normal ? normal.clone() : null;
          if (worldNormal && e.object) {
            worldNormal.transformDirection(e.object.matrixWorld);
          }
          const adjacent = getAdjacentPos(
            worldNormal ? { x: worldNormal.x, y: worldNormal.y, z: worldNormal.z } : null,
            pos,
          );
          const adjKey = voxelKey(...adjacent);
          setVoxels(prev => {
            const next = new Map(prev);
            next.set(adjKey, activeColor);
            return next;
          });
          const [ax, ay3d] = adjacent;
          const gridY = 31 - ay3d;
          if (ax >= 0 && ax < 32 && gridY >= 0 && gridY < 32) {
            onPixelChange(ax, gridY, activeColor);
          }
          break;
        }
        case 'eraser': {
          setVoxels(prev => {
            const next = new Map(prev);
            next.delete(key);
            return next;
          });
          const [ex, ey3d] = pos;
          const gridY = 31 - ey3d;
          if (ex >= 0 && ex < 32 && gridY >= 0 && gridY < 32) {
            onPixelChange(ex, gridY, '');
          }
          break;
        }
        case 'fill': {
          const changes = floodFill3D(voxels, key, activeColor);
          if (changes.size > 0) {
            setVoxels(prev => {
              const next = new Map(prev);
              for (const [k, v] of changes) next.set(k, v);
              return next;
            });
            const grid2dChanges: [number, number, string][] = [];
            for (const [k, v] of changes) {
              const [fx, fy3d] = parseKey(k);
              const gy = 31 - fy3d;
              if (fx >= 0 && fx < 32 && gy >= 0 && gy < 32) {
                grid2dChanges.push([fx, gy, v]);
              }
            }
            if (grid2dChanges.length > 0) onPixelsFill(grid2dChanges);
          }
          break;
        }
        case 'eyedropper': {
          const color = voxels.get(key);
          if (color) onColorPick(color);
          break;
        }
      }
    },
    [
      activeTool,
      activeColor,
      interactionMode,
      voxels,
      isDrag,
      onPixelChange,
      onPixelsFill,
      onColorPick,
    ],
  );

  // ── Handle voxel hover ──
  const handleVoxelHover = useCallback(
    (key: string, e: MeshPointerEvent) => {
      if (interactionMode === 'orbit') return;
      e.stopPropagation();
      setHoveredKey(key);
      if (activeTool === 'pencil' && activeColor) {
        const pos = parseKey(key);
        const normal = e.face?.normal;
        const worldNormal = normal ? normal.clone() : null;
        if (worldNormal && e.object) {
          worldNormal.transformDirection(e.object.matrixWorld);
        }
        const adjacent = getAdjacentPos(
          worldNormal ? { x: worldNormal.x, y: worldNormal.y, z: worldNormal.z } : null,
          pos,
        );
        setGhostPos(adjacent);
      } else {
        setGhostPos(null);
      }
    },
    [activeTool, activeColor, interactionMode],
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

      {voxelEntries.map(([key, color]) => {
        const [x, y, z] = parseKey(key);
        return (
          <Voxel
            key={key}
            position={[x - 15.5, y - 15.5, z]}
            color={color}
            isHovered={hoveredKey === key}
            onClick={interactionMode === 'sculpt' ? e => handleVoxelClick(key, e) : undefined}
            onPointerOver={interactionMode === 'sculpt' ? e => handleVoxelHover(key, e) : undefined}
          />
        );
      })}

      {ghostPos && activeTool === 'pencil' && activeColor && (
        <GhostVoxel
          position={[ghostPos[0] - 15.5, ghostPos[1] - 15.5, ghostPos[2]]}
          color={activeColor}
        />
      )}

      <EditOrbitControls interactionMode={interactionMode} />

      <mesh
        visible={false}
        position={[0, 0, -10]}
        onPointerOver={() => {
          setHoveredKey(null);
          setGhostPos(null);
        }}
      >
        <planeGeometry args={[200, 200]} />
      </mesh>
    </>
  );
}
