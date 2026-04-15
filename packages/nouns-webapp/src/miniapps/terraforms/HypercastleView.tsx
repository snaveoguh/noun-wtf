/**
 * HypercastleView — 3D visualization of all 9,910 Terraforms parcels
 * positioned in the Hypercastle structure using their onchain coordinates.
 *
 * Progressively loads token metadata via batched multicall,
 * renders each parcel as a colored cube at its structureSpace position.
 * Click a parcel to navigate to its detail view.
 */
import { FC, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { OrbitControls } from '@react-three/drei';
import { Canvas, ThreeEvent } from '@react-three/fiber';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNavigate } from 'react-router';
import * as THREE from 'three';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

import { useTerrainData } from './TerrainView';
import type { TerrainData } from './TerrainView';

const TerrainViewCanvas = lazy(() => import('./TerrainView'));

type ViewMode = 'terrain' | 'lofi' | 'grid';

// ─── Constants ──────────────────────────────────────────────────────────────

const TERRAFORMS_ADDRESS = '0x4E1f41613c9084FdB9E34E11fAE9412427480e56' as const;
const TOTAL_SUPPLY = 9910;

// Zone colors for parcels that haven't loaded yet (gradient by level)
const LEVEL_COLORS = [
  '#4a1942', '#5c1f5c', '#6e2576', '#802b90', '#9231aa',
  '#7b3fc4', '#644dde', '#4d5bf8', '#3669ff', '#1f77ff',
  '#0885ff', '#0093e6', '#00a1cc', '#00afb3', '#00bd99',
  '#00cb80', '#00d966', '#00e74d', '#00f533', '#00ff1a',
];

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(import.meta.env.VITE_MAINNET_JSONRPC || 'https://mainnet.rpc.buidlguidl.com'),
});

// ─── Types ──────────────────────────────────────────────────────────────────

interface ParcelData {
  tokenId: number;
  level: number;
  x: number;
  y: number;
  elevation: number;
  sx: number; // structureSpaceX
  sy: number; // structureSpaceY
  sz: number; // structureSpaceZ
  zoneName: string;
  color: string; // primary zone color
}

// ─── Data fetching with localStorage cache ──────────────────────────────────

const CACHE_KEY = 'terraforms_hypercastle_v1';
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days

function loadCache(): ParcelData[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > CACHE_EXPIRY) {
      localStorage.removeItem(CACHE_KEY);
      return [];
    }
    return data;
  } catch {
    return [];
  }
}

function saveCache(data: ParcelData[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      data,
      timestamp: Date.now(),
    }));
  } catch { /* quota exceeded, ignore */ }
}

