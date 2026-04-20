/* eslint-disable react/no-unknown-property, @typescript-eslint/strict-boolean-expressions */
/**
 * TerrainView — 3D terrain renderer for Terraforms parcels.
 *
 * Renders all parcels as atlas-mapped instanced planes (single draw call).
 * LOD: Nearest ~12 parcels get animated ASCII character overlays,
 * distant parcels stay as atlas-textured terrain.
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
// 1px per cell — one pixel per ASCII char. Atlas = 3200×3200 (~40 MB) which
// fits well under the 4096² mobile WebGL cap. From distance the colored pixel
// pattern reads as ASCII art; up close the CharTerrain overlay paints real glyphs.
const CELL_PX = 1;
const ATLAS_COLS = 100; // 100×100 grid = 3200×3200px atlas

const tempObj = new THREE.Object3D();

type TokenEntry = [string, string[], string, Record<string, string>];

// ─── Mathcastles Font Loader ──────────────────────────────────────────────
// Load the onchain WOFF font so canvas fillText renders exact characters
const FONT_NAME = 'MathcastlesRemix';
// Self-executing font loader — loads once on module init
(async () => {
  try {
    const font = new FontFace(FONT_NAME, 'url(/data/terraforms-font.woff)');
    await font.load();
    document.fonts.add(font);
  } catch {
    console.warn('Mathcastles font not available, using monospace fallback');
  }
})();

// ─── Texture Atlas (all 9,910 parcels in one texture) ─────────────────────

/**
 * Build a single atlas texture containing all parcel arts as flat ASCII cards.
 * Each parcel gets a CELL_PX*32 × CELL_PX*32 tile in a 100×100 grid.
 * Each cell renders the actual ASCII glyph (from the parcel's chars map) on a
 * transparent background so flat planes look like ASCII art when seen from above.
 * Returns { colorTex, uvMap } where uvMap maps tokenId → [u, v].
 */
