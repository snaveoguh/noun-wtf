/* eslint-disable react/no-unknown-property -- three.js JSX props (args, emissive, …) */
// Optional 3D "neural treasury". A fixed, readable layout instead of a force
// hairball: nouns.eth in the middle, one sector per entity type, distance from
// the centre by value (bigger = closer), height by when they were first paid.
// Shape = entity type, colour = the main way money moved. Labels on the
// biggest nodes, the hovered one and the selected one.
import type { EntityType, FlowKind, FlowNode } from './types';

import { useMemo, useState } from 'react';

import { Html, Line, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';

import { KIND_META, TYPE_META, fmtEth, fmtUsd } from './model';

/** For sizing only: USDC is folded in at this nominal rate so USDC-paid teams aren't invisible. */
export const SIZE_USD_PER_ETH = 2500;

export interface ExploreNode {
  node: FlowNode;
  eth: number;
  usd: number;
  kind: FlowKind;
}

const SECTORS: EntityType[] = ['person', 'multisig', 'contract', 'subdao', 'nounders', 'bidder'];

function Shape({
  type,
  r,
  color,
  dim,
}: {
  type: EntityType;
  r: number;
  color: string;
  dim: boolean;
}) {
  const mat = (
    <meshStandardMaterial
      color={color}
      emissive={color}
      emissiveIntensity={dim ? 0.05 : 0.35}
      transparent
      opacity={dim ? 0.25 : 1}
    />
  );
  switch (type) {
    case 'multisig':
      return (
        <mesh>
          <boxGeometry args={[r * 1.6, r * 1.6, r * 1.6]} />
          {mat}
        </mesh>
      );
    case 'contract':
      return (
        <mesh>
          <coneGeometry args={[r * 1.1, r * 2, 4]} />
          {mat}
        </mesh>
      );
    case 'subdao':
      return (
        <mesh>
          <octahedronGeometry args={[r * 1.3]} />
          {mat}
        </mesh>
      );
    case 'nounders':
      return (
        <mesh>
          <torusGeometry args={[r, r * 0.35, 8, 20]} />
          {mat}
        </mesh>
      );
    default:
      return (
        <mesh>
          <sphereGeometry args={[r, 18, 14]} />
          {mat}
        </mesh>
      );
  }
}

interface Props {
  items: ExploreNode[];
  selected: string | null;
  onSelect: (id: string) => void;
}

export default function Explore3D({ items, selected, onSelect }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const layout = useMemo(() => {
    const value = (i: ExploreNode) => i.eth + i.usd / SIZE_USD_PER_ETH;
    const maxV = Math.max(1, ...items.map(value));
    const ts = items.map(i => i.node.firstT).filter(Boolean);
    const t0 = Math.min(...ts);
    const t1 = Math.max(...ts);
    const present = SECTORS.filter(s => items.some(i => i.node.type === s));
    const span = (Math.PI * 2) / Math.max(1, present.length);
    const labelled = new Set(
      [...items]
        .sort((a, b) => value(b) - value(a))
        .slice(0, 10)
        .map(i => i.node.id),
    );
    return items.map((it, idx) => {
      const sector = Math.max(0, present.indexOf(it.node.type));
      const v = value(it) / maxV;
      // golden-ratio jitter inside the sector keeps neighbours apart
      const frac = ((idx * 0.618034) % 1) * 0.8 + 0.1;
      const angle = sector * span + frac * span;
      const radius = 7 + (1 - Math.sqrt(v)) * 16;
      const y = ts.length && t1 > t0 ? ((it.node.firstT - t0) / (t1 - t0) - 0.5) * 12 : 0;
      return {
        ...it,
        pos: [Math.cos(angle) * radius, y, Math.sin(angle) * radius] as [number, number, number],
        r: 0.18 + Math.sqrt(v) * 1.3,
        label: labelled.has(it.node.id),
      };
    });
  }, [items]);

  return (
    <div className="nz-3d">
      <Canvas camera={{ position: [0, 16, 34], fov: 45 }} dpr={[1, 2]}>
        <color attach="background" args={['#050506']} />
        <ambientLight intensity={0.5} />
        <pointLight position={[0, 20, 10]} intensity={300} />
        <mesh>
          <icosahedronGeometry args={[2.2, 1]} />
          <meshStandardMaterial
            color="#d4ff3a"
            emissive="#d4ff3a"
            emissiveIntensity={0.5}
            flatShading
          />
        </mesh>
        <Html center position={[0, 3.4, 0]} className="nz-3d-label is-treasury">
          nouns.eth
        </Html>
        {layout.map(l => {
          const color = KIND_META[l.kind].color;
          const isSel = selected === l.node.id;
          const dim = selected !== null && !isSel;
          // only the labelled / hovered / selected links are bright; the rest
          // stay faint so the centre doesn't turn into a hairball
          let lineOpacity = 0.1;
          if (dim) lineOpacity = 0.04;
          else if (isSel || l.label || hover === l.node.id) lineOpacity = 0.55;
          return (
            <group key={l.node.id}>
              <Line
                points={[[0, 0, 0], l.pos]}
                color={color}
                lineWidth={isSel ? 2.5 : 1}
                transparent
                opacity={lineOpacity}
              />
              <group
                position={l.pos}
                onClick={e => {
                  e.stopPropagation();
                  onSelect(l.node.id);
                }}
                onPointerOver={e => {
                  e.stopPropagation();
                  setHover(l.node.id);
                  document.body.style.cursor = 'pointer';
                }}
                onPointerOut={() => {
                  setHover(h => (h === l.node.id ? null : h));
                  document.body.style.cursor = '';
                }}
              >
                <Shape type={l.node.type} r={l.r} color={color} dim={dim} />
                {(l.label || hover === l.node.id || isSel) && (
                  <Html
                    center
                    position={[0, l.r + 0.9, 0]}
                    className="nz-3d-label"
                    zIndexRange={[10, 0]}
                  >
                    <b>{l.node.name}</b>
                    <span>
                      {l.eth > 0 && fmtEth(l.eth)}
                      {l.usd > 0 && ` ${fmtUsd(l.usd)}`}
                    </span>
                  </Html>
                )}
              </group>
            </group>
          );
        })}
        <OrbitControls
          enablePan={false}
          minDistance={12}
          maxDistance={70}
          autoRotate={!selected && !hover}
          autoRotateSpeed={0.4}
        />
      </Canvas>
      <div className="nz-3d-legend">
        <div>
          <b>shape</b>
          {SECTORS.map(t => (
            <span key={t}>
              {TYPE_META[t].glyph} {TYPE_META[t].label}
            </span>
          ))}
        </div>
        <div>
          <b>colour</b>
          {(Object.keys(KIND_META) as FlowKind[]).map(k => (
            <span key={k}>
              <i style={{ background: KIND_META[k].color }} /> {KIND_META[k].label}
            </span>
          ))}
        </div>
        <p>
          closer and bigger = more money (USDC sized at {SIZE_USD_PER_ETH.toLocaleString()} per ETH,
          for size only). higher = paid more recently. drag to turn, scroll to zoom, click for
          details.
        </p>
      </div>
    </div>
  );
}
