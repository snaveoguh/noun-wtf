/**
 * TreasuryScene — Three.js scene rendered inside R3F Canvas.
 * Force-directed 3D layout, Noun-face sprite nodes, particle streams, bloom.
 *
 * Each node renders as a pixelated Noun face generated deterministically
 * from its Ethereum address. The treasury node is larger with a golden glow.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Html, OrbitControls, Stars } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { getNounTexture, loadEnsAvatarTexture, loadNounSvgTexture } from './nounTextures';
import type { NounSeed } from './nounTextures';
import { particleFragmentShader, particleVertexShader } from './shaders';

// ─── Force Resize (workaround for R3F not detecting parent dimensions) ──────

function ForceResize() {
  const { gl, camera, set } = useThree();
  useEffect(() => {
    const resize = () => {
      const container = gl.domElement.parentElement?.parentElement;
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w < 100 || h < 100) return;
      set({ size: { width: w, height: h, top: 0, left: 0 } });
      gl.setSize(w, h);
      gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      if ((camera as any).aspect) {
        (camera as any).aspect = w / h;
        (camera as any).updateProjectionMatrix();
      }
    };
    resize();
    const t1 = setTimeout(resize, 200);
    const t2 = setTimeout(resize, 1000);
    window.addEventListener('resize', resize);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', resize); };
  }, [gl, camera, set]);
  return null;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface FlowNode {
  id: string;
  name: string;
  type: string;
  description: string;
  url?: string;
  totalIn: number;
  totalOut: number;
  netFlow: number;
  color: string;
  size: number;
  proposals: string[];
  auctionCount: number;
  votesCount: number;
  totalVotingWeight: number;
  proposalsCreated: number;
  proposalsCreatedIds: string[];
  participationRate: number;
  flowRole: number;
  outboundConnections: number;
  inboundConnections: number;
  ensName: string | null;
  ensAvatar: string | null;
  nounIds: string[];
  firstNounSeed: NounSeed | null;
  delegatedVotes: number;
}

interface FlowLink {
  source: string | FlowNode;
  target: string | FlowNode;
  value: number;
  label: string;
  direction: string;
}

export interface TreasurySceneProps {
  nodes: FlowNode[];
  links: FlowLink[];
  searchTerms: string[];
  paused: boolean;
  onNodeClick: (node: FlowNode) => void;
  onNodeHover: (node: FlowNode | null) => void;
}

// ─── Type colors (for links/particles/labels) ───────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  treasury: '#f59e0b',
  governance: '#6366f1',
  nounder: '#ec4899',
  delegate: '#a855f7',
  subdao: '#8b5cf6',
  builder: '#f59e0b',
  culture: '#f97316',
  infra: '#06b6d4',
  education: '#10b981',
  bidder: '#6b7280',
  wallet: '#64748b',
  // Legacy types (in case API returns old data)
  dao: '#8b5cf6',
  project: '#f59e0b',
  protocol: '#06b6d4',
};

// ─── 3D Force Layout (runs once synchronously) ─────────────────────────────

interface SimNode {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

function computeForceLayout(
  nodes: FlowNode[],
  links: FlowLink[],
): Map<string, [number, number, number]> {
  if (nodes.length === 0) return new Map();

  const simNodes: SimNode[] = nodes.map((n, i) => {
    const isTreasury = n.id === 'treasury';
    const phi = Math.acos(1 - (2 * (i + 0.5)) / nodes.length);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const r = isTreasury ? 0 : 180;
    return {
      id: n.id,
      x: isTreasury ? 0 : r * Math.sin(phi) * Math.cos(theta),
      y: isTreasury ? 0 : r * Math.sin(phi) * Math.sin(theta),
      z: isTreasury ? 0 : r * Math.cos(phi),
      vx: 0, vy: 0, vz: 0,
      size: n.size,
      fx: isTreasury ? 0 : undefined,
      fy: isTreasury ? 0 : undefined,
      fz: isTreasury ? 0 : undefined,
    };
  });

  const nodeMap = new Map<string, SimNode>();
  for (const n of simNodes) nodeMap.set(n.id, n);

  const linkPairs = links.map(l => ({
    source: nodeMap.get(typeof l.source === 'string' ? l.source : l.source.id),
    target: nodeMap.get(typeof l.target === 'string' ? l.target : l.target.id),
    value: l.value,
  })).filter(l => l.source && l.target);

  // Run 250 ticks of force simulation
  for (let tick = 0; tick < 250; tick++) {
    const alpha = 0.3 * Math.pow(0.985, tick);
    if (alpha < 0.001) break;

    // Center gravity
    for (const n of simNodes) {
      if (n.fx != null) { n.x = n.fx; n.y = n.fy!; n.z = n.fz!; n.vx = 0; n.vy = 0; n.vz = 0; continue; }
      n.vx -= n.x * 0.008 * alpha;
      n.vy -= n.y * 0.008 * alpha;
      n.vz -= n.z * 0.008 * alpha;
    }

    // Repulsion O(n²) — acceptable for ~100-200 nodes
    for (let i = 0; i < simNodes.length; i++) {
      const a = simNodes[i];
      if (a.fx != null) continue;
      for (let j = i + 1; j < simNodes.length; j++) {
        const b = simNodes[j];
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const force = -300 * alpha / (dist * dist);
        const fx = (dx / dist) * force, fy = (dy / dist) * force, fz = (dz / dist) * force;
        if (a.fx == null) { a.vx -= fx; a.vy -= fy; a.vz -= fz; }
        if (b.fx == null) { b.vx += fx; b.vy += fy; b.vz += fz; }
      }
    }

    // Spring links
    for (const link of linkPairs) {
      const s = link.source!, t = link.target!;
      const dx = t.x - s.x, dy = t.y - s.y, dz = t.z - s.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const idealDist = 60 + Math.log(1 + link.value) * 10;
      const force = (dist - idealDist) * 0.004 * alpha;
      const fx = (dx / dist) * force, fy = (dy / dist) * force, fz = (dz / dist) * force;
      if (s.fx == null) { s.vx += fx; s.vy += fy; s.vz += fz; }
      if (t.fx == null) { t.vx -= fx; t.vy -= fy; t.vz -= fz; }
    }

    // Collision
    for (let i = 0; i < simNodes.length; i++) {
      const a = simNodes[i];
      if (a.fx != null) continue;
      for (let j = i + 1; j < simNodes.length; j++) {
        const b = simNodes[j];
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const minDist = (a.size + b.size) * 1.2;
        if (dist < minDist) {
          const push = (minDist - dist) * 0.3;
          const nx = dx / dist, ny = dy / dist, nz = dz / dist;
          if (a.fx == null) { a.vx += nx * push; a.vy += ny * push; a.vz += nz * push; }
          if (b.fx == null) { b.vx -= nx * push; b.vy -= ny * push; b.vz -= nz * push; }
        }
      }
    }

    // Integration + friction
    for (const n of simNodes) {
      if (n.fx != null) continue;
      n.vx *= 0.55; n.vy *= 0.55; n.vz *= 0.55;
      n.x += n.vx; n.y += n.vy; n.z += n.vz;
    }
  }

  const result = new Map<string, [number, number, number]>();
  for (const n of simNodes) result.set(n.id, [n.x, n.y, n.z]);
  return result;
}

// ─── Noun-Face Sprite Nodes ─────────────────────────────────────────────────

function NounNodes({
  nodes,
  positions,
  searchTerms,
  onNodeClick,
  onNodeHover,
}: {
  nodes: FlowNode[];
  positions: Map<string, [number, number, number]>;
  searchTerms: string[];
  onNodeClick: (node: FlowNode) => void;
  onNodeHover: (node: FlowNode | null) => void;
}) {
  // Generate/cache Noun textures for all non-treasury nodes (instant pixel art)
  const baseTextures = useMemo(() => {
    const map = new Map<string, THREE.DataTexture>();
    for (const node of nodes) {
      if (node.id === 'treasury') continue;
      map.set(node.id, getNounTexture(node.id));
    }
    return map;
  }, [nodes]);

  // Async texture upgrades: Noun SVG → ENS avatar (higher priority wins)
  const [upgradedTextures, setUpgradedTextures] = useState<Map<string, THREE.Texture>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const newUpgrades = new Map<string, THREE.Texture>();

    const loadAll = async () => {
      for (const node of nodes) {
        if (node.id === 'treasury' || cancelled) continue;

        // Tier 2: Load Noun SVG if they own a Noun
        if (node.firstNounSeed) {
          const tex = await loadNounSvgTexture(node.id, node.firstNounSeed);
          if (tex && !cancelled) {
            newUpgrades.set(node.id, tex);
          }
        }

        // Tier 3 (highest priority): Load ENS avatar
        if (node.ensAvatar) {
          const tex = await loadEnsAvatarTexture(node.id, node.ensAvatar);
          if (tex && !cancelled) {
            newUpgrades.set(node.id, tex);
          }
        }
      }
      if (!cancelled) {
        setUpgradedTextures(new Map(newUpgrades));
      }
    };

    loadAll();
    return () => { cancelled = true; };
  }, [nodes]);

  const hasSearch = searchTerms.length > 0;

  return (
    <group>
      {nodes.map(node => {
        if (node.id === 'treasury') return null;
        const pos = positions.get(node.id);
        const texture = upgradedTextures.get(node.id) ?? baseTextures.get(node.id);
        if (!pos || !texture) return null;

        const radius = node.size * 0.28;
        const isMatched = !hasSearch || searchTerms.some(
          t => node.name.toLowerCase().includes(t) || node.id.toLowerCase().includes(t),
        );

        return (
          <mesh
            key={node.id}
            position={[pos[0], pos[1], pos[2]]}
            onClick={(e: any) => { e.stopPropagation?.(); onNodeClick(node); }}
            onPointerOver={(e: any) => { e.stopPropagation?.(); onNodeHover(node); document.body.style.cursor = 'pointer'; }}
            onPointerOut={() => { onNodeHover(null); document.body.style.cursor = 'auto'; }}
          >
            <sphereGeometry args={[radius, 32, 32]} />
            <meshBasicMaterial
              map={texture}
              transparent
              opacity={isMatched ? 1 : 0.08}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// ─── Treasury Central Node (Noun + golden glow) ─────────────────────────────

function TreasuryNode({ onClick, onHover, paused }: { onClick: () => void; onHover: (h: boolean) => void; paused: boolean }) {
  const texture = useMemo(() => getNounTexture('treasury'), []);
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (glowRef.current && !paused) {
      const mat = glowRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.05 + Math.sin(clock.getElapsedTime() * 1.5) * 0.025;
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* Golden glow sphere */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[18, 16, 16]} />
        <meshBasicMaterial
          color="#FFD700"
          transparent
          opacity={0.06}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Noun face sphere */}
      <mesh
        onClick={(e: any) => { e.stopPropagation?.(); onClick(); }}
        onPointerOver={(e: any) => { e.stopPropagation?.(); onHover(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { onHover(false); document.body.style.cursor = 'auto'; }}
      >
        <sphereGeometry args={[12, 32, 32]} />
        <meshBasicMaterial map={texture} />
      </mesh>
    </group>
  );
}