function buildAtlas(
  parcels: ParcelData[],
  terrainData: TerrainData,
): {
  colorTex: THREE.CanvasTexture;
  uvMap: Map<number, [number, number]>;
} {
  const tileSize = CELL_PX * GRID_SIZE; // 32px per parcel (1px cells × 32 grid)
  const atlasSize = ATLAS_COLS * tileSize; // 3200px

  // Color atlas — colored dots-on-transparent that READ as ASCII pixelation
  // from any zoom level. The actual animated chars come from the near-set
  // CharTerrain overlay; this layer just contributes the silhouette + palette.
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = atlasSize;
  colorCanvas.height = atlasSize;
  const colorCtx = colorCanvas.getContext('2d', { alpha: true })!;
  colorCtx.clearRect(0, 0, atlasSize, atlasSize);

  const uvMap = new Map<number, [number, number]>();

  // Use ImageData fast path — 6400² canvas is too slow to fill with thousands
  // of fillRect calls. Direct pixel writes are ~50× quicker.
  const imgData = colorCtx.getImageData(0, 0, atlasSize, atlasSize);
  const px8 = imgData.data;

  const hexToRGB = (hex: string): [number, number, number] => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  // Pre-resolve which class indices have a non-blank glyph per parcel — empty
  // glyphs paint fully transparent (chars[k] === ' ') so the silhouette shows
  // gaps where the original ASCII art has gaps.
  let slot = 0;
  for (const p of parcels) {
    const td = terrainData.tokens[p.tokenId] as TokenEntry | undefined;
    if (!td) continue;

    const tileCol = slot % ATLAS_COLS;
    const tileRow = Math.floor(slot / ATLAS_COLS);
    const ox = tileCol * tileSize;
    const oy = tileRow * tileSize;

    const [bg, palette, classGrid, chars] = td;
    const bgRGB = hexToRGB(bg || '#000000');

    // Per-class: cached "is this glyph blank?" + RGB
    const blankByClass = new Uint8Array(10);
    const rgbByClass: Array<[number, number, number]> = new Array(10);
    for (let i = 0; i < 10; i++) {
      const k = String.fromCharCode(97 + i);
      const g = chars[k];
      blankByClass[i] = g && g !== ' ' ? 0 : 1;
      rgbByClass[i] = hexToRGB(palette[i] || '#fff');
    }

    // Fill tile with parcel's onchain bg color first — Terraforms NFTs aren't
    // transparent, they have a solid colored backdrop behind the chars.
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const xx = ox + c * CELL_PX;
        const yy = oy + r * CELL_PX;
        const i4 = (yy * atlasSize + xx) * 4;
        px8[i4] = bgRGB[0];
        px8[i4 + 1] = bgRGB[1];
        px8[i4 + 2] = bgRGB[2];
        px8[i4 + 3] = 255;
      }
    }

    // Now overlay the colored chars on top of the bg.
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const clsIdx = (classGrid.charCodeAt(r * GRID_SIZE + c) - 97) & 0x0f;
        if (clsIdx > 9 || blankByClass[clsIdx]) continue; // bg shows through where char is blank
        const rgb = rgbByClass[clsIdx];
        const xx = ox + c * CELL_PX;
        const yy = oy + r * CELL_PX;
        const i4 = (yy * atlasSize + xx) * 4;
        px8[i4] = rgb[0];
        px8[i4 + 1] = rgb[1];
        px8[i4 + 2] = rgb[2];
        px8[i4 + 3] = 255;
      }
    }

    uvMap.set(p.tokenId, [tileCol / ATLAS_COLS, tileRow / ATLAS_COLS]);
    slot++;
  }

  colorCtx.putImageData(imgData, 0, 0);

  console.log('Atlas built:', { slots: slot, uvMapSize: uvMap.size, atlasSize, tileSize });

  const colorTex = new THREE.CanvasTexture(colorCanvas);
  colorTex.magFilter = THREE.LinearFilter;
  colorTex.minFilter = THREE.LinearMipmapLinearFilter;
  colorTex.generateMipmaps = true;
  colorTex.colorSpace = THREE.SRGBColorSpace;

  return { colorTex, uvMap };
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
  hiddenParcelIds,
}: {
  parcels: ParcelData[];
  terrainData: TerrainData;
  normalization: { cx: number; cy: number; cz: number; scale: number };
  onClickParcel: (id: number) => void;
  hoveredId: number | null;
  setHoveredId: (id: number | null) => void;
  heightScale: number;
  hiddenParcelIds: Set<number>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const idMapRef = useRef<number[]>([]);
  // Track previous hidden set for diff-only matrix mutations
  const prevHiddenRef = useRef<Set<number>>(new Set());
  // Cache the "shown" matrix per index so we can restore quickly when unhiding
  const baseMatrixRef = useRef<Float32Array | null>(null);

  // Build atlas once when both parcels + terrainData are ready
  const atlas = useMemo(
    () => buildAtlas(parcels, terrainData),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parcels.length, terrainData], // only rebuild when data actually changes, not on hover
  );

  // Custom shader: flat ASCII atlas card — no extrusion, no per-vertex displacement.
  // Each instance is a single textured plane. Transparent bg + alphaTest so empty
  // cells in the ASCII art see through to whatever's behind.
  const material = useMemo(() => {
    const uvScale = 1 / ATLAS_COLS;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        colorAtlas: { value: atlas.colorTex },
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
        uniform sampler2D colorAtlas;
        varying vec2 vUv;
        void main() {
          vec4 col = texture2D(colorAtlas, vUv);
          if (col.a < 0.5) discard;
          gl_FragColor = col;
        }
      `,
      side: THREE.DoubleSide,
      // Opaque + alpha-discard rather than `transparent: true` — prevents
      // z-fighting flicker between coplanar parcels (InstancedMesh doesn't
      // sort transparent instances per-frame, so the transparent pass would
      // render them in arbitrary order and flicker).
      transparent: false,
      depthWrite: true,
    });
    return mat;
  }, [atlas]);
  // heightScale no longer affects this layer — flat cards by design.
  // (NearbyCharOverlay still consumes heightScale for animated voxel layer.)
  void heightScale;

  // Set up instances
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || parcels.length === 0) return;

    const { cx, cy, cz, scale } = normalization;
    const ids: number[] = [];
    const offsets = new Float32Array(parcels.length * 2);
    // Cache base matrices (each is 16 floats) so we can swap visible/hidden cheaply.
    const base = new Float32Array(parcels.length * 16);

    let mapped = 0;
    for (let i = 0; i < parcels.length; i++) {
      const p = parcels[i];
      const uv = atlas.uvMap.get(p.tokenId);

      if (!uv) {
        // No terrain data — hide this instance completely
        tempObj.position.set(0, -9999, 0);
        tempObj.scale.setScalar(0);
        tempObj.rotation.set(0, 0, 0);
        tempObj.updateMatrix();
        mesh.setMatrixAt(i, tempObj.matrix);
        for (let k = 0; k < 16; k++) base[i * 16 + k] = tempObj.matrix.elements[k];
        offsets[i * 2] = 0;
        offsets[i * 2 + 1] = 0;
        ids.push(p.tokenId);
        continue;
      }

      mapped++;
      // Terraforms structureSpace is Z-up; Three.js is Y-up. Swap sy ↔ sz.
      tempObj.position.set((p.sx - cx) * scale, (p.sz - cz) * scale, (p.sy - cy) * scale);
      tempObj.rotation.set(-Math.PI / 2, 0, 0);
      tempObj.scale.setScalar(hoveredId === p.tokenId ? 1.6 : 1.0);
      tempObj.updateMatrix();
      mesh.setMatrixAt(i, tempObj.matrix);
      for (let k = 0; k < 16; k++) base[i * 16 + k] = tempObj.matrix.elements[k];

      offsets[i * 2] = uv[0];
      offsets[i * 2 + 1] = uv[1];
      ids.push(p.tokenId);
    }

    if (mapped === 0) {
      console.warn(
        'TerrainView: 0 parcels mapped to atlas. uvMap size:',
        atlas.uvMap.size,
        'parcels:',
        parcels.length,
      );
    }

    // Set per-instance UV offset attribute
    const uvAttr = new THREE.InstancedBufferAttribute(offsets, 2);
    mesh.geometry.setAttribute('uvOffset', uvAttr);

    idMapRef.current = ids;
    baseMatrixRef.current = base;
    // Reapply any current hidden ids on top of the fresh base — otherwise a near-set
    // membership change that already fired before this rebuild would be lost.
    prevHiddenRef.current = new Set();
    for (const id of hiddenParcelIds) {
      const i = ids.indexOf(id);
      if (i < 0) continue;
      tempObj.position.set(0, -9999, 0);
      tempObj.rotation.set(0, 0, 0);
      tempObj.scale.setScalar(0);
      tempObj.updateMatrix();
      mesh.setMatrixAt(i, tempObj.matrix);
    }
    prevHiddenRef.current = new Set(hiddenParcelIds);

    mesh.instanceMatrix.needsUpdate = true;
    console.log('Instances set:', mapped, 'mapped,', parcels.length - mapped, 'hidden');
    // Progressive top-down reveal — start at 0, ramp up to full count over
    // ~1.6s so the castle visibly grows from the top peak downward (parcels
    // are pre-sorted by sz descending in useHypercastleData).
    mesh.count = 0;
    const start = performance.now();
    const total = parcels.length;
    const DURATION = 1600;
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / DURATION);
      // Ease-out cubic for snappier early reveal
      const eased = 1 - Math.pow(1 - t, 3);
      mesh.count = Math.floor(eased * total);
      if (t < 1) raf = requestAnimationFrame(tick);
      else mesh.count = total;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcels.length, normalization, atlas]); // NO hoveredId — don't rebuild 9910 matrices on hover

  // Visibility filter — hide near-set parcels (the ones drawn as live ASCII voxel terrain)
  // so the colored atlas mesh doesn't leak through underneath. Diff-only mutations:
  // we only touch instances whose membership in the hidden set actually changed.
  useEffect(() => {
    const mesh = meshRef.current;
    const base = baseMatrixRef.current;
    const ids = idMapRef.current;
    if (!mesh || !base || ids.length === 0) return;

    const prev = prevHiddenRef.current;
    const next = hiddenParcelIds;

    // Build id → instance index map only when needed (small, cached per call)
    const idIndex = new Map<number, number>();
    for (let i = 0; i < ids.length; i++) idIndex.set(ids[i], i);

    let touched = 0;

    // Newly hidden — set scale 0 and park offscreen
    for (const id of next) {
      if (prev.has(id)) continue;
      const i = idIndex.get(id);
      if (i === undefined) continue;
      tempObj.position.set(0, -9999, 0);
      tempObj.rotation.set(0, 0, 0);
      tempObj.scale.setScalar(0);
      tempObj.updateMatrix();
      mesh.setMatrixAt(i, tempObj.matrix);
      touched++;
    }

    // Newly unhidden — restore base matrix
    for (const id of prev) {
      if (next.has(id)) continue;
      const i = idIndex.get(id);
      if (i === undefined) continue;
      const off = i * 16;
      tempObj.matrix.fromArray(base, off);
      mesh.setMatrixAt(i, tempObj.matrix);
      touched++;
    }

    if (touched > 0) {
      mesh.instanceMatrix.needsUpdate = true;
    }
    prevHiddenRef.current = new Set(next);
  }, [hiddenParcelIds]);

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (e.instanceId !== undefined && idMapRef.current[e.instanceId]) {
        setHoveredId(idMapRef.current[e.instanceId]);
      }
    },
    [setHoveredId],
  );

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.instanceId !== undefined && idMapRef.current[e.instanceId]) {
        onClickParcel(idMapRef.current[e.instanceId]);
      }
    },
    [onClickParcel],
  );

  // Memoize geometry so R3F doesn't recreate the instanced mesh on every render.
  // 1×1 plane (no segments) — we no longer displace vertices, so segments are wasted.
  const geometry = useMemo(() => new THREE.PlaneGeometry(PARCEL_SIZE, PARCEL_SIZE), []);

  if (parcels.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, parcels.length]}
      frustumCulled={false}
      onPointerMove={handlePointerMove}
      onPointerOut={() => setHoveredId(null)}
      onClick={handleClick}
    />
  );
}

// ─── ASCII Character Terrain (nearest parcels) ───────────────────────────
//
// Each near-camera parcel = ONE tilted plane with a 32×32 ASCII canvas painted
// at ~6fps. Characters cycle per cell using onchain-style time/position formula
// (charIndex = floor(0.25*t + h + 0.5*col + 0.1*DIR*row) % chars.length).
// Chars are sharp and readable at parcel-close zoom.

// ─── Per-cell glyph instance constants ──────────────────────────────────────
// One small textured quad per cell. The atlas holds (glyphList.length * 10 palette)
// tiles painted as colored glyphs on transparent bg. Each instance picks a tile by
// (currentGlyphIdx, classIdx) and the picked tile cycles each animation tick.
// Cell footprint = PARCEL_SIZE / GRID_SIZE. Quads are slightly smaller so chars
// don't visually touch — gives the airy "floating chars" look the user wants.
const CELL_SIZE = PARCEL_SIZE / GRID_SIZE;
const QUAD_SIZE = CELL_SIZE * 0.95;
const VOXEL_HEIGHT_UNIT = PARCEL_SIZE * 0.04; // 9 * unit ≈ 36% of parcel width at peak
const PALETTE_LEN = 10; // a..j
const TILE_PX = 64; // one glyph tile = 64×64 px (sharp at near zoom, manageable atlas)

/**
 * Build a per-parcel glyph atlas: rows = palette classes (10), cols = glyphList.
 * Returns the texture + dimensions so the animation loop can encode UVs cheaply.
 * Background is transparent; only the colored glyph pixels are opaque.
 */
function buildGlyphAtlas(
  glyphList: string[],
  palette: string[],
): { texture: THREE.CanvasTexture; cols: number; rows: number } {
  const cols = glyphList.length;
  const rows = PALETTE_LEN;
  const canvas = document.createElement('canvas');
  canvas.width = cols * TILE_PX;
  canvas.height = rows * TILE_PX;
  const ctx = canvas.getContext('2d', { alpha: true })!;
  // Transparent background — leave canvas cleared
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${Math.floor(TILE_PX * 0.95)}px '${FONT_NAME}', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let ci = 0; ci < rows; ci++) {
    ctx.fillStyle = palette[ci] || '#fff';
    for (let gi = 0; gi < cols; gi++) {
      const x = gi * TILE_PX + TILE_PX / 2;
      const y = ci * TILE_PX + TILE_PX / 2;
      ctx.fillText(glyphList[gi], x, y);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  return { texture: tex, cols, rows };
}

/**
 * One parcel rendered as 1024 instanced glyph quads — each cell is its OWN
 * floating textured plane at its class-derived height. Background between
 * quads is fully transparent. No solid plate, no continuous surface.
 *
 * Per-cell glyph cycles via shifting the instance's UV offset (pointing at a
 * different column of the per-parcel glyph atlas). Heights also shift each
 * tick because the picked glyph's "row position" in the glyph list ripples
 * through the diagonal wave formula.
 */
function CharTerrain({
  parcel,
  tokenData,
  normalization,
  heightScale,
}: {
  parcel: ParcelData;
  tokenData: TokenEntry;
  normalization: { cx: number; cy: number; cz: number; scale: number };
  heightScale: number;
}) {
  const { cx, cy, cz, scale } = normalization;
  const px = (parcel.sx - cx) * scale;
  const py = (parcel.sz - cz) * scale;
  const pz = (parcel.sy - cy) * scale;
  // Sit just above the atlas-extruded base so we don't z-fight when the atlas
  // mesh for this parcel briefly shows during membership transitions.
  const liftY = Math.max(0.05, heightScale + 0.05);

  // Pre-compute per-cell metadata
  const cellMeta = useMemo(() => {
    const [, palette, classGrid, chars] = tokenData;
    const glyphList: string[] = [];
    for (let i = 0; i < 10; i++) {
      const k = String.fromCharCode(97 + i);
      const g = chars[k];
      if (g && g !== ' ') glyphList.push(g);
    }
    if (glyphList.length === 0) glyphList.push('.');
    const N = GRID_SIZE * GRID_SIZE;
    const clsIdx = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      clsIdx[i] = (classGrid.charCodeAt(i) - 97) & 0x0f;
    }
    return { palette, clsIdx, glyphList };
  }, [tokenData]);

  // Build the per-parcel glyph atlas once
  const atlas = useMemo(
    () => buildGlyphAtlas(cellMeta.glyphList, cellMeta.palette as string[]),
    [cellMeta],
  );

  // Geometry: a single PlaneGeometry — InstancedMesh replicates it 1024 times.
  // Each instance gets its own matrix (position+scale) and uvOffset attribute.
  const geom = useMemo(() => new THREE.PlaneGeometry(QUAD_SIZE, QUAD_SIZE), []);

  // ShaderMaterial: standard textured + alpha test, but with per-instance uvOffset
  // attribute to address into the atlas. Transparent everywhere except the glyph.
  const material = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        atlas: { value: atlas.texture },
        uTileSize: { value: new THREE.Vector2(1 / atlas.cols, 1 / atlas.rows) },
      },
      vertexShader: `
        attribute vec2 uvOffset;
        varying vec2 vUv;
        uniform vec2 uTileSize;
        void main() {
          vUv = uv * uTileSize + uvOffset;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D atlas;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(atlas, vUv);
          if (c.a < 0.5) discard;
          gl_FragColor = c;
        }
      `,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
    });
    return m;
  }, [atlas]);

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const N = GRID_SIZE * GRID_SIZE;
  // Per-instance uvOffset attribute storage (we mutate this each tick)
  const uvOffsetsRef = useRef<Float32Array>(new Float32Array(N * 2));

  // Sync init right after mount so the first paint already shows positioned
  // glyphs (no 1-frame flicker of 1024 stacked quads at origin).
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const attr = new THREE.InstancedBufferAttribute(uvOffsetsRef.current, 2);
    attr.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('uvOffset', attr);
    // Run one tick of layout so the very first paint shows the parcel.
    runTick(0);
    mesh.instanceMatrix.needsUpdate = true;
    attr.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atlas, geom, material]);

  // Layout one tick — called from init effect and the throttled animation loop.
  const runTick = (t: number) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const { clsIdx, glyphList } = cellMeta;
    const len = glyphList.length;
    const tileU = 1 / atlas.cols;
    const tileV = 1 / atlas.rows;
    const uvs = uvOffsetsRef.current;
    const half = (GRID_SIZE - 1) / 2;

    for (let row = 0; row < GRID_SIZE; row++) {
      const DIR = row % 2 === 0 ? 1 : -1;
      for (let col = 0; col < GRID_SIZE; col++) {
        const i = row * GRID_SIZE + col;
        const ci = clsIdx[i];
        const baseH = 9 - ci;
        const wave = Math.floor(0.25 * t + baseH + 0.5 * col + 0.1 * DIR * row);
        const gIdx = ((wave % len) + len) % len;
        const ripple = ((wave % 3) + 3) % 3;
        const h = (baseH + ripple * 0.25) * VOXEL_HEIGHT_UNIT;

        const lx = (col - half) * CELL_SIZE;
        const lz = (row - half) * CELL_SIZE;
        const ly = h;

        tempObj.position.set(lx, ly, lz);
        // Tilt -π/2 around X makes the plane lie flat (face +Y), so glyphs are
        // visible from above. doubleSide ensures they're also visible from below.
        tempObj.rotation.set(-Math.PI / 2, 0, 0);
        tempObj.scale.setScalar(1);
        tempObj.updateMatrix();
        mesh.setMatrixAt(i, tempObj.matrix);

        uvs[i * 2] = gIdx * tileU;
        // CanvasTexture defaults to flipY=true: V=0 maps to canvas bottom (last
        // class row painted), so invert to point at the right palette row.
        uvs[i * 2 + 1] = (PALETTE_LEN - 1 - ci) * tileV;
      }
    }
  };

  const tickRef = useRef(0);
  const frameRef = useRef(0);
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    frameRef.current++;
    if (frameRef.current % 6 !== 0) return;
    tickRef.current++;
    runTick(tickRef.current);
    mesh.instanceMatrix.needsUpdate = true;
    const uvAttr = mesh.geometry.getAttribute('uvOffset') as THREE.InstancedBufferAttribute;
    if (uvAttr) uvAttr.needsUpdate = true;
  });

  // Cleanup
  useEffect(() => {
    return () => {
      atlas.texture.dispose();
      geom.dispose();
      material.dispose();
    };
  }, [atlas, geom, material]);

  return (
    <group position={[px, py + liftY, pz]}>
      <instancedMesh
        ref={meshRef}
        args={[geom, material, N]}
        frustumCulled={false}
        raycast={() => {}}
      />
    </group>
  );
}

// ─── Camera-distance ASCII overlay (LOD: nearby = animated chars, far = atlas) ─

const CHAR_RENDER_DISTANCE = 70; // scene units — show ASCII within this range
const MAX_CHAR_PARCELS = 300; // cap to keep it lightweight (each parcel = 1 plane + 1 canvas)

/**
 * Wrapper that owns the shared "near set" state so the atlas-instanced layer
 * can hide parcels currently being rendered as live ASCII voxel terrain
 * (otherwise the colored extrusion leaks through underneath the chars).
 */
function TerrainLayers({
  parcels,
  terrainData,
  normalization,
  onClickParcel,
  hoveredId,
  setHoveredId,
  heightScale,
}: {
  parcels: ParcelData[];
  terrainData: TerrainData;
  normalization: { cx: number; cy: number; cz: number; scale: number };
  onClickParcel: (id: number) => void;
  hoveredId: number | null;
  setHoveredId: (id: number | null) => void;
  heightScale: number;
}) {
  // Identity of the current near set. Updated by NearbyCharOverlay only when
  // membership actually changes (not every frame), so AllParcelsInstanced
  // re-runs its visibility-diff effect rarely.
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(() => new Set());

  return (
    <>
      <AllParcelsInstanced
        parcels={parcels}
        terrainData={terrainData}
        normalization={normalization}
        onClickParcel={onClickParcel}
        hoveredId={hoveredId}
        setHoveredId={setHoveredId}
        heightScale={heightScale}
        hiddenParcelIds={hiddenIds}
      />
      <NearbyCharOverlay
        parcels={parcels}
        terrainData={terrainData}
        normalization={normalization}
        heightScale={heightScale}
        onNearSetChange={setHiddenIds}
      />
    </>
  );
}

function NearbyCharOverlay({
  parcels,
  terrainData,
  normalization,
  heightScale,
  onNearSetChange,
}: {
  parcels: ParcelData[];
  terrainData: TerrainData;
  normalization: { cx: number; cy: number; cz: number; scale: number };
  heightScale: number;
  onNearSetChange: (ids: Set<number>) => void;
}) {
  const [nearParcels, setNearParcels] = useState<ParcelData[]>([]);

  useFrame(({ camera }) => {
    const { cx, cy, cz, scale } = normalization;
    const camPos = camera.position;
    // Camera forward vector for view-cone filtering — render parcels the
    // camera is LOOKING AT (tunnel of detail in view direction), not the
    // ones surrounding the camera.
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);

    const scored: [ParcelData, number][] = [];
    for (const p of parcels) {
      if (!terrainData.tokens[p.tokenId]) continue;
      const px = (p.sx - cx) * scale;
      const py = (p.sz - cz) * scale;
      const pz = (p.sy - cy) * scale;
      const dx = px - camPos.x;
      const dy = py - camPos.y;
      const dz = pz - camPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist >= CHAR_RENDER_DISTANCE) continue;
      if (dist < 0.5) continue;
      // Dot product of (parcel-from-camera) ⋅ (camera-forward).
      // > 0 = parcel in front of camera (full forward hemisphere).
      const dot = (dx * camDir.x + dy * camDir.y + dz * camDir.z) / dist;
      if (dot < 0) continue;
      scored.push([p, dist]);
    }
    scored.sort((a, b) => a[1] - b[1]);
    const nearest = scored.slice(0, MAX_CHAR_PARCELS).map(s => s[0]);
    // Only update state if the set actually changed (membership, not order)
    const ids = nearest
      .map(p => p.tokenId)
      .sort()
      .join(',');
    const prevIds = nearParcels
      .map(p => p.tokenId)
      .sort()
      .join(',');
    if (ids !== prevIds) {
      setNearParcels(nearest);
      onNearSetChange(new Set(nearest.map(p => p.tokenId)));
    }
  });

  return (
    <group>
      {nearParcels.map(p => {
        const td = terrainData.tokens[p.tokenId] as TokenEntry | undefined;
        if (!td) return null;
        return (
          <CharTerrain
            key={p.tokenId}
            parcel={p}
            tokenData={td}
            normalization={normalization}
            heightScale={heightScale}
          />
        );
      })}
    </group>
  );
}

/** Exports the R3F camera to external state for Teleport button. */
function CameraSync({ onCamera }: { onCamera: (cam: THREE.Camera) => void }) {
  const { camera } = useThree();
  useEffect(() => {
    onCamera(camera);
  }, [camera, onCamera]);
  return null;
}

// ─── Scene ─────────────────────────────────────────────────────────────────

const TerrainScene: FC<TerrainViewProps & { heightScale: number; bloomIntensity: number }> = ({
  parcels,
  terrainData,
  onClickParcel,
  hoveredId,
  setHoveredId,
  heightScale,
  bloomIntensity,
}) => {
  const normalization = useMemo(() => {
    if (parcels.length === 0) return { cx: 0, cy: 0, cz: 0, scale: 1 };
    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;
    let minZ = Infinity,
      maxZ = -Infinity;
    for (const p of parcels) {
      if (p.sx < minX) minX = p.sx;
      if (p.sx > maxX) maxX = p.sx;
      if (p.sy < minY) minY = p.sy;
      if (p.sy > maxY) maxY = p.sy;
      if (p.sz < minZ) minZ = p.sz;
      if (p.sz > maxZ) maxZ = p.sz;
    }
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      cz: (minZ + maxZ) / 2,
      scale: 80 / Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1),
    };
  }, [parcels]);

  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[50, 80, 30]} intensity={0.6} />
      <pointLight position={[0, 50, 0]} intensity={0.4} color="#4466ff" />
      <pointLight position={[-30, 20, -30]} intensity={0.2} color="#ff4466" />

      {terrainData && (
        <TerrainLayers
          parcels={parcels}
          terrainData={terrainData}
          normalization={normalization}
          onClickParcel={onClickParcel}
          hoveredId={hoveredId}
          setHoveredId={setHoveredId}
          heightScale={heightScale}
        />
      )}

      <OrbitControls
        enableDamping
        dampingFactor={0.06}
        autoRotate
        autoRotateSpeed={0.15}
        minDistance={0.5}
        maxDistance={300}
        enablePan
        target={[0, 40, 0]}
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

// ─── Main Export ──────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = { height: 0.5, bloom: 0 };
const DEEP_FRIED = { height: 0.7, bloom: 1.0 };

const TerrainViewCanvas: FC<{
  parcels: ParcelData[];
  terrainData: TerrainData | null;
  onClickParcel: (id: number) => void;
  hoveredId: number | null;
  setHoveredId: (id: number | null) => void;
}> = props => {
  const [fried, setFried] = useState(false);
  const s = fried ? DEEP_FRIED : DEFAULT_SETTINGS;
  const containerRef = useRef<HTMLDivElement>(null);
  const [liveCamera, setLiveCamera] = useState<THREE.Camera | null>(null);

  // Compute normalization here too (same as TerrainScene) for CSS3D layer
  const normalization = useMemo(() => {
    if (props.parcels.length === 0) return { cx: 0, cy: 0, cz: 0, scale: 1 };
    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;
    let minZ = Infinity,
      maxZ = -Infinity;
    for (const p of props.parcels) {
      if (p.sx < minX) minX = p.sx;
      if (p.sx > maxX) maxX = p.sx;
      if (p.sy < minY) minY = p.sy;
      if (p.sy > maxY) maxY = p.sy;
      if (p.sz < minZ) minZ = p.sz;
      if (p.sz > maxZ) maxZ = p.sz;
    }
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      cz: (minZ + maxZ) / 2,
      scale: 80 / Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1),
    };
  }, [props.parcels]);

  // Spawn camera DIRECTLY above the top peak looking straight down — clouds
  // and mountains live at the highest sz parcels and read best from a true
  // top-down view. Tiny Z offset avoids OrbitControls' axial gimbal lock.
  const spawnPos = useMemo(() => {
    return [0, 42, 0.01] as [number, number, number];
  }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: spawnPos, fov: 60 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl, camera }) => {
          gl.setClearColor('#050510');
          setLiveCamera(camera);
        }}
        style={{ cursor: props.hoveredId ? 'pointer' : 'grab' }}
      >
        <TerrainScene {...props} heightScale={s.height} bloomIntensity={s.bloom} />
        <CameraSync onCamera={setLiveCamera} />
      </Canvas>

      {/* CSS3D overlay disabled — was causing blue blob + potential rendering issues */}

      {/* Controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 20,
          right: 20,
          zIndex: 10,
          display: 'flex',
          gap: 8,
        }}
      >
        <button
          onClick={() => {
            if (liveCamera && props.parcels.length > 0) {
              const { cx, cy, cz, scale } = normalization;
              const rp = props.parcels[Math.floor(Math.random() * props.parcels.length)];
              const px = (rp.sx - cx) * scale;
              const py = (rp.sz - cz) * scale;
              const pz = (rp.sy - cy) * scale;
              liveCamera.position.set(px + 2, py + 3, pz + 2);
              liveCamera.lookAt(px, py, pz);
            }
          }}
          style={{
            padding: '6px 14px',
            borderRadius: 8,
            border: '1px solid #334155',
            background: '#1e293b',
            color: '#94a3b8',
            fontSize: '0.65rem',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontWeight: 700,
          }}
        >
          Teleport
        </button>
        <button
          onClick={() => setFried(!fried)}
          style={{
            padding: '6px 14px',
            borderRadius: 8,
            border: fried ? '1px solid #f59e0b' : '1px solid #334155',
            background: fried ? '#78350f' : '#1e293b',
            color: fried ? '#fbbf24' : '#94a3b8',
            fontSize: '0.65rem',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontWeight: 700,
          }}
        >
          {fried ? '🔥 DEEP FRIED' : 'Deep Fry'}
        </button>
      </div>
    </div>
  );
};

export default TerrainViewCanvas;