/** Load all 9,909 parcels from static JSON (extracted from ThousandAnt's Hypercastle Explorer). */
function useHypercastleData() {
  const [parcels, setParcels] = useState<ParcelData[]>(() => loadCache());
  const [loadedCount, setLoadedCount] = useState(() => loadCache().length);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Already loaded from cache on init?
    if (parcels.length >= TOTAL_SUPPLY - 10) return; // -10 tolerance (JSON has 9909 vs 9910)

    setIsLoading(true);
    fetch('/data/hypercastle.json')
      .then(r => { if (!r.ok) throw new Error('Not found'); return r.json(); })
      .then((data: { terraformRecords: any[] }) => {
        const mapped: ParcelData[] = data.terraformRecords.map((r: any) => {
          const level = r.TerraformAttributes?.Level ?? 0;
          const colors = (r.ZoneColors || []).filter((c: string) => c.length > 0);
          return {
            tokenId: r.TokenId,
            level,
            x: r.TerraformAttributes?.XCoordinate ?? 0,
            y: r.TerraformAttributes?.YCoordinate ?? 0,
            elevation: 0,
            sx: r.StructureSpaceX,
            sy: r.StructureSpaceY,
            sz: r.StructureSpaceZ,
            zoneName: r.TerraformAttributes?.Zone ?? '',
            color: colors[0] || LEVEL_COLORS[Math.min(level - 1, 19)],
          };
        });
        setParcels(mapped);
        setLoadedCount(mapped.length);
        saveCache(mapped);
      })
      .catch(err => {
        console.warn('Failed to load hypercastle.json, falling back to cache:', err);
        if (cached.length > 0) {
          setParcels(cached);
          setLoadedCount(cached.length);
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  return { parcels, loadedCount, isLoading, total: TOTAL_SUPPLY };
}

// ─── 3D Scene Components ────────────────────────────────────────────────────

const tempObj = new THREE.Object3D();
const tempColor = new THREE.Color();

function ParcelInstances({
  parcels,
  onClickParcel,
  hoveredId,
  setHoveredId,
}: {
  parcels: ParcelData[];
  onClickParcel: (id: number) => void;
  hoveredId: number | null;
  setHoveredId: (id: number | null) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const idMapRef = useRef<number[]>([]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || parcels.length === 0) return;

    // Compute bounding box to center + scale the scene
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const p of parcels) {
      if (p.sx < minX) minX = p.sx; if (p.sx > maxX) maxX = p.sx;
      if (p.sy < minY) minY = p.sy; if (p.sy > maxY) maxY = p.sy;
      if (p.sz < minZ) minZ = p.sz; if (p.sz > maxZ) maxZ = p.sz;
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const range = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
    const scale = 80 / range; // normalize to ~80 unit cube

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
      if (hoveredId === p.tokenId) {
        tempColor.multiplyScalar(1.5);
      }
      mesh.setColorAt(i, tempColor);
      ids.push(p.tokenId);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    idMapRef.current = ids;
  }, [parcels, hoveredId]);

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined && idMapRef.current[e.instanceId]) {
      setHoveredId(idMapRef.current[e.instanceId]);
    }
  }, [setHoveredId]);

  const handlePointerOut = useCallback(() => {
    setHoveredId(null);
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
      onPointerOut={handlePointerOut}
      onClick={handleClick}
    >
      <boxGeometry args={[0.85, 0.85, 0.85]} />
      <meshStandardMaterial roughness={0.4} metalness={0.1} />
    </instancedMesh>
  );
}

// HoverLabel is rendered as a DOM overlay (see bottom bar in the main component)

// ─── Main Component ─────────────────────────────────────────────────────────

// ─── View Mode Tab Button ──────────────────────────────────────────────────

const TabButton: FC<{
  label: string;
  active: boolean;
  onClick: () => void;
}> = ({ label, active, onClick }) => (
  <button
    onClick={onClick}
    style={{
      padding: '4px 12px', borderRadius: 6,
      border: active ? '1px solid #475569' : '1px solid transparent',
      background: active ? '#1e293b' : 'transparent',
      color: active ? '#e2e8f0' : '#64748b',
      fontSize: '0.65rem', cursor: 'pointer',
      fontFamily: 'monospace', fontWeight: active ? 700 : 400,
      transition: 'all 0.15s',
    }}
  >
    {label}
  </button>
);

// ─── tokenHTML batch fetcher ───────────────────────────────────────────────

const TOKEN_HTML_ABI = [{
  name: 'tokenHTML',
  type: 'function' as const,
  stateMutability: 'view' as const,
  inputs: [{ name: 'tokenId', type: 'uint256' }] as const,
  outputs: [{ name: '', type: 'string' }] as const,
}] as const;

