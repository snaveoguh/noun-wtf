/**
 * EditableScene — True 3D voxel editor with face-based placement.
 *
 * Voxels stored as Map<"x,y,z", color>. Click a voxel face to place
 * a new voxel adjacent to it. Eraser removes. Full 3D building.
 * Initial state loaded from 2D pixel grid (all at z=0).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { OrbitControls } from '@react-three/drei';
import { ThreeEvent, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { type Tool } from '@/components/Studio/PixelCanvas';

// ─── Types ───────────────────────────────────────────────────────────────────

export type VoxelMap = Map<string, string>; // "x,y,z" → hex color

interface EditableSceneProps {
  /** 32x32 pixel grid — loaded as z=0 plane */
  pixels: string[][];
  activeTool: Tool;
  activeColor: string;
  onPixelChange: (x: number, y: number, color: string) => void;
  onPixelsFill: (changes: [number, number, string][]) => void;
  onColorPick: (color: string) => void;
  voxelDepth?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BOX = new THREE.BoxGeometry(1, 1, 1);
const HIGHLIGHT_COLOR = new THREE.Color(0xffffff);

function voxelKey(x: number, y: number, z: number) { return `${x},${y},${z}`; }
function parseKey(key: string): [number, number, number] {
  const [x, y, z] = key.split(',').map(Number);
  return [x, y, z];
}

/**
 * Get adjacent voxel position from a raycaster hit.
 * Uses the hit point + a tiny offset along the face normal to figure out
 * which side was clicked, then places the new voxel on that side.
 */
function getAdjacentPos(intersection: THREE.Intersection, voxelPos: [number, number, number]): [number, number, number] {
  const normal = intersection.face?.normal;
  if (!normal) return [voxelPos[0], voxelPos[1], voxelPos[2] + 1];

  // Transform normal from object space to world space
  const worldNormal = normal.clone();
  if (intersection.object) {
    worldNormal.transformDirection(intersection.object.matrixWorld);
  }

  // Snap to dominant axis
  const ax = Math.abs(worldNormal.x);
  const ay = Math.abs(worldNormal.y);
  const az = Math.abs(worldNormal.z);

  let nx = 0, ny = 0, nz = 0;
  if (ax >= ay && ax >= az) {
    nx = worldNormal.x > 0 ? 1 : -1;
  } else if (ay >= ax && ay >= az) {
    ny = worldNormal.y > 0 ? 1 : -1;
  } else {
    nz = worldNormal.z > 0 ? 1 : -1;
  }

  return [voxelPos[0] + nx, voxelPos[1] + ny, voxelPos[2] + nz];
}

/** 3D flood fill */
function floodFill3D(voxels: VoxelMap, startKey: string, fillColor: string): Map<string, string> {
  const targetColor = voxels.get(startKey) || '';
  if (targetColor === fillColor) return new Map();
  const changes = new Map<string, string>();
  const visited = new Set<string>();
  const queue = [startKey];
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (visited.has(key)) continue;
    const current = voxels.get(key);
    if (current !== targetColor) continue;
    visited.add(key);
    changes.set(key, fillColor);
    const [x, y, z] = parseKey(key);
    // 6-connected neighbors
    queue.push(
      voxelKey(x - 1, y, z), voxelKey(x + 1, y, z),
      voxelKey(x, y - 1, z), voxelKey(x, y + 1, z),
      voxelKey(x, y, z - 1), voxelKey(x, y, z + 1),
    );
  }
  return changes;
}

// ─── Orbit controls (right-click to orbit) ───────────────────────────────────

function EditOrbitControls() {
  return (
    <OrbitControls
      enablePan={false}
      enableDamping
      dampingFactor={0.12}
      minDistance={10}
      maxDistance={80}
      minPolarAngle={Math.PI * 0.05}
      maxPolarAngle={Math.PI * 0.95}
      mouseButtons={{ LEFT: undefined as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
    />
  );
}

// ─── Single voxel mesh ───────────────────────────────────────────────────────

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
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  onPointerOver: (e: ThreeEvent<PointerEvent>) => void;
}) {
  const col = useMemo(() => new THREE.Color(color), [color]);

  return (
    <mesh
      position={position}
      geometry={BOX}
      onClick={onClick}
      onPointerOver={onPointerOver}
      castShadow
      receiveShadow
    >
      {/* eslint-disable react/no-unknown-property */}
      <meshStandardMaterial
        color={col}
        roughness={0.7}
        emissive={isHovered ? HIGHLIGHT_COLOR : undefined}
        emissiveIntensity={isHovered ? 0.3 : 0}
      />
      {/* eslint-enable react/no-unknown-property */}
    </mesh>
  );
}

// ─── Ghost voxel (placement preview) ─────────────────────────────────────────

function GhostVoxel({ position, color }: { position: [number, number, number]; color: string }) {
  const col = useMemo(() => new THREE.Color(color || '#ffffff'), [color]);
  return (
    <mesh position={position} geometry={BOX}>
      {/* eslint-disable react/no-unknown-property */}
      <meshStandardMaterial color={col} transparent opacity={0.35} roughness={0.5} />
      {/* eslint-enable react/no-unknown-property */}
    </mesh>
  );
}

