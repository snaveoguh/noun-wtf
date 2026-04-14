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

const NEAR_DISTANCE = 80; // show terrain for most visible parcels
const MAX_TERRAIN_PARCELS = 60;
const MAX_ANIMATED = 6; // closest N get live animation from tokenHTML
const PARCEL_SIZE = 1.2;
const GRID_SIZE = 32;
const TEX_RES = 512;
const LRU_LIMIT = 50;

const tempObj = new THREE.Object3D();
const tempColor = new THREE.Color();

// ─── ASCII Art Texture Generator ──────────────────────────────────────────

type TokenEntry = [string, string[], string, Record<string, string>];

// LRU caches (module-level, persist across re-renders)
const textureCache = new Map<number, THREE.CanvasTexture>();

function evictLRU<T extends { dispose(): void }>(cache: Map<number, T>, limit: number) {
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.get(oldest)?.dispose();
    cache.delete(oldest);
  }
}

/** Render onchain ASCII art to a CanvasTexture (NearestFilter for pixel art look). */
function getOrCreateTexture(tokenId: number, td: TokenEntry): THREE.CanvasTexture {
  let tex = textureCache.get(tokenId);
  if (tex) {
    // Move to end (LRU refresh)
    textureCache.delete(tokenId);
    textureCache.set(tokenId, tex);
    return tex;
  }

  const [bg, palette, classGrid, chars] = td;
  const canvas = document.createElement('canvas');
  canvas.width = TEX_RES;
  canvas.height = TEX_RES;
  const ctx = canvas.getContext('2d')!;
  const cellW = TEX_RES / GRID_SIZE;
  const cellH = TEX_RES / GRID_SIZE;
  const fontSize = Math.floor(cellH * 0.92);

  // Fill background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, TEX_RES, TEX_RES);

  // Draw each character with its exact onchain color
  ctx.font = `${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const cls = classGrid[row * GRID_SIZE + col];
      const clsIdx = cls.charCodeAt(0) - 97;
      ctx.fillStyle = palette[clsIdx] || '#fff';
      const char = chars[cls] || ' ';
      ctx.fillText(char, col * cellW + cellW / 2, row * cellH + cellH / 2);
    }
  }

  tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;

  textureCache.set(tokenId, tex);
  evictLRU(textureCache, LRU_LIMIT);
  return tex;
}

// Shared flat plane geometry — no displacement, the ASCII art IS the depth
const flatPlaneGeo = new THREE.PlaneGeometry(PARCEL_SIZE, PARCEL_SIZE);

// ─── Single Terrain Plane (one parcel) ────────────────────────────────────

function TerrainPlane({ parcel, tokenData, normalization }: {
  parcel: ParcelData;
  tokenData: TokenEntry;
  normalization: { cx: number; cy: number; cz: number; scale: number };
}) {
  const { cx, cy, cz, scale } = normalization;
  const px = (parcel.sx - cx) * scale;
  const py = (parcel.sy - cy) * scale;
  const pz = (parcel.sz - cz) * scale;

  const texture = useMemo(() => getOrCreateTexture(parcel.tokenId, tokenData), [parcel.tokenId, tokenData]);

  return (
    <mesh
      geometry={flatPlaneGeo}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[px, py + 0.01, pz]}
    >
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ─── Animated Terrain Plane (live tokenHTML → texture) ─────────────────────

const TERRAFORMS_ADDRESS = '0x4E1f41613c9084FdB9E34E11fAE9412427480e56' as const;
const TOKEN_HTML_ABI = [{
  name: 'tokenHTML', type: 'function', stateMutability: 'view' as const,
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ name: '', type: 'string' }],
}] as const;

const rpcClient = createPublicClient({
  chain: mainnet,
  transport: http(import.meta.env.VITE_MAINNET_JSONRPC || 'https://ethereum-rpc.publicnode.com'),
});

/** Animated terrain: hidden iframe renders tokenHTML, we capture to texture every 200ms. */
function AnimatedTerrainPlane({ parcel, tokenData, normalization }: {
  parcel: ParcelData;
  tokenData: TokenEntry;
  normalization: { cx: number; cy: number; cz: number; scale: number };
}) {
  const { cx, cy, cz, scale } = normalization;
  const px = (parcel.sx - cx) * scale;
  const py = (parcel.sy - cy) * scale;
  const pz = (parcel.sz - cz) * scale;

  // Start with static texture, upgrade to animated when iframe loads
  const staticTex = useMemo(() => getOrCreateTexture(parcel.tokenId, tokenData), [parcel.tokenId, tokenData]);
  const [texture, setTexture] = useState<THREE.CanvasTexture>(staticTex);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;

    // Fetch tokenHTML
    (async () => {
      try {
        const html = await rpcClient.readContract({
          address: TERRAFORMS_ADDRESS, abi: TOKEN_HTML_ABI,
          functionName: 'tokenHTML', args: [BigInt(parcel.tokenId)],
        });
        if (cancelled) return;

        // Create hidden iframe
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:388px;height:560px;border:none;';
        iframe.sandbox.add('allow-scripts', 'allow-same-origin');
        iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:#000;width:100%;height:100%}</style></head><body>${html}</body></html>`;
        document.body.appendChild(iframe);
        iframeRef.current = iframe;

        // Create capture canvas
        const canvas = document.createElement('canvas');
        canvas.width = TEX_RES;
        canvas.height = TEX_RES;
        canvasRef.current = canvas;

        // Wait for iframe to load, then start capturing
        iframe.onload = () => {
          if (cancelled) return;

          const animTex = new THREE.CanvasTexture(canvas);
          animTex.magFilter = THREE.NearestFilter;
          animTex.minFilter = THREE.NearestFilter;
          animTex.colorSpace = THREE.SRGBColorSpace;

          const captureFrame = () => {
            const doc = iframe.contentDocument;
            if (!doc) return;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const gridEls = doc.querySelectorAll('.r p, .meta p');
            if (gridEls.length < 1024) return;

            const cellW = TEX_RES / GRID_SIZE;
            const cellH = TEX_RES / GRID_SIZE;
            const fontSize = Math.floor(cellH * 0.92);

            // Read bg from iframe
            const bg = getComputedStyle(doc.querySelector('.r') || doc.body).backgroundColor || '#000';
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, TEX_RES, TEX_RES);

            ctx.font = `${fontSize}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (let i = 0; i < Math.min(1024, gridEls.length); i++) {
              const el = gridEls[i] as HTMLElement;
              const row = Math.floor(i / GRID_SIZE);
              const col = i % GRID_SIZE;
              ctx.fillStyle = el.style.color || getComputedStyle(el).color || '#fff';
              ctx.fillText(el.textContent || ' ', col * cellW + cellW / 2, row * cellH + cellH / 2);
            }

            animTex.needsUpdate = true;
          };

          // Capture first frame, then every 200ms
          setTimeout(() => {
            captureFrame();
            setTexture(animTex);
            intervalRef.current = window.setInterval(captureFrame, 200);
          }, 500); // give animation JS time to start
        };
      } catch (err) {
        // Fallback to static — already set
      }
    })();

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (iframeRef.current) {
        document.body.removeChild(iframeRef.current);
        iframeRef.current = null;
      }
    };
  }, [parcel.tokenId]);

  return (
    <mesh geometry={flatPlaneGeo} rotation={[-Math.PI / 2, 0, 0]} position={[px, py + 0.01, pz]}>
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ─── Terrain Planes (near parcels) ────────────────────────────────────────

function TerrainPlanes({
  parcels,
  terrainData,
  cameraRef,
  normalization,
}: {
  parcels: ParcelData[];
  terrainData: TerrainData;
  cameraRef: React.RefObject<THREE.Camera | null>;
  normalization: { cx: number; cy: number; cz: number; scale: number };
}) {
  const [nearParcels, setNearParcels] = useState<ParcelData[]>([]);

  useFrame(() => {
    const cam = cameraRef.current;
    if (!cam) return;

    const camPos = cam.position;
    const { cx, cy, cz, scale } = normalization;

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

    scored.sort((a, b) => a[1] - b[1]);
    const nearest = scored.slice(0, MAX_TERRAIN_PARCELS).map(s => s[0]);

    const newIds = nearest.map(p => p.tokenId).join(',');
    const oldIds = nearParcels.map(p => p.tokenId).join(',');
    if (newIds !== oldIds) {
      setNearParcels(nearest);
    }
  });

  return (
    <group>
      {nearParcels.map((p, i) => {
        const td = terrainData.tokens[p.tokenId] as TokenEntry | undefined;
        if (!td) return null;

        // Closest parcels get live animation, rest get static texture
        if (i < MAX_ANIMATED) {
          return (
            <AnimatedTerrainPlane
              key={p.tokenId}
              parcel={p}
              tokenData={td}
              normalization={normalization}
            />
          );
        }
        return (
          <TerrainPlane
            key={p.tokenId}
            parcel={p}
            tokenData={td}
            normalization={normalization}
          />
        );
      })}
    </group>
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

      {/* Far: small colored dots for castle structure visibility */}
      <FarCubes
        parcels={parcels}
        normalization={normalization}
        onClickParcel={onClickParcel}
        hoveredId={hoveredId}
        setHoveredId={setHoveredId}
      />

      {/* Near: displacement-mapped ASCII art terrain (replaces dots when close) */}
      {terrainData && (
        <TerrainPlanes
          parcels={parcels}
          terrainData={terrainData}
          cameraRef={cameraRef}
          normalization={normalization}
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