function useTokenHTMLBatch() {
  const htmlCache = useRef(new Map<number, string>());
  const pendingRef = useRef(new Set<number>());
  const queueRef = useRef<number[]>([]);
  const [, forceUpdate] = useState(0);

  // Process fetch queue in batches
  useEffect(() => {
    let active = true;
    const BATCH = 5;
    const DELAY = 400;

    async function processBatch() {
      while (active && queueRef.current.length > 0) {
        const batch = queueRef.current.splice(0, BATCH)
          .filter(id => !htmlCache.current.has(id) && !pendingRef.current.has(id));
        if (batch.length === 0) { await new Promise(r => setTimeout(r, DELAY)); continue; }

        batch.forEach(id => pendingRef.current.add(id));
        try {
          const calls = batch.map(id => ({
            address: TERRAFORMS_ADDRESS, abi: TOKEN_HTML_ABI,
            functionName: 'tokenHTML' as const, args: [BigInt(id)] as const,
          }));
          const results = await publicClient.multicall({ contracts: calls });
          for (let i = 0; i < results.length; i++) {
            if (results[i].status === 'success') {
              htmlCache.current.set(batch[i], results[i].result as string);
            }
            pendingRef.current.delete(batch[i]);
          }
          forceUpdate(n => n + 1);
        } catch {
          batch.forEach(id => pendingRef.current.delete(id));
        }
        await new Promise(r => setTimeout(r, DELAY));
      }
    }

    processBatch();
    return () => { active = false; };
  }, []);

  const requestTokens = useCallback((ids: number[]) => {
    const needed = ids.filter(id => !htmlCache.current.has(id) && !pendingRef.current.has(id));
    if (needed.length > 0) {
      // Prepend to queue (newest requests first)
      queueRef.current = [...needed, ...queueRef.current.filter(id => !needed.includes(id))];
    }
  }, []);

  return { htmlCache: htmlCache.current, requestTokens };
}

// ─── Live Iframe Cell ─────────────────────────────────────────────────────

const LiveCell: FC<{
  tokenId: number;
  html: string | undefined;
  color: string;
  zoneName: string;
  level: number;
  onClick: () => void;
  size: number;
}> = ({ tokenId, html, color, zoneName, level, onClick, size }) => {
  const srcdoc = useMemo(() => {
    if (!html) return '';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:#000;width:100%;height:100%}</style></head><body>${html}</body></html>`;
  }, [html]);

  return (
    <div
      onClick={onClick}
      title={`#${tokenId} · ${zoneName} · L${level}`}
      style={{
        width: size, height: size, borderRadius: 4, cursor: 'pointer',
        overflow: 'hidden', position: 'relative', background: color,
      }}
    >
      {srcdoc ? (
        <iframe
          srcDoc={srcdoc}
          sandbox="allow-scripts allow-same-origin"
          style={{ width: '100%', height: '100%', border: 'none', display: 'block', pointerEvents: 'none' }}
          title={`Terraform #${tokenId}`}
          loading="lazy"
        />
      ) : (
        <div style={{
          width: '100%', height: '100%', background: color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.3)', fontSize: '0.6rem', fontFamily: 'monospace',
        }}>
          #{tokenId}
        </div>
      )}
      <span style={{
        position: 'absolute', bottom: 1, left: 2,
        fontSize: '0.4rem', color: 'rgba(255,255,255,0.5)',
        fontFamily: 'monospace', textShadow: '0 0 3px #000',
        pointerEvents: 'none',
      }}>
        {tokenId}
      </span>
    </div>
  );
};

// ─── Grid View (virtualized live iframes) ─────────────────────────────────

const GRID_CELL = 150;
const GRID_GAP = 6;