// ─── Main scene ──────────────────────────────────────────────────────────────

export default function EditableScene({
  pixels,
  activeTool,
  activeColor,
  onPixelChange,
  onPixelsFill,
  onColorPick,
}: EditableSceneProps) {
  // ── 3D voxel state (initialized from 2D pixel grid at z=0) ──
  const [voxels, setVoxels] = useState<VoxelMap>(() => {
    const map: VoxelMap = new Map();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const c = pixels[y]?.[x];
        if (c) map.set(voxelKey(x, 31 - y, 0), c); // flip Y for 3D
      }
    }
    return map;
  });

  // Re-init when pixels change externally (undo/redo, layer toggle)
  useEffect(() => {
    const map: VoxelMap = new Map();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const c = pixels[y]?.[x];
        if (c) map.set(voxelKey(x, 31 - y, 0), c);
      }
    }
    setVoxels(map);
  }, [pixels]);

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [ghostPos, setGhostPos] = useState<[number, number, number] | null>(null);
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const { gl } = useThree();

  // Track pointer for drag detection
  useEffect(() => {
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => { pointerDownPos.current = { x: e.clientX, y: e.clientY }; };
    const onLeave = () => { setHoveredKey(null); setGhostPos(null); };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerleave', onLeave);
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerleave', onLeave); };
  }, [gl]);

  const isDrag = useCallback((e: { clientX: number; clientY: number }) => {
    if (!pointerDownPos.current) return false;
    return Math.abs(e.clientX - pointerDownPos.current.x) > 4 ||
           Math.abs(e.clientY - pointerDownPos.current.y) > 4;
  }, []);

  // ── Sync 3D changes back to 2D grid (for undo/redo/save) ──
  const syncTo2D = useCallback((map: VoxelMap) => {
    // Project all voxels onto the 2D grid (flatten Z — keep frontmost)
    for (const [key, color] of map) {
      const [x, y3d] = parseKey(key);
      const gridY = 31 - y3d;
      if (x >= 0 && x < 32 && gridY >= 0 && gridY < 32) {
        onPixelChange(x, gridY, color);
      }
    }
  }, [onPixelChange]);

  // ── Handle voxel click ──
  const handleVoxelClick = useCallback((key: string, e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (isDrag(e)) return;

    const pos = parseKey(key);

    switch (activeTool) {
      case 'pencil': {
        // Place new voxel adjacent to clicked face
        // R3F ThreeEvent IS an intersection — use it directly
        const adjacent = getAdjacentPos(e as unknown as THREE.Intersection, pos);
        const adjKey = voxelKey(...adjacent);
        setVoxels(prev => {
          const next = new Map(prev);
          next.set(adjKey, activeColor);
          return next;
        });
        // Sync to 2D
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
          // Sync fills to 2D
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
  }, [activeTool, activeColor, voxels, isDrag, onPixelChange, onPixelsFill, onColorPick]);

  // ── Handle voxel hover ──
  const handleVoxelHover = useCallback((key: string, e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHoveredKey(key);
    if (activeTool === 'pencil' && activeColor) {
      const pos = parseKey(key);
      const adjacent = getAdjacentPos(e as unknown as THREE.Intersection, pos);
      setGhostPos(adjacent as [number, number, number]);
    } else {
      setGhostPos(null);
    }
  }, [activeTool, activeColor]);

  // Build voxel entries for rendering
  const voxelEntries = useMemo(() => Array.from(voxels.entries()), [voxels]);

  void syncTo2D; // used implicitly via onPixelChange

  return (
    <>
      {/* eslint-disable react/no-unknown-property */}
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[15, 25, 30]}
        intensity={1.8}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-camera-near={1}
        shadow-camera-far={80}
        shadow-bias={-0.002}
      />
      <directionalLight position={[-10, -5, -15]} intensity={0.15} />
      <directionalLight position={[-5, 10, -20]} intensity={0.25} />

      {/* All voxels */}
      {voxelEntries.map(([key, color]) => {
        const [x, y, z] = parseKey(key);
        return (
          <Voxel
            key={key}
            position={[x - 15.5, y - 15.5, z]}
            color={color}
            isHovered={hoveredKey === key}
            onClick={e => handleVoxelClick(key, e)}
            onPointerOver={e => handleVoxelHover(key, e)}
          />
        );
      })}

      {/* Ghost preview for new voxel placement */}
      {ghostPos && activeTool === 'pencil' && activeColor && (
        <GhostVoxel
          position={[ghostPos[0] - 15.5, ghostPos[1] - 15.5, ghostPos[2]]}
          color={activeColor}
        />
      )}

      <EditOrbitControls />
      {/* eslint-enable react/no-unknown-property */}

      {/* Background plane to clear hover */}
      <mesh
        visible={false}
        position={[0, 0, -10]}
        onPointerOver={() => { setHoveredKey(null); setGhostPos(null); }}
      >
        <planeGeometry args={[200, 200]} />
      </mesh>
    </>
  );
}
