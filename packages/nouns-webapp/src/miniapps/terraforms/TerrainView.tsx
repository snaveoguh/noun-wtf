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
import { Bloom, EffectComposer } from '@react-three/postprocessing';
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
const CELL_PX = 1; // 1px per cell (32×32px per parcel) — color patterns, not text
const ATLAS_COLS = 100; // 100×100 grid = 3200×3200px atlas — fits in GPU

const tempObj = new THREE.Object3D();

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
): { colorTex: THREE.CanvasTexture; heightTex: THREE.CanvasTexture; uvMap: Map<number, [number, number]> } {
  const tileSize = CELL_PX * GRID_SIZE; // 128px per parcel
  const atlasSize = ATLAS_COLS * tileSize; // 12800px

  // Color atlas — ASCII art
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = atlasSize;
  colorCanvas.height = atlasSize;
  const colorCtx = colorCanvas.getContext('2d')!;
  colorCtx.fillStyle = '#000';
  colorCtx.fillRect(0, 0, atlasSize, atlasSize);

  // Height atlas — grayscale heightmap (bright = tall, dark = flat)
  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = atlasSize;
  heightCanvas.height = atlasSize;
  const heightCtx = heightCanvas.getContext('2d')!;
  heightCtx.fillStyle = '#000';
  heightCtx.fillRect(0, 0, atlasSize, atlasSize);

  const uvMap = new Map<number, [number, number]>();

  // Use ImageData for fast pixel-level atlas painting (no fillRect/fillText overhead)
  const colorData = colorCtx.getImageData(0, 0, atlasSize, atlasSize);
  const heightData = heightCtx.getImageData(0, 0, atlasSize, atlasSize);
  const cPixels = colorData.data;
  const hPixels = heightData.data;

  // Helper to parse hex color
  const hexToRGB = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  let slot = 0;
  for (const p of parcels) {
    const td = terrainData.tokens[p.tokenId] as TokenEntry | undefined;
    if (!td) continue;

    const tileCol = slot % ATLAS_COLS;
    const tileRow = Math.floor(slot / ATLAS_COLS);
    const ox = tileCol * tileSize;
    const oy = tileRow * tileSize;

    const [bg, palette, classGrid] = td;
    const bgRGB = hexToRGB(bg || '#000000');

    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const cls = classGrid[r * GRID_SIZE + c];
        const clsIdx = cls.charCodeAt(0) - 97;
        const height = 9 - clsIdx; // a=9 peak, j=0 flat

        const px = ox + c;
        const py = oy + r;
        const idx = (py * atlasSize + px) * 4;

        // Color: use zone color (bg for height 0)
        const rgb = height > 0 ? hexToRGB(palette[clsIdx] || '#fff') : bgRGB;
        cPixels[idx] = rgb[0];
        cPixels[idx + 1] = rgb[1];
        cPixels[idx + 2] = rgb[2];
        cPixels[idx + 3] = 255;

        // Height: grayscale 0-255
        const brightness = Math.round((height / 9) * 255);
        hPixels[idx] = brightness;
        hPixels[idx + 1] = brightness;
        hPixels[idx + 2] = brightness;
        hPixels[idx + 3] = 255;
      }
    }

    uvMap.set(p.tokenId, [tileCol / ATLAS_COLS, tileRow / ATLAS_COLS]);
    slot++;
  }

  colorCtx.putImageData(colorData, 0, 0);
  heightCtx.putImageData(heightData, 0, 0);

  const colorTex = new THREE.CanvasTexture(colorCanvas);
  colorTex.magFilter = THREE.NearestFilter;
  colorTex.minFilter = THREE.LinearMipmapLinearFilter;
  colorTex.colorSpace = THREE.SRGBColorSpace;

  const heightTex = new THREE.CanvasTexture(heightCanvas);
  heightTex.magFilter = THREE.NearestFilter;
  heightTex.minFilter = THREE.NearestFilter;

  return { colorTex, heightTex, uvMap };
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
  heightScale,
  saturation,
}: {
  parcels: ParcelData[];
  terrainData: TerrainData;
  normalization: { cx: number; cy: number; cz: number; scale: number };
  onClickParcel: (id: number) => void;
  hoveredId: number | null;
  setHoveredId: (id: number | null) => void;
  heightScale: number;
  saturation: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const idMapRef = useRef<number[]>([]);

  // Build atlas once
  const atlas = useMemo(() => buildAtlas(parcels, terrainData), [parcels, terrainData]);

  // Custom shader: color atlas + height displacement + saturation boost
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const material = useMemo(() => {
    const uvScale = 1 / ATLAS_COLS;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        colorAtlas: { value: atlas.colorTex },
        heightAtlas: { value: atlas.heightTex },
        uvScale: { value: uvScale },
        heightScale: { value: heightScale },
        saturation: { value: saturation },
      },
      vertexShader: `
        attribute vec2 uvOffset;
        varying vec2 vUv;
        varying float vHeight;
        uniform float uvScale;
        uniform sampler2D heightAtlas;
        uniform float heightScale;
        void main() {
          vUv = uv * uvScale + uvOffset;
          float h = texture2D(heightAtlas, vUv).r;
          vHeight = h;
          vec3 pos = position;
          pos.z += h * heightScale;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D colorAtlas;
        uniform float saturation;
        varying vec2 vUv;
        varying float vHeight;
        void main() {
          vec4 col = texture2D(colorAtlas, vUv);
          // Saturation boost
          float gray = dot(col.rgb, vec3(0.299, 0.587, 0.114));
          col.rgb = mix(vec3(gray), col.rgb, saturation);
          // Slight emission boost on higher terrain for glow pickup
          col.rgb *= 1.0 + vHeight * 0.3;
          gl_FragColor = col;
        }
      `,
      side: THREE.DoubleSide,
    });
    materialRef.current = mat;
    return mat;
  }, [atlas]);

  // Sync uniforms every frame — avoids race conditions with useEffect
  useFrame(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.heightScale.value = heightScale;
      materialRef.current.uniforms.saturation.value = saturation;
    }
  });

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
      args={[new THREE.PlaneGeometry(PARCEL_SIZE, PARCEL_SIZE, GRID_SIZE, GRID_SIZE), material, parcels.length]}
      onPointerMove={handlePointerMove}
      onPointerOut={() => setHoveredId(null)}
      onClick={handleClick}
    />
  );
}

