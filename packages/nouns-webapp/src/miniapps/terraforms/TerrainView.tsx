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
const CELL_PX = 1; // 1px per cell (32×32px per parcel) — color patterns, not text
const ATLAS_COLS = 100; // 100×100 grid = 3200×3200px atlas — fits in GPU
const HEIGHT_SCALE = 0.25; // max height displacement per parcel

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

  // Update uniforms when sliders change (no material rebuild needed)
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.heightScale.value = heightScale;
      materialRef.current.uniforms.saturation.value = saturation;
    }
  }, [heightScale, saturation]);

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

// ─── Animated Overlay (nearest parcels) ───────────────────────────────────
//
// Flat texture planes showing LIVE animated tokenHTML art.
// Each near parcel gets a hidden iframe → canvas capture every 250ms.
// Positioned at parcel coords slightly above the atlas.

const ANIM_DISTANCE = 20;
const MAX_ANIM_PARCELS = 4; // keep low — each is a hidden iframe + 250ms capture
const ANIM_TEX = 256; // capture resolution
const animPlaneGeo = new THREE.PlaneGeometry(PARCEL_SIZE * 1.02, PARCEL_SIZE * 1.02);

const rpcClient = createPublicClient({
  chain: mainnet,
  transport: http(import.meta.env.VITE_MAINNET_JSONRPC || 'https://ethereum-rpc.publicnode.com'),
});

const TERRAFORMS_ADDRESS_2 = '0x4E1f41613c9084FdB9E34E11fAE9412427480e56' as const;
const TOKEN_HTML_ABI_2 = [{
  name: 'tokenHTML', type: 'function', stateMutability: 'view' as const,
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ name: '', type: 'string' }],
}] as const;

/** One animated parcel: iframe captures live art to texture. */
function AnimatedParcel({ parcel, normalization }: {
  parcel: ParcelData;
  normalization: { cx: number; cy: number; cz: number; scale: number };
}) {
  const { cx, cy, cz, scale } = normalization;
  const px = (parcel.sx - cx) * scale;
  const py = (parcel.sy - cy) * scale;
  const pz = (parcel.sz - cz) * scale;

  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const intervalRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const html = await rpcClient.readContract({
          address: TERRAFORMS_ADDRESS_2, abi: TOKEN_HTML_ABI_2,
          functionName: 'tokenHTML', args: [BigInt(parcel.tokenId)],
        });
        if (cancelled) return;

        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:388px;height:560px;border:none;';
        iframe.sandbox.add('allow-scripts', 'allow-same-origin');
        iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:#000;width:100%;height:100%}</style></head><body>${html}</body></html>`;
        document.body.appendChild(iframe);
        iframeRef.current = iframe;

        const canvas = document.createElement('canvas');
        canvas.width = ANIM_TEX;
        canvas.height = ANIM_TEX;

        iframe.onload = () => {
          if (cancelled) return;
          const tex = new THREE.CanvasTexture(canvas);
          tex.magFilter = THREE.NearestFilter;
          tex.minFilter = THREE.NearestFilter;
          tex.colorSpace = THREE.SRGBColorSpace;

          const capture = () => {
            const doc = iframe.contentDocument;
            if (!doc) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            const gridEls = doc.querySelectorAll('.r p, .meta p');
            if (gridEls.length < 1024) return;

            const cellW = ANIM_TEX / GRID_SIZE;
            const cellH = ANIM_TEX / GRID_SIZE;
            const fontSize = Math.floor(cellH * 0.85);
            const bg = getComputedStyle(doc.querySelector('.r') || doc.body).backgroundColor || '#000';
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, ANIM_TEX, ANIM_TEX);
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
            tex.needsUpdate = true;
          };

          setTimeout(() => {
            capture();
            setTexture(tex);
            intervalRef.current = window.setInterval(capture, 250);
          }, 800);
        };
      } catch { /* fallback: no overlay */ }
    })();

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (iframeRef.current) {
        try { document.body.removeChild(iframeRef.current); } catch {}
        iframeRef.current = null;
      }
    };
  }, [parcel.tokenId]);

  if (!texture) return null;

  return (
    <mesh
      geometry={animPlaneGeo}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[px, py + 0.03, pz]}
      raycast={() => {}} // pass-through — atlas handles interaction
    >
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} transparent opacity={0.95} />
    </mesh>
  );
}

/** Renders animated overlays for nearest parcels. */
function AnimOverlay({
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
      if (!terrainData.tokens[p.tokenId]) continue;
      const ppx = (p.sx - cx) * scale;
      const ppy = (p.sy - cy) * scale;
      const ppz = (p.sz - cz) * scale;
      const dist = Math.sqrt((camPos.x - ppx) ** 2 + (camPos.y - ppy) ** 2 + (camPos.z - ppz) ** 2);
      if (dist < ANIM_DISTANCE) scored.push([p, dist]);
    }

    scored.sort((a, b) => a[1] - b[1]);
    // Only show animated parcels when zoomed into a cluster (3+ nearby)
    const nearest = scored.length >= 3
      ? scored.slice(0, MAX_ANIM_PARCELS).map(s => s[0])
      : [];
    const newIds = nearest.map(p => p.tokenId).join(',');
    const oldIds = nearParcels.map(p => p.tokenId).join(',');
    if (newIds !== oldIds) setNearParcels(nearest);
  });

  return (
    <group>
      {nearParcels.map(p => (
        <AnimatedParcel key={p.tokenId} parcel={p} normalization={normalization} />
      ))}
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
          <AnimOverlay
            parcels={parcels}
            terrainData={terrainData}
            cameraRef={cameraRef}
            normalization={normalization}
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
