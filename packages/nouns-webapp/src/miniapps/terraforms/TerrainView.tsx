/**
 * TerrainView — 3D voxel terrain renderer for Terraforms parcels.
 *
 * Loads pre-generated terrain JSON and renders each parcel as extruded
 * voxels positioned at its structureSpace coordinates. Uses LOD:
 *   - Far (>50u): colored cube (same as lofi view)
 *   - Near (<50u): full 32×32 voxel terrain
 *
 * Terrain data: per-token grid of heights 0-9, colors from zoneColors palette.
 * Height 0 = valley (flat), 9 = peak (tallest voxel).
 * Color = zoneColors[9 - height] (0 = peak color, 9 = background).
 */
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { OrbitControls } from '@react-three/drei';
import { Canvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { useNavigate } from 'react-router';
import * as THREE from 'three';

// ─── Types ─────────────────────────────────────────────────────────────────

interface ParcelData {
  tokenId: number;
  level: number;
  x: number;
  y: number;
  elevation: number;
  sx: number;
  sy: number;
  sz: number;
  zoneName: string;
  color: string;
}

interface TerrainData {
  v: number;
  count: number;
  tokens: Record<string, [string[], string]>; // [colors[10], gridString(1024)]
}

interface TerrainViewProps {
  parcels: ParcelData[];
  terrainData: TerrainData | null;
  onClickParcel: (id: number) => void;
  hoveredId: number | null;
  setHoveredId: (id: number | null) => void;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const NEAR_DISTANCE = 50; // distance below which terrain voxels are shown
const MAX_TERRAIN_PARCELS = 30; // max parcels to render as terrain simultaneously
const VOXEL_SCALE = 0.02; // scale of each voxel relative to parcel spacing
const TERRAIN_HEIGHT_SCALE = 0.06; // how tall the voxels extrude
const GRID_SIZE = 32;

// Shared geometries and materials
const tempObj = new THREE.Object3D();
const tempColor = new THREE.Color();
const tempVec = new THREE.Vector3();

// ─── Terrain Voxels (near parcels) ────────────────────────────────────────

/**
 * Renders terrain voxels for parcels close to the camera.
 * Uses InstancedMesh for all voxels of nearby parcels combined.
 */
function TerrainVoxels({
  parcels,
  terrainData,
  cameraRef,
  normalization,
  hoveredId,
}: {
  parcels: ParcelData[];
  terrainData: TerrainData;
  cameraRef: React.RefObject<THREE.Camera | null>;
  normalization: { cx: number; cy: number; cz: number; scale: number };
  hoveredId: number | null;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const [nearParcels, setNearParcels] = useState<ParcelData[]>([]);

  // Update which parcels are near the camera
  useFrame(() => {
    const cam = cameraRef.current;
    if (!cam) return;

    const camPos = cam.position;
    const { cx, cy, cz, scale } = normalization;

    // Find parcels within NEAR_DISTANCE
    const scored: [ParcelData, number][] = [];
    for (const p of parcels) {
      const px = (p.sx - cx) * scale;
      const py = (p.sy - cy) * scale;
      const pz = (p.sz - cz) * scale;
      const dist = Math.sqrt(
        (camPos.x - px) ** 2 + (camPos.y - py) ** 2 + (camPos.z - pz) ** 2,
      );
      if (dist < NEAR_DISTANCE && terrainData.tokens[p.tokenId]) {
        scored.push([p, dist]);
      }
    }

    // Sort by distance, take closest N
    scored.sort((a, b) => a[1] - b[1]);
    const nearest = scored.slice(0, MAX_TERRAIN_PARCELS).map(s => s[0]);

    // Only update if the set changed
    const newIds = nearest.map(p => p.tokenId).join(',');
    const oldIds = nearParcels.map(p => p.tokenId).join(',');
    if (newIds !== oldIds) {
      setNearParcels(nearest);
    }
  });

  // Build instanced mesh when near parcels change
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || nearParcels.length === 0) return;

    const { cx, cy, cz, scale } = normalization;
    let instanceIdx = 0;

    for (const p of nearParcels) {
      const tokenData = terrainData.tokens[p.tokenId];
      if (!tokenData) continue;

      const [colors, grid] = tokenData;
      const parcelX = (p.sx - cx) * scale;
      const parcelY = (p.sy - cy) * scale;
      const parcelZ = (p.sz - cz) * scale;

      // Render 32x32 grid of voxels for this parcel
      for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
          if (instanceIdx >= mesh.count) break;

          const height = parseInt(grid[row * GRID_SIZE + col], 10);
          if (height === 0) continue; // skip flat/background cells

          // Position: offset from parcel center
          const ox = (col - 16) * VOXEL_SCALE;
          const oz = (row - 16) * VOXEL_SCALE;
          const oy = height * TERRAIN_HEIGHT_SCALE * 0.5;

          tempObj.position.set(
            parcelX + ox,
            parcelY + oy,
            parcelZ + oz,
          );
          tempObj.scale.set(
            VOXEL_SCALE,
            height * TERRAIN_HEIGHT_SCALE,
            VOXEL_SCALE,
          );
          tempObj.updateMatrix();
          mesh.setMatrixAt(instanceIdx, tempObj.matrix);

          // Color from zone palette: zoneColors[9 - height]
          const colorIdx = Math.max(0, Math.min(9, 9 - height));
          const color = colors[colorIdx] || '#ffffff';
          tempColor.set(color);
          if (hoveredId === p.tokenId) tempColor.multiplyScalar(1.3);
          mesh.setColorAt(instanceIdx, tempColor);

          instanceIdx++;
        }
      }
    }

    // Zero out remaining instances
    tempObj.scale.setScalar(0);
    tempObj.updateMatrix();
    for (let i = instanceIdx; i < mesh.count; i++) {
      mesh.setMatrixAt(i, tempObj.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [nearParcels, terrainData, normalization, hoveredId]);

  // Max possible voxels: MAX_TERRAIN_PARCELS * 1024
  const maxInstances = MAX_TERRAIN_PARCELS * GRID_SIZE * GRID_SIZE;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, maxInstances]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.5} metalness={0.05} />
    </instancedMesh>
  );
}

