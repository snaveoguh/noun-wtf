/**
 * EditableScene — 3D voxel editor with face-based placement.
 *
 * Voxels stored as VoxelMap. Click faces to place/erase. Supports pencil,
 * eraser, fill, and eyedropper tools. Initializes from 2D pixel grid as
 * a solid block with configurable depth (for sculpting/chiseling).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { OrbitControls } from '@react-three/drei';
import { ThreeEvent, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import type { Tool, VoxelMap, LayerVisibility } from '../types';
import { DEFAULT_VOXEL_DEPTH } from '../types';
import { floodFill3D, getAdjacentPos, parseKey, pixelsToSolidBlock, voxelKey } from '../voxelMap';

// ─── Constants ──────────────────────────────────────────────────────────────

const BOX = new THREE.BoxGeometry(1, 1, 1);
const HIGHLIGHT_COLOR = new THREE.Color(0xffffff);

// ─── Orbit controls (right-click to rotate) ─────────────────────────────────

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

// ─── Ghost voxel (placement preview) ────────────────────────────────────────

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

// ─── Props ───────────────────────────────────────────────────────────────────

export interface EditableSceneProps {
  /** 32x32 pixel grid — converted to solid block on init */
  pixels: string[][];
  activeTool: Tool;
  activeColor: string;
  onPixelChange: (x: number, y: number, color: string) => void;
  onPixelsFill: (changes: [number, number, string][]) => void;
  onColorPick: (color: string) => void;
  /** How deep the initial solid block is (default 3) */
  voxelDepth?: number;
  layerVisibility?: LayerVisibility;
  /** Called when voxel map changes — parent can capture for save */
  onVoxelMapChange?: (map: VoxelMap) => void;
}

// ─── Main scene ─────────────────────────────────────────────────────────────

export default function EditableScene({
  pixels,
  activeTool,
  activeColor,
  onPixelChange,
  onPixelsFill,
  onColorPick,
  voxelDepth = DEFAULT_VOXEL_DEPTH,
  onVoxelMapChange,
}: EditableSceneProps) {
  // Initialize as solid block with depth
  const [voxels, setVoxels] = useState<VoxelMap>(() => pixelsToSolidBlock(pixels, voxelDepth));

  // Re-init when pixels change externally (undo/redo, layer toggle)
  useEffect(() => {
    const map = pixelsToSolidBlock(pixels, voxelDepth);
    setVoxels(map);
  }, [pixels, voxelDepth]);

  // Notify parent of changes
  useEffect(() => {
    onVoxelMapChange?.(voxels);
  }, [voxels, onVoxelMapChange]);

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

  // ── Handle voxel click ──
  const handleVoxelClick = useCallback((key: string, e: ThreeEvent<MouseEvent>) => {
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
  }, [activeTool, activeColor, voxels, isDrag, onPixelChange, onPixelsFill, onColorPick]);

  // ── Handle voxel hover ──
  const handleVoxelHover = useCallback((key: string, e: ThreeEvent<PointerEvent>) => {
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
  }, [activeTool, activeColor]);

  const voxelEntries = useMemo(() => Array.from(voxels.entries()), [voxels]);

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
        shadow-bias={-0.005}
      />
      <directionalLight position={[-10, -5, -15]} intensity={0.15} />
      <directionalLight position={[-5, 10, -20]} intensity={0.25} />

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

      {ghostPos && activeTool === 'pencil' && activeColor && (
        <GhostVoxel
          position={[ghostPos[0] - 15.5, ghostPos[1] - 15.5, ghostPos[2]]}
          color={activeColor}
        />
      )}

      <EditOrbitControls />
      {/* eslint-enable react/no-unknown-property */}

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
