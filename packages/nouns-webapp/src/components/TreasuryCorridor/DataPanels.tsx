/**
 * DataPanels — 3D floating data panels positioned along the corridor walls.
 * Each panel animates in as the player approaches.
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { StatsData, SpendingCategory } from './useStatsData';

const FADE_DISTANCE = 30; // Distance at which panels start appearing
const FULL_VISIBLE_DISTANCE = 10; // Fully visible at this distance

// ─── Single Data Panel (glowing bordered frame) ─────────────────────────────

interface PanelProps {
  position: [number, number, number];
  playerZ: number;
  color: string;
  title: string;
  children: React.ReactNode;
  width?: number;
  height?: number;
}

function DataPanel({ position, playerZ, color, title, children, width = 5, height = 3.5 }: PanelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const dz = Math.abs(playerZ - position[2]);
    const t = Math.max(0, Math.min(1, 1 - (dz - FULL_VISIBLE_DISTANCE) / (FADE_DISTANCE - FULL_VISIBLE_DISTANCE)));

    // Scale and opacity animation
    groupRef.current.scale.setScalar(0.5 + t * 0.5);
    groupRef.current.visible = t > 0.01;

    // Gentle float
    groupRef.current.position.y = position[1] + Math.sin(clock.elapsedTime * 0.5 + position[2] * 0.1) * 0.1;

    // Glow pulse
    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.5 + Math.sin(clock.elapsedTime * 2 + position[2]) * 0.5;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Panel backing */}
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          color="#0a0a1a"
          transparent
          opacity={0.85}
          metalness={0.5}
          roughness={0.3}
        />
      </mesh>

      {/* Glowing border frame */}
      <mesh ref={glowRef} position={[0, 0, 0.01]}>
        <planeGeometry args={[width + 0.1, height + 0.1]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.5}
          transparent
          opacity={0.15}
          toneMapped={false}
        />
      </mesh>

      {/* Border edges */}
      <lineSegments position={[0, 0, 0.02]}>
        <edgesGeometry args={[new THREE.PlaneGeometry(width, height)]} />
        <lineBasicMaterial color={color} transparent opacity={0.8} />
      </lineSegments>

      {/* Title bar */}
      <mesh position={[0, height / 2 - 0.2, 0.03]}>
        <planeGeometry args={[width - 0.2, 0.35]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.8}
          transparent
          opacity={0.3}
          toneMapped={false}
        />
      </mesh>

      {/* Spotlight on panel */}
      <pointLight
        position={[0, 2, 2]}
        color={color}
        intensity={0.5}
        distance={8}
        decay={2}
      />

      {/* HTML overlay content */}
      <Html
        center
        transform
        occlude={false}
        position={[0, 0, 0.05]}
        style={{
          width: `${width * 60}px`,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        <div style={{
          fontFamily: "'PT Root UI', monospace, sans-serif",
          color: '#e2e8f0',
          textAlign: 'center',
          padding: '8px',
        }}>
          <div style={{
            fontSize: '10px',
            fontWeight: 800,
            color: color,
            textTransform: 'uppercase',
            letterSpacing: '0.2em',
            marginBottom: '8px',
          }}>
            {title}
          </div>
          {children}
        </div>
      </Html>
    </group>
  );
}

// ─── 3D Bar Chart ───────────────────────────────────────────────────────────

interface BarProps {
  data: { label: string; value: number; color: string }[];
  position: [number, number, number];
  playerZ: number;
  maxHeight?: number;
}

function BarChart3D({ data, position, playerZ, maxHeight = 2 }: BarProps) {
  const groupRef = useRef<THREE.Group>(null);
  const barsRef = useRef<THREE.Mesh[]>([]);

  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barWidth = 0.6;
  const gap = 0.15;
  const totalWidth = data.length * (barWidth + gap) - gap;
  const startX = -totalWidth / 2 + barWidth / 2;

  useFrame(() => {
    if (!groupRef.current) return;
    const dz = Math.abs(playerZ - position[2]);
    const t = Math.max(0, Math.min(1, 1 - (dz - FULL_VISIBLE_DISTANCE) / (FADE_DISTANCE - FULL_VISIBLE_DISTANCE)));

    groupRef.current.visible = t > 0.01;

    // Animate bars growing
    barsRef.current.forEach((bar, i) => {
      if (!bar) return;
      const targetH = (data[i].value / maxVal) * maxHeight * t;
      const currentH = bar.scale.y;
      bar.scale.y = currentH + (targetH - currentH) * 0.05;
      bar.position.y = bar.scale.y / 2;
    });
  });

  return (
    <group ref={groupRef} position={position}>
      {data.map((d, i) => (
        <group key={d.label} position={[startX + i * (barWidth + gap), 0, 0]}>
          <mesh
            ref={el => { if (el) barsRef.current[i] = el; }}
            scale={[1, 0.01, 1]}
          >
            <boxGeometry args={[barWidth, 1, 0.4]} />
            <meshStandardMaterial
              color={d.color}
              emissive={d.color}
              emissiveIntensity={0.6}
              toneMapped={false}
            />
          </mesh>
          {/* Label */}
          <Html
            center
            position={[0, -0.3, 0]}
            style={{ pointerEvents: 'none', whiteSpace: 'nowrap' }}
          >
            <span style={{
              fontSize: '7px',
              color: '#64748b',
              fontFamily: "'PT Root UI', sans-serif",
            }}>
              {d.label}
            </span>
          </Html>
        </group>
      ))}
    </group>
  );
}