// ─── Far Cubes (all parcels, LOD fallback) ─────────────────────────────────

function FarCubes({
  parcels,
  normalization,
  onClickParcel,
  hoveredId,
  setHoveredId,
}: {
  parcels: ParcelData[];
  normalization: { cx: number; cy: number; cz: number; scale: number };
  onClickParcel: (id: number) => void;
  hoveredId: number | null;
  setHoveredId: (id: number | null) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const idMapRef = useRef<number[]>([]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || parcels.length === 0) return;

    const { cx, cy, cz, scale } = normalization;
    const ids: number[] = [];

    for (let i = 0; i < parcels.length; i++) {
      const p = parcels[i];
      tempObj.position.set(
        (p.sx - cx) * scale,
        (p.sy - cy) * scale,
        (p.sz - cz) * scale,
      );
      tempObj.scale.setScalar(hoveredId === p.tokenId ? 2.5 : 1.2);
      tempObj.updateMatrix();
      mesh.setMatrixAt(i, tempObj.matrix);

      tempColor.set(p.color);
      if (hoveredId === p.tokenId) tempColor.multiplyScalar(1.5);
      mesh.setColorAt(i, tempColor);
      ids.push(p.tokenId);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    idMapRef.current = ids;
  }, [parcels, normalization, hoveredId]);

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined && idMapRef.current[e.instanceId]) {
      setHoveredId(idMapRef.current[e.instanceId]);
    }
  }, [setHoveredId]);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined && idMapRef.current[e.instanceId]) {
      onClickParcel(idMapRef.current[e.instanceId]);
    }
  }, [onClickParcel]);

  if (parcels.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, parcels.length]}
      onPointerMove={handlePointerMove}
      onPointerOut={() => setHoveredId(null)}
      onClick={handleClick}
    >
      <boxGeometry args={[0.85, 0.85, 0.85]} />
      <meshStandardMaterial roughness={0.4} metalness={0.1} transparent opacity={0.6} />
    </instancedMesh>
  );
}