// ─── ASCII Character Terrain (nearest parcels) ───────────────────────────
//
// Each parcel = merged BufferGeometry of 1024 quads facing up.
// Each quad at (col, row, height), UVs pointing to a character atlas.
// Standard meshBasicMaterial — no custom shaders needed.

const CHAR_DISTANCE = 30;
const MAX_CHAR_PARCELS = 20;
const CELL = PARCEL_SIZE / GRID_SIZE; // scene units per cell
const CHAR_PX = 32; // pixels per character tile in atlas
const HEIGHT_UNIT = 0.04; // height per level (scaled by relief slider)

type CharAtlasResult = {
  texture: THREE.CanvasTexture;
  // Maps "classLetter" → { col, row } in the atlas grid
  tileMap: Map<string, { u0: number; v0: number; u1: number; v1: number }>;
};

const charAtlasCache = new Map<string, CharAtlasResult>();

/** Build atlas: one tile per (class letter) — character drawn in its zone color on bg. */
function buildCharAtlas(td: TokenEntry): CharAtlasResult {
  const [bg, palette, , chars] = td;
  // Key by palette + chars for caching
  const key = palette.join(',') + '|' + Object.values(chars).join(',') + '|' + bg;
  if (charAtlasCache.has(key)) return charAtlasCache.get(key)!;

  // 10 classes (a-j), one tile each. Layout: 10 columns × 1 row
  const numTiles = 10;
  const canvas = document.createElement('canvas');
  canvas.width = numTiles * CHAR_PX;
  canvas.height = CHAR_PX;
  const ctx = canvas.getContext('2d')!;

  // Fill background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const fontSize = Math.floor(CHAR_PX * 0.82);
  ctx.font = `${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const tileMap = new Map<string, { u0: number; v0: number; u1: number; v1: number }>();

  for (let i = 0; i < 10; i++) {
    const cls = String.fromCharCode(97 + i); // 'a' to 'j'
    const color = palette[i] || '#fff';
    const char = chars[cls] || ' ';

    // Draw character in its color on the bg
    ctx.fillStyle = bg;
    ctx.fillRect(i * CHAR_PX, 0, CHAR_PX, CHAR_PX);
    ctx.fillStyle = color;
    ctx.fillText(char, i * CHAR_PX + CHAR_PX / 2, CHAR_PX / 2);

    tileMap.set(cls, {
      u0: i / numTiles,
      v0: 0,
      u1: (i + 1) / numTiles,
      v1: 1,
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  const result = { texture, tileMap };
  charAtlasCache.set(key, result);
  return result;
}

/** Build merged geometry: 1024 upward-facing quads at correct heights, UVs to atlas. */
function buildCharGeometry(td: TokenEntry, atlas: CharAtlasResult): THREE.BufferGeometry {
  const [, , classGrid] = td;
  const N = GRID_SIZE * GRID_SIZE;
  const positions = new Float32Array(N * 4 * 3);
  const uvs = new Float32Array(N * 4 * 2);
  const indices = new Uint32Array(N * 6);
  const half = CELL * 0.47;

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const i = row * GRID_SIZE + col;
      const cls = classGrid[i];
      const clsIdx = cls.charCodeAt(0) - 97;
      const height = (9 - clsIdx) * HEIGHT_UNIT;

      // Quad center in local space (origin = parcel center)
      const cx = (col - GRID_SIZE / 2 + 0.5) * CELL;
      const cy = height;
      const cz = (row - GRID_SIZE / 2 + 0.5) * CELL;

      // 4 vertices: quad on XZ plane facing Y-up
      const vi = i * 4;
      positions[vi * 3] = cx - half;     positions[vi * 3 + 1] = cy; positions[vi * 3 + 2] = cz - half;
      positions[(vi+1) * 3] = cx + half; positions[(vi+1) * 3 + 1] = cy; positions[(vi+1) * 3 + 2] = cz - half;
      positions[(vi+2) * 3] = cx + half; positions[(vi+2) * 3 + 1] = cy; positions[(vi+2) * 3 + 2] = cz + half;
      positions[(vi+3) * 3] = cx - half; positions[(vi+3) * 3 + 1] = cy; positions[(vi+3) * 3 + 2] = cz + half;

      // UVs: map to the right atlas tile for this class
      const tile = atlas.tileMap.get(cls);
      const u0 = tile?.u0 ?? 0, u1 = tile?.u1 ?? 0.1;
      // v: 0=top, 1=bottom in Three.js UV space
      uvs[vi * 2] = u0;     uvs[vi * 2 + 1] = 1;
      uvs[(vi+1) * 2] = u1; uvs[(vi+1) * 2 + 1] = 1;
      uvs[(vi+2) * 2] = u1; uvs[(vi+2) * 2 + 1] = 0;
      uvs[(vi+3) * 2] = u0; uvs[(vi+3) * 2 + 1] = 0;

      // Two triangles
      const ii = i * 6;
      indices[ii] = vi; indices[ii+1] = vi+1; indices[ii+2] = vi+2;
      indices[ii+3] = vi; indices[ii+4] = vi+2; indices[ii+5] = vi+3;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

/** One parcel: merged character quads at height levels. */
function CharTerrain({ parcel, tokenData, normalization, heightScale }: {
  parcel: ParcelData;
  tokenData: TokenEntry;
  normalization: { cx: number; cy: number; cz: number; scale: number };
  heightScale: number;
}) {
  const { cx, cy, cz, scale } = normalization;
  const px = (parcel.sx - cx) * scale;
  const py = (parcel.sy - cy) * scale;
  const pz = (parcel.sz - cz) * scale;

  const atlas = useMemo(() => buildCharAtlas(tokenData), [tokenData]);
  const geometry = useMemo(() => buildCharGeometry(tokenData, atlas), [tokenData, atlas]);

  return (
    <group position={[px, py, pz]} scale={[1, Math.max(0.01, heightScale * 8), 1]}>
      <mesh geometry={geometry} raycast={() => {}}>
        <meshBasicMaterial map={atlas.texture} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** Renders character terrain for nearest parcels. */
function CharOverlay({
  parcels, terrainData, cameraRef, normalization, heightScale,
}: {
  parcels: ParcelData[];
  terrainData: TerrainData;
  cameraRef: React.RefObject<THREE.Camera | null>;
  normalization: { cx: number; cy: number; cz: number; scale: number };
  heightScale: number;
}) {
  const [nearParcels, setNearParcels] = useState<ParcelData[]>([]);

  useFrame(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    const { cx, cy, cz, scale } = normalization;
    const camPos = cam.position;

    const scored: [ParcelData, number][] = [];
    for (const p of parcels) {
      if (!terrainData.tokens[p.tokenId]) continue;
      const dx = camPos.x - (p.sx - cx) * scale;
      const dy = camPos.y - (p.sy - cy) * scale;
      const dz = camPos.z - (p.sz - cz) * scale;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < CHAR_DISTANCE) scored.push([p, dist]);
    }
    scored.sort((a, b) => a[1] - b[1]);
    const nearest = scored.slice(0, MAX_CHAR_PARCELS).map(s => s[0]);
    const ids = nearest.map(p => p.tokenId).join(',');
    if (ids !== nearParcels.map(p => p.tokenId).join(',')) setNearParcels(nearest);
  });

  return (
    <group>
      {nearParcels.map(p => {
        const td = terrainData.tokens[p.tokenId] as TokenEntry | undefined;
        if (!td) return null;
        return <CharTerrain key={p.tokenId} parcel={p} tokenData={td} normalization={normalization} heightScale={heightScale} />;
      })}
    </group>
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

const TerrainScene: FC<TerrainViewProps & { heightScale: number; saturation: number; bloomIntensity: number }> = ({
  parcels,
  terrainData,
  onClickParcel,
  hoveredId,
  setHoveredId,
  heightScale,
  saturation,
  bloomIntensity,
}) => {
  const cameraRef = useRef<THREE.Camera | null>(null);

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
    return {
      cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2,
      scale: 80 / Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1),
    };
  }, [parcels]);

  return (
    <>
      <CameraRefSetter cameraRef={cameraRef} />

      <ambientLight intensity={0.4} />
      <directionalLight position={[50, 80, 30]} intensity={0.6} />
      <pointLight position={[0, 50, 0]} intensity={0.4} color="#4466ff" />
      <pointLight position={[-30, 20, -30]} intensity={0.2} color="#ff4466" />

      {terrainData && (
        <>
          <AllParcelsInstanced
            parcels={parcels}
            terrainData={terrainData}
            normalization={normalization}
            onClickParcel={onClickParcel}
            hoveredId={hoveredId}
            setHoveredId={setHoveredId}
            heightScale={heightScale}
            saturation={saturation}
          />
          <CharOverlay
            parcels={parcels}
            terrainData={terrainData}
            cameraRef={cameraRef}
            normalization={normalization}
            heightScale={heightScale}
          />
        </>
      )}

      <OrbitControls
        enableDamping dampingFactor={0.06}
        autoRotate autoRotateSpeed={0.15}
        minDistance={5} maxDistance={200}
        enablePan maxPolarAngle={Math.PI * 0.9}
      />

      {/* Bloom glow — only active when slider > 0 to save GPU */}
      {bloomIntensity > 0 && (
        <EffectComposer>
          <Bloom
            intensity={bloomIntensity}
            luminanceThreshold={0.4}
            luminanceSmoothing={0.9}
            mipmapBlur
          />
        </EffectComposer>
      )}
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

// ─── Slider HUD ───────────────────────────────────────────────────────────

const sliderStyle: React.CSSProperties = {
  width: '100%', height: 4, appearance: 'none' as const, background: '#1e293b',
  borderRadius: 2, outline: 'none', cursor: 'pointer',
  accentColor: '#22c55e',
};
const sliderLabelStyle: React.CSSProperties = {
  fontSize: '0.55rem', color: '#64748b', fontFamily: 'monospace',
  display: 'flex', justifyContent: 'space-between', marginBottom: 2,
};

// ─── Main Export ──────────────────────────────────────────────────────────

const TerrainViewCanvas: FC<{
  parcels: ParcelData[];
  terrainData: TerrainData | null;
  onClickParcel: (id: number) => void;
  hoveredId: number | null;
  setHoveredId: (id: number | null) => void;
}> = (props) => {
  const PRESETS = {
    default: { height: 0.35, sat: 1.2, bloom: 0, label: 'Default' },
    deepFried: { height: 0.5, sat: 2.2, bloom: 1.2, label: 'Deep Fried' },
    flat: { height: 0, sat: 1.0, bloom: 0, label: 'Flat' },
    extreme: { height: 1.2, sat: 2.8, bloom: 1.8, label: 'Extreme' },
  };

  const [heightScale, setHeightScale] = useState(PRESETS.default.height);
  const [saturation, setSaturation] = useState(PRESETS.default.sat);
  const [bloomIntensity, setBloomIntensity] = useState(PRESETS.default.bloom);

  const applyPreset = (p: typeof PRESETS.default) => {
    setHeightScale(p.height);
    setSaturation(p.sat);
    setBloomIntensity(p.bloom);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [60, 40, 60], fov: 55 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => gl.setClearColor('#050510')}
        style={{ cursor: props.hoveredId ? 'pointer' : 'grab' }}
      >
        <TerrainScene {...props} heightScale={heightScale} saturation={saturation} bloomIntensity={bloomIntensity} />
      </Canvas>

      {/* Slider HUD — bottom right */}
      <div style={{
        position: 'absolute', bottom: 20, right: 20, width: 180,
        background: 'rgba(0,0,0,0.7)', borderRadius: 10, padding: '12px 14px',
        border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div>
          <div style={sliderLabelStyle}><span>Relief</span><span>{heightScale.toFixed(2)}</span></div>
          <input type="range" min="0" max="1.5" step="0.01" value={heightScale}
            onChange={e => setHeightScale(parseFloat(e.target.value))} style={sliderStyle} />
        </div>
        <div>
          <div style={sliderLabelStyle}><span>Saturation</span><span>{saturation.toFixed(1)}</span></div>
          <input type="range" min="0.5" max="3" step="0.1" value={saturation}
            onChange={e => setSaturation(parseFloat(e.target.value))} style={sliderStyle} />
        </div>
        <div>
          <div style={sliderLabelStyle}><span>Glow</span><span>{bloomIntensity.toFixed(1)}</span></div>
          <input type="range" min="0" max="2" step="0.1" value={bloomIntensity}
            onChange={e => setBloomIntensity(parseFloat(e.target.value))} style={sliderStyle} />
        </div>
        {/* Presets */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
          {Object.values(PRESETS).map(p => (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              style={{
                padding: '3px 8px', borderRadius: 4, border: '1px solid #334155',
                background: '#0f172a', color: '#94a3b8', fontSize: '0.5rem',
                cursor: 'pointer', fontFamily: 'monospace',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TerrainViewCanvas;
