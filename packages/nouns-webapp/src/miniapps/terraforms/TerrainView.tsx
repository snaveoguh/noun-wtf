/**
 * TerrainView — 3D terrain renderer for Terraforms parcels.
 *
 * Renders each nearby parcel as a displacement-mapped plane with the exact
 * onchain ASCII art as its texture. Uses PlaneGeometry with direct vertex
 * displacement (same pattern as WorldPage.tsx Terrain component).
 *
 * LOD: Far parcels = colored cubes, near parcels = textured terrain planes.
 * Textures + geometries cached in LRU maps for smooth navigation.
 */
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { OrbitControls } from '@react-three/drei';
import { Canvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { useNavigate } from 'react-router';
import * as THREE from 'three';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

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
  // v2: [bg, palette[10], classGrid(1024 a-j chars), chars{class→char}]
  tokens: Record<string, [string, string[], string, Record<string, string>]>;
}

interface TerrainViewProps {
  parcels: ParcelData[];
  terrainData: TerrainData | null;
  onClickParcel: (id: number) => void;
  hoveredId: number | null;
  setHoveredId: (id: number | null) => void;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const PARCEL_SIZE = 1.2;
const GRID_SIZE = 32;
const CELL_PX = 4; // pixels per cell in the atlas (4px × 32 = 128px per parcel)
const ATLAS_COLS = 100; // 100×100 grid = 10,000 slots, fits all 9,910

const tempObj = new THREE.Object3D();
const tempColor = new THREE.Color();

type TokenEntry = [string, string[], string, Record<string, string>];

// ─── Texture Atlas (all 9,910 parcels in one texture) ─────────────────────

/**
 * Build a single atlas texture containing all parcel arts.
 * Each parcel gets a CELL_PX*32 × CELL_PX*32 tile in a 100×100 grid.
 * Returns { texture, uvOffsets } where uvOffsets maps tokenId → [u, v].
 */
function buildAtlas(
  parcels: ParcelData[],
  terrainData: TerrainData,
): { texture: THREE.CanvasTexture; uvMap: Map<number, [number, number]> } {
  const tileSize = CELL_PX * GRID_SIZE; // 128px per parcel
  const atlasSize = ATLAS_COLS * tileSize; // 12800px

  const canvas = document.createElement('canvas');
  canvas.width = atlasSize;
  canvas.height = atlasSize;
  const ctx = canvas.getContext('2d')!;

  // Black base
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, atlasSize, atlasSize);

  const uvMap = new Map<number, [number, number]>();
  const fontSize = Math.max(2, Math.floor(CELL_PX * 0.9));
  ctx.font = `${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let slot = 0;
  for (const p of parcels) {
    const td = terrainData.tokens[p.tokenId] as TokenEntry | undefined;
    if (!td) continue;

    const col = slot % ATLAS_COLS;
    const row = Math.floor(slot / ATLAS_COLS);
    const ox = col * tileSize;
    const oy = row * tileSize;

    const [bg, palette, classGrid, chars] = td;

    // Fill parcel background
    ctx.fillStyle = bg;
    ctx.fillRect(ox, oy, tileSize, tileSize);

    // Draw characters
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cls = classGrid[r * GRID_SIZE + c];
        const clsIdx = cls.charCodeAt(0) - 97;
        ctx.fillStyle = palette[clsIdx] || '#fff';
        const char = chars[cls] || ' ';
        ctx.fillText(char, ox + c * CELL_PX + CELL_PX / 2, oy + r * CELL_PX + CELL_PX / 2);
      }
    }

    // UV offset: normalized position in atlas
    uvMap.set(p.tokenId, [col / ATLAS_COLS, row / ATLAS_COLS]);
    slot++;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;

  return { texture, uvMap };
}

// ─── All Parcels InstancedMesh (single draw call) ─────────────────────────

/**
 * Renders ALL 9,910 parcels as instanced flat planes with atlas-mapped textures.
 * One draw call, one texture. Each instance has a custom UV offset attribute.
 */
function AllParcelsInstanced({
  parcels,
  terrainData,
  normalization,
  onClickParcel,
  hoveredId,
  setHoveredId,
}: {
  parcels: ParcelData[];
  terrainData: TerrainData;
  normalization: { cx: number; cy: number; cz: number; scale: number };
  onClickParcel: (id: number) => void;
  hoveredId: number | null;
  setHoveredId: (id: number | null) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const idMapRef = useRef<number[]>([]);

  // Build atlas once
  const atlas = useMemo(() => buildAtlas(parcels, terrainData), [parcels, terrainData]);

  // Custom shader material that uses per-instance UV offset
  const material = useMemo(() => {
    const uvScale = 1 / ATLAS_COLS;
    return new THREE.ShaderMaterial({
      uniforms: {
        atlas: { value: atlas.texture },
        uvScale: { value: uvScale },
      },
      vertexShader: `
        attribute vec2 uvOffset;
        varying vec2 vUv;
        uniform float uvScale;
        void main() {
          vUv = uv * uvScale + uvOffset;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D atlas;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(atlas, vUv);
        }
      `,
      side: THREE.DoubleSide,
    });
  }, [atlas]);

  // Set up instances
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || parcels.length === 0) return;

    const { cx, cy, cz, scale } = normalization;
    const ids: number[] = [];
    const offsets = new Float32Array(parcels.length * 2);

    for (let i = 0; i < parcels.length; i++) {
      const p = parcels[i];

      // Position
      tempObj.position.set(
        (p.sx - cx) * scale,
        (p.sy - cy) * scale,
        (p.sz - cz) * scale,
      );
      tempObj.rotation.set(-Math.PI / 2, 0, 0);
      tempObj.scale.setScalar(hoveredId === p.tokenId ? 1.6 : 1.0);
      tempObj.updateMatrix();
      mesh.setMatrixAt(i, tempObj.matrix);

      // UV offset for this parcel's tile in the atlas
      const uv = atlas.uvMap.get(p.tokenId);
      offsets[i * 2] = uv ? uv[0] : 0;
      offsets[i * 2 + 1] = uv ? uv[1] : 0;

      ids.push(p.tokenId);
    }

    // Set per-instance UV offset attribute
    const uvAttr = new THREE.InstancedBufferAttribute(offsets, 2);
    mesh.geometry.setAttribute('uvOffset', uvAttr);

    mesh.instanceMatrix.needsUpdate = true;
    idMapRef.current = ids;
  }, [parcels, normalization, atlas, hoveredId]);

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
      args={[new THREE.PlaneGeometry(PARCEL_SIZE, PARCEL_SIZE), material, parcels.length]}
      onPointerMove={handlePointerMove}
      onPointerOut={() => setHoveredId(null)}
      onClick={handleClick}
    />
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
      <sphereGeometry args={[0.4, 6, 4]} />
      <meshBasicMaterial />
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

      {/* All 9,910 parcels as ASCII art planes — single draw call via atlas */}
      {terrainData && (
        <AllParcelsInstanced
          parcels={parcels}
          terrainData={terrainData}
          normalization={normalization}
          onClickParcel={onClickParcel}
          hoveredId={hoveredId}
          setHoveredId={setHoveredId}
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