// ─── Camera Ref Helper ─────────────────────────────────────────────────────

function CameraRefSetter({ cameraRef }: { cameraRef: React.RefObject<THREE.Camera | null> }) {
  const { camera } = useThree();
  useEffect(() => {
    (cameraRef as React.MutableRefObject<THREE.Camera | null>).current = camera;
  }, [camera, cameraRef]);
  return null;
}

// ─── Scene ─────────────────────────────────────────────────────────────────

const TerrainScene: FC<TerrainViewProps> = ({
  parcels,
  terrainData,
  onClickParcel,
  hoveredId,
  setHoveredId,
}) => {
  const cameraRef = useRef<THREE.Camera | null>(null);

  // Compute normalization from parcels (center + scale to ~80 unit cube)
  const normalization = useMemo(() => {
    if (parcels.length === 0) return { cx: 0, cy: 0, cz: 0, scale: 1 };

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const p of parcels) {
      if (p.sx < minX) minX = p.sx; if (p.sx > maxX) maxX = p.sx;
      if (p.sy < minY) minY = p.sy; if (p.sy > maxY) maxY = p.sy;
      if (p.sz < minZ) minZ = p.sz; if (p.sz > maxZ) maxZ = p.sz;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const range = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
    const scale = 80 / range;

    return { cx, cy, cz, scale };
  }, [parcels]);

  return (
    <>
      <CameraRefSetter cameraRef={cameraRef} />

      <ambientLight intensity={0.5} />
      <directionalLight position={[50, 80, 30]} intensity={0.8} />
      <pointLight position={[0, 50, 0]} intensity={0.3} color="#4466ff" />

      {/* Far LOD: colored cubes for all parcels */}
      <FarCubes
        parcels={parcels}
        normalization={normalization}
        onClickParcel={onClickParcel}
        hoveredId={hoveredId}
        setHoveredId={setHoveredId}
      />

      {/* Near LOD: terrain voxels for nearby parcels */}
      {terrainData && (
        <TerrainVoxels
          parcels={parcels}
          terrainData={terrainData}
          cameraRef={cameraRef}
          normalization={normalization}
          hoveredId={hoveredId}
        />
      )}

      <OrbitControls
        enableDamping
        dampingFactor={0.06}
        autoRotate
        autoRotateSpeed={0.15}
        minDistance={5}
        maxDistance={200}
        enablePan
        maxPolarAngle={Math.PI * 0.9}
      />

      <gridHelper args={[100, 50, '#111133', '#0a0a22']} position={[0, -20, 0]} />
    </>
  );
};

// ─── Terrain Data Loader ───────────────────────────────────────────────────

function useTerrainData() {
  const [data, setData] = useState<TerrainData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch('/data/terraforms-terrain.json')
      .then(r => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then(d => setData(d))
      .catch(() => {
        // Terrain data not generated yet — component works without it
        console.warn('Terrain data not available at /data/terraforms-terrain.json');
      })
      .finally(() => setLoading(false));
  }, []);

  return { data, loading };
}

// ─── Exported Component ────────────────────────────────────────────────────

export { useTerrainData };
export type { TerrainData, TerrainViewProps };

const TerrainViewCanvas: FC<{
  parcels: ParcelData[];
  terrainData: TerrainData | null;
  onClickParcel: (id: number) => void;
  hoveredId: number | null;
  setHoveredId: (id: number | null) => void;
}> = (props) => (
  <Canvas
    camera={{ position: [60, 40, 60], fov: 55 }}
    gl={{ antialias: true, alpha: false }}
    onCreated={({ gl }) => gl.setClearColor('#050510')}
    style={{ cursor: props.hoveredId ? 'pointer' : 'grab' }}
  >
    <TerrainScene {...props} />
  </Canvas>
);

export default TerrainViewCanvas;