// ─── Main DataPanels Component ──────────────────────────────────────────────

interface DataPanelsProps {
  data: StatsData;
  playerZ: number;
}

export default function DataPanels({ data, playerZ }: DataPanelsProps) {
  // ── Station 1: Treasury Overview (z = -5) ──

  const treasuryContent = useMemo(() => (
    <>
      <div style={{
        fontSize: '28px',
        fontWeight: 900,
        color: '#fbbf24',
        textShadow: '0 0 20px rgba(251,191,36,0.5)',
        lineHeight: 1,
      }}>
        {data.treasuryEth > 0
          ? `${data.treasuryEth.toLocaleString(undefined, { maximumFractionDigits: 0 })} ETH`
          : '...'}
      </div>
      {data.treasuryUsd > 0 && (
        <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
          ${data.treasuryUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} USD
        </div>
      )}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '4px',
        marginTop: '10px',
        fontSize: '8px',
      }}>
        {[
          ['ETH', data.treasuryBreakdown.eth],
          ['stETH', data.treasuryBreakdown.stEth],
          ['rETH', data.treasuryBreakdown.rEth],
          ['wstETH', data.treasuryBreakdown.wstEth],
          ['wETH', data.treasuryBreakdown.wEth],
          ['mETH', data.treasuryBreakdown.mEth],
        ].filter(([, v]) => (v as number) > 0.1).map(([label, value]) => (
          <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 4px' }}>
            <span style={{ color: '#64748b' }}>{label}</span>
            <span style={{ color: '#e2e8f0' }}>{(value as number).toFixed(1)}</span>
          </div>
        ))}
      </div>
    </>
  ), [data.treasuryEth, data.treasuryUsd, data.treasuryBreakdown]);

  // ── Station 2: Auction Revenue (z = -45) ──

  const auctionContent = useMemo(() => (
    <>
      <div style={{
        fontSize: '22px',
        fontWeight: 900,
        color: '#ec4899',
        textShadow: '0 0 15px rgba(236,72,153,0.4)',
      }}>
        {data.totalAuctionRevenue > 0
          ? `${data.totalAuctionRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })} ETH`
          : '...'}
      </div>
      <div style={{ fontSize: '9px', color: '#94a3b8', marginTop: '2px' }}>
        Total Auction Revenue
      </div>
      <div style={{ fontSize: '8px', color: '#64748b', marginTop: '6px' }}>
        {data.nounCount > 0 ? `${data.nounCount} Nouns minted` : ''}
      </div>
      {data.recentAuctions.length > 0 && (
        <div style={{ marginTop: '8px', fontSize: '7px', color: '#475569' }}>
          Latest: Noun #{data.recentAuctions[0].nounId} — {data.recentAuctions[0].amount} ETH
        </div>
      )}
    </>
  ), [data.totalAuctionRevenue, data.nounCount, data.recentAuctions]);

  // ── Station 3: Monthly revenue bar chart data ──

  const monthlyBars = useMemo(() => {
    return data.monthlyRevenue.map(m => ({
      label: m.month.slice(5), // "01", "02", etc.
      value: m.eth,
      color: '#ec4899',
    }));
  }, [data.monthlyRevenue]);

  // ── Station 4: Proposal Stats (z = -125) ──

  const proposalContent = useMemo(() => (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '6px',
        marginTop: '4px',
      }}>
        {[
          ['Passed', data.proposals.passed, '#22c55e'],
          ['Failed', data.proposals.failed, '#ef4444'],
          ['Active', data.proposals.active, '#fbbf24'],
          ['Cancelled', data.proposals.cancelled, '#64748b'],
        ].map(([label, count, color]) => (
          <div key={label as string} style={{
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '4px',
            padding: '6px',
            border: `1px solid ${color}22`,
          }}>
            <div style={{ fontSize: '16px', fontWeight: 800, color: color as string }}>
              {count as number}
            </div>
            <div style={{ fontSize: '7px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {label}
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
        {data.proposals.total} Total Proposals
      </div>
    </>
  ), [data.proposals]);

  // ── Station 5: Spending categories bar data ──

  const spendingBars = useMemo(() => {
    return data.spendingByCategory.slice(0, 8).map((c: SpendingCategory) => ({
      label: c.category.slice(0, 6),
      value: c.ethAmount,
      color: c.color,
    }));
  }, [data.spendingByCategory]);

  // ── Station 6: Network stats (z = -205) ──

  const networkContent = useMemo(() => (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '6px',
      }}>
        {[
          ['Inflow', `${data.flowStats.totalInflow.toFixed(0)} ETH`, '#22c55e'],
          ['Outflow', `${data.flowStats.totalOutflow.toFixed(0)} ETH`, '#ef4444'],
          ['Addresses', data.flowStats.uniqueAddresses.toLocaleString(), '#60a5fa'],
          ['Transactions', data.flowStats.totalTransactions.toLocaleString(), '#fbbf24'],
          ['Voters', data.flowStats.uniqueVoters.toLocaleString(), '#a78bfa'],
          ['Votes', data.flowStats.totalVotes.toLocaleString(), '#ec4899'],
          ['Streams', data.flowStats.totalStreams.toLocaleString(), '#38bdf8'],
          ['Active', data.flowStats.activeStreams.toLocaleString(), '#34d399'],
        ].map(([label, value, color]) => (
          <div key={label as string} style={{
            padding: '4px',
            borderLeft: `2px solid ${color}`,
            paddingLeft: '6px',
          }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: color as string }}>
              {value}
            </div>
            <div style={{ fontSize: '7px', color: '#64748b' }}>{label}</div>
          </div>
        ))}
      </div>
    </>
  ), [data.flowStats]);

  return (
    <>
      {/* Station 1: Treasury Overview — LEFT wall */}
      <DataPanel
        position={[-6, 3.5, -5]}
        playerZ={playerZ}
        color="#fbbf24"
        title="Treasury"
        width={5}
        height={4}
      >
        {treasuryContent}
      </DataPanel>

      {/* Station 2: Auction Revenue — RIGHT wall */}
      <DataPanel
        position={[6, 3.5, -45]}
        playerZ={playerZ}
        color="#ec4899"
        title="Auction Revenue"
        width={5}
        height={3.5}
      >
        {auctionContent}
      </DataPanel>

      {/* Station 3: Monthly Revenue Bar Chart — LEFT wall */}
      {monthlyBars.length > 0 && (
        <BarChart3D
          data={monthlyBars}
          position={[-5, 1, -85]}
          playerZ={playerZ}
          maxHeight={2.5}
        />
      )}
      <DataPanel
        position={[-6, 4.5, -85]}
        playerZ={playerZ}
        color="#ec4899"
        title="Monthly Revenue"
        width={5}
        height={1.5}
      >
        <div style={{ fontSize: '9px', color: '#94a3b8' }}>
          Last {monthlyBars.length} months of auction revenue
        </div>
      </DataPanel>

      {/* Station 4: Proposal Stats — RIGHT wall */}
      <DataPanel
        position={[6, 3.5, -125]}
        playerZ={playerZ}
        color="#a78bfa"
        title="Proposals"
        width={5}
        height={4}
      >
        {proposalContent}
      </DataPanel>

      {/* Station 5: Spending Categories — LEFT wall */}
      {spendingBars.length > 0 && (
        <BarChart3D
          data={spendingBars}
          position={[-5, 1, -165]}
          playerZ={playerZ}
          maxHeight={2}
        />
      )}
      <DataPanel
        position={[-6, 4.5, -165]}
        playerZ={playerZ}
        color="#34d399"
        title="Spending Categories"
        width={5}
        height={1.5}
      >
        <div style={{ fontSize: '9px', color: '#94a3b8' }}>
          Passed proposals by category
        </div>
      </DataPanel>

      {/* Station 6: Network Stats — RIGHT wall */}
      <DataPanel
        position={[6, 3.5, -205]}
        playerZ={playerZ}
        color="#60a5fa"
        title="Network"
        width={5}
        height={4.5}
      >
        {networkContent}
      </DataPanel>
    </>
  );
}