const GridView: FC<{
  parcels: ParcelData[];
  onClickParcel: (id: number) => void;
  terrainData: TerrainData | null;
}> = ({ parcels, onClickParcel, terrainData: _terrainData }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { htmlCache, requestTokens } = useTokenHTMLBatch();

  // Responsive column count
  const [cols, setCols] = useState(8);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setCols(Math.max(2, Math.floor((w + GRID_GAP) / (GRID_CELL + GRID_GAP))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totalRows = Math.ceil(parcels.length / cols);
  const cellSize = Math.max(80, Math.floor(((containerRef.current?.clientWidth || 1200) - GRID_GAP * (cols - 1)) / cols));

  const rowVirtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => cellSize + GRID_GAP,
    overscan: 3,
  });

  // Request tokenHTML for visible rows
  useEffect(() => {
    const visibleItems = rowVirtualizer.getVirtualItems();
    const ids: number[] = [];
    for (const vRow of visibleItems) {
      const startIdx = vRow.index * cols;
      for (let c = 0; c < cols; c++) {
        const idx = startIdx + c;
        if (idx < parcels.length) ids.push(parcels[idx].tokenId);
      }
    }
    if (ids.length > 0) requestTokens(ids);
  }, [rowVirtualizer.getVirtualItems(), cols, parcels, requestTokens]);

  return (
    <div
      ref={scrollRef}
      style={{
        width: '100%', height: '100vh', background: '#050510',
        overflow: 'auto', padding: '80px 0 40px',
      }}
    >
      <div ref={containerRef} style={{ maxWidth: 1400, margin: '0 auto', padding: '0 20px' }}>
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map(vRow => {
            const startIdx = vRow.index * cols;
            return (
              <div
                key={vRow.key}
                style={{
                  position: 'absolute',
                  top: vRow.start,
                  left: 0, right: 0,
                  display: 'flex', gap: GRID_GAP,
                }}
              >
                {Array.from({ length: cols }, (_, c) => {
                  const idx = startIdx + c;
                  if (idx >= parcels.length) return null;
                  const p = parcels[idx];
                  return (
                    <LiveCell
                      key={p.tokenId}
                      tokenId={p.tokenId}
                      html={htmlCache.get(p.tokenId)}
                      color={p.color}
                      zoneName={p.zoneName}
                      level={p.level}
                      onClick={() => onClickParcel(p.tokenId)}
                      size={cellSize}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ─── Main Component ─────────────────────────────────────────────────────────

const HypercastleView: FC = () => {
  const navigate = useNavigate();
  const { parcels, loadedCount, isLoading, total } = useHypercastleData();
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const { data: terrainData } = useTerrainData();

  const onClickParcel = useCallback((tokenId: number) => {
    navigate(`/terraforms/${tokenId}`);
  }, [navigate]);

  const pct = Math.round((loadedCount / total) * 100);

  return (
    <div style={{
      width: '100%', height: '100vh', background: '#050510',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Loading overlay */}
      {isLoading && (
        <div style={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
          zIndex: 10, background: 'rgba(0,0,0,0.7)', padding: '10px 24px',
          borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12,
          border: '1px solid rgba(255,255,255,0.1)',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{
            width: 120, height: 4, background: '#1e293b', borderRadius: 2,
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${pct}%`, height: '100%', background: '#22c55e',
              borderRadius: 2, transition: 'width 0.3s',
            }} />
          </div>
          <span style={{
            color: '#94a3b8', fontSize: '0.7rem', fontFamily: 'monospace',
          }}>
            {loadedCount.toLocaleString()} / {total.toLocaleString()} parcels
          </span>
        </div>
      )}

      {/* Title + View Mode Tabs */}
      <div style={{
        position: 'absolute', top: 16, left: 20, zIndex: 10,
        fontFamily: "'Londrina Solid', cursive",
      }}>
        <h1 style={{
          margin: 0, fontSize: '1.4rem', color: '#e2e8f0', fontWeight: 400,
        }}>
          <span style={{ color: '#64748b' }}>&#x25A8;</span> Hypercastle
        </h1>
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          <TabButton label="Terrain" active={viewMode === 'terrain'} onClick={() => setViewMode('terrain')} />
          <TabButton label="Lofi" active={viewMode === 'lofi'} onClick={() => setViewMode('lofi')} />
          <TabButton label="Grid" active={viewMode === 'grid'} onClick={() => setViewMode('grid')} />
        </div>
        <p style={{ margin: '4px 0 0', fontSize: '0.55rem', color: '#475569', fontFamily: 'monospace' }}>
          {loadedCount.toLocaleString()} parcels{terrainData ? ` · ${terrainData.count} terrain maps` : ''}
        </p>
      </div>

      {/* Random button */}
      <div style={{
        position: 'absolute', top: 16, right: 20, zIndex: 10,
        display: 'flex', gap: 8,
      }}>
        <button
          onClick={() => {
            const rand = Math.floor(Math.random() * TOTAL_SUPPLY) + 1;
            navigate(`/terraforms/${rand}`);
          }}
          style={{
            padding: '6px 14px', borderRadius: 8, border: '1px solid #334155',
            background: '#1e293b', color: '#e2e8f0', fontSize: '0.7rem',
            cursor: 'pointer', fontFamily: 'monospace',
          }}
        >
          Random Parcel
        </button>
      </div>

      {/* Hovered parcel info (3D modes only) */}
      {hoveredId && viewMode !== 'grid' && (() => {
        const p = parcels.find(p => p.tokenId === hoveredId);
        if (!p) return null;
        return (
          <div style={{
            position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
            zIndex: 10, background: 'rgba(0,0,0,0.85)', padding: '10px 18px',
            borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)',
            fontFamily: 'monospace', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <div>
              <div style={{ fontSize: '0.85rem', color: p.color, fontWeight: 700 }}>
                Terraform #{p.tokenId}
              </div>
              <div style={{ fontSize: '0.6rem', color: '#94a3b8', marginTop: 2 }}>
                {p.zoneName} · Level {p.level} · ({p.x},{p.y}) · Elev {p.elevation}
              </div>
            </div>
            <button
              onClick={() => navigate(`/terraforms/${p.tokenId}`)}
              style={{
                padding: '5px 12px', borderRadius: 6, border: '1px solid #334155',
                background: '#1e293b', color: '#e2e8f0', fontSize: '0.6rem',
                cursor: 'pointer', fontFamily: 'monospace', whiteSpace: 'nowrap',
              }}
            >
              View →
            </button>
          </div>
        );
      })()}

      {/* ── Terrain View (default) ── */}
      {viewMode === 'terrain' && (
        <Suspense fallback={null}>
          <TerrainViewCanvas
            parcels={parcels}
            terrainData={terrainData}
            onClickParcel={onClickParcel}
            hoveredId={hoveredId}
            setHoveredId={setHoveredId}
          />
        </Suspense>
      )}

      {/* ── Lofi View (colored cubes) ── */}
      {viewMode === 'lofi' && (
        <Canvas
          camera={{ position: [60, 40, 60], fov: 55 }}
          gl={{ antialias: true, alpha: false }}
          onCreated={({ gl }) => gl.setClearColor('#050510')}
          style={{ cursor: hoveredId ? 'pointer' : 'grab' }}
        >
          <Suspense fallback={null}>
            <ambientLight intensity={0.5} />
            <directionalLight position={[50, 80, 30]} intensity={0.8} />
            <pointLight position={[0, 50, 0]} intensity={0.3} color="#4466ff" />
            <ParcelInstances
              parcels={parcels}
              onClickParcel={onClickParcel}
              hoveredId={hoveredId}
              setHoveredId={setHoveredId}
            />
            <OrbitControls
              enableDamping dampingFactor={0.06}
              autoRotate autoRotateSpeed={0.3}
              minDistance={10} maxDistance={200}
              enablePan maxPolarAngle={Math.PI * 0.9}
            />
            <gridHelper args={[100, 50, '#111133', '#0a0a22']} position={[0, -20, 0]} />
          </Suspense>
        </Canvas>
      )}

      {/* ── Grid View (2D thumbnails) ── */}
      {viewMode === 'grid' && (
        <GridView
          parcels={parcels}
          onClickParcel={onClickParcel}
          terrainData={terrainData}
        />
      )}
    </div>
  );
};

export default HypercastleView;