// ─── Links ──────────────────────────────────────────────────────────────────

function Links({
  links,
  positions,
  searchTerms,
  nodes,
}: {
  links: FlowLink[];
  positions: Map<string, [number, number, number]>;
  searchTerms: string[];
  nodes: FlowNode[];
}) {
  const lineRef = useRef<THREE.LineSegments>(null);

  const { geometry } = useMemo(() => {
    const verts: number[] = [];
    const colors: number[] = [];
    const hasSearch = searchTerms.length > 0;
    const nodeMap = new Map<string, FlowNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    for (const link of links) {
      const sid = typeof link.source === 'string' ? link.source : link.source.id;
      const tid = typeof link.target === 'string' ? link.target : link.target.id;
      const sp = positions.get(sid);
      const tp = positions.get(tid);
      if (!sp || !tp) continue;

      verts.push(sp[0], sp[1], sp[2], tp[0], tp[1], tp[2]);

      let r: number, g: number, b: number;
      if (link.direction === 'in') {
        r = 0.13; g = 0.77; b = 0.37;
      } else if (link.direction === 'proposed') {
        r = 0.55; g = 0.36; b = 0.96;
      } else if (link.direction === 'stream') {
        r = 0.02; g = 0.71; b = 0.84;
      } else {
        r = 0.94; g = 0.27; b = 0.27;
      }

      let alpha = 0.12;
      if (hasSearch) {
        const sn = nodeMap.get(sid);
        const tn = nodeMap.get(tid);
        const sMatch = sn && searchTerms.some(t => sn.name.toLowerCase().includes(t) || sn.id.toLowerCase().includes(t));
        const tMatch = tn && searchTerms.some(t => tn.name.toLowerCase().includes(t) || tn.id.toLowerCase().includes(t));
        alpha = sMatch || tMatch ? 0.35 : 0.03;
      }

      colors.push(r * alpha * 3, g * alpha * 3, b * alpha * 3);
      colors.push(r * alpha * 3, g * alpha * 3, b * alpha * 3);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return { geometry: geo };
  }, [links, positions, searchTerms, nodes]);

  return (
    <lineSegments ref={lineRef} geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={1} depthWrite={false} />
    </lineSegments>
  );
}

// ─── Link Flow Labels (ETH amount at midpoint of top links) ─────────────────

function LinkLabels({
  links,
  positions,
  searchTerms,
  nodes,
}: {
  links: FlowLink[];
  positions: Map<string, [number, number, number]>;
  searchTerms: string[];
  nodes: FlowNode[];
}) {
  const hasSearch = searchTerms.length > 0;
  const nodeMap = useMemo(() => {
    const m = new Map<string, FlowNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  // Show labels for top 30 links by value, or all matched links during search
  const visibleLinks = useMemo(() => {
    const sorted = [...links]
      .filter(l => l.value >= 10) // Only show links with 10+ ETH
      .sort((a, b) => b.value - a.value);
    if (hasSearch) {
      return sorted.filter(l => {
        const sid = typeof l.source === 'string' ? l.source : l.source.id;
        const tid = typeof l.target === 'string' ? l.target : l.target.id;
        const sn = nodeMap.get(sid);
        const tn = nodeMap.get(tid);
        return (sn && searchTerms.some(t => sn.name.toLowerCase().includes(t) || sn.id.toLowerCase().includes(t))) ||
               (tn && searchTerms.some(t => tn.name.toLowerCase().includes(t) || tn.id.toLowerCase().includes(t)));
      }).slice(0, 40);
    }
    return sorted.slice(0, 30);
  }, [links, hasSearch, searchTerms, nodeMap]);

  return (
    <>
      {visibleLinks.map((link, i) => {
        const sid = typeof link.source === 'string' ? link.source : link.source.id;
        const tid = typeof link.target === 'string' ? link.target : link.target.id;
        const sp = positions.get(sid);
        const tp = positions.get(tid);
        if (!sp || !tp) return null;

        // Midpoint with slight offset upward
        const mx = (sp[0] + tp[0]) / 2;
        const my = (sp[1] + tp[1]) / 2 + 3;
        const mz = (sp[2] + tp[2]) / 2;

        const dirColor = link.direction === 'in' ? '#22c55e'
          : link.direction === 'proposed' ? '#a78bfa'
          : link.direction === 'stream' ? '#06b6d4'
          : '#ef4444';

        return (
          <Html
            key={`ll-${i}`}
            position={[mx, my, mz]}
            center
            distanceFactor={200}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
            zIndexRange={[5, 0]}
          >
            <div style={{
              fontSize: '7px',
              fontFamily: "'PT Root UI', sans-serif",
              color: dirColor,
              opacity: 0.7,
              textShadow: '0 0 6px rgba(0,0,0,0.95)',
              whiteSpace: 'nowrap',
            }}>
              {Math.round(link.value)} ETH {link.direction === 'in' ? '→' : link.direction === 'proposed' ? '⇢' : link.direction === 'stream' ? '⇝' : '→'}
            </div>
          </Html>
        );
      })}
    </>
  );
}

// ─── Particle Streams ───────────────────────────────────────────────────────

function ParticleStreams({
  links,
  positions,
  paused,
}: {
  links: FlowLink[];
  positions: Map<string, [number, number, number]>;
  paused: boolean;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { geometry, totalParticles } = useMemo(() => {
    const startPositions: number[] = [];
    const endPositions: number[] = [];
    const offsets: number[] = [];
    const speeds: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];

    for (const link of links) {
      const sid = typeof link.source === 'string' ? link.source : link.source.id;
      const tid = typeof link.target === 'string' ? link.target : link.target.id;
      const sp = positions.get(sid);
      const tp = positions.get(tid);
      if (!sp || !tp) continue;

      const count = Math.max(2, Math.floor(Math.log(1 + link.value) * 3));
      const speed = 0.08 + Math.log(1 + link.value) * 0.015;
      const size = 2.0 + Math.log(1 + link.value) * 0.4;

      let r: number, g: number, b: number;
      if (link.direction === 'in') {
        r = 0.2; g = 0.95; b = 0.45;
      } else if (link.direction === 'proposed') {
        r = 0.65; g = 0.45; b = 1.0;
      } else if (link.direction === 'stream') {
        r = 0.15; g = 0.85; b = 0.95;
      } else {
        r = 1.0; g = 0.35; b = 0.2;
      }

      for (let i = 0; i < count; i++) {
        startPositions.push(sp[0], sp[1], sp[2]);
        endPositions.push(tp[0], tp[1], tp[2]);
        offsets.push(Math.random());
        speeds.push(speed * (0.7 + Math.random() * 0.6));
        colors.push(r, g, b);
        sizes.push(size * (0.6 + Math.random() * 0.8));
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(startPositions.length), 3));
    geo.setAttribute('aStartPos', new THREE.Float32BufferAttribute(startPositions, 3));
    geo.setAttribute('aEndPos', new THREE.Float32BufferAttribute(endPositions, 3));
    geo.setAttribute('aOffset', new THREE.Float32BufferAttribute(offsets, 1));
    geo.setAttribute('aSpeed', new THREE.Float32BufferAttribute(speeds, 1));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));

    return { geometry: geo, totalParticles: offsets.length };
  }, [links, positions]);

  const frozenTime = useRef(0);
  useFrame(({ clock }) => {
    if (materialRef.current) {
      if (!paused) frozenTime.current = clock.getElapsedTime();
      materialRef.current.uniforms.uTime.value = frozenTime.current;
    }
  });

  if (totalParticles === 0) return null;

  return (
    <points ref={pointsRef} geometry={geometry}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={particleVertexShader}
        fragmentShader={particleFragmentShader}
        uniforms={{ uTime: { value: 0 } }}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ─── Labels ─────────────────────────────────────────────────────────────────

function NodeLabels({
  nodes,
  positions,
  searchTerms,
  hoveredId,
}: {
  nodes: FlowNode[];
  positions: Map<string, [number, number, number]>;
  searchTerms: string[];
  hoveredId: string | null;
}) {
  const hasSearch = searchTerms.length > 0;

  // Label top 40 nodes + treasury + hovered + searched
  const labelNodes = useMemo(() => {
    const sorted = [...nodes].sort((a, b) => (b.totalIn + b.totalOut) - (a.totalIn + a.totalOut));
    // Top 60 by volume always get labels
    const topIds = new Set(sorted.slice(0, 60).map(n => n.id));
    topIds.add('treasury');
    if (hoveredId) topIds.add(hoveredId);

    return nodes.filter(n => {
      if (topIds.has(n.id)) return true;
      // Any node with an ENS name gets a label (that's the point of resolving them)
      if (n.ensName && !n.id.startsWith('0x') || (n.ensName && n.ensName !== n.id)) return true;
      if (hasSearch) {
        return searchTerms.some(
          t => n.name.toLowerCase().includes(t) || n.id.toLowerCase().includes(t),
        );
      }
      return false;
    });
  }, [nodes, hoveredId, hasSearch, searchTerms]);

  // Generate contextual one-liner for each node
  const getNodeContext = useCallback((node: FlowNode): string => {
    if (node.id === 'treasury') return 'Central vault for all Nouns DAO funds';
    const parts: string[] = [];
    const typeLabels: Record<string, string> = {
      nounder: 'Founding team member',
      delegate: 'Active governance delegate',
      governance: 'Governance infrastructure',
      builder: 'Funded builder/team',
      culture: 'Cultural initiative',
      subdao: 'Sub-DAO or fork',
      infra: 'Protocol infrastructure',
      education: 'Education initiative',
      bidder: 'Auction participant',
      treasury: 'DAO Treasury',
      wallet: 'Participant',
    };
    parts.push(typeLabels[node.type] || 'Entity');
    if (node.nounIds && node.nounIds.length > 0) {
      parts.push(`holds ${node.nounIds.length} Noun${node.nounIds.length > 1 ? 's' : ''}`);
    }
    if (node.delegatedVotes > 0) {
      parts.push(`${node.delegatedVotes} delegated votes`);
    }
    if (node.proposalsCreated > 0) {
      parts.push(`authored ${node.proposalsCreated} prop${node.proposalsCreated > 1 ? 's' : ''}`);
    }
    if (node.votesCount > 0 && !parts.some(p => p.includes('vote'))) {
      parts.push(`${node.votesCount} votes cast`);
    }
    if (node.auctionCount > 0) {
      parts.push(`won ${node.auctionCount} auction${node.auctionCount > 1 ? 's' : ''}`);
    }
    if (parts.length === 1 && node.totalIn > 0) {
      parts.push(`received ${Math.round(node.totalIn)} ETH`);
    }
    return parts.join(' · ');
  }, []);

  return (
    <>
      {labelNodes.map(node => {
        const pos = positions.get(node.id);
        if (!pos) return null;
        const ethTotal = node.totalIn + node.totalOut;
        const isMatched = hasSearch && searchTerms.some(
          t => node.name.toLowerCase().includes(t) || node.id.toLowerCase().includes(t),
        );
        const isTreasury = node.id === 'treasury';
        const isHovered = node.id === hoveredId;
        const typeColor = TYPE_COLORS[node.type] ?? '#64748b';
        const displayName = node.ensName || node.name;
        const contextLine = getNodeContext(node);

        return (
          <Html
            key={node.id}
            position={[pos[0], pos[1] + node.size * 0.35 + 5, pos[2]]}
            center
            distanceFactor={140}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
            zIndexRange={[10, 0]}
          >
            <div
              style={{
                textAlign: 'center',
                whiteSpace: 'nowrap',
                textShadow: '0 0 8px rgba(0,0,0,0.95), 0 0 16px rgba(0,0,0,0.6)',
                opacity: hasSearch && !isMatched && !isTreasury ? 0.2 : 1,
                transform: isHovered ? 'scale(1.2)' : 'scale(1)',
                transition: 'transform 0.15s, opacity 0.15s',
              }}
            >
              {/* ENS name / display name — primary label above node */}
              <div
                style={{
                  fontFamily: "'Londrina Solid', 'Comic Sans MS', cursive",
                  fontSize: isTreasury ? '16px' : '12px',
                  fontWeight: 'bold',
                  color: isMatched ? '#FFD700' : isTreasury ? '#FFD700' : '#fff',
                  lineHeight: 1.2,
                }}
              >
                {displayName}
              </div>
              {/* ETH amount */}
              {ethTotal > 0 && (
                <div
                  style={{
                    fontFamily: "'PT Root UI', sans-serif",
                    fontSize: '9px',
                    color: isMatched ? '#fbbf24' : '#94a3b8',
                    lineHeight: 1.3,
                  }}
                >
                  {ethTotal.toLocaleString()} ETH
                </div>
              )}
              {/* Contextual description — below the node */}
              <div
                style={{
                  fontFamily: "'PT Root UI', sans-serif",
                  fontSize: '7px',
                  color: typeColor,
                  lineHeight: 1.3,
                  maxWidth: 200,
                  whiteSpace: 'normal',
                  opacity: 0.85,
                }}
              >
                {contextLine}
              </div>
            </div>
          </Html>
        );
      })}
    </>
  );
}

// ─── Camera Auto-Focus on Search ────────────────────────────────────────────

function CameraAutoFocus({
  nodes,
  positions,
  searchTerms,
}: {
  nodes: FlowNode[];
  positions: Map<string, [number, number, number]>;
  searchTerms: string[];
}) {
  const { camera, controls } = useThree();
  const camTargetRef = useRef<THREE.Vector3 | null>(null);
  const orbitTargetRef = useRef<THREE.Vector3 | null>(null);

  useEffect(() => {
    if (searchTerms.length === 0) {
      camTargetRef.current = null;
      orbitTargetRef.current = null;
      return;
    }

    const matched = nodes.filter(n =>
      searchTerms.some(t => n.name.toLowerCase().includes(t) || n.id.toLowerCase().includes(t)),
    );
    if (matched.length === 0) return;

    const center = new THREE.Vector3();
    let count = 0;
    for (const n of matched) {
      const p = positions.get(n.id);
      if (!p) continue;
      center.add(new THREE.Vector3(p[0], p[1], p[2]));
      count++;
    }
    if (count === 0) return;
    center.divideScalar(count);

    let maxDist = 0;
    for (const n of matched) {
      const p = positions.get(n.id);
      if (!p) continue;
      const d = new THREE.Vector3(p[0], p[1], p[2]).distanceTo(center);
      if (d > maxDist) maxDist = d;
    }

    const pullback = Math.max(100, maxDist * 2.5 + 80);
    const dir = camera.position.clone().sub(center).normalize();
    camTargetRef.current = center.clone().add(dir.multiplyScalar(pullback));
    orbitTargetRef.current = center.clone();
  }, [searchTerms, nodes, positions, camera]);

  useFrame(() => {
    if (camTargetRef.current) {
      camera.position.lerp(camTargetRef.current, 0.04);
    }
    // Also move the orbit pivot so the camera orbits around the searched node
    if (orbitTargetRef.current && controls) {
      const oc = controls as unknown as { target: THREE.Vector3 };
      if (oc.target) {
        oc.target.lerp(orbitTargetRef.current, 0.04);
      }
    }
  });

  return null;
}

// ─── Main Scene Component ───────────────────────────────────────────────────

export default function TreasuryScene({
  nodes,
  links,
  searchTerms,
  paused,
  onNodeClick,
  onNodeHover,
}: TreasurySceneProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Compute 3D layout
  const positions = useMemo(() => computeForceLayout(nodes, links), [nodes, links]);

  // Treasury node for click handler
  const treasuryNode = useMemo(() => nodes.find(n => n.id === 'treasury'), [nodes]);

  const handleNodeHover = useCallback(
    (node: FlowNode | null) => {
      setHoveredId(node?.id ?? null);
      onNodeHover(node);
    },
    [onNodeHover],
  );

  const handleTreasuryClick = useCallback(() => {
    if (treasuryNode) onNodeClick(treasuryNode);
  }, [treasuryNode, onNodeClick]);

  const handleTreasuryHover = useCallback(
    (h: boolean) => {
      if (h && treasuryNode) {
        setHoveredId(treasuryNode.id);
        onNodeHover(treasuryNode);
        document.body.style.cursor = 'pointer';
      } else {
        setHoveredId(null);
        onNodeHover(null);
        document.body.style.cursor = 'auto';
      }
    },
    [treasuryNode, onNodeHover],
  );

  // Non-treasury nodes
  const nonTreasuryNodes = useMemo(() => nodes.filter(n => n.id !== 'treasury'), [nodes]);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <pointLight position={[100, 200, 150]} intensity={1.0} color="#ffffff" />
      <pointLight position={[-100, -100, -200]} intensity={0.3} color="#8b5cf6" />
      <pointLight position={[0, 0, 0]} intensity={0.6} color="#FFD700" distance={200} decay={2} />

      {/* Force resize on mount */}
      <ForceResize />

      {/* Stars background */}
      <Stars radius={500} depth={100} count={3000} factor={3} saturation={0.1} fade speed={0.5} />

      {/* Controls */}
      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minDistance={30}
        maxDistance={800}
        autoRotate={!paused}
        autoRotateSpeed={0.15}
        enablePan
      />

      {/* Links */}
      <Links links={links} positions={positions} searchTerms={searchTerms} nodes={nodes} />

      {/* ETH flow labels on links */}
      <LinkLabels links={links} positions={positions} searchTerms={searchTerms} nodes={nodes} />

      {/* Particle Streams */}
      <ParticleStreams links={links} positions={positions} paused={paused} />

      {/* Treasury central node (Noun + golden glow) */}
      {treasuryNode && (
        <TreasuryNode onClick={handleTreasuryClick} onHover={handleTreasuryHover} paused={paused} />
      )}

      {/* Noun-face sprite nodes */}
      <NounNodes
        nodes={nonTreasuryNodes}
        positions={positions}
        searchTerms={searchTerms}
        onNodeClick={onNodeClick}
        onNodeHover={handleNodeHover}
      />

      {/* Labels */}
      <NodeLabels
        nodes={nodes}
        positions={positions}
        searchTerms={searchTerms}
        hoveredId={hoveredId}
      />

      {/* Camera auto-focus on search */}
      <CameraAutoFocus nodes={nodes} positions={positions} searchTerms={searchTerms} />

      {/* Post-processing bloom — disabled for debugging */}
      {/* <EffectComposer>
        <Bloom luminanceThreshold={0.25} luminanceSmoothing={0.9} intensity={0.6} />
      </EffectComposer> */}
    </>
  );
}
